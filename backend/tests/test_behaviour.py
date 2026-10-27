"""
Behaviour tests - these exercise what the platform actually *does* end-to-end
(dispatch, breakdown recovery, order lifecycle, ML sanity) rather than just
checking that objects can be constructed.
"""
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.incident import IncidentStatus
from app.models.optimization import OptimizationTrigger
from app.models.order import AddressPoint, Order, OrderPriority, OrderStatus
from app.models.vehicle import FuelType, GeoPoint, Vehicle, VehicleStatus, VehicleType
from app.optimization.engine import OptimizationEngine, VehicleScorer
from app.simulation import engine as sim_module
from app.simulation.engine import SimulationEngine

MUMBAI_LNG = 72.87
DELHI_LNG = 77.20


def km_to_lat(km: float) -> float:
    return km / 111.0


def make_vehicle(vid, lat, lng=MUMBAI_LNG, capacity=1000.0, fuel=90.0, vtype=VehicleType.VAN,
                 fuel_type=FuelType.DIESEL) -> Vehicle:
    return Vehicle(
        vehicle_id=vid, name=vid.upper(), type=vtype, fuel_type=fuel_type,
        location=GeoPoint(coordinates=[lng, lat]), max_capacity_kg=capacity, fuel_level=fuel,
    )


_order_seq = 0


def make_order(oid, plat, dlat=None, lng=MUMBAI_LNG, weight=50.0, priority=OrderPriority.NORMAL,
               age_min=0, refrigerated=False) -> Order:
    global _order_seq
    _order_seq += 1
    return Order(
        order_id=oid, reference=oid.upper(), customer_name="Test Co", priority=priority,
        pickup=AddressPoint(address="pickup", location=GeoPoint(coordinates=[lng, plat])),
        delivery=AddressPoint(address="drop", location=GeoPoint(coordinates=[lng, dlat if dlat is not None else plat + 0.01])),
        weight_kg=weight, requires_refrigeration=refrigerated,
        created_at=datetime.utcnow() - timedelta(minutes=age_min),
    )


@pytest.fixture
def quiet_sim(monkeypatch):
    """A simulation with no random order generation or breakdowns, 60s per tick."""
    monkeypatch.setattr(sim_module, "ORDER_GEN_PROBABILITY", 0.0)
    monkeypatch.setattr(sim_module, "BREAKDOWN_RATE_PER_TICK", 0.0)
    engine = SimulationEngine()
    engine.interval = 60.0
    return engine


def wire(engine: SimulationEngine) -> OptimizationEngine:
    opt = OptimizationEngine()
    opt.set_simulation(engine)

    async def dispatcher(trigger, **kwargs):
        return await opt.dispatch(trigger, **kwargs)

    engine.register_dispatcher(dispatcher)
    return opt


# ── Dispatch correctness ──────────────────────────────────────────────────────

