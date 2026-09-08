"""
Vehicle Simulation Engine — India Fleet
Mumbai MMR + Delhi NCR dual-region operation.

Real Indian vehicle models, authentic traffic patterns:
- Mumbai: 18-32 km/h avg, severe peak-hour congestion (8-11am, 6-9pm)
- Delhi: 22-38 km/h avg, pollution-related restrictions
- Monsoon season traffic multipliers
- CNG/Electric/Diesel fuel types with realistic consumption
"""
import asyncio
import math
import random
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import structlog

from app.config import settings
from app.models.vehicle import Vehicle, VehicleStatus, GeoPoint, VehicleHealth
from app.models.order import Order, OrderStatus, OrderPriority, AddressPoint
from app.models.incident import Incident, IncidentType, IncidentSeverity, IncidentStatus
from app.websocket.broadcaster import broadcaster, WSEventType

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
    ("Connaught Place",  28.6315, 77.2167, "DL"),
    ("Karol Bagh",       28.6508, 77.1900, "DL"),
    ("Lajpat Nagar",     28.5665, 77.2433, "DL"),
    ("Saket",            28.5245, 77.2066, "DL"),
    ("Dwarka",           28.5921, 77.0460, "DL"),
    ("Rohini",           28.7041, 77.1025, "DL"),
    ("Noida Sector 18",  28.5705, 77.3219, "UP"),
    ("Noida Sector 62",  28.6270, 77.3650, "UP"),
    ("Greater Noida",    28.4744, 77.5040, "UP"),
    ("Gurgaon Sector 29",28.4595, 77.0266, "HR"),
    ("Gurgaon DLF",      28.4672, 77.0435, "HR"),
    ("Faridabad",        28.4089, 77.3178, "HR"),
    ("Ghaziabad",        28.6692, 77.4538, "UP"),
    ("Vasant Kunj",      28.5244, 77.1571, "DL"),
    ("Nehru Place",      28.5491, 77.2519, "DL"),
    ("Gurugram Cyber Hub",28.4949,77.0887, "HR"),
]

ALL_ZONES = MUMBAI_ZONES + DELHI_NCR_ZONES

INDIAN_COMPANIES = [
    "Reliance Retail Ltd","Tata Consumer Products","Flipkart Logistics",
    "Amazon India Pvt Ltd","BigBasket Fulfilment","Zomato Hyperpure",
    "Meesho Warehouse","Nykaa Distribution","Mahindra Logistics",
    "Blue Dart Express","DTDC Courier","Delhivery Ltd",
    "Ekart Logistics","Shadowfax Technologies","Porter Logistics",
    "Dunzo Daily","Swiggy Instamart","Blinkit Dark Store",
    "Spencer's Retail","DMart Distribution","Jio Commerce",
    "Godrej Consumer","Hindustan Unilever","ITC Limited",
    "Haldiram's Distribution","Amul Dairy","Mother Dairy",
    "Zepto Dark Store","PharmEasy Express","Pepperfry Logistics",
]

VEHICLE_MODELS = {
    "van":          ["Tata Ace Gold","Tata Ace HT","Mahindra Bolero Pikup","Mahindra Jeeto","Ashok Leyland Dost","Force Traveller T1","Mahindra Supro"],
    "truck":        ["Tata LPT 1412","Tata LPT 1616","Tata Prima 2528","Eicher Pro 2095","Eicher Pro 3015","BharatBenz 1617","Ashok Leyland U-Truck 1616"],
    "cargo_bike":   ["Euler HiLoad EV","OSM Rage+","Mahindra Treo Zor","Piaggio Ape E-City"],
    "motorcycle":   ["Hero Splendor+","Honda Activa 6G","TVS Apache RTR","Bajaj Platina 110"],
    "refrigerated": ["Tata Ace Zip Reefer","Mahindra Jeeto Reefer","Eicher Pro 2095 Reefer"],
}

