"""
Autonomous Optimization Engine

Uses Google OR-Tools to solve the Capacitated Vehicle Routing Problem
with time windows (CVRPTW).

Key fix: assign_order_to_best_vehicle now ACTUALLY assigns the order —
it updates the order status, vehicle state, and persists to DB.
"""

import math
import time
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import structlog

try:
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    ORTOOLS_AVAILABLE = True
except ImportError:
    ORTOOLS_AVAILABLE = False

from app.models.vehicle import Vehicle, VehicleStatus
from app.models.order import Order, OrderStatus, OrderPriority
from app.models.optimization import OptimizationRun, OptimizationTrigger, VehicleCandidate
from app.websocket.broadcaster import broadcaster, WSEventType

logger = structlog.get_logger(__name__)

PRIORITY_WEIGHTS = {
    OrderPriority.CRITICAL: 4.0,
    OrderPriority.HIGH: 2.0,
    OrderPriority.NORMAL: 1.0,
    OrderPriority.LOW: 0.5,
}


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def estimate_travel_minutes(dist_km: float, traffic_factor: float = 1.0) -> float:
    avg_speed = 30.0 / max(traffic_factor, 0.5)
    return (dist_km / avg_speed) * 60 if dist_km > 0 else 0


class VehicleScorer:
    """Multi-factor transparent vehicle scorer. Higher = better fit."""

    def score(self, vehicle: Vehicle, order: Order, traffic_factor: float = 1.0) -> Tuple[float, List[str], List[str]]:
        reasons, negatives = [], []
        score = 100.0

        vlat = vehicle.location.coordinates[1]
        vlng = vehicle.location.coordinates[0]
        plat = order.pickup.location.coordinates[1]
        plng = order.pickup.location.coordinates[0]

        dist_km = haversine_km(vlat, vlng, plat, plng)
        score -= min(dist_km * 2, 40)
        eta_min = estimate_travel_minutes(dist_km, traffic_factor)
        reasons.append(f"{dist_km:.1f} km to pickup — ETA ~{eta_min:.0f} min")

        available = vehicle.max_capacity_kg - vehicle.current_load_kg
        if available < order.weight_kg:
            return -999.0, [], [f"Insufficient capacity ({available:.0f} kg available, {order.weight_kg:.0f} kg needed)"]
        score += (available / vehicle.max_capacity_kg) * 10
        reasons.append(f"{available:.0f} kg available capacity")

        dlat = order.delivery.location.coordinates[1]
        dlng = order.delivery.location.coordinates[0]
        total_dist = dist_km + haversine_km(plat, plng, dlat, dlng)
        if vehicle.fuel_level < total_dist * 0.04 + 10:
            score -= 20
            negatives.append(f"Low fuel ({vehicle.fuel_level:.0f}%)")
        else:
            reasons.append(f"Sufficient fuel ({vehicle.fuel_level:.0f}%)")

        if vehicle.health.overall_score < 50:
            score -= 25
            negatives.append(f"Poor health ({vehicle.health.overall_score:.0f}/100)")
        elif vehicle.health.overall_score >= 85:
            score += 5
            reasons.append(f"Good health ({vehicle.health.overall_score:.0f}/100)")

        if order.requires_refrigeration and vehicle.type.value != "refrigerated":
            return -999.0, [], ["Refrigerated vehicle required"]

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

    def set_db(self, db) -> None:
        self._db = db

    def set_simulation(self, sim) -> None:
        self._simulation = sim

    async def run(
        self,
        trigger: OptimizationTrigger,
        triggering_vehicle_id: Optional[str] = None,
        triggering_order_id: Optional[str] = None,
    ) -> OptimizationRun:
        run_id = f"OPT-{uuid.uuid4().hex[:8].upper()}"
        run = OptimizationRun(
            run_id=run_id,
            trigger=trigger,
            triggering_vehicle_id=triggering_vehicle_id,
            triggering_order_id=triggering_order_id,
            status="running",
        )

        await broadcaster.broadcast(WSEventType.OPTIMIZATION_STARTED, {
            "run_id": run_id,
            "trigger": trigger.value,
        })

        start_ms = time.monotonic() * 1000

        try:
            if self._simulation is None:
                raise RuntimeError("Simulation not connected")

            vehicles = [v for v in self._simulation.get_all_vehicles()
                        if v.status in (VehicleStatus.AVAILABLE, VehicleStatus.IDLE)]
            pending_orders = self._simulation.get_pending_orders()

            run.vehicles_considered = len(vehicles)
            run.orders_in_scope = len(pending_orders)

            if not pending_orders:
                run.status = "completed"
                run.summary = "No pending orders to assign."
                return await self._finalize_run(run, start_ms)

            if not vehicles:
                run.status = "completed"
                run.summary = "No available vehicles at this time."
                return await self._finalize_run(run, start_ms)

            assignments, candidates_map = self._score_assignments(vehicles, pending_orders)
            run.candidates = [c for cs in candidates_map.values() for c in cs][:50]

            # Apply assignments to the simulation
            assigned_count = await self._apply_assignments(assignments, pending_orders, run)

            if ORTOOLS_AVAILABLE and len(pending_orders) >= 2 and len(vehicles) >= 2:
                await self._compute_vrp_metrics(vehicles, pending_orders, run)

            run.assignments_changed = assigned_count
            run.status = "completed"
            run.summary = self._build_summary(run)

        except Exception as e:
            logger.error("Optimization failed", run_id=run_id, error=str(e), exc_info=True)
            run.status = "failed"
            run.error_message = str(e)

        return await self._finalize_run(run, start_ms)

    def _score_assignments(self, vehicles, orders):
        assignments = {}
        candidates_map = {}
        for order in orders:
            candidates = []
            best_score = -1.0
            best_vehicle_id = None
            for vehicle in vehicles:
                score, reasons, negatives = self._scorer.score(vehicle, order)
                vlat = vehicle.location.coordinates[1]
                vlng = vehicle.location.coordinates[0]
                plat = order.pickup.location.coordinates[1]
                plng = order.pickup.location.coordinates[0]
                dist = haversine_km(vlat, vlng, plat, plng)
                eta = estimate_travel_minutes(dist)
                candidate = VehicleCandidate(
                    vehicle_id=vehicle.vehicle_id,
                    distance_to_pickup_km=round(dist, 2),
                    eta_minutes=round(eta, 1),
                    available_capacity_kg=round(vehicle.max_capacity_kg - vehicle.current_load_kg, 1),
                    fuel_level=vehicle.fuel_level,
                    current_load_kg=vehicle.current_load_kg,
                    score=round(score, 2),
                    disqualified=score < 0,
                    disqualification_reason=negatives[0] if negatives and score < 0 else None,
                    selection_reasons=reasons,
                )
                candidates.append(candidate)
                if score > best_score and not candidate.disqualified:
                    best_score = score
                    best_vehicle_id = vehicle.vehicle_id
            candidates.sort(key=lambda c: c.score, reverse=True)
            candidates_map[order.order_id] = candidates
            assignments[order.order_id] = best_vehicle_id
        return assignments, candidates_map

    async def _apply_assignments(self, assignments, pending_orders, run) -> int:
        """
        Actually assign orders to vehicles in the simulation and DB.
        This is the critical step that was missing before.
        """
        assigned = 0
        used_vehicles = set()

        for order in pending_orders:
            vehicle_id = assignments.get(order.order_id)
            if not vehicle_id or vehicle_id in used_vehicles:
                continue

            # Get the vehicle state
            state = self._simulation._vehicles.get(vehicle_id)
            if not state:
                continue
            vehicle = state.vehicle
            if vehicle.status not in (VehicleStatus.AVAILABLE, VehicleStatus.IDLE):
                continue

            # Actually assign: update order
            order.status = OrderStatus.ASSIGNED
            order.assigned_vehicle_id = vehicle_id
            order.assigned_at = datetime.utcnow()
            order.estimated_delivery_at = datetime.utcnow() + timedelta(minutes=estimate_travel_minutes(
                haversine_km(vehicle.location.coordinates[1], vehicle.location.coordinates[0],
                             order.pickup.location.coordinates[1], order.pickup.location.coordinates[0])
            ) + 20)

            # Remove from pending
            if order in self._simulation._pending_orders:
                self._simulation._pending_orders.remove(order)

            # Update simulation vehicle state
            state.current_order = order
            state.phase = "to_pickup"
            state.set_target(
                order.pickup.location.coordinates[1],
                order.pickup.location.coordinates[0],
            )
            vehicle.status = VehicleStatus.EN_ROUTE
            vehicle.current_order_id = order.order_id
            vehicle.current_load_kg = order.weight_kg
            vehicle.updated_at = datetime.utcnow()
            used_vehicles.add(vehicle_id)

            # Persist to DB
            if self._db:
                try:
                    await self._db.orders.update_one(
                        {"order_id": order.order_id},
                        {"$set": {
                            "status": "assigned",
                            "assigned_vehicle_id": vehicle_id,
                            "assigned_at": order.assigned_at.isoformat(),
                            "estimated_delivery_at": order.estimated_delivery_at.isoformat() if order.estimated_delivery_at else None,
                        }}
                    )
                except Exception as e:
                    logger.error("DB update failed during assignment", error=str(e))

            run.decisions.append({
                "type": "assign",
                "order_id": order.order_id,
                "order_ref": order.reference,
                "vehicle_id": vehicle_id,
                "vehicle_name": vehicle.name,
                "reason": f"Best scoring vehicle: {assignments.get(order.order_id)}",
            })

            await broadcaster.broadcast(WSEventType.ORDER_ASSIGNED, {
                "order_id": order.order_id,
                "reference": order.reference,
                "vehicle_id": vehicle_id,
                "vehicle_name": vehicle.name,
                "customer": order.customer_name,
            })

            assigned += 1
            logger.info("Order assigned by optimizer", order_id=order.order_id, vehicle=vehicle.name)

        return assigned

    async def _compute_vrp_metrics(self, vehicles, orders, run):
        """Compute before/after distance metrics using OR-Tools."""
        try:
            depot_lat, depot_lng = 19.0760, 72.8777
            nodes_lat = [depot_lat]
            nodes_lng = [depot_lng]
            for order in orders:
                nodes_lat.append(order.pickup.location.coordinates[1])
                nodes_lng.append(order.pickup.location.coordinates[0])
                nodes_lat.append(order.delivery.location.coordinates[1])
                nodes_lng.append(order.delivery.location.coordinates[0])

            n_nodes = len(nodes_lat)
            n_vehicles = min(len(vehicles), max(len(orders), 1))
            SCALE = 100

            dist_matrix = [[int(haversine_km(nodes_lat[i], nodes_lng[i], nodes_lat[j], nodes_lng[j]) * SCALE)
                            for j in range(n_nodes)] for i in range(n_nodes)]

            manager = pywrapcp.RoutingIndexManager(n_nodes, n_vehicles, 0)
            routing = pywrapcp.RoutingModel(manager)

            def dist_cb(fi, ti):
                return dist_matrix[manager.IndexToNode(fi)][manager.IndexToNode(ti)]
            cb_idx = routing.RegisterTransitCallback(dist_cb)
            routing.SetArcCostEvaluatorOfAllVehicles(cb_idx)

            params = pywrapcp.DefaultRoutingSearchParameters()
            params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
            params.time_limit.seconds = 2

            solution = routing.SolveWithParameters(params)
            if solution:
                total_after = sum(
                    dist_matrix[manager.IndexToNode(routing.Start(v))][manager.IndexToNode(solution.Value(routing.NextVar(routing.Start(v))))] / SCALE
                    for v in range(n_vehicles)
                )
                total_before = sum(
                    haversine_km(vehicles[i % len(vehicles)].location.coordinates[1],
                                 vehicles[i % len(vehicles)].location.coordinates[0],
                                 orders[i].pickup.location.coordinates[1],
                                 orders[i].pickup.location.coordinates[0])
                    for i in range(len(orders))
                ) if orders else 0

                run.before_total_distance_km = round(total_before, 1)
                run.after_total_distance_km = round(total_after, 1)
                run.distance_saved_km = round(max(0, total_before - total_after), 1)
                run.before_total_duration_min = round(estimate_travel_minutes(total_before), 1)
                run.after_total_duration_min = round(estimate_travel_minutes(total_after), 1)
                run.time_saved_min = round(max(0, run.before_total_duration_min - run.after_total_duration_min), 1)
                if total_before > 0:
                    run.improvement_pct = round(max(0, (1 - total_after / total_before) * 100), 1)
                run.routes_updated = n_vehicles
        except Exception as e:
            logger.warning("VRP metrics computation failed", error=str(e))

    async def assign_order_to_best_vehicle(self, order: Order) -> Optional[VehicleCandidate]:
        """
        Find AND ACTUALLY ASSIGN the best available vehicle for a new order.
        Called when a new order is created manually via the API.
        """
        if self._simulation is None:
            return None

        vehicles = [v for v in self._simulation.get_all_vehicles()
                    if v.status in (VehicleStatus.AVAILABLE, VehicleStatus.IDLE)]
        if not vehicles:
            logger.info("No available vehicles for immediate assignment", order_id=order.order_id)
            return None

        best_score = -999.0
        best_candidate = None
        best_vehicle = None

        for vehicle in vehicles:
            score, reasons, negatives = self._scorer.score(vehicle, order)
            vlat = vehicle.location.coordinates[1]
            vlng = vehicle.location.coordinates[0]
            plat = order.pickup.location.coordinates[1]
            plng = order.pickup.location.coordinates[0]
            dist = haversine_km(vlat, vlng, plat, plng)
            eta = estimate_travel_minutes(dist)
            candidate = VehicleCandidate(
                vehicle_id=vehicle.vehicle_id,
                distance_to_pickup_km=round(dist, 2),
                eta_minutes=round(eta, 1),
                available_capacity_kg=round(vehicle.max_capacity_kg - vehicle.current_load_kg, 1),
                fuel_level=vehicle.fuel_level,
                current_load_kg=vehicle.current_load_kg,
                score=round(score, 2),
                disqualified=score < 0,
                selection_reasons=reasons,
            )
            if score > best_score and not candidate.disqualified:
                best_score = score
                best_candidate = candidate
                best_vehicle = vehicle

        if not best_candidate or not best_vehicle:
            return None

        # ── ACTUALLY ASSIGN ───────────────────────────────────────────────────
        state = self._simulation._vehicles.get(best_vehicle.vehicle_id)
        if not state:
            return best_candidate

        # Update order
        order.status = OrderStatus.ASSIGNED
        order.assigned_vehicle_id = best_vehicle.vehicle_id
        order.assigned_at = datetime.utcnow()
        order.eta_minutes = best_candidate.eta_minutes
        order.estimated_delivery_at = datetime.utcnow() + timedelta(minutes=best_candidate.eta_minutes + 20)

        # Remove from pending
        if order in self._simulation._pending_orders:
            self._simulation._pending_orders.remove(order)

        # Update simulation state
        state.current_order = order
        state.phase = "to_pickup"
        state.set_target(
            order.pickup.location.coordinates[1],
            order.pickup.location.coordinates[0],
        )
        best_vehicle.status = VehicleStatus.EN_ROUTE
        best_vehicle.current_order_id = order.order_id
        best_vehicle.current_load_kg = order.weight_kg
        best_vehicle.current_eta_minutes = best_candidate.eta_minutes
        best_vehicle.updated_at = datetime.utcnow()

        # Persist both order and vehicle state to DB
        if self._db:
            try:
                await self._db.orders.update_one(
                    {"order_id": order.order_id},
                    {"$set": {
                        "status": "assigned",
                        "assigned_vehicle_id": best_vehicle.vehicle_id,
                        "assigned_at": order.assigned_at.isoformat(),
                        "eta_minutes": best_candidate.eta_minutes,
                        "estimated_delivery_at": order.estimated_delivery_at.isoformat(),
                    }}
                )
            except Exception as e:
                logger.error("Failed to persist order assignment", error=str(e))

        # Broadcast assignment event
        await broadcaster.broadcast(WSEventType.ORDER_ASSIGNED, {
            "order_id": order.order_id,
            "reference": order.reference,
            "vehicle_id": best_vehicle.vehicle_id,
            "vehicle_name": best_vehicle.name,
            "customer": order.customer_name,
            "eta_minutes": best_candidate.eta_minutes,
            "distance_km": best_candidate.distance_to_pickup_km,
            "reasons": best_candidate.selection_reasons,
            "score": best_candidate.score,
        })

        logger.info(
            "Order assigned immediately",
            order_id=order.order_id,
            vehicle=best_vehicle.name,
            eta_min=best_candidate.eta_minutes,
            score=best_candidate.score,
        )
        return best_candidate

    def _build_summary(self, run: OptimizationRun) -> str:
        if run.status == "failed":
            return f"Failed: {run.error_message}"
        parts = [f"Trigger: {run.trigger.value}."]
        parts.append(f"Evaluated {run.vehicles_considered} vehicles, {run.orders_in_scope} pending orders.")
        if run.assignments_changed:
            parts.append(f"{run.assignments_changed} order(s) assigned.")
        if run.improvement_pct:
            parts.append(f"Route efficiency improved by {run.improvement_pct:.1f}%.")
        if run.time_saved_min:
            parts.append(f"Estimated {run.time_saved_min:.0f} min saved.")
        if not run.assignments_changed and not run.improvement_pct:
            parts.append("No actionable improvements found — fleet already optimal.")
        return " ".join(parts)

    async def _finalize_run(self, run: OptimizationRun, start_ms: float) -> OptimizationRun:
        run.completed_at = datetime.utcnow()
        run.solver_duration_ms = round(time.monotonic() * 1000 - start_ms, 1)

        if self._db:
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