class TestDispatch:
    def test_vehicle_in_other_region_is_disqualified(self):
        delhi_van = make_vehicle("delhi-van", 28.6, lng=DELHI_LNG)
        order = make_order("mumbai-order", 19.07)
        score, _, negatives = VehicleScorer().score(delhi_van, order)
        assert score < 0
        assert "region" in negatives[0].lower()

    def test_low_fuel_vehicle_is_disqualified_for_long_trip(self):
        v = make_vehicle("tired", 19.0, fuel=11.0)
        far_order = make_order("far", 19.0 + km_to_lat(3), dlat=19.0 + km_to_lat(40))
        score, _, negatives = VehicleScorer().score(v, far_order)
        assert score < 0
        assert "fuel" in negatives[0].lower()

    @pytest.mark.asyncio
    async def test_hungarian_beats_first_come_nearest_dispatch(self, quiet_sim):
        """
        V1 at 0 km, V2 at 6 km. O1 (older) is at 2.9 km, O2 is at 0 km.
        Naive FIFO gives O1->V1 (2.9) and O2->V2 (6.0) = 8.9 km.
        Optimal gives O1->V2 (3.1) and O2->V1 (0.0) = 3.1 km.
        """
        opt = wire(quiet_sim)
        base = 19.0
        quiet_sim.load_vehicles([make_vehicle("v1", base), make_vehicle("v2", base + km_to_lat(6))])
        o1 = make_order("o1", base + km_to_lat(2.9), age_min=10)
        o2 = make_order("o2", base, age_min=1)
        await quiet_sim.add_order(o1, dispatch=False)
        await quiet_sim.add_order(o2, dispatch=False)

        run = await opt.run(OptimizationTrigger.MANUAL)

        assert run.assignments_changed == 2
        assert o2.assigned_vehicle_id == "v1"
        assert o1.assigned_vehicle_id == "v2"
        assert run.before_total_distance_km == pytest.approx(8.9, abs=0.2)
        assert run.after_total_distance_km == pytest.approx(3.1, abs=0.2)
        assert run.improvement_pct > 50

    @pytest.mark.asyncio
    async def test_single_order_reports_no_fake_improvement(self, quiet_sim):
        opt = wire(quiet_sim)
        quiet_sim.load_vehicles([make_vehicle("v1", 19.0), make_vehicle("v2", 19.2)])
        await quiet_sim.add_order(make_order("solo", 19.01), dispatch=False)
        run = await opt.run(OptimizationTrigger.MANUAL)
        assert run.assignments_changed == 1
        assert run.improvement_pct == 0.0
        assert run.distance_saved_km == 0.0

    @pytest.mark.asyncio
    async def test_critical_order_wins_the_only_vehicle(self, quiet_sim):
        opt = wire(quiet_sim)
        quiet_sim.load_vehicles([make_vehicle("only", 19.0)])
        low = make_order("low", 19.0, priority=OrderPriority.LOW, age_min=30)
        crit = make_order("crit", 19.0 + km_to_lat(5), priority=OrderPriority.CRITICAL, age_min=1)
        await quiet_sim.add_order(low, dispatch=False)
        await quiet_sim.add_order(crit, dispatch=False)
        await opt.run(OptimizationTrigger.MANUAL)
        assert crit.assigned_vehicle_id == "only"
        assert low.status == OrderStatus.PENDING

    @pytest.mark.asyncio
    async def test_never_dispatches_across_regions(self, quiet_sim):
        opt = wire(quiet_sim)
        quiet_sim.load_vehicles([make_vehicle("delhi-van", 28.6, lng=DELHI_LNG)])
        order = make_order("mum", 19.07)
        await quiet_sim.add_order(order, dispatch=False)
        run = await opt.run(OptimizationTrigger.MANUAL)
        assert run.assignments_changed == 0
        assert order.status == OrderStatus.PENDING
        assert any(d["type"] == "unassigned" for d in run.decisions)

    @pytest.mark.asyncio
    async def test_idle_scheduled_runs_are_not_persisted(self, quiet_sim):
        opt = wire(quiet_sim)
        db = MagicMock()
        db.optimization_runs.insert_one = AsyncMock()
        opt.set_db(db)
        quiet_sim.load_vehicles([make_vehicle("v1", 19.0)])

        await opt.run(OptimizationTrigger.SCHEDULED)          # nothing pending
        db.optimization_runs.insert_one.assert_not_called()

        await opt.run(OptimizationTrigger.MANUAL)             # user asked - keep a record
        assert db.optimization_runs.insert_one.await_count == 1


# ── Order lifecycle & incident handling ───────────────────────────────────────