ROADS_MUM = ["Western Express Highway","Eastern Freeway","NH-48","Sion-Panvel Highway","JVLR","Thane-Belapur Road"]
ROADS_DEL = ["NH-48 Gurgaon","Delhi-Noida Direct Flyway","Outer Ring Road","NH-9","Mehrauli-Badarpur Road"]
AREAS_MUM = ["Kurla Junction","Andheri flyover","Thane creek bridge","Vashi bridge","Ghatkopar flyover"]
AREAS_DEL = ["Karol Bagh chowk","DND Flyway","Dhaula Kuan","Saket Metro","NH-48 toll plaza"]


def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def bearing(lat1, lng1, lat2, lng2):
    dlng = math.radians(lng2 - lng1)
    lat1r, lat2r = math.radians(lat1), math.radians(lat2)
    x = math.sin(dlng) * math.cos(lat2r)
    y = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlng)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def move_toward(lat, lng, tlat, tlng, speed_kmh, dt_hours):
    dist = haversine_km(lat, lng, tlat, tlng)
    travel = speed_kmh * dt_hours
    if dist <= travel or dist < 0.05:
        return tlat, tlng, True
    ratio = travel / dist
    return lat + (tlat - lat) * ratio, lng + (tlng - lng) * ratio, False


def random_point(zone, radius_km=1.8):
    _, z_lat, z_lng, _ = zone
    r = radius_km * math.sqrt(random.random())
    theta = random.uniform(0, 2 * math.pi)
    dlat = r * math.cos(theta) / 111.0
    dlng = r * math.sin(theta) / (111.0 * math.cos(math.radians(z_lat)))
    return z_lat + dlat, z_lng + dlng


def make_indian_address(zone):
    z_name, _, _, z_state = zone
    state_name = {"DL":"Delhi","UP":"Uttar Pradesh","HR":"Haryana","MH":"Maharashtra"}.get(z_state,"India")
    areas = ["Shivaji Nagar","Gandhi Nagar","Nehru Nagar","Rajendra Nagar","Laxmi Nagar"]
    road = random.choice(["Marg","Road","Lane","Colony","Sector","Nagar"])
    pin = random.randint(110001,110099) if z_state=="DL" else random.randint(201301,201310) if z_state=="UP" else random.randint(400001,421605)
    return f"{random.randint(1,500)}, {random.choice(areas)} {road}, {z_name}, {state_name} - {pin}"


class VehicleSimState:
    def __init__(self, vehicle: Vehicle):
        self.vehicle = vehicle
        self.target_lat: Optional[float] = None
        self.target_lng: Optional[float] = None
        self.phase: str = "idle"
        self.current_order: Optional[Order] = None
        self.stop_timer: float = 0.0
        self.telemetry_counter: int = 0
        self.traffic_factor: float = 1.0
        # Determine region from location (approximate)
        lng = vehicle.location.coordinates[0]
        self.is_delhi = lng > 76.5  # Mumbai ~72.8, Delhi ~77.2

    @property
    def lat(self):
        return self.vehicle.location.coordinates[1]

    @property
    def lng(self):
        return self.vehicle.location.coordinates[0]

    def set_position(self, lat, lng):
        self.vehicle.location = GeoPoint(coordinates=[lng, lat])

    def set_target(self, lat, lng):
        self.target_lat = lat
        self.target_lng = lng

    def typical_speed(self):
        """City-appropriate speed range in km/h."""
        if self.is_delhi:
            # Delhi slightly faster, wide roads
            return random.uniform(22, 38) / max(self.traffic_factor, 0.5)
        else:
            # Mumbai: dense, slower
            return random.uniform(16, 30) / max(self.traffic_factor, 0.5)


