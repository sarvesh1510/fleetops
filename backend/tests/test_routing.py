"""Vehicles must follow road geometry, not fly in a straight line between stops."""
import pytest

from app.config import settings
from app.models.order import OrderStatus
from app.simulation import engine as sim_module
from app.simulation.engine import SimulationEngine, advance_along_path, path_suffix_km
from app.simulation.routing import densify, parse_osrm_route
from app.utils.geo import haversine_km

from tests.test_behaviour import km_to_lat, make_order, make_vehicle, wire

# An L-shaped "road": 1.1 km north, then 1.1 km east. The straight line between the ends cuts the corner.
START = (19.000, 72.870)
CORNER = (19.010, 72.870)
END = (19.010, 72.880)
L_ROAD = [START, CORNER, END]


def dist_to_road(lat, lng, path):
    """Distance (km) from a point to the polyline, via dense sampling of the polyline."""
    return min(haversine_km(lat, lng, p[0], p[1]) for p in densify(path, 0.01))


class TestPathHelpers:
    def test_advance_stops_mid_segment(self):
        lat, lng, idx = advance_along_path(*START, L_ROAD, 1, 0.5)
        assert idx == 1
        assert lng == pytest.approx(START[1])          # still on the northbound leg
        assert START[0] < lat < CORNER[0]

    def test_advance_turns_the_corner_instead_of_cutting_it(self):
        total = path_suffix_km(L_ROAD)[0]
        lat, lng, idx = advance_along_path(*START, L_ROAD, 1, total * 0.75)
        assert idx == 2
        assert lat == pytest.approx(CORNER[0])         # on the eastbound leg, not diagonal
        assert dist_to_road(lat, lng, L_ROAD) < 0.02

    def test_advance_reports_arrival(self):
        _, _, idx = advance_along_path(*START, L_ROAD, 1, 100.0)
        assert idx == len(L_ROAD)

    def test_suffix_lengths(self):
        s = path_suffix_km(L_ROAD)
        assert s[-1] == 0
        assert s[0] == pytest.approx(haversine_km(*START, *CORNER) + haversine_km(*CORNER, *END))


class TestOsrmParsing:
    def test_parses_geojson_lng_lat_into_lat_lng(self):
        payload = {"code": "Ok", "routes": [{"geometry": {"coordinates": [[72.87, 19.0], [72.87, 19.01]]}}]}
        pts = parse_osrm_route(payload)
        assert pts[0] == (19.0, 72.87) and pts[-1] == (19.01, 72.87)

    def test_densify_fills_long_segments(self):
        pts = densify([(19.0, 72.87), (19.01, 72.87)], 0.05)
        assert len(pts) > 10
        assert all(haversine_km(*a, *b) <= 0.06 for a, b in zip(pts, pts[1:]))

    @pytest.mark.parametrize("payload", [{"code": "NoRoute"}, {"code": "Ok", "routes": []}])
    def test_no_route_raises(self, payload):
        with pytest.raises(ValueError):
            parse_osrm_route(payload)


class FakeRouter:
    """Routes along an L: north/south first, then east/west. `path` overrides it with a fixed route."""
    enabled = True

    def __init__(self, path=None, fail=False):
        self.path = path
        self.fail = fail
        self.calls = 0
        self.returned = []

    async def route(self, start, end):
        self.calls += 1
        if self.fail:
            return None
        pts = list(self.path) if self.path else [start, (end[0], start[1]), end]
        self.returned.append(pts)
        return pts

    async def aclose(self):
        pass


@pytest.fixture
def road_sim(monkeypatch):
    monkeypatch.setattr(sim_module, "ORDER_GEN_PROBABILITY", 0.0)
    monkeypatch.setattr(sim_module, "BREAKDOWN_RATE_PER_TICK", 0.0)
    monkeypatch.setattr(settings, "ROUTING_ENABLED", True)
    engine = SimulationEngine()
    engine.interval = 20.0
    return engine


async def settle():
    """Let pending route-fetch tasks run."""
    import asyncio
    for _ in range(3):
        await asyncio.sleep(0)