class TestSimulationBehaviour:
    @pytest.mark.asyncio
    async def test_order_goes_from_pending_to_delivered(self, quiet_sim):
        wire(quiet_sim)
        quiet_sim.load_vehicles([make_vehicle("v1", 19.0)])
        order = make_order("job", 19.0 + km_to_lat(0.5), dlat=19.0 + km_to_lat(2.0), weight=120)
        await quiet_sim.add_order(order)                       # dispatches immediately
        assert order.assigned_vehicle_id == "v1"
        assert order.predicted_eta_minutes and order.predicted_eta_minutes > 0

        seen = set()
        for _ in range(60):
            await quiet_sim._tick()
            seen.add(order.status)
            if order.status == OrderStatus.DELIVERED:
                break

        assert order.status == OrderStatus.DELIVERED
        assert {OrderStatus.PICKUP_EN_ROUTE, OrderStatus.PICKED_UP, OrderStatus.DELIVERY_EN_ROUTE} <= seen
        vehicle = quiet_sim.get_vehicle("v1")
        assert vehicle.status == VehicleStatus.AVAILABLE and vehicle.current_load_kg == 0
        assert order.actual_duration_min and order.actual_duration_min > 0
        assert order.actual_distance_km and order.actual_distance_km > 1
        assert order.order_id not in {o.order_id for o in quiet_sim.get_all_orders()}

    @pytest.mark.asyncio
    async def test_breakdown_reassigns_the_active_order(self, quiet_sim):
        wire(quiet_sim)
        quiet_sim.load_vehicles([make_vehicle("v1", 19.0), make_vehicle("v2", 19.0 + km_to_lat(8))])
        order = make_order("job", 19.0 + km_to_lat(1), dlat=19.0 + km_to_lat(12))
        await quiet_sim.add_order(order)
        first = order.assigned_vehicle_id
        other = "v2" if first == "v1" else "v1"
        await quiet_sim._tick()

        hit = await quiet_sim.trigger_breakdown_event(first)

        assert hit == first
        assert quiet_sim.get_vehicle(first).status == VehicleStatus.BREAKDOWN
        assert order.assigned_vehicle_id == other, "order must move to the healthy vehicle"
        assert order.reassignment_count == 1
        assert quiet_sim.get_vehicle(first).current_order_id is None
        incident = next(i for i in quiet_sim._incidents.values() if i.vehicle_id == first)
        assert incident.status == IncidentStatus.ACTION_TAKEN
        assert any(a.action_type == "reassign_order" for a in incident.autonomous_actions)
        assert len(incident.timeline) >= 3

    @pytest.mark.asyncio
    async def test_breakdown_with_no_spare_vehicle_queues_order(self, quiet_sim):
        wire(quiet_sim)
        quiet_sim.load_vehicles([make_vehicle("solo", 19.0)])
        order = make_order("job", 19.0 + km_to_lat(1))
        await quiet_sim.add_order(order)
        await quiet_sim.trigger_breakdown_event("solo")
        assert order.status == OrderStatus.PENDING and order.assigned_vehicle_id is None
        incident = next(iter(quiet_sim._incidents.values()))
        assert incident.status == IncidentStatus.MONITORING

    @pytest.mark.asyncio
    async def test_broken_vehicle_is_repaired_and_incident_resolved(self, quiet_sim):
        wire(quiet_sim)
        quiet_sim.load_vehicles([make_vehicle("v1", 19.0)])
        await quiet_sim._trigger_breakdown(quiet_sim._vehicles["v1"])
        for _ in range(40):                                   # 40 x 60s = 40 simulated minutes
            await quiet_sim._tick()
        assert quiet_sim.get_vehicle("v1").status == VehicleStatus.AVAILABLE
        incident = next(iter(quiet_sim._incidents.values()))
        assert incident.status == IncidentStatus.RESOLVED and incident.resolved_at is not None

    @pytest.mark.asyncio
    async def test_traffic_surge_slows_vehicles_then_expires(self, quiet_sim):
        v = make_vehicle("v1", 19.0)
        quiet_sim.load_vehicles([v])
        before = quiet_sim.expected_speed_kmh(v)
        await quiet_sim.trigger_traffic_event("Mumbai MMR")
        await quiet_sim._update_traffic()
        during = quiet_sim.expected_speed_kmh(v)
        assert during < before * 0.65, "surge must visibly slow the region"
        assert any(i.type.value == "traffic_spike" for i in quiet_sim._incidents.values())

        for _ in range(25):                                    # 25 x 60s > 20 minute surge
            await quiet_sim._update_traffic()
        after = quiet_sim.expected_speed_kmh(v)
        assert after > during * 1.4, "traffic must recover once the surge ends"
        incident = next(i for i in quiet_sim._incidents.values() if i.type.value == "traffic_spike")
        assert incident.status == IncidentStatus.RESOLVED

    @pytest.mark.asyncio
    async def test_low_fuel_vehicle_refuels_instead_of_spamming_incidents(self, quiet_sim):
        wire(quiet_sim)
        v = make_vehicle("v1", 19.0, fuel=9.0)
        quiet_sim.load_vehicles([v])
        for _ in range(10):
            await quiet_sim._tick()
        fuel_incidents = [i for i in quiet_sim._incidents.values() if i.type.value == "low_fuel"]
        assert len(fuel_incidents) == 1, "exactly one incident per low-fuel episode"
        assert quiet_sim.get_vehicle("v1").fuel_level > 90
        assert fuel_incidents[0].status == IncidentStatus.RESOLVED

    @pytest.mark.asyncio
    async def test_restore_requeues_in_flight_and_expires_stale_orders(self, quiet_sim):
        fresh = make_order("fresh", 19.0)
        fresh.status = OrderStatus.PICKED_UP
        fresh.assigned_vehicle_id = "ghost"
        stale = make_order("stale", 19.0, age_min=60 * 12)
        docs = [fresh.model_dump(), stale.model_dump()]
        stats = await quiet_sim.restore_orders(docs)
        assert stats == {"restored": 1, "requeued": 1, "expired": 1}
        restored = quiet_sim._orders["fresh"]
        assert restored.status == OrderStatus.PENDING and restored.assigned_vehicle_id is None
        assert "stale" not in quiet_sim._orders


