"""
Vehicle Simulation Engine - India fleet (Mumbai MMR + Delhi NCR).

The engine moves vehicles, advances orders through their lifecycle, injects
traffic / breakdown / low-fuel events, and persists every state change.

What it deliberately does NOT do: decide which vehicle serves which order.
Dispatch is owned by the optimization engine (see app/optimization/engine.py);
the simulation only exposes `assign_order()` and calls the registered
dispatcher whenever work is waiting.

Time model
----------
Every tick advances the simulated world by `interval` seconds. The wall-clock
delay between ticks is `interval / speed`, so a 10x speed-up simply ticks 10x
more often. All durations (handling time, repairs, surge length, order
elapsed time) are measured in simulated seconds.
"""
import asyncio
import math
import random
import uuid
from datetime import datetime, timedelta
from typing import Awaitable, Callable, Dict, List, Optional, Tuple

import structlog
from pymongo import UpdateOne

from app.config import settings
from app.ml.models import ml_engine
from app.models.incident import (
    AutonomousAction, Incident, IncidentSeverity, IncidentStatus,
    IncidentTimelineEntry, IncidentType,
)
from app.models.optimization import OptimizationTrigger
from app.models.order import AddressPoint, Order, OrderPriority, OrderStatus
from app.models.vehicle import GeoPoint, Vehicle, VehicleStatus
from app.simulation.profile import (
    BASE_SPEED_KMH, DELIVERY_HANDLING_SEC, PICKUP_HANDLING_SEC, ROAD_CIRCUITY,
    SURGE_DURATION_SEC, TYPE_SPEED_FACTOR, fixed_speed_eta_minutes,
    formula_eta_minutes, free_flow_speed_kmh, target_traffic,
)
from app.simulation.routing import road_router
from app.utils.cargo import random_cargo_weight
from app.utils.geo import (  # re-exported for callers/tests
    DELHI, MUMBAI, REGIONS, bearing, haversine_km, ist_hour, ist_now, region_for_lng,
)
from app.websocket.broadcaster import WSEventType, broadcaster

logger = structlog.get_logger(__name__)

# ── Geography ─────────────────────────────────────────────────────────────────
MUMBAI_ZONES = [
    ("Bandra",          19.0596, 72.8295, "MH"),
    ("Andheri",         19.1136, 72.8697, "MH"),
    ("Kurla",           19.0726, 72.8795, "MH"),
    ("Dadar",           19.0186, 72.8432, "MH"),
    ("Worli",           19.0109, 72.8181, "MH"),
    ("Powai",           19.1197, 72.9050, "MH"),
    ("Goregaon",        19.1663, 72.8526, "MH"),
    ("Malad",           19.1871, 72.8484, "MH"),
    ("Borivali",        19.2318, 72.8567, "MH"),
    ("Thane",           19.2183, 72.9781, "MH"),
    ("Navi Mumbai",     19.0368, 73.0158, "MH"),
    ("Vashi",           19.0771, 73.0073, "MH"),
    ("Bhiwandi",        19.2967, 73.0583, "MH"),
    ("Kalyan",          19.2437, 73.1355, "MH"),
    ("Chembur",         19.0522, 72.8997, "MH"),
    ("Ghatkopar",       19.0858, 72.9087, "MH"),
    ("Dharavi",         19.0392, 72.8544, "MH"),
    ("Panvel",          18.9894, 73.1175, "MH"),
]

DELHI_NCR_ZONES = [
    ("Connaught Place",   28.6315, 77.2167, "DL"),
    ("Karol Bagh",        28.6508, 77.1900, "DL"),
    ("Lajpat Nagar",      28.5665, 77.2433, "DL"),
    ("Saket",             28.5245, 77.2066, "DL"),
    ("Dwarka",            28.5921, 77.0460, "DL"),
    ("Rohini",            28.7041, 77.1025, "DL"),
    ("Noida Sector 18",   28.5705, 77.3219, "UP"),
    ("Noida Sector 62",   28.6270, 77.3650, "UP"),
    ("Greater Noida",     28.4744, 77.5040, "UP"),
    ("Gurgaon Sector 29", 28.4595, 77.0266, "HR"),
    ("Gurgaon DLF",       28.4672, 77.0435, "HR"),
    ("Faridabad",         28.4089, 77.3178, "HR"),
    ("Ghaziabad",         28.6692, 77.4538, "UP"),
    ("Vasant Kunj",       28.5244, 77.1571, "DL"),
    ("Nehru Place",       28.5491, 77.2519, "DL"),
    ("Gurugram Cyber Hub", 28.4949, 77.0887, "HR"),
]

ALL_ZONES = MUMBAI_ZONES + DELHI_NCR_ZONES
ZONES_BY_REGION = {MUMBAI: MUMBAI_ZONES, DELHI: DELHI_NCR_ZONES}

INDIAN_COMPANIES = [
    "Reliance Retail Ltd", "Tata Consumer Products", "Flipkart Logistics",
    "Amazon India Pvt Ltd", "BigBasket Fulfilment", "Zomato Hyperpure",
    "Meesho Warehouse", "Nykaa Distribution", "Mahindra Logistics",
    "Blue Dart Express", "DTDC Courier", "Delhivery Ltd",
    "Ekart Logistics", "Shadowfax Technologies", "Porter Logistics",
    "Dunzo Daily", "Swiggy Instamart", "Blinkit Dark Store",
    "Spencer's Retail", "DMart Distribution", "Jio Commerce",
    "Godrej Consumer", "Hindustan Unilever", "ITC Limited",
    "Haldiram's Distribution", "Amul Dairy", "Mother Dairy",
    "Zepto Dark Store", "PharmEasy Express", "Pepperfry Logistics",
]

# ── Tunables (simulated seconds unless noted) ─────────────────────────────────
# Speeds, traffic by hour and handling times live in simulation/profile.py so the ETA
# model is trained on exactly the same rules the vehicles follow here.
REFUEL_SEC = 180
LOW_FUEL_PCT = 15.0           # idle vehicles below this go to refuel
CRITICAL_FUEL_PCT = 8.0       # en-route vehicles below this raise an incident
BREAKDOWN_RATE_PER_TICK = 0.00004
ORDER_GEN_EVERY_TICKS = 10
ORDER_GEN_PROBABILITY = 0.25   # ~0.75 new orders/min at 1x: keeps a 78-vehicle fleet around half busy
DISPATCH_EVERY_TICKS = 3
PERSIST_VEHICLES_EVERY_TICKS = 15

# Energy use in % of tank/battery per km.
def fuel_use_pct_per_km(fuel_type: str, vehicle_type: str) -> float:
    if fuel_type == "electric":
        return 0.8
    if fuel_type == "cng":
        return 0.35
    if fuel_type == "petrol":
        return 0.2
    return 0.12 if vehicle_type == "truck" else 0.2     # diesel


# ── Geometry helpers ──────────────────────────────────────────────────────────
def move_toward(lat, lng, tlat, tlng, speed_kmh, dt_hours):
    dist = haversine_km(lat, lng, tlat, tlng)
    travel = speed_kmh * dt_hours
    if dist <= travel or dist < 0.05:
        return tlat, tlng, True
    ratio = travel / dist
    return lat + (tlat - lat) * ratio, lng + (tlng - lng) * ratio, False


