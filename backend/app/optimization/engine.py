"""
Dispatch / Optimization Engine

Decides which available vehicle serves which pending order.

How it works
------------
1. Every (order, vehicle) pair is scored by `VehicleScorer`. Hard constraints
   (operating region, capacity, cold chain, fuel range) disqualify a pair;
   soft factors (pickup distance, health, deadline pressure) shape the score.
2. The optimal one-to-one assignment minimising total pickup distance - with a
   priority bonus so critical orders win scarce vehicles - is found with the
   Hungarian algorithm (scipy.optimize.linear_sum_assignment).
3. As an honest baseline we also compute what a naive dispatcher would have done:
   serve orders first-come-first-served, each taking the nearest feasible vehicle.
   Reported "improvement" is the real difference between those two plans, measured
   on the same quantity (total pickup distance / time) - never a fabricated figure.

Runs that did nothing (no assignment made, not requested manually) are not
persisted, so the history only contains meaningful decisions.
"""
import asyncio
import time
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
import structlog
from scipy.optimize import linear_sum_assignment

from app.models.optimization import OptimizationRun, OptimizationTrigger, VehicleCandidate
from app.models.order import Order, OrderPriority, OrderStatus
from app.models.vehicle import Vehicle, VehicleStatus
from app.simulation.engine import fuel_use_pct_per_km
from app.utils.geo import haversine_km, region_for_lng
from app.websocket.broadcaster import WSEventType, broadcaster

logger = structlog.get_logger(__name__)

PRIORITY_WEIGHTS = {
    OrderPriority.CRITICAL: 4.0,
    OrderPriority.HIGH: 2.0,
    OrderPriority.NORMAL: 1.0,
    OrderPriority.LOW: 0.5,
}
# Distance-equivalent bonus (km) for serving an order when vehicles are scarce.
PRIORITY_BONUS_KM = {
    OrderPriority.CRITICAL: 60.0,
    OrderPriority.HIGH: 30.0,
    OrderPriority.NORMAL: 10.0,
    OrderPriority.LOW: 0.0,
}
INFEASIBLE_COST = 1e6
FUEL_RESERVE_PCT = 10.0


def estimate_travel_minutes(dist_km: float, traffic_factor: float = 1.0) -> float:
    avg_speed = 30.0 / max(traffic_factor, 0.5)
    return (dist_km / avg_speed) * 60 if dist_km > 0 else 0


def _vehicle_region(v: Vehicle) -> str:
    return v.region or region_for_lng(v.location.coordinates[0])


def _order_region(o: Order) -> str:
    return o.region or region_for_lng(o.pickup.location.coordinates[0])


class VehicleScorer:
    """Multi-factor, explainable vehicle scorer. Higher = better fit; negative = disqualified."""

    def score(
        self,
        vehicle: Vehicle,
        order: Order,
        traffic_factor: float = 1.0,
        speed_kmh: Optional[float] = None,
    ) -> Tuple[float, List[str], List[str]]:
        reasons: List[str] = []
        negatives: List[str] = []
        score = 100.0

        if _vehicle_region(vehicle) != _order_region(order):
            return -999.0, [], [f"Different operating region ({_vehicle_region(vehicle)} vehicle, {_order_region(order)} order)"]

        vlat, vlng = vehicle.location.coordinates[1], vehicle.location.coordinates[0]
        plat, plng = order.pickup.location.coordinates[1], order.pickup.location.coordinates[0]
        dlat, dlng = order.delivery.location.coordinates[1], order.delivery.location.coordinates[0]

        dist_km = haversine_km(vlat, vlng, plat, plng)
        score -= min(dist_km * 2, 40)
        eta_min = dist_km / speed_kmh * 60 if speed_kmh else estimate_travel_minutes(dist_km, traffic_factor)
        reasons.append(f"{dist_km:.1f} km to pickup - ETA ~{eta_min:.0f} min")

        available = vehicle.max_capacity_kg - vehicle.current_load_kg
        if available < order.weight_kg:
            return -999.0, [], [f"Insufficient capacity ({available:.0f} kg available, {order.weight_kg:.0f} kg needed)"]
        score += (available / vehicle.max_capacity_kg) * 10 if vehicle.max_capacity_kg else 0
        reasons.append(f"{available:.0f} kg available capacity")

        if order.requires_refrigeration and vehicle.type.value != "refrigerated":
            return -999.0, [], ["Refrigerated vehicle required"]
        if vehicle.type.value == "refrigerated" and not order.requires_refrigeration:
            score -= 10
            negatives.append("Refrigerated vehicle reserved for cold-chain orders")

        total_dist = dist_km + haversine_km(plat, plng, dlat, dlng)
        needed_pct = fuel_use_pct_per_km(vehicle.fuel_type.value, vehicle.type.value) * total_dist + FUEL_RESERVE_PCT
        if vehicle.fuel_level < needed_pct:
            return -999.0, [], [f"Insufficient fuel ({vehicle.fuel_level:.0f}% available, ~{needed_pct:.0f}% needed incl. reserve)"]
        reasons.append(f"Sufficient fuel ({vehicle.fuel_level:.0f}%)")

        if vehicle.health.overall_score < 50:
            score -= 25
            negatives.append(f"Poor health ({vehicle.health.overall_score:.0f}/100)")
        elif vehicle.health.overall_score >= 85:
            score += 5
            reasons.append(f"Good health ({vehicle.health.overall_score:.0f}/100)")

        score += PRIORITY_WEIGHTS.get(order.priority, 1.0) * 3

        if order.deadline and isinstance(order.deadline, datetime):
            deadline_in = (order.deadline - datetime.utcnow()).total_seconds() / 60
            if deadline_in < eta_min + 30:
                score -= 15
                negatives.append(f"Tight deadline ({deadline_in:.0f} min remaining)")
            else:
                reasons.append(f"Deadline comfortable ({deadline_in:.0f} min)")

        return max(score, 0.0), reasons, negatives