# ── ML sanity ─────────────────────────────────────────────────────────────────

class TestMLBehaviour:
    @pytest.fixture(scope="class")
    def models(self):
        from app.ml.models import DemandForecaster, ETAPredictor
        eta, demand = ETAPredictor(), DemandForecaster()
        eta.train()
        demand.train()
        return eta, demand

    def test_eta_never_decreases_with_more_traffic(self, models):
        eta, _ = models
        for distance in (3, 10, 25):
            for speed in (25, 35, 45):
                values = [eta.predict(distance, speed, hour=11, day_of_week=2, traffic_factor=t)[0]
                          for t in (0.8, 1.0, 1.4, 1.8, 2.2, 2.6)]
                assert values == sorted(values), f"ETA not monotonic in traffic: {values}"

    def test_eta_grows_with_distance_and_shrinks_with_speed(self, models):
        eta, _ = models
        d = [eta.predict(x, 30, 11, 2, traffic_factor=1.2)[0] for x in (2, 8, 15, 25)]
        assert d == sorted(d)
        s = [eta.predict(15, x, 11, 2, traffic_factor=1.2)[0] for x in (22, 30, 40, 48)]
        assert s == sorted(s, reverse=True)

    def test_demand_forecast_differs_between_zones(self, models):
        _, demand = models
        by_zone = {f["zone"]: f["predicted_orders"] for f in demand.predict_all_zones(10, 2)}
        assert by_zone["Andheri"] > by_zone["Faridabad"] * 1.5
        assert len(set(by_zone.values())) > 5


# ── ETA quote at assignment ───────────────────────────────────────────────────