class TestVehicleFollowsRoad:
    @pytest.mark.asyncio
    async def test_vehicle_stays_on_the_road_the_whole_way(self, road_sim, monkeypatch):
        router = FakeRouter()
        monkeypatch.setattr(sim_module, "road_router", router)
        wire(road_sim)
        road_sim.load_vehicles([make_vehicle("v1", START[0], lng=START[1])])
        order = make_order("job", END[0], dlat=START[0], lng=END[1])
        order.pickup.location.coordinates = [END[1], END[0]]
        order.delivery.location.coordinates = [START[1] + 0.005, START[0]]
        await road_sim.add_order(order)

        def off_road_km(lat, lng):
            return min(dist_to_road(lat, lng, p) for p in router.returned)

        worst = 0.0
        saw_motion = False
        for _ in range(300):
            await road_sim._tick()
            await settle()
            s = road_sim._vehicles["v1"]
            if s.vehicle.speed > 0 and router.returned:
                saw_motion = True
                worst = max(worst, off_road_km(s.lat, s.lng))
            if order.status == OrderStatus.DELIVERED:
                break

        straight_mid = ((START[0] + END[0]) / 2, (START[1] + END[1]) / 2)
        assert order.status == OrderStatus.DELIVERED
        assert saw_motion
        assert worst < 0.03, f"vehicle strayed {worst * 1000:.0f} m from the road"
        assert router.calls == 2                       # one leg to pickup, one to delivery
        assert dist_to_road(*straight_mid, router.returned[0]) > 0.3   # the straight line is NOT the road

    @pytest.mark.asyncio
    async def test_vehicle_waits_for_route_instead_of_flying(self, road_sim, monkeypatch):
        import asyncio
        gate = asyncio.Event()

        class SlowRouter(FakeRouter):
            async def route(self, start, end):
                await gate.wait()
                return await super().route(start, end)

        monkeypatch.setattr(sim_module, "road_router", SlowRouter(L_ROAD))
        wire(road_sim)
        road_sim.load_vehicles([make_vehicle("v1", START[0], lng=START[1])])
        order = make_order("job", END[0], dlat=END[0] + 0.01, lng=END[1])
        await road_sim.add_order(order)

        state = road_sim._vehicles["v1"]
        before = (state.lat, state.lng)
        for _ in range(3):
            await road_sim._tick()
        assert (state.lat, state.lng) == before and state.vehicle.speed == 0

        gate.set()
        await settle()
        await road_sim._tick()
        assert (state.lat, state.lng) != before

    @pytest.mark.asyncio
    async def test_falls_back_to_straight_line_when_routing_fails(self, road_sim, monkeypatch):
        monkeypatch.setattr(sim_module, "road_router", FakeRouter(fail=True))
        wire(road_sim)
        road_sim.load_vehicles([make_vehicle("v1", 19.0)])
        order = make_order("job", 19.0 + km_to_lat(0.5), dlat=19.0 + km_to_lat(1.5))
        await road_sim.add_order(order)
        for _ in range(100):
            await road_sim._tick()
            await settle()
            if order.status == OrderStatus.DELIVERED:
                break
        assert order.status == OrderStatus.DELIVERED

    @pytest.mark.asyncio
    async def test_eta_uses_remaining_road_distance(self, road_sim, monkeypatch):
        monkeypatch.setattr(sim_module, "road_router", FakeRouter(L_ROAD))
        wire(road_sim)
        road_sim.load_vehicles([make_vehicle("v1", START[0], lng=START[1])])
        order = make_order("job", END[0], dlat=END[0] + 0.001, lng=END[1])
        await road_sim.add_order(order)
        state = road_sim._vehicles["v1"]
        await road_sim._tick()
        await settle()
        await road_sim._tick()
        road_km = state.remaining_path_km()
        assert road_km == pytest.approx(path_suffix_km(L_ROAD)[0], abs=0.3)
        straight = haversine_km(*START, *END)
        assert road_km > straight * 1.2            # the road really is longer than the crow-flies line