class SimulationEngine:
    def __init__(self):
        self.running = False
        self.paused = False
        self.speed = settings.SIMULATION_SPEED
        self.interval = settings.SIMULATION_INTERVAL_SECONDS
        self.tick_count = 0
        self.persist_interval = settings.TELEMETRY_PERSIST_INTERVAL
        self._vehicles: Dict[str, VehicleSimState] = {}
        self._orders: Dict[str, Order] = {}
        self._pending_orders: List[Order] = []
        self._db = None
        self._order_gen_counter = 0
        self._task: Optional[asyncio.Task] = None
        self._on_incident_callbacks = []
        self._on_order_callbacks = []

    def register_incident_callback(self, cb):
        self._on_incident_callbacks.append(cb)

    def register_order_callback(self, cb):
        self._on_order_callbacks.append(cb)

    def set_db(self, db):
        self._db = db

    def load_vehicles(self, vehicles: List[Vehicle]):
        for v in vehicles:
            self._vehicles[v.vehicle_id] = VehicleSimState(v)
        logger.info("Vehicles loaded into simulation", count=len(vehicles))

    def get_all_vehicles(self) -> List[Vehicle]:
        return [s.vehicle for s in self._vehicles.values()]

    def get_vehicle(self, vehicle_id: str) -> Optional[Vehicle]:
        s = self._vehicles.get(vehicle_id)
        return s.vehicle if s else None

    def get_all_orders(self) -> List[Order]:
        return list(self._orders.values())

    def get_pending_orders(self) -> List[Order]:
        return [o for o in self._orders.values() if o.status == OrderStatus.PENDING]

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

    def pause(self):
        self.paused = True

    def resume(self):
        self.paused = False

    async def _loop(self):
        while self.running:
            if not self.paused:
                try:
                    await self._tick()
                except Exception as e:
                    logger.error("Sim tick error", error=str(e))
            await asyncio.sleep(self.interval / max(self.speed, 0.1))

    def _traffic_factor(self, is_delhi: bool) -> float:
        """IST-approximate traffic multiplier based on hour."""
        hour_ist = (datetime.utcnow().hour + 5) % 24
        if 8 <= hour_ist <= 11 or 17 <= hour_ist <= 20:
            base = random.uniform(1.7, 2.5) if not is_delhi else random.uniform(1.5, 2.2)
        elif 13 <= hour_ist <= 15:
            base = random.uniform(1.2, 1.5)
        elif hour_ist < 7 or hour_ist > 22:
            base = random.uniform(0.7, 1.0)
        else:
            base = random.uniform(1.0, 1.4)
        return base * random.uniform(0.85, 1.15)

    async def _tick(self):
        self.tick_count += 1
        dt_hours = self.interval / 3600.0

        # Generate new orders periodically
        self._order_gen_counter += 1
        if self._order_gen_counter >= 10:
            self._order_gen_counter = 0
            if random.random() < 0.7:
                await self._generate_random_order()

        for state in self._vehicles.values():
            state.traffic_factor = self._traffic_factor(state.is_delhi)
            await self._update_vehicle(state, self.interval, dt_hours)

        await broadcaster.broadcast(WSEventType.FLEET_SNAPSHOT, self._build_fleet_snapshot())

    async def _update_vehicle(self, state: VehicleSimState, dt_sec: float, dt_hours: float):
        v = state.vehicle
        now = datetime.utcnow()

        if v.status in (VehicleStatus.OFFLINE, VehicleStatus.MAINTENANCE):
            return
        if v.status == VehicleStatus.BREAKDOWN:
            return

        # Breakdown risk: higher for older vehicles
        bd_prob = 0.00015 * max(1.0, v.odometer_km / 100000)
        if v.status == VehicleStatus.EN_ROUTE and random.random() < bd_prob:
            await self._trigger_breakdown(state)
            return

        if v.fuel_level < 10.0 and random.random() < 0.04:
            await self._trigger_low_fuel_incident(state)

        if state.phase in ("idle", "returning"):
            await self._try_assign_order(state)
        elif state.phase == "to_pickup":
            await self._move_to_pickup(state, dt_hours)
        elif state.phase == "at_pickup":
            state.stop_timer += dt_sec
            if state.stop_timer >= 110:  # Indian loading time
                state.stop_timer = 0
                state.phase = "to_delivery"
                if state.current_order:
                    state.current_order.status = OrderStatus.PICKED_UP
                    state.set_target(
                        state.current_order.delivery.location.coordinates[1],
                        state.current_order.delivery.location.coordinates[0],
                    )
                    v.status = VehicleStatus.EN_ROUTE
                    v.updated_at = now
        elif state.phase == "to_delivery":
            await self._move_to_delivery(state, dt_hours)
        elif state.phase == "at_delivery":
            state.stop_timer += dt_sec
            if state.stop_timer >= 140:
                state.stop_timer = 0
                await self._complete_delivery(state)

        # Fuel consumption by type
        if v.status == VehicleStatus.EN_ROUTE:
            fuel_rates = {"diesel": 0.09, "cng": 0.12, "electric": 0.18, "petrol": 0.10}
            rate = fuel_rates.get(v.fuel_type.value, 0.09)
            dist = v.speed * dt_hours
            v.fuel_level = max(0.0, v.fuel_level - rate * dist)
            v.odometer_km += dist

        v.updated_at = now
        state.telemetry_counter += 1
        if self._db is not None and state.telemetry_counter >= self.persist_interval:
            state.telemetry_counter = 0
            await self._persist_telemetry(state)

    async def _try_assign_order(self, state: VehicleSimState):
        if not self._pending_orders:
            state.vehicle.status = VehicleStatus.AVAILABLE
            return

        # Prefer same-region orders for geographic realism
        region_orders = [o for o in self._pending_orders
                        if (state.is_delhi and "Delhi" in (o.customer_id or ""))
                        or not state.is_delhi]
        candidates = region_orders if region_orders else self._pending_orders
        if not candidates:
            state.vehicle.status = VehicleStatus.AVAILABLE
            return
        order = candidates[0]
        self._pending_orders.remove(order)

        state.current_order = order
        order.status = OrderStatus.ASSIGNED
        order.assigned_vehicle_id = state.vehicle.vehicle_id
        order.assigned_at = datetime.utcnow()
        state.set_target(
            order.pickup.location.coordinates[1],
            order.pickup.location.coordinates[0],
        )
        state.phase = "to_pickup"
        state.vehicle.status = VehicleStatus.EN_ROUTE
        state.vehicle.current_order_id = order.order_id
        state.vehicle.current_load_kg = order.weight_kg
        self._orders[order.order_id] = order

        await broadcaster.broadcast(WSEventType.ORDER_ASSIGNED, {
            "order_id": order.order_id,
            "vehicle_id": state.vehicle.vehicle_id,
            "vehicle_name": state.vehicle.name,
            "reference": order.reference,
            "customer": order.customer_name,
            "priority": order.priority.value,
        })

    async def _move_to_pickup(self, state: VehicleSimState, dt_hours: float):
        if state.target_lat is None:
            return
        speed = state.typical_speed()
        state.vehicle.speed = speed
        new_lat, new_lng, arrived = move_toward(state.lat, state.lng, state.target_lat, state.target_lng, speed, dt_hours)
        state.set_position(new_lat, new_lng)
        if state.target_lat and state.target_lng:
            state.vehicle.heading = bearing(state.lat, state.lng, state.target_lat, state.target_lng)
        if arrived:
            state.phase = "at_pickup"
            state.vehicle.status = VehicleStatus.LOADING
            state.vehicle.speed = 0.0
        else:
            dist = haversine_km(state.lat, state.lng, state.target_lat, state.target_lng)
            if speed > 0:
                state.vehicle.current_eta_minutes = (dist / speed) * 60 + 18

    async def _move_to_delivery(self, state: VehicleSimState, dt_hours: float):
        if state.target_lat is None or state.current_order is None:
            return
        speed = state.typical_speed()
        state.vehicle.speed = speed
        new_lat, new_lng, arrived = move_toward(state.lat, state.lng, state.target_lat, state.target_lng, speed, dt_hours)
        state.set_position(new_lat, new_lng)
        if state.target_lat and state.target_lng:
            state.vehicle.heading = bearing(state.lat, state.lng, state.target_lat, state.target_lng)
        if arrived:
            state.phase = "at_delivery"
            state.vehicle.status = VehicleStatus.UNLOADING
            state.vehicle.speed = 0.0
        else:
            dist = haversine_km(state.lat, state.lng, state.target_lat, state.target_lng)
            if speed > 0:
                eta_min = (dist / speed) * 60
                state.vehicle.current_eta_minutes = eta_min
                if state.current_order.deadline:
                    deadline_in = (state.current_order.deadline - datetime.utcnow()).total_seconds() / 60
                    state.current_order.sla_at_risk = eta_min > deadline_in * 0.9

    async def _complete_delivery(self, state: VehicleSimState):
        if not state.current_order:
            return
        order = state.current_order
        order.status = OrderStatus.DELIVERED
        order.delivered_at = datetime.utcnow()
        state.vehicle.current_load_kg = 0.0
        state.vehicle.current_order_id = None
        state.vehicle.status = VehicleStatus.AVAILABLE
        state.vehicle.current_eta_minutes = None
        state.phase = "idle"
        state.current_order = None
        await broadcaster.broadcast(WSEventType.DELIVERY_COMPLETED, {
            "order_id": order.order_id,
            "vehicle_id": state.vehicle.vehicle_id,
            "vehicle_name": state.vehicle.name,
            "reference": order.reference,
            "customer": order.customer_name,
            "delivered_at": order.delivered_at.isoformat(),
        })

    async def _trigger_breakdown(self, state: VehicleSimState):
        v = state.vehicle
        v.status = VehicleStatus.BREAKDOWN
        v.speed = 0.0
        v.health.overall_score = random.uniform(4, 18)
        v.health.engine_temp = random.uniform(128, 168)
        state.phase = "idle"
        is_delhi = state.is_delhi
        road = random.choice(ROADS_DEL if is_delhi else ROADS_MUM)
        area = random.choice(AREAS_DEL if is_delhi else AREAS_MUM)
        incident = Incident(
            incident_id=f"INC-{uuid.uuid4().hex[:8].upper()}",
            type=IncidentType.VEHICLE_BREAKDOWN,
            severity=IncidentSeverity.HIGH,
            status=IncidentStatus.DETECTED,
            title=f"Breakdown: {v.name} on {road}",
            description=f"Vehicle {v.name} has suffered engine failure near {area}. Engine temperature critical at {v.health.engine_temp:.0f}°C. Roadside assistance dispatched. Active delivery will be reassigned.",
            vehicle_id=v.vehicle_id,
            order_ids=[v.current_order_id] if v.current_order_id else [],
        )
        for cb in self._on_incident_callbacks:
            await cb(incident)
        asyncio.create_task(self._recover_vehicle(state, delay=random.randint(90, 300)))
        logger.warning("Vehicle breakdown triggered", vehicle=v.name, vehicle_id=v.vehicle_id)

    async def _recover_vehicle(self, state: VehicleSimState, delay: int):
        await asyncio.sleep(delay / max(self.speed, 1))
        v = state.vehicle
        if v.status == VehicleStatus.BREAKDOWN:
            v.status = VehicleStatus.MAINTENANCE
            v.health.engine_temp = 88.0
            await asyncio.sleep(60 / max(self.speed, 1))
            v.status = VehicleStatus.AVAILABLE
            v.fuel_level = max(v.fuel_level, 50.0)
            v.health.overall_score = 70.0
            state.phase = "idle"
            logger.info("Vehicle recovered", vehicle=v.name)

    async def _trigger_low_fuel_incident(self, state: VehicleSimState):
        v = state.vehicle
        fuel_label = "battery charge" if v.fuel_type.value == "electric" else "CNG level" if v.fuel_type.value == "cng" else "fuel level"
        incident = Incident(
            incident_id=f"INC-{uuid.uuid4().hex[:8].upper()}",
            type=IncidentType.LOW_FUEL,
            severity=IncidentSeverity.MEDIUM,
            status=IncidentStatus.DETECTED,
            title=f"Low {fuel_label.title()}: {v.name}",
            description=f"Vehicle {v.name} {fuel_label} at {v.fuel_level:.1f}%. Nearest IOCL/CNG station assigned.",
            vehicle_id=v.vehicle_id,
        )
        for cb in self._on_incident_callbacks:
            await cb(incident)

    async def _generate_random_order(self):
        # Pick region randomly (40% Delhi, 60% Mumbai by default)
        if random.random() < 0.4:
            pickup_zone = random.choice(DELHI_NCR_ZONES)
            delivery_zone = random.choice(DELHI_NCR_ZONES)
            ref_prefix = "DEL"
        else:
            pickup_zone = random.choice(MUMBAI_ZONES)
            delivery_zone = random.choice(MUMBAI_ZONES)
            ref_prefix = "MUM"

        plat, plng = random_point(pickup_zone)
        dlat, dlng = random_point(delivery_zone)
        customer = random.choice(INDIAN_COMPANIES)

        priority = random.choices(
            [OrderPriority.LOW, OrderPriority.NORMAL, OrderPriority.HIGH, OrderPriority.CRITICAL],
            weights=[12, 50, 30, 8]
        )[0]

        order = Order(
            order_id=f"ord-{uuid.uuid4().hex[:12]}",
            reference=f"{ref_prefix}-{datetime.utcnow().strftime('%y%m%d')}-{random.randint(1000,9999)}",
            status=OrderStatus.PENDING,
            priority=priority,
            customer_name=customer,
            pickup=AddressPoint(
                address=make_indian_address(pickup_zone),
                location=GeoPoint(coordinates=[plng, plat]),
            ),
            delivery=AddressPoint(
                address=make_indian_address(delivery_zone),
                location=GeoPoint(coordinates=[dlng, dlat]),
            ),
            weight_kg=random.uniform(5, 1200),
            description=f"Shipment for {customer}",
            deadline=datetime.utcnow() + timedelta(hours=random.randint(2, 10)),
        )

        self._orders[order.order_id] = order
        self._pending_orders.append(order)

        if self._db is not None:
            try:
                await self._db.orders.insert_one(order.model_dump())
            except Exception:
                pass

        await broadcaster.broadcast(WSEventType.ORDER_CREATED, {
            "order_id": order.order_id,
            "reference": order.reference,
            "customer": order.customer_name,
            "priority": order.priority.value,
            "weight_kg": round(order.weight_kg, 1),
        })
        for cb in self._on_order_callbacks:
            await cb(order)

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
            pass

    def _build_fleet_snapshot(self):
        return {
            "vehicles": [
                {
                    "vehicle_id": s.vehicle.vehicle_id,
                    "name": s.vehicle.name,
                    "status": s.vehicle.status.value,
                    "lat": s.lat,
                    "lng": s.lng,
                    "speed": round(s.vehicle.speed, 1),
                    "heading": round(s.vehicle.heading, 1),
                    "fuel_level": round(s.vehicle.fuel_level, 1),
                    "current_load_kg": round(s.vehicle.current_load_kg, 1),
                    "current_order_id": s.vehicle.current_order_id,
                    "eta_minutes": round(s.vehicle.current_eta_minutes, 1) if s.vehicle.current_eta_minutes else None,
                    "health_score": round(s.vehicle.health.overall_score, 1),
                    "region": "Delhi NCR" if s.is_delhi else "Mumbai MMR",
                }
                for s in self._vehicles.values()
            ],
            "tick": self.tick_count,
            "sim_speed": self.speed,
            "pending_orders": len(self._pending_orders),
        }

    async def trigger_traffic_event(self):
        count = 0
        for state in self._vehicles.values():
            if state.vehicle.status == VehicleStatus.EN_ROUTE:
                state.traffic_factor = random.uniform(2.0, 3.0)
                count += 1
        region_msg = "Western Express Highway (Mumbai) and NH-48 (Delhi NCR)" if count > 3 else "Western Express Highway"
        await broadcaster.broadcast(WSEventType.ALERT_CREATED, {
            "type": "traffic_surge",
            "message": f"Heavy congestion on {region_msg}. {count} vehicles affected. ETAs recalculating.",
            "severity": "high",
            "affected_vehicles": count,
        })
        logger.info("Traffic event triggered", affected=count)

    async def trigger_breakdown_event(self, vehicle_id=None):
        if vehicle_id and vehicle_id in self._vehicles:
            state = self._vehicles[vehicle_id]
        else:
            candidates = [s for s in self._vehicles.values() if s.vehicle.status == VehicleStatus.EN_ROUTE]
            if not candidates:
                return
            state = random.choice(candidates)
        await self._trigger_breakdown(state)


simulation_engine = SimulationEngine()