class TestEtaQuote:
    @pytest.mark.asyncio
    async def test_assignment_uses_formula_until_ml_model_is_trained(self, quiet_sim, monkeypatch):
        from app.ml.models import ETAPredictor
        monkeypatch.setattr("app.simulation.engine.ml_engine.eta_predictor", ETAPredictor())  # untrained
        wire(quiet_sim)
        quiet_sim.load_vehicles([make_vehicle("v1", 19.0)])
        order = make_order("job", 19.0 + km_to_lat(1), dlat=19.0 + km_to_lat(6))
        await quiet_sim.add_order(order)
        assert order.eta_source == "formula"
        assert order.ml_eta_minutes is None
        assert order.predicted_eta_minutes == order.formula_eta_minutes
        assert order.fixed_speed_eta_minutes > 0

    @pytest.mark.asyncio
    async def test_assignment_quotes_ml_eta_and_keeps_all_three_estimates(self, quiet_sim, monkeypatch, trained_eta):
        monkeypatch.setattr("app.simulation.engine.ml_engine.eta_predictor", trained_eta)
        wire(quiet_sim)
        quiet_sim.load_vehicles([make_vehicle("v1", 19.0)])
        order = make_order("job", 19.0 + km_to_lat(1), dlat=19.0 + km_to_lat(6))
        await quiet_sim.add_order(order)
        assert order.eta_source == "ml"
        assert order.ml_eta_minutes and order.formula_eta_minutes and order.fixed_speed_eta_minutes
        assert order.predicted_eta_minutes == order.ml_eta_minutes
        assert order.eta_minutes == order.ml_eta_minutes

    @pytest.mark.asyncio
    async def test_delivered_order_keeps_quote_next_to_actual_time(self, quiet_sim, monkeypatch, trained_eta):
        monkeypatch.setattr("app.simulation.engine.ml_engine.eta_predictor", trained_eta)
        wire(quiet_sim)
        quiet_sim.load_vehicles([make_vehicle("v1", 19.0)])
        order = make_order("job", 19.0 + km_to_lat(0.5), dlat=19.0 + km_to_lat(2.0))
        await quiet_sim.add_order(order)
        quoted = order.ml_eta_minutes
        for _ in range(60):
            await quiet_sim._tick()
            if order.status == OrderStatus.DELIVERED:
                break
        assert order.status == OrderStatus.DELIVERED
        assert order.ml_eta_minutes == quoted
        assert order.actual_duration_min > 0

    @pytest.mark.asyncio
    async def test_eta_evaluation_endpoint_scores_each_method_against_actual(self, monkeypatch, trained_eta):
        from app.routers import optimization as router

        monkeypatch.setattr(router.ml_engine, "eta_predictor", trained_eta)
        rows = [
            {"reference": "A", "ml_eta_minutes": 50.0, "formula_eta_minutes": 40.0,
             "fixed_speed_eta_minutes": 30.0, "actual_duration_min": 50.0, "delivered_at": datetime.utcnow()},
            {"reference": "B", "ml_eta_minutes": 62.0, "formula_eta_minutes": 50.0,
             "fixed_speed_eta_minutes": 80.0, "actual_duration_min": 60.0, "delivered_at": datetime.utcnow()},
        ]
        cursor = MagicMock()
        cursor.sort.return_value.limit.return_value.to_list = AsyncMock(return_value=list(reversed(rows)))
        db = MagicMock()
        db.orders.find = MagicMock(return_value=cursor)

        out = await router.eta_evaluation(limit=50, current_user={}, db=db)

        assert out["model_ready"] is True
        assert out["held_out"]["samples"] > 500
        assert out["held_out"]["ml_vs_formula_pct"] > 0
        live = out["live"]
        assert live["samples"] == 2
        assert live["methods"]["ml"]["mae"] == pytest.approx(1.0)          # |0| and |2|
        assert live["methods"]["formula"]["mae"] == pytest.approx(10.0)    # |10| and |10|
        assert live["methods"]["fixed_speed"]["mae"] == pytest.approx(20.0)  # |20| and |20|
        assert live["ml_vs_formula_pct"] == pytest.approx(90.0)
        assert [p["order_ref"] for p in live["points"]] == ["A", "B"]      # oldest first

    @pytest.mark.asyncio
    async def test_eta_evaluation_with_no_deliveries_reports_empty_live_section(self, monkeypatch, trained_eta):
        from app.routers import optimization as router

        monkeypatch.setattr(router.ml_engine, "eta_predictor", trained_eta)
        cursor = MagicMock()
        cursor.sort.return_value.limit.return_value.to_list = AsyncMock(return_value=[])
        db = MagicMock()
        db.orders.find = MagicMock(return_value=cursor)
        out = await router.eta_evaluation(limit=50, current_user={}, db=db)
        assert out["live"]["samples"] == 0 and out["live"]["methods"] is None and out["live"]["points"] == []