def advance_along_path(lat, lng, path, idx, travel_km):
    """
    Walk `travel_km` along `path` (list of (lat, lng)) starting at (lat, lng), whose next
    waypoint is path[idx]. Returns (lat, lng, next_idx); next_idx == len(path) means arrived.
    """
    while travel_km > 0 and idx < len(path):
        wlat, wlng = path[idx]
        d = haversine_km(lat, lng, wlat, wlng)
        if d <= travel_km:
            lat, lng = wlat, wlng
            travel_km -= d
            idx += 1
        else:
            f = travel_km / d
            return lat + (wlat - lat) * f, lng + (wlng - lng) * f, idx
    return lat, lng, idx


def path_suffix_km(path) -> List[float]:
    """suffix[i] = length of the path from path[i] to its end (suffix[-1] == 0)."""
    suffix = [0.0] * len(path)
    for i in range(len(path) - 2, -1, -1):
        suffix[i] = suffix[i + 1] + haversine_km(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1])
    return suffix


def random_point(zone, radius_km=1.8):
    _, z_lat, z_lng, _ = zone
    r = radius_km * math.sqrt(random.random())
    theta = random.uniform(0, 2 * math.pi)
    dlat = r * math.cos(theta) / 111.0
    dlng = r * math.sin(theta) / (111.0 * math.cos(math.radians(z_lat)))
    return z_lat + dlat, z_lng + dlng


def nearest_zone_name(lat: float, lng: float) -> str:
    return min(ALL_ZONES, key=lambda z: haversine_km(lat, lng, z[1], z[2]))[0]


def make_indian_address(zone) -> str:
    z_name, _, _, z_state = zone
    state_name = {"DL": "Delhi", "UP": "Uttar Pradesh", "HR": "Haryana", "MH": "Maharashtra"}.get(z_state, "India")
    areas = ["Shivaji Nagar", "Gandhi Nagar", "Nehru Nagar", "Rajendra Nagar", "Laxmi Nagar"]
    road = random.choice(["Marg", "Road", "Lane", "Colony", "Sector", "Nagar"])
    if z_state == "DL":
        pin = random.randint(110001, 110099)
    elif z_state == "UP":
        pin = random.randint(201301, 201310)
    elif z_state == "HR":
        pin = random.randint(122001, 122018)
    else:
        pin = random.randint(400001, 421605)
    return f"{random.randint(1, 500)}, {random.choice(areas)} {road}, {z_name}, {state_name} - {pin}"


# ── Per-vehicle state ─────────────────────────────────────────────────────────
class VehicleSimState:
    def __init__(self, vehicle: Vehicle):
        self.vehicle = vehicle
        self.region: str = vehicle.region or region_for_lng(vehicle.location.coordinates[0])
        vehicle.region = self.region
        self.target_lat: Optional[float] = None
        self.target_lng: Optional[float] = None
        # Road path to the target: list of (lat, lng); path_i is the next waypoint to reach
        self.path: Optional[List[Tuple[float, float]]] = None
        self.path_i: int = 0
        self.path_suffix: List[float] = []
        self.route_task: Optional[asyncio.Task] = None
        self.route_gen: int = 0
        self.phase: str = "idle"   # idle|to_pickup|at_pickup|to_delivery|at_delivery|refuelling
        self.current_order: Optional[Order] = None
        self.stop_timer: float = 0.0
        self.telemetry_counter: int = 0
        self.speed_noise: float = 1.0
        # Per-order accounting (simulated)
        self.order_elapsed_min: float = 0.0
        self.order_distance_km: float = 0.0
        # Repairs / refuelling
        self.repair_remaining_sec: float = 0.0
        self.refuel_remaining_sec: float = 0.0
        self.breakdown_incident: Optional[Incident] = None
        self.low_fuel_incident: Optional[Incident] = None

    @property
    def lat(self) -> float:
        return self.vehicle.location.coordinates[1]

    @property
    def lng(self) -> float:
        return self.vehicle.location.coordinates[0]

    @property
    def is_delhi(self) -> bool:
        return self.region == DELHI

    def set_position(self, lat, lng):
        self.vehicle.location = GeoPoint(coordinates=[lng, lat])

    def set_target(self, lat, lng):
        self.target_lat = lat
        self.target_lng = lng
        self.clear_route()

    # ── Route following ───────────────────────────────────────────────────────
    def clear_route(self):
        """Forget the current path (new target, breakdown, delivery done)."""
        self.route_gen += 1
        if self.route_task is not None and not self.route_task.done():
            self.route_task.cancel()
        self.route_task = None
        self.path = None
        self.path_i = 0
        self.path_suffix = []

    def set_path(self, path):
        self.path = path
        self.path_i = 1 if len(path) > 1 else 0     # path[0] is where the vehicle already is
        self.path_suffix = path_suffix_km(path)

    def remaining_path_km(self) -> Optional[float]:
        """Distance still to drive along the current path, or None if there is no path yet."""
        if self.path is None:
            return None
        if self.path_i >= len(self.path):
            return 0.0
        wlat, wlng = self.path[self.path_i]
        return haversine_km(self.lat, self.lng, wlat, wlng) + self.path_suffix[self.path_i]


IncidentCallback = Callable[[Incident, bool], Awaitable[None]]
Dispatcher = Callable[..., Awaitable[object]]