class OptimizationEngine:
    def __init__(self) -> None:
        self._scorer = VehicleScorer()
        self._db = None
        self._simulation = None
        self._lock = asyncio.Lock()

    def set_db(self, db) -> None:
        self._db = db

    def set_simulation(self, sim) -> None:
        self._simulation = sim

    # ── Public entry points ───────────────────────────────────────────────────
    async def dispatch(
        self,
        trigger: OptimizationTrigger,
        triggering_vehicle_id: Optional[str] = None,
        triggering_order_id: Optional[str] = None,
        triggering_incident_id: Optional[str] = None,
    ) -> Optional[OptimizationRun]:
        """Automatic dispatch used by the simulation. Periodic runs skip if one is already in flight."""
        if trigger == OptimizationTrigger.SCHEDULED and self._lock.locked():
            return None
        return await self.run(trigger, triggering_vehicle_id, triggering_order_id, triggering_incident_id)

    async def run(
        self,
        trigger: OptimizationTrigger,
        triggering_vehicle_id: Optional[str] = None,
        triggering_order_id: Optional[str] = None,
        triggering_incident_id: Optional[str] = None,
    ) -> OptimizationRun:
        async with self._lock:
            run = OptimizationRun(
                run_id=f"OPT-{uuid.uuid4().hex[:8].upper()}",
                trigger=trigger,
                triggering_vehicle_id=triggering_vehicle_id,
                triggering_order_id=triggering_order_id,
                triggering_incident_id=triggering_incident_id,
                status="running",
            )
            if trigger == OptimizationTrigger.MANUAL:
                await broadcaster.broadcast(WSEventType.OPTIMIZATION_STARTED,
                                            {"run_id": run.run_id, "trigger": trigger.value})
            start_ms = time.monotonic() * 1000
            try:
                if self._simulation is None:
                    raise RuntimeError("Simulation not connected")
                await self._optimise(run)
                run.status = "completed"
            except Exception as e:
                logger.error("Optimization failed", run_id=run.run_id, error=str(e), exc_info=True)
                run.status = "failed"
                run.error_message = str(e)
                run.summary = f"Failed: {e}"
            return await self._finalize_run(run, start_ms)

    # ── Core ──────────────────────────────────────────────────────────────────
    async def _optimise(self, run: OptimizationRun) -> None:
        sim = self._simulation
        vehicles = [v for v in sim.get_all_vehicles() if v.status == VehicleStatus.AVAILABLE]
        orders = [o for o in sim.get_pending_orders() if o.status == OrderStatus.PENDING]
        run.vehicles_considered = len(vehicles)
        run.orders_in_scope = len(orders)

        if not orders:
            run.summary = "No pending orders - nothing to dispatch."
            return
        if not vehicles:
            run.summary = f"{len(orders)} order(s) waiting; no vehicle is currently available."
            return

        scored = self._score_matrix(vehicles, orders)
        optimal = self._solve_assignment(orders, vehicles, scored)
        baseline = self._baseline_assignment(orders, vehicles, scored)
        self._fill_metrics(run, orders, vehicles, scored, baseline, optimal)
        run.candidates = self._top_candidates(orders, vehicles, scored)

        assigned = 0
        for oi, vi in sorted(optimal.items()):
            order, vehicle = orders[oi], vehicles[vi]
            if not await sim.assign_order(vehicle.vehicle_id, order):
                continue
            assigned += 1
            cell = scored[oi][vi]
            baseline_vehicle = vehicles[baseline[oi]].name if oi in baseline else None
            reason = "; ".join(cell["reasons"][:3])
            if baseline_vehicle and baseline[oi] != vi:
                reason += f". Chosen over nearest-first pick {baseline_vehicle} to improve the overall plan."
            run.decisions.append({
                "type": "assign",
                "order_id": order.order_id,
                "order_ref": order.reference,
                "priority": order.priority.value,
                "vehicle_id": vehicle.vehicle_id,
                "vehicle_name": vehicle.name,
                "distance_km": round(cell["dist"], 2),
                "eta_minutes": round(cell["eta"], 1),
                "score": round(cell["score"], 1),
                "reason": reason,
            })
        for oi, order in enumerate(orders):
            if oi in optimal:
                continue
            blockers: Dict[str, int] = {}
            region = _order_region(order)
            same_region = [vi for vi in range(len(vehicles)) if _vehicle_region(vehicles[vi]) == region]
            for vi in same_region:
                cell = scored[oi][vi]
                if cell["disqualified"] and cell["negatives"]:
                    key = cell["negatives"][0].split(" (")[0]
                    blockers[key] = blockers.get(key, 0) + 1
            if not same_region:
                reason = f"Waiting: no free vehicle in {region}"
            elif blockers:
                reason = f"Waiting: {max(blockers, key=blockers.get)}"
            else:
                reason = "Waiting: free vehicles were assigned to higher-value orders"
            run.decisions.append({
                "type": "unassigned",
                "order_id": order.order_id,
                "order_ref": order.reference,
                "priority": order.priority.value,
                "reason": reason,
            })

        run.assignments_changed = assigned
        run.routes_updated = assigned
        run.summary = self._build_summary(run, len(orders), assigned)

    def _score_matrix(self, vehicles: List[Vehicle], orders: List[Order]) -> List[List[dict]]:
        sim = self._simulation
        matrix: List[List[dict]] = []
        for order in orders:
            plat, plng = order.pickup.location.coordinates[1], order.pickup.location.coordinates[0]
            row = []
            for vehicle in vehicles:
                speed = sim.expected_speed_kmh(vehicle) if sim else None
                score, reasons, negatives = self._scorer.score(vehicle, order, speed_kmh=speed)
                dist = haversine_km(vehicle.location.coordinates[1], vehicle.location.coordinates[0], plat, plng)
                eta = dist / speed * 60 if speed else estimate_travel_minutes(dist)
                row.append({
                    "score": score, "reasons": reasons, "negatives": negatives,
                    "dist": dist, "eta": eta, "disqualified": score < 0,
                })
            matrix.append(row)
        return matrix

    @staticmethod
    def _solve_assignment(orders: List[Order], vehicles: List[Vehicle], scored) -> Dict[int, int]:
        """Hungarian algorithm on pickup distance, with a per-order priority bonus."""
        cost = np.empty((len(orders), len(vehicles)))
        for oi, order in enumerate(orders):
            bonus = PRIORITY_BONUS_KM.get(order.priority, 0.0)
            for vi in range(len(vehicles)):
                cell = scored[oi][vi]
                cost[oi, vi] = INFEASIBLE_COST if cell["disqualified"] else cell["dist"] - bonus
        rows, cols = linear_sum_assignment(cost)
        return {int(r): int(c) for r, c in zip(rows, cols) if cost[r, c] < INFEASIBLE_COST / 2}

    @staticmethod
    def _baseline_assignment(orders: List[Order], vehicles: List[Vehicle], scored) -> Dict[int, int]:
        """Naive dispatcher: first-come-first-served, each order takes the nearest feasible free vehicle."""
        taken: set = set()
        plan: Dict[int, int] = {}
        for oi in sorted(range(len(orders)), key=lambda i: orders[i].created_at):
            best, best_d = None, float("inf")
            for vi in range(len(vehicles)):
                cell = scored[oi][vi]
                if vi in taken or cell["disqualified"]:
                    continue
                if cell["dist"] < best_d:
                    best, best_d = vi, cell["dist"]
            if best is not None:
                taken.add(best)
                plan[oi] = best
        return plan

    @staticmethod
    def _fill_metrics(run, orders, vehicles, scored, baseline, optimal) -> None:
        """Compare both plans on the orders they both serve (like-for-like)."""
        common = [oi for oi in optimal if oi in baseline]
        if not common:
            return
        before_km = sum(scored[oi][baseline[oi]]["dist"] for oi in common)
        after_km = sum(scored[oi][optimal[oi]]["dist"] for oi in common)
        before_min = sum(scored[oi][baseline[oi]]["eta"] for oi in common)
        after_min = sum(scored[oi][optimal[oi]]["eta"] for oi in common)
        run.before_total_distance_km = round(before_km, 2)
        run.after_total_distance_km = round(after_km, 2)
        run.before_total_duration_min = round(before_min, 1)
        run.after_total_duration_min = round(after_min, 1)
        run.distance_saved_km = round(before_km - after_km, 2)
        run.time_saved_min = round(before_min - after_min, 1)
        run.improvement_pct = round((before_km - after_km) / before_km * 100, 1) if before_km > 0 else 0.0

    @staticmethod
    def _top_candidates(orders, vehicles, scored, per_order: int = 4, cap: int = 40) -> List[VehicleCandidate]:
        out: List[VehicleCandidate] = []
        for oi in range(len(orders)):
            ranked = sorted(range(len(vehicles)), key=lambda vi: scored[oi][vi]["score"], reverse=True)[:per_order]
            for vi in ranked:
                cell, v = scored[oi][vi], vehicles[vi]
                out.append(VehicleCandidate(
                    vehicle_id=v.vehicle_id,
                    distance_to_pickup_km=round(cell["dist"], 2),
                    eta_minutes=round(cell["eta"], 1),
                    available_capacity_kg=round(v.max_capacity_kg - v.current_load_kg, 1),
                    fuel_level=round(v.fuel_level, 1),
                    current_load_kg=round(v.current_load_kg, 1),
                    score=round(cell["score"], 2),
                    disqualified=cell["disqualified"],
                    disqualification_reason=cell["negatives"][0] if cell["disqualified"] and cell["negatives"] else None,
                    selection_reasons=cell["reasons"],
                ))
            if len(out) >= cap:
                break
        return out[:cap]

    @staticmethod
    def _build_summary(run: OptimizationRun, n_orders: int, assigned: int) -> str:
        parts = [f"Assigned {assigned} of {n_orders} pending order(s) using {run.vehicles_considered} available vehicle(s)."]
        waiting = n_orders - assigned
        if waiting:
            parts.append(f"{waiting} still waiting.")
        if run.before_total_distance_km is not None and run.after_total_distance_km is not None:
            delta = run.improvement_pct or 0.0
            parts.append(
                f"Total pickup distance {run.after_total_distance_km:.1f} km vs "
                f"{run.before_total_distance_km:.1f} km with first-come nearest-vehicle dispatch "
                f"({delta:+.1f}%)."
            )
        return " ".join(parts)

    # ── Persistence ───────────────────────────────────────────────────────────
    async def _finalize_run(self, run: OptimizationRun, start_ms: float) -> OptimizationRun:
        run.completed_at = datetime.utcnow()
        run.solver_duration_ms = round(time.monotonic() * 1000 - start_ms, 1)

        meaningful = (run.trigger == OptimizationTrigger.MANUAL
                      or run.assignments_changed > 0
                      or run.status == "failed")
        if not meaningful:
            return run

        if self._db is not None:
            try:
                await self._db.optimization_runs.insert_one(run.model_dump())
            except Exception as e:
                logger.error("Failed to persist optimization run", error=str(e))

        await broadcaster.broadcast(WSEventType.OPTIMIZATION_COMPLETED, {
            "run_id": run.run_id,
            "status": run.status,
            "trigger": run.trigger.value,
            "improvement_pct": run.improvement_pct,
            "assignments_changed": run.assignments_changed,
            "distance_saved_km": run.distance_saved_km,
            "time_saved_min": run.time_saved_min,
            "summary": run.summary,
        })
        return run


optimization_engine = OptimizationEngine()