class SimulationEngine:
    def __init__(self):
        self.running = False
        self.paused = False
        self.speed = settings.SIMULATION_SPEED
        self.interval = settings.SIMULATION_INTERVAL_SECONDS
        self.tick_count = 0
        self.persist_interval = settings.TELEMETRY_PERSIST_INTERVAL
        self._vehicles: Dict[str, VehicleSimState] = {}
        self._orders: Dict[str, Order] = {}          # live orders only (not yet delivered)
        self._incidents: Dict[str, Incident] = {}
        self._db = None
        self._task: Optional[asyncio.Task] = None
        self._order_gen_counter = 0
        self._on_incident_callbacks: List[IncidentCallback] = []
        self._on_order_callbacks: List[Callable[[Order], Awaitable[None]]] = []
        self._dispatcher: Optional[Dispatcher] = None
        self._traffic: Dict[str, float] = {r: 1.0 for r in REGIONS}       # effective (incl. surge)
        self._traffic_base: Dict[str, float] = {r: 1.0 for r in REGIONS}  # time-of-day baseline
        self._surges: Dict[str, dict] = {}
        self._sla_alerted: set = set()

    # ── Wiring ────────────────────────────────────────────────────────────────
    def register_incident_callback(self, cb: IncidentCallback):
        self._on_incident_callbacks.append(cb)

    def register_order_callback(self, cb):
        self._on_order_callbacks.append(cb)

    def register_dispatcher(self, dispatcher: Dispatcher):
        self._dispatcher = dispatcher

    def set_db(self, db):
        self._db = db

    # ── Loading / queries ─────────────────────────────────────────────────────
    def load_vehicles(self, vehicles: List[Vehicle]):
        """Load vehicles into the sim. Anything mid-task is reset: there is no order bound to it."""
        for v in vehicles:
            if v.status == VehicleStatus.BREAKDOWN:
                v.status = VehicleStatus.MAINTENANCE
            elif v.status not in (VehicleStatus.MAINTENANCE, VehicleStatus.OFFLINE):
                v.status = VehicleStatus.AVAILABLE
            v.current_order_id = None
            v.current_load_kg = 0.0
            v.current_eta_minutes = None
            v.speed = 0.0
            state = VehicleSimState(v)
            if v.status == VehicleStatus.MAINTENANCE:
                state.repair_remaining_sec = random.uniform(120, 600)
            self._vehicles[v.vehicle_id] = state
        logger.info("Vehicles loaded into simulation", count=len(vehicles))

    def get_all_vehicles(self) -> List[Vehicle]:
        return [s.vehicle for s in self._vehicles.values()]

    def get_vehicle(self, vehicle_id: str) -> Optional[Vehicle]:
        s = self._vehicles.get(vehicle_id)
        return s.vehicle if s else None

    def get_all_orders(self) -> List[Order]:
        return list(self._orders.values())

    def get_pending_orders(self) -> List[Order]:
        pending = [o for o in self._orders.values() if o.status == OrderStatus.PENDING]
        pending.sort(key=lambda o: o.created_at)
        return pending

    @property
    def pending_count(self) -> int:
        return sum(1 for o in self._orders.values() if o.status == OrderStatus.PENDING)

    def get_incident(self, incident_id: str) -> Optional[Incident]:
        return self._incidents.get(incident_id)

    def traffic_factor(self, region: str) -> float:
        return self._traffic.get(region, 1.0)

    def expected_speed_kmh(self, vehicle: Vehicle) -> float:
        """Speed we expect this vehicle to sustain right now in its region (used for ETAs)."""
        region = vehicle.region or region_for_lng(vehicle.location.coordinates[0])
        base = BASE_SPEED_KMH.get(region, 24.0) * TYPE_SPEED_FACTOR.get(vehicle.type.value, 1.0)
        return max(5.0, base / max(self.traffic_factor(region), 0.6))

    async def restore_orders(self, docs: List[dict]) -> dict:
        """
        Rebuild live order state after a restart. Orders that were in flight lose their
        vehicle (vehicles restart idle) and go back to pending; stale pending orders expire.
        """
        stats = {"restored": 0, "requeued": 0, "expired": 0}
        now = datetime.utcnow()
        for doc in docs:
            try:
                order = Order(**{k: v for k, v in doc.items() if k != "_id"})
            except Exception as e:
                logger.warning("Skipping unreadable order", order_id=doc.get("order_id"), error=str(e))
                continue
            if order.status in (OrderStatus.DELIVERED, OrderStatus.FAILED, OrderStatus.CANCELLED):
                continue
            if order.region is None:
                order.region = region_for_lng(order.pickup.location.coordinates[0])
            if now - order.created_at > timedelta(hours=6):
                order.status = OrderStatus.CANCELLED
                await self._persist_order(order)
                stats["expired"] += 1
                continue
            if order.status != OrderStatus.PENDING:
                order.status = OrderStatus.PENDING
                order.assigned_vehicle_id = None
                order.assigned_at = None
                order.eta_minutes = None
                order.estimated_delivery_at = None
                order.reassignment_count += 1
                await self._persist_order(order)
                stats["requeued"] += 1
            self._orders[order.order_id] = order
            stats["restored"] += 1
        logger.info("Orders restored", **stats)
        return stats

    # ── Lifecycle ─────────────────────────────────────────────────────────────
    def set_speed(self, speed: float):
        self.speed = max(0.1, min(speed, 20.0))
        logger.info("Simulation speed set", speed=self.speed)

    async def start(self):
        if self.running:
            return
        self.running = True
        self.paused = False
        self._task = asyncio.create_task(self._loop())
        logger.info("Simulation started", speed=self.speed)

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        for s in self._vehicles.values():
            s.clear_route()
        await road_router.aclose()
        await self._persist_vehicles()

    def pause(self):
        self.paused = True

    def resume(self):
        self.paused = False

    async def _loop(self):
        while self.running:
            if not self.paused:
                try:
                    await self._tick()
                except Exception:
                    logger.error("Sim tick error", exc_info=True)
            await asyncio.sleep(self.interval / max(self.speed, 0.1))

    # ── Traffic ───────────────────────────────────────────────────────────────
    def _target_traffic(self, region: str) -> float:
        return target_traffic(region, ist_hour(datetime.utcnow()))

    async def _update_traffic(self):
        for region in REGIONS:
            current = self._traffic_base[region]
            target = self._target_traffic(region)
            base = min(max(current + (target - current) * 0.05 + random.gauss(0, 0.01), 0.7), 2.6)
            self._traffic_base[region] = base

            surge = self._surges.get(region)
            mult = 1.0
            if surge:
                surge["remaining_sec"] -= self.interval
                ease = min(1.0, max(surge["remaining_sec"], 0.0) / (0.25 * surge["total_sec"]))
                mult = 1.0 + (surge["multiplier"] - 1.0) * ease
            self._traffic[region] = round(base * mult, 3)
            if surge and surge["remaining_sec"] <= 0:
                await self._end_surge(region)

    async def _end_surge(self, region: str):
        surge = self._surges.pop(region, None)
        if not surge:
            return
        incident: Incident = surge["incident"]
        if incident.status != IncidentStatus.RESOLVED:
            at_risk = len(surge["at_risk"])
            self._finish_incident(
                incident,
                note=f"Congestion cleared. {at_risk} order(s) were flagged SLA-at-risk during the surge.",
                outcome=f"{at_risk} order(s) flagged SLA-at-risk",
            )
            await self._emit_incident(incident)
        await broadcaster.broadcast(WSEventType.ALERT_CREATED, {
            "type": "traffic_cleared", "message": f"Traffic back to normal in {region}.", "severity": "low",
        })

    async def trigger_traffic_event(self, region: Optional[str] = None) -> dict:
        region = region if region in REGIONS else MUMBAI
        affected = [s for s in self._vehicles.values()
                    if s.region == region and s.vehicle.status == VehicleStatus.EN_ROUTE]
        multiplier = round(random.uniform(1.8, 2.4), 2)
        existing = self._surges.get(region)
        if existing:                       # extend an ongoing surge instead of stacking incidents
            existing["remaining_sec"] = existing["total_sec"] = SURGE_DURATION_SEC
            existing["multiplier"] = max(existing["multiplier"], multiplier)
        else:
            corridor = "Western Express Highway" if region == MUMBAI else "NH-48 / Outer Ring Road"
            incident = self._new_incident(
                IncidentType.TRAFFIC_SPIKE, IncidentSeverity.HIGH,
                title=f"Congestion surge - {region}",
                description=(f"Heavy congestion on {corridor}. Traffic factor in {region} raised "
                             f"{multiplier}x for about {SURGE_DURATION_SEC // 60} minutes."),
                region=region,
            )
            incident.autonomous_actions.append(AutonomousAction(
                action_type="recalculate_eta",
                description=f"Recalculated ETAs for {len(affected)} en-route vehicle(s) at {multiplier}x traffic",
                reason="Regional traffic factor changed",
                expected_impact="ETAs and SLA-risk flags reflect slower travel",
            ))
            incident.status = IncidentStatus.ACTION_TAKEN
            self._surges[region] = {
                "multiplier": multiplier, "remaining_sec": SURGE_DURATION_SEC,
                "total_sec": SURGE_DURATION_SEC, "incident": incident, "at_risk": set(),
            }
            await self._emit_incident(incident, is_new=True)
        await broadcaster.broadcast(WSEventType.ALERT_CREATED, {
            "type": "traffic_surge",
            "message": f"Heavy congestion in {region}. {len(affected)} vehicles affected; ETAs recalculating.",
            "severity": "high",
            "affected_vehicles": len(affected),
        })
        logger.info("Traffic event triggered", region=region, affected=len(affected), multiplier=multiplier)
        return {"region": region, "affected": len(affected), "multiplier": multiplier}

    # ── Tick ──────────────────────────────────────────────────────────────────
    async def _tick(self):
        self.tick_count += 1
        await self._update_traffic()

        self._order_gen_counter += 1
        if self._order_gen_counter >= ORDER_GEN_EVERY_TICKS:
            self._order_gen_counter = 0
            if random.random() < ORDER_GEN_PROBABILITY:
                await self.generate_random_order()

        for state in list(self._vehicles.values()):
            await self._update_vehicle(state)

        if self.tick_count % DISPATCH_EVERY_TICKS == 0 and self.pending_count:
            await self._request_dispatch(OptimizationTrigger.SCHEDULED)

        if self.tick_count % PERSIST_VEHICLES_EVERY_TICKS == 0:
            await self._persist_vehicles()

        await broadcaster.broadcast(WSEventType.FLEET_SNAPSHOT, self.build_fleet_snapshot())

    async def _request_dispatch(self, trigger: OptimizationTrigger, **kwargs):
        if self._dispatcher is None:
            return None
        try:
            return await self._dispatcher(trigger, **kwargs)
        except Exception:
            logger.error("Dispatch failed", exc_info=True)
            return None

    # ── Vehicle update ────────────────────────────────────────────────────────
    def vehicle_speed(self, state: VehicleSimState) -> float:
        state.speed_noise = min(1.15, max(0.85, state.speed_noise + random.gauss(0, 0.02)))
        return max(4.0, self.expected_speed_kmh(state.vehicle) * state.speed_noise)

    def _consume_fuel(self, state: VehicleSimState, km: float):
        v = state.vehicle
        rate = fuel_use_pct_per_km(v.fuel_type.value, v.type.value)
        v.fuel_level = max(0.0, v.fuel_level - rate * km)
        v.fuel_range_km = round(v.fuel_level / rate, 1) if rate else 0.0
        v.odometer_km += km

    def _ensure_route(self, state: VehicleSimState) -> bool:
        """
        Make sure the vehicle has a path to its target. Returns True when one is ready.
        With routing on, the road path is fetched in the background and the vehicle waits
        (stationary) until it arrives; with routing off it is a straight line, immediately.
        """
        if state.path is not None:
            return True
        tlat, tlng = state.target_lat, state.target_lng
        if not road_router.enabled:
            state.set_path([(state.lat, state.lng), (tlat, tlng)])
            return True
        if state.route_task is None:
            state.route_task = asyncio.create_task(self._fetch_route(state, state.route_gen, tlat, tlng))
        return False

    async def _fetch_route(self, state: VehicleSimState, gen: int, tlat: float, tlng: float):
        start = (state.lat, state.lng)
        try:
            points = await road_router.route(start, (tlat, tlng))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.error("Route fetch failed", exc_info=True)
            points = None
        if gen != state.route_gen:          # target changed / vehicle stopped while we waited
            return
        if points:
            # The route starts on the nearest road. Snap onto it if that is close, otherwise
            # keep the real start so the vehicle does not teleport.
            if haversine_km(start[0], start[1], points[0][0], points[0][1]) > 0.5:
                points = [start] + points
            else:
                state.set_position(*points[0])
        else:
            points = [start, (tlat, tlng)]   # routing unavailable: straight line
        state.set_path(points)

    def _drive(self, state: VehicleSimState, dt_hours: float) -> bool:
        """Advance along the path to the current target. Returns True on arrival."""
        v = state.vehicle
        if state.target_lat is None or state.target_lng is None:
            return True
        if not self._ensure_route(state):
            v.speed = 0.0                    # waiting for the road route
            return False
        speed = self.vehicle_speed(state)
        v.speed = speed
        lat, lng = state.lat, state.lng
        new_lat, new_lng, state.path_i = advance_along_path(
            lat, lng, state.path, state.path_i, speed * dt_hours)
        moved = haversine_km(lat, lng, new_lat, new_lng)
        state.set_position(new_lat, new_lng)
        state.order_distance_km += moved
        self._consume_fuel(state, moved)
        if state.path_i >= len(state.path):
            v.speed = 0.0
            return True
        wlat, wlng = state.path[state.path_i]
        if haversine_km(new_lat, new_lng, wlat, wlng) > 0.002:
            v.heading = bearing(new_lat, new_lng, wlat, wlng)
        return False

    async def _update_vehicle(self, state: VehicleSimState):
        v = state.vehicle
        dt_sec = self.interval
        dt_hours = dt_sec / 3600.0
        now = datetime.utcnow()

        if v.status == VehicleStatus.OFFLINE:
            return
        if v.status in (VehicleStatus.BREAKDOWN, VehicleStatus.MAINTENANCE):
            await self._tick_repair(state, dt_sec)
            return
        if state.phase == "refuelling":
            await self._tick_refuel(state, dt_sec)
            return

        # Random mechanical failure while driving; older / unhealthy vehicles fail more often
        if v.status == VehicleStatus.EN_ROUTE:
            risk = BREAKDOWN_RATE_PER_TICK * max(1.0, v.odometer_km / 100000)
            if v.health.overall_score < 50:
                risk *= 3
            if random.random() < risk:
                await self._trigger_breakdown(state)
                return
            if v.fuel_level < CRITICAL_FUEL_PCT and state.low_fuel_incident is None:
                await self._raise_low_fuel(state, en_route=True)

        if state.current_order:
            state.order_elapsed_min += dt_sec / 60.0

        phase = state.phase
        order = state.current_order
        if phase == "idle":
            v.status = VehicleStatus.AVAILABLE
            v.speed = 0.0
            if v.fuel_level < LOW_FUEL_PCT:
                await self._start_refuel(state)
        elif phase == "to_pickup" and order:
            if order.status == OrderStatus.ASSIGNED:
                order.status = OrderStatus.PICKUP_EN_ROUTE
                await self._persist_order(order)
            if self._drive(state, dt_hours):
                state.phase = "at_pickup"
                state.stop_timer = 0.0
                v.status = VehicleStatus.LOADING
        elif phase == "at_pickup" and order:
            state.stop_timer += dt_sec
            if state.stop_timer >= PICKUP_HANDLING_SEC:
                state.stop_timer = 0.0
                v.current_load_kg = order.weight_kg
                order.status = OrderStatus.PICKED_UP
                order.picked_up_at = now
                state.phase = "to_delivery"
                state.set_target(order.delivery.location.coordinates[1], order.delivery.location.coordinates[0])
                v.status = VehicleStatus.EN_ROUTE
                await self._persist_order(order)
        elif phase == "to_delivery" and order:
            if order.status == OrderStatus.PICKED_UP:
                order.status = OrderStatus.DELIVERY_EN_ROUTE
                await self._persist_order(order)
            if self._drive(state, dt_hours):
                state.phase = "at_delivery"
                state.stop_timer = 0.0
                v.status = VehicleStatus.UNLOADING
        elif phase == "at_delivery" and order:
            state.stop_timer += dt_sec
            if state.stop_timer >= DELIVERY_HANDLING_SEC:
                await self._complete_delivery(state)
        elif phase != "idle" and not order:
            # Defensive: a task phase with no order should never persist
            state.phase = "idle"

        if state.current_order:
            await self._refresh_eta(state)

        v.updated_at = now
        state.telemetry_counter += 1
        if self._db is not None and state.telemetry_counter >= self.persist_interval:
            state.telemetry_counter = 0
            if v.speed > 0:
                await self._persist_telemetry(state)

    # ── ETA / SLA ─────────────────────────────────────────────────────────────
    def _road_factor(self) -> float:
        """Straight-line to road-distance multiplier (1.0 when vehicles move in straight lines)."""
        return ROAD_CIRCUITY if road_router.enabled else 1.0

    def _order_road_km(self, vehicle: Vehicle, order: Order) -> float:
        """Estimated road distance: vehicle -> pickup -> delivery."""
        plat, plng = order.pickup.location.coordinates[1], order.pickup.location.coordinates[0]
        dlat, dlng = order.delivery.location.coordinates[1], order.delivery.location.coordinates[0]
        return (haversine_km(vehicle.location.coordinates[1], vehicle.location.coordinates[0], plat, plng)
                + haversine_km(plat, plng, dlat, dlng)) * self._road_factor()

    def estimate_order_eta(self, vehicle: Vehicle, order: Order) -> dict:
        """
        Quote the ETA for giving `order` to `vehicle`.

        Returns the figure to use (`used`, from the ML model once it has trained, otherwise the
        simple formula) plus all three estimates, so each can later be scored against the real
        delivery time.
        """
        region = vehicle.region or region_for_lng(vehicle.location.coordinates[0])
        km = self._order_road_km(vehicle, order)
        traffic = self.traffic_factor(region)
        free_flow = free_flow_speed_kmh(region, vehicle.type.value)
        formula = formula_eta_minutes(km, free_flow, traffic, n_stops=2)
        fixed = fixed_speed_eta_minutes(km, n_stops=2)

        ml: Optional[float] = None
        eta_model = ml_engine.eta_predictor
        if eta_model.is_trained:
            try:
                now = ist_now()
                ml, _ = eta_model.predict(
                    distance_km=km, speed_kmh=free_flow,
                    hour=now.hour + now.minute / 60.0, n_stops=2,
                    traffic_factor=traffic, sim_speed=self.speed, region=region,
                )
            except Exception:
                logger.warning("ML ETA failed, using the simple formula", exc_info=True)
                ml = None
        return {
            "used": ml if ml is not None else formula,
            "source": "ml" if ml is not None else "formula",
            "ml": ml,
            "formula": formula,
            "fixed_speed": fixed,
        }

    def _remaining_eta_min(self, state: VehicleSimState) -> Optional[float]:
        order = state.current_order
        if not order:
            return None
        v = state.vehicle
        speed = self.expected_speed_kmh(v)
        k = self._road_factor()
        plat, plng = order.pickup.location.coordinates[1], order.pickup.location.coordinates[0]
        dlat, dlng = order.delivery.location.coordinates[1], order.delivery.location.coordinates[0]
        trip = haversine_km(plat, plng, dlat, dlng) * k
        if state.phase == "to_pickup":
            leg = state.remaining_path_km()
            if leg is None:
                leg = haversine_km(state.lat, state.lng, plat, plng) * k
            d = leg + trip
            handling = (PICKUP_HANDLING_SEC + DELIVERY_HANDLING_SEC) / 60
        elif state.phase == "at_pickup":
            d = trip
            handling = (max(PICKUP_HANDLING_SEC - state.stop_timer, 0) + DELIVERY_HANDLING_SEC) / 60
        elif state.phase == "to_delivery":
            d = state.remaining_path_km()
            if d is None:
                d = haversine_km(state.lat, state.lng, dlat, dlng) * k
            handling = DELIVERY_HANDLING_SEC / 60
        else:  # at_delivery
            d = 0.0
            handling = max(DELIVERY_HANDLING_SEC - state.stop_timer, 0) / 60
        return d / speed * 60 + handling

    async def _refresh_eta(self, state: VehicleSimState):
        order = state.current_order
        eta = self._remaining_eta_min(state)
        if order is None or eta is None:
            return
        state.vehicle.current_eta_minutes = eta
        order.eta_minutes = round(eta, 1)
        # Deadlines are wall-clock; compare against wall-clock time remaining.
        real_eta_min = eta / max(self.speed, 0.1)
        order.estimated_delivery_at = datetime.utcnow() + timedelta(minutes=real_eta_min)
        if order.deadline:
            time_left = (order.deadline - datetime.utcnow()).total_seconds() / 60
            at_risk = real_eta_min * 1.1 > time_left
            if at_risk != order.sla_at_risk:
                order.sla_at_risk = at_risk
                await self._persist_order(order)
                if at_risk and order.order_id not in self._sla_alerted:
                    self._sla_alerted.add(order.order_id)
                    surge = self._surges.get(state.region)
                    if surge:
                        surge["at_risk"].add(order.order_id)
                    await broadcaster.broadcast(WSEventType.ALERT_CREATED, {
                        "type": "sla_risk",
                        "message": f"SLA at risk: {order.reference} ({order.customer_name})",
                        "severity": "medium",
                        "order_id": order.order_id,
                    })

    # ── Assignment (called by the optimization engine) ────────────────────────
    async def assign_order(self, vehicle_id: str, order: Order) -> bool:
        """Bind a pending order to an available vehicle. Check-and-set happens before any await."""
        state = self._vehicles.get(vehicle_id)
        if (state is None or state.vehicle.status != VehicleStatus.AVAILABLE or state.phase != "idle"
                or order.status != OrderStatus.PENDING or order.order_id not in self._orders):
            return False
        v = state.vehicle
        now = datetime.utcnow()

        order.status = OrderStatus.ASSIGNED
        order.assigned_vehicle_id = vehicle_id
        order.assigned_driver_id = v.driver_id
        order.assigned_at = now
        order.region = order.region or state.region
        eta_info = self.estimate_order_eta(v, order)
        eta = eta_info["used"]
        order.predicted_eta_minutes = round(eta, 1)
        order.eta_source = eta_info["source"]
        order.ml_eta_minutes = round(eta_info["ml"], 1) if eta_info["ml"] is not None else None
        order.formula_eta_minutes = round(eta_info["formula"], 1)
        order.fixed_speed_eta_minutes = round(eta_info["fixed_speed"], 1)
        order.eta_minutes = round(eta, 1)
        order.estimated_delivery_at = now + timedelta(minutes=eta / max(self.speed, 0.1))

        state.current_order = order
        state.phase = "to_pickup"
        state.order_elapsed_min = 0.0
        state.order_distance_km = 0.0
        state.stop_timer = 0.0
        state.set_target(order.pickup.location.coordinates[1], order.pickup.location.coordinates[0])
        v.status = VehicleStatus.EN_ROUTE
        v.current_order_id = order.order_id
        v.current_eta_minutes = eta
        v.updated_at = now

        await self._persist_order(order)
        await broadcaster.broadcast(WSEventType.ORDER_ASSIGNED, {
            "order_id": order.order_id,
            "reference": order.reference,
            "vehicle_id": vehicle_id,
            "vehicle_name": v.name,
            "customer": order.customer_name,
            "priority": order.priority.value,
            "eta_minutes": round(eta, 1),
        })
        return True

    async def _complete_delivery(self, state: VehicleSimState):
        order = state.current_order
        v = state.vehicle
        if not order:
            return
        now = datetime.utcnow()
        order.status = OrderStatus.DELIVERED
        order.delivered_at = now
        order.eta_minutes = None
        order.sla_at_risk = False
        order.actual_distance_km = round(state.order_distance_km, 2)
        order.actual_duration_min = round(state.order_elapsed_min, 1)
        on_time = order.deadline is None or now <= order.deadline

        v.current_load_kg = 0.0
        v.current_order_id = None
        v.current_eta_minutes = None
        v.status = VehicleStatus.AVAILABLE
        v.speed = 0.0
        state.phase = "idle"
        state.current_order = None
        state.stop_timer = 0.0

        await self._persist_order(order)
        self._orders.pop(order.order_id, None)
        self._sla_alerted.discard(order.order_id)
        if self._db is not None and v.driver_id:
            try:
                await self._db.drivers.update_one(
                    {"driver_id": v.driver_id}, {"$inc": {"total_deliveries_today": 1}})
            except Exception:
                logger.warning("Driver stat update failed", exc_info=True)
        await broadcaster.broadcast(WSEventType.DELIVERY_COMPLETED, {
            "order_id": order.order_id,
            "vehicle_id": v.vehicle_id,
            "vehicle_name": v.name,
            "reference": order.reference,
            "customer": order.customer_name,
            "delivered_at": now.isoformat(),
            "on_time": on_time,
        })

    # ── Breakdown ─────────────────────────────────────────────────────────────
    async def _trigger_breakdown(self, state: VehicleSimState):
        v = state.vehicle
        order = state.current_order
        zone = nearest_zone_name(state.lat, state.lng)

        v.status = VehicleStatus.BREAKDOWN
        v.speed = 0.0
        v.current_eta_minutes = None
        v.health.overall_score = random.uniform(4, 18)
        v.health.engine_temp = random.uniform(128, 168)
        state.phase = "idle"
        state.repair_remaining_sec = random.uniform(300, 900)
        state.clear_route()

        incident = self._new_incident(
            IncidentType.VEHICLE_BREAKDOWN, IncidentSeverity.HIGH,
            title=f"Breakdown: {v.name} near {zone}",
            description=(f"{v.name} ({v.registration or v.vehicle_id}) stopped with engine failure near {zone}. "
                         f"Engine temperature {v.health.engine_temp:.0f}\u00b0C."),
            vehicle=v, region=state.region,
            order_ids=[order.order_id] if order else [],
        )
        incident.timeline.append(IncidentTimelineEntry(
            timestamp=datetime.utcnow(), event="Telemetry flagged engine failure",
            details=f"Engine temp {v.health.engine_temp:.0f}\u00b0C, health score {v.health.overall_score:.0f}/100"))
        state.breakdown_incident = incident
        await self._emit_incident(incident, is_new=True)

        if order:
            await self._release_order_after_breakdown(state, order, incident)
        else:
            incident.status = IncidentStatus.MONITORING
            incident.timeline.append(IncidentTimelineEntry(
                timestamp=datetime.utcnow(), event="No active delivery on this vehicle",
                details="Roadside assistance dispatched"))
            await self._emit_incident(incident)
        logger.warning("Vehicle breakdown", vehicle=v.name, vehicle_id=v.vehicle_id, had_order=bool(order))

    async def _release_order_after_breakdown(self, state: VehicleSimState, order: Order, incident: Incident):
        """Take the order off the broken vehicle and ask the dispatcher to re-home it."""
        v = state.vehicle
        cargo_on_board = order.status in (OrderStatus.PICKED_UP, OrderStatus.DELIVERY_EN_ROUTE)
        if cargo_on_board:
            # Replacement vehicle must collect the cargo from the breakdown site.
            order.pickup = AddressPoint(
                address=f"Breakdown site - {v.name}",
                location=GeoPoint(coordinates=[state.lng, state.lat]),
                notes="Cargo transfer from broken-down vehicle",
            )
        order.status = OrderStatus.PENDING
        order.assigned_vehicle_id = None
        order.assigned_driver_id = None
        order.assigned_at = None
        order.eta_minutes = None
        order.sla_at_risk = False
        order.reassignment_count += 1
        v.current_order_id = None
        v.current_load_kg = 0.0
        state.current_order = None
        state.order_elapsed_min = 0.0
        state.order_distance_km = 0.0
        await self._persist_order(order)

        incident.timeline.append(IncidentTimelineEntry(
            timestamp=datetime.utcnow(), event=f"Order {order.reference} released for reassignment",
            details="Cargo transfer required at breakdown site" if cargo_on_board else "Not yet picked up"))
        incident.status = IncidentStatus.ANALYZING
        await self._emit_incident(incident)

        await self._request_dispatch(
            OptimizationTrigger.VEHICLE_BREAKDOWN,
            triggering_vehicle_id=v.vehicle_id, triggering_incident_id=incident.incident_id)

        new_vehicle = self.get_vehicle(order.assigned_vehicle_id) if order.assigned_vehicle_id else None
        if new_vehicle and order.status == OrderStatus.ASSIGNED:
            eta = order.eta_minutes or 0
            incident.autonomous_actions.append(AutonomousAction(
                action_type="reassign_order",
                description=f"Order {order.reference} reassigned to {new_vehicle.name}",
                vehicle_id=new_vehicle.vehicle_id, order_id=order.order_id,
                reason=f"{v.name} broke down while carrying the order",
                expected_impact=f"New delivery ETA about {eta:.0f} min",
                outcome="Reassigned successfully",
            ))
            incident.timeline.append(IncidentTimelineEntry(
                timestamp=datetime.utcnow(), event=f"Reassigned to {new_vehicle.name}",
                details=f"ETA {eta:.0f} min", actor="optimizer"))
            incident.status = IncidentStatus.ACTION_TAKEN
            incident.sla_impact = "At risk" if order.sla_at_risk else "None expected"
        else:
            incident.autonomous_actions.append(AutonomousAction(
                action_type="queue_order",
                description=f"No suitable vehicle free - {order.reference} queued for next available",
                order_id=order.order_id,
                reason="No available vehicle satisfies capacity / region / cold-chain constraints",
                expected_impact="Order is dispatched as soon as a vehicle frees up",
            ))
            incident.timeline.append(IncidentTimelineEntry(
                timestamp=datetime.utcnow(), event="No vehicle available - order queued", actor="optimizer"))
            incident.status = IncidentStatus.MONITORING
            incident.sla_impact = "At risk"
        await self._emit_incident(incident)

    async def _tick_repair(self, state: VehicleSimState, dt_sec: float):
        v = state.vehicle
        state.repair_remaining_sec -= dt_sec
        if state.repair_remaining_sec > 0:
            return
        if v.status == VehicleStatus.BREAKDOWN:
            v.status = VehicleStatus.MAINTENANCE
            v.health.engine_temp = 88.0
            state.repair_remaining_sec = 120.0
            incident = state.breakdown_incident
            if incident and incident.status != IncidentStatus.RESOLVED:
                incident.timeline.append(IncidentTimelineEntry(
                    timestamp=datetime.utcnow(), event="Roadside repair complete - vehicle in workshop check"))
                await self._emit_incident(incident)
            return
        # MAINTENANCE finished
        v.status = VehicleStatus.AVAILABLE
        v.fuel_level = max(v.fuel_level, 50.0)
        v.health.overall_score = max(v.health.overall_score, 70.0)
        state.phase = "idle"
        incident = state.breakdown_incident
        state.breakdown_incident = None
        if incident and incident.status != IncidentStatus.RESOLVED:
            self._finish_incident(incident, note=f"{v.name} repaired and back in service",
                                  outcome="Vehicle returned to service")
            await self._emit_incident(incident)
        logger.info("Vehicle recovered", vehicle=v.name)

    # ── Fuel ──────────────────────────────────────────────────────────────────
    async def _raise_low_fuel(self, state: VehicleSimState, en_route: bool):
        v = state.vehicle
        label = "battery charge" if v.fuel_type.value == "electric" else "fuel"
        incident = self._new_incident(
            IncidentType.LOW_BATTERY if v.fuel_type.value == "electric" else IncidentType.LOW_FUEL,
            IncidentSeverity.MEDIUM,
            title=f"Low {label}: {v.name}",
            description=f"{v.name} {label} at {v.fuel_level:.1f}%.",
            vehicle=v, region=state.region,
            order_ids=[state.current_order.order_id] if state.current_order else [],
        )
        if en_route:
            incident.autonomous_actions.append(AutonomousAction(
                action_type="schedule_refuel",
                description="Refuel scheduled immediately after the current delivery",
                vehicle_id=v.vehicle_id, reason=f"{label.capitalize()} below {CRITICAL_FUEL_PCT:.0f}%",
                expected_impact="Vehicle is not offered new orders until refuelled"))
            incident.status = IncidentStatus.ACTION_TAKEN
        state.low_fuel_incident = incident
        await self._emit_incident(incident, is_new=True)

    async def _start_refuel(self, state: VehicleSimState):
        v = state.vehicle
        if state.low_fuel_incident is None:
            await self._raise_low_fuel(state, en_route=False)
        incident = state.low_fuel_incident
        state.phase = "refuelling"
        state.refuel_remaining_sec = REFUEL_SEC
        v.status = VehicleStatus.IDLE      # not dispatchable while refuelling
        v.speed = 0.0
        if incident:
            incident.autonomous_actions.append(AutonomousAction(
                action_type="refuel",
                description=f"{v.name} taken out of dispatch to refuel/recharge",
                vehicle_id=v.vehicle_id, reason=f"Level {v.fuel_level:.0f}% is below {LOW_FUEL_PCT:.0f}%",
                expected_impact=f"Back in service in about {REFUEL_SEC // 60} min"))
            incident.status = IncidentStatus.ACTION_TAKEN
            incident.timeline.append(IncidentTimelineEntry(
                timestamp=datetime.utcnow(), event="Vehicle sent to refuel", actor="system"))
            await self._emit_incident(incident)

    async def _tick_refuel(self, state: VehicleSimState, dt_sec: float):
        v = state.vehicle
        state.refuel_remaining_sec -= dt_sec
        if state.refuel_remaining_sec > 0:
            return
        v.fuel_level = 100.0 if v.fuel_type.value == "electric" else 95.0
        rate = fuel_use_pct_per_km(v.fuel_type.value, v.type.value)
        v.fuel_range_km = round(v.fuel_level / rate, 1)
        v.status = VehicleStatus.AVAILABLE
        state.phase = "idle"
        incident = state.low_fuel_incident
        state.low_fuel_incident = None
        if incident and incident.status != IncidentStatus.RESOLVED:
            self._finish_incident(incident, note=f"{v.name} refuelled to {v.fuel_level:.0f}%",
                                  outcome="Refuelled")
            await self._emit_incident(incident)

    # ── Incidents ─────────────────────────────────────────────────────────────
    def _new_incident(self, itype: IncidentType, severity: IncidentSeverity, title: str, description: str,
                      vehicle: Optional[Vehicle] = None, region: Optional[str] = None,
                      order_ids: Optional[List[str]] = None) -> Incident:
        incident = Incident(
            incident_id=f"INC-{uuid.uuid4().hex[:8].upper()}",
            type=itype, severity=severity, status=IncidentStatus.DETECTED,
            title=title, description=description,
            vehicle_id=vehicle.vehicle_id if vehicle else None,
            vehicle_name=vehicle.name if vehicle else None,
            driver_id=vehicle.driver_id if vehicle else None,
            region=region,
            order_ids=order_ids or [],
            detected_by="simulation",
            timeline=[IncidentTimelineEntry(timestamp=datetime.utcnow(), event="Incident detected")],
        )
        self._incidents[incident.incident_id] = incident
        return incident

    def _finish_incident(self, incident: Incident, note: str, outcome: Optional[str] = None,
                         actor: str = "system"):
        now = datetime.utcnow()
        incident.status = IncidentStatus.RESOLVED
        incident.resolved_at = now
        incident.resolution_notes = note
        incident.timeline.append(IncidentTimelineEntry(timestamp=now, event="Incident resolved",
                                                       details=note, actor=actor))
        if outcome and incident.autonomous_actions:
            last = incident.autonomous_actions[-1]
            if not last.outcome:
                last.outcome = outcome

    async def _emit_incident(self, incident: Incident, is_new: bool = False):
        incident.updated_at = datetime.utcnow()
        for cb in self._on_incident_callbacks:
            try:
                await cb(incident, is_new)
            except Exception:
                logger.error("Incident callback failed", exc_info=True)
        # Bound memory: keep only recent resolved incidents
        if len(self._incidents) > 300:
            for iid in [i for i, inc in self._incidents.items() if inc.status == IncidentStatus.RESOLVED][:100]:
                self._incidents.pop(iid, None)

    async def resolve_incident(self, incident_id: str, username: str, notes: Optional[str] = None) -> bool:
        """Manual resolution of a live incident. Returns False if it is not in memory."""
        incident = self._incidents.get(incident_id)
        if incident is None:
            return False
        if incident.status != IncidentStatus.RESOLVED:
            self._finish_incident(incident, note=notes or f"Resolved manually by {username}",
                                  actor=f"user:{username}")
            await self._emit_incident(incident)
        return True

    async def trigger_breakdown_event(self, vehicle_id: Optional[str] = None) -> Optional[str]:
        if vehicle_id:
            state = self._vehicles.get(vehicle_id)
            if state is None or state.vehicle.status in (VehicleStatus.BREAKDOWN, VehicleStatus.OFFLINE):
                return None
        else:
            candidates = [s for s in self._vehicles.values() if s.vehicle.status == VehicleStatus.EN_ROUTE]
            if not candidates:
                return None
            state = random.choice(candidates)
        await self._trigger_breakdown(state)
        return state.vehicle.vehicle_id

    # ── Orders ────────────────────────────────────────────────────────────────
    def _max_capacity(self, region: str) -> float:
        caps = [s.vehicle.max_capacity_kg for s in self._vehicles.values() if s.region == region]
        return max(caps) if caps else 0.0

    async def generate_random_order(self, region: Optional[str] = None, dispatch: bool = True) -> Optional[Order]:
        if region not in REGIONS:
            region = DELHI if random.random() < 0.4 else MUMBAI
        zones = ZONES_BY_REGION[region]
        pickup_zone, delivery_zone = random.choice(zones), random.choice(zones)
        plat, plng = random_point(pickup_zone)
        dlat, dlng = random_point(delivery_zone)

        weight = random_cargo_weight()
        max_cap = self._max_capacity(region)
        if max_cap and weight > max_cap:
            weight = round(random.uniform(5, max_cap * 0.8), 1)
        priority = random.choices(
            [OrderPriority.LOW, OrderPriority.NORMAL, OrderPriority.HIGH, OrderPriority.CRITICAL],
            weights=[12, 50, 30, 8])[0]
        slack = {OrderPriority.CRITICAL: (1.2, 1.8), OrderPriority.HIGH: (1.4, 2.4),
                 OrderPriority.NORMAL: (1.8, 3.2), OrderPriority.LOW: (2.5, 4.0)}[priority]
        trip_km = haversine_km(plat, plng, dlat, dlng)
        base_min = (trip_km + 4.0) / BASE_SPEED_KMH[region] * 60 + (PICKUP_HANDLING_SEC + DELIVERY_HANDLING_SEC) / 60
        deadline = datetime.utcnow() + timedelta(minutes=30 + base_min * random.uniform(*slack))
        customer = random.choice(INDIAN_COMPANIES)
        prefix = "DEL" if region == DELHI else "MUM"

        order = Order(
            order_id=f"ord-{uuid.uuid4().hex[:12]}",
            reference=f"{prefix}-{datetime.utcnow().strftime('%y%m%d')}-{random.randint(1000, 9999)}",
            status=OrderStatus.PENDING,
            priority=priority,
            customer_name=customer,
            region=region,
            pickup=AddressPoint(address=make_indian_address(pickup_zone), location=GeoPoint(coordinates=[plng, plat])),
            delivery=AddressPoint(address=make_indian_address(delivery_zone), location=GeoPoint(coordinates=[dlng, dlat])),
            weight_kg=weight,
            requires_refrigeration=random.random() < 0.05,
            description=f"Shipment for {customer}",
            deadline=deadline,
            estimated_distance_km=round(trip_km, 1),
        )
        await self.add_order(order, dispatch=dispatch)
        return order

    async def add_order(self, order: Order, dispatch: bool = True):
        """Register a new pending order (persist, announce, ask for dispatch)."""
        order.region = order.region or region_for_lng(order.pickup.location.coordinates[0])
        self._orders[order.order_id] = order
        await self._persist_order(order)
        await broadcaster.broadcast(WSEventType.ORDER_CREATED, {
            "order_id": order.order_id,
            "reference": order.reference,
            "customer": order.customer_name,
            "priority": order.priority.value,
            "weight_kg": round(order.weight_kg, 1),
            "region": order.region,
        })
        for cb in self._on_order_callbacks:
            await cb(order)
        if dispatch:
            await self._request_dispatch(OptimizationTrigger.NEW_ORDER, triggering_order_id=order.order_id)

    async def seed_initial_orders(self, count: int = 24):
        """Give a freshly started system some work so the first screen is not empty."""
        for _ in range(count):
            await self.generate_random_order(dispatch=False)
        await self._request_dispatch(OptimizationTrigger.SCHEDULED)

    # ── Persistence ───────────────────────────────────────────────────────────
    async def _persist_order(self, order: Order):
        order.updated_at = datetime.utcnow()
        if self._db is None:
            return
        try:
            await self._db.orders.replace_one({"order_id": order.order_id}, order.model_dump(), upsert=True)
        except Exception:
            logger.error("Failed to persist order", order_id=order.order_id, exc_info=True)

    async def _persist_vehicles(self):
        if self._db is None or not self._vehicles:
            return
        ops = []
        for s in self._vehicles.values():
            v = s.vehicle
            ops.append(UpdateOne({"vehicle_id": v.vehicle_id}, {"$set": {
                "location": v.location.model_dump(),
                "status": v.status.value,
                "speed": v.speed,
                "heading": v.heading,
                "fuel_level": v.fuel_level,
                "fuel_range_km": v.fuel_range_km,
                "current_load_kg": v.current_load_kg,
                "current_order_id": v.current_order_id,
                "current_eta_minutes": v.current_eta_minutes,
                "odometer_km": v.odometer_km,
                "health": v.health.model_dump(),
                "updated_at": datetime.utcnow(),
            }}))
        try:
            await self._db.vehicles.bulk_write(ops, ordered=False)
        except Exception:
            logger.error("Failed to persist vehicles", exc_info=True)

    async def _persist_telemetry(self, state: VehicleSimState):
        if self._db is None:
            return
        v = state.vehicle
        try:
            await self._db.telemetry.insert_one({
                "vehicle_id": v.vehicle_id,
                "vehicle_name": v.name,
                "timestamp": datetime.utcnow(),
                "location": v.location.model_dump(),
                "speed": v.speed,
                "heading": v.heading,
                "fuel_level": v.fuel_level,
                "current_load_kg": v.current_load_kg,
                "status": v.status.value,
                "engine_temp": v.health.engine_temp,
                "odometer_km": v.odometer_km,
                "current_order_id": v.current_order_id,
                "eta_minutes": v.current_eta_minutes,
            })
        except Exception:
            logger.warning("Failed to persist telemetry", exc_info=True)

    # ── Snapshot ──────────────────────────────────────────────────────────────
    def build_fleet_snapshot(self) -> dict:
        return {
            "vehicles": [
                {
                    "vehicle_id": s.vehicle.vehicle_id,
                    "name": s.vehicle.name,
                    "type": s.vehicle.type.value,
                    "status": s.vehicle.status.value,
                    "lat": s.lat,
                    "lng": s.lng,
                    "speed": round(s.vehicle.speed, 1),
                    "heading": round(s.vehicle.heading, 1),
                    "fuel_level": round(s.vehicle.fuel_level, 1),
                    "current_load_kg": round(s.vehicle.current_load_kg, 1),
                    "max_capacity_kg": s.vehicle.max_capacity_kg,
                    "current_order_id": s.vehicle.current_order_id,
                    "eta_minutes": round(s.vehicle.current_eta_minutes, 1) if s.vehicle.current_eta_minutes else None,
                    "health_score": round(s.vehicle.health.overall_score, 1),
                    "region": s.region,
                }
                for s in self._vehicles.values()
            ],
            "tick": self.tick_count,
            "sim_speed": self.speed,
            "paused": self.paused,
            "pending_orders": self.pending_count,
            "traffic": {r: round(f, 2) for r, f in self._traffic.items()},
        }

    _build_fleet_snapshot = build_fleet_snapshot   # backwards-compatible alias


simulation_engine = SimulationEngine()
