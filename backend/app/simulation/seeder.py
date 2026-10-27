"""
Database seeder — India fleet (Mumbai MMR + Delhi NCR dual-region operation).
Uses bcrypt directly to avoid passlib version issues.
"""
import random
import uuid
import math
import bcrypt
from datetime import datetime, timedelta, timezone
import structlog

from app.utils.cargo import random_cargo_weight
from app.utils.geo import DELHI, IST, MUMBAI, haversine_km, region_for_lng

logger = structlog.get_logger(__name__)

# Bump when the persisted data model changes; triggers a rebuild of operational collections.
SCHEMA_VERSION = 2

def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

# ─── GEOGRAPHY ────────────────────────────────────────────────────────────────
MUMBAI_ZONES = [
    ("Bandra",           19.0596, 72.8295, "MH"),
    ("Andheri",          19.1136, 72.8697, "MH"),
    ("Kurla",            19.0726, 72.8795, "MH"),
    ("Dadar",            19.0186, 72.8432, "MH"),
    ("Worli",            19.0109, 72.8181, "MH"),
    ("Powai",            19.1197, 72.9050, "MH"),
    ("Goregaon",         19.1663, 72.8526, "MH"),
    ("Malad",            19.1871, 72.8484, "MH"),
    ("Borivali",         19.2318, 72.8567, "MH"),
    ("Thane",            19.2183, 72.9781, "MH"),
    ("Navi Mumbai",      19.0368, 73.0158, "MH"),
    ("Vashi",            19.0771, 73.0073, "MH"),
    ("Kharghar",         19.0474, 73.0691, "MH"),
    ("Panvel",           18.9894, 73.1175, "MH"),
    ("Bhiwandi",         19.2967, 73.0583, "MH"),
    ("Kalyan",           19.2437, 73.1355, "MH"),
    ("Dombivli",         19.2143, 73.0888, "MH"),
    ("Mira Road",        19.2812, 72.8726, "MH"),
    ("Chembur",          19.0522, 72.8997, "MH"),
    ("Ghatkopar",        19.0858, 72.9087, "MH"),
    ("Vikhroli",         19.1073, 72.9244, "MH"),
    ("Mulund",           19.1768, 72.9576, "MH"),
    ("Dharavi",          19.0392, 72.8544, "MH"),
    ("Vasai",            19.3707, 72.8076, "MH"),
]

DELHI_NCR_ZONES = [
    ("Connaught Place",   28.6315, 77.2167, "DL"),
    ("Karol Bagh",        28.6508, 77.1900, "DL"),
    ("Lajpat Nagar",      28.5665, 77.2433, "DL"),
    ("Saket",             28.5245, 77.2066, "DL"),
    ("Dwarka",            28.5921, 77.0460, "DL"),
    ("Rohini",            28.7041, 77.1025, "DL"),
    ("Janakpuri",         28.6289, 77.0836, "DL"),
    ("Pitampura",         28.7009, 77.1338, "DL"),
    ("Noida Sector 18",   28.5705, 77.3219, "UP"),
    ("Noida Sector 62",   28.6270, 77.3650, "UP"),
    ("Greater Noida",     28.4744, 77.5040, "UP"),
    ("Gurgaon Sector 29", 28.4595, 77.0266, "HR"),
    ("Gurgaon DLF",       28.4672, 77.0435, "HR"),
    ("Faridabad",         28.4089, 77.3178, "HR"),
    ("Ghaziabad",         28.6692, 77.4538, "UP"),
    ("Gurugram Cyber Hub",28.4949, 77.0887, "HR"),
    ("Vasant Kunj",       28.5244, 77.1571, "DL"),
    ("Nehru Place",       28.5491, 77.2519, "DL"),
    ("South Extension",   28.5700, 77.2200, "DL"),
    ("Noida Expressway",  28.5355, 77.3910, "UP"),
]

ALL_ZONES = MUMBAI_ZONES + DELHI_NCR_ZONES

# Real Indian vehicles sold and operated in India
TATA_ACE_VARIANTS  = ["Tata Ace Gold", "Tata Ace HT", "Tata Ace Mega", "Tata Ace Zip"]
MAHINDRA_VANS      = ["Mahindra Bolero Pikup", "Mahindra Jeeto", "Mahindra Supro", "Mahindra Bolero Maxitruck+"]
FORCE_MINI         = ["Force Traveller T1", "Ashok Leyland Dost", "Ashok Leyland Stile"]
TATA_TRUCKS        = ["Tata LPT 1412", "Tata LPT 1616", "Tata Prima 2528", "Tata Signa 1923", "Tata Ultra 1518"]
EICHER_TRUCKS      = ["Eicher Pro 2095", "Eicher Pro 3015", "Eicher Pro 6016"]
BHARAT_BENZ        = ["BharatBenz 1617", "BharatBenz 2523", "BharatBenz 4028"]
ASHOK_LEYLAND_HT   = ["Ashok Leyland U-Truck 1616", "Ashok Leyland Captain 4940", "Ashok Leyland Boss 1415"]
ELECTRIC_BIKES     = ["Euler HiLoad EV", "OSM Rage+", "Mahindra Treo Zor", "Piaggio Ape E-City", "Altigreen neEV"]
MOTORCYCLES        = ["Hero Splendor+", "Honda Activa 6G", "TVS Apache RTR 160", "Bajaj Platina 110", "Hero HF Deluxe"]
REFRIGERATED       = ["Tata Ace Zip Reefer", "Mahindra Jeeto Reefer", "Eicher Pro 2095 Reefer", "Ashok Leyland Dost Reefer"]

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
    "Urban Company", "Lenskart Fulfilment", "Myntra Logistics",
    "FirstCry Logistics", "Ninjacart Fresh", "WayCool Foods",
]

DRIVER_FIRST = [
    "Rahul","Amit","Suresh","Ravi","Vijay","Sanjay","Deepak","Manoj",
    "Arun","Rajesh","Pradeep","Sunil","Ramesh","Dinesh","Santosh",
    "Mohan","Krishna","Ganesh","Prakash","Shyam","Pawan","Ashok",
    "Vikas","Naveen","Mukesh","Sachin","Rohit","Nikhil","Ajay","Vinod",
    "Ankit","Gaurav","Harsh","Lokesh","Manish","Narendra","Omkar",
    "Pramod","Ravindra","Sandip","Tejas","Umesh","Vaibhav","Yogesh",
    "Zafar","Irfan","Salim","Devendra","Harish","Kiran",
]
DRIVER_LAST = [
    "Sharma","Verma","Singh","Kumar","Patel","Yadav","Gupta","Mishra",
    "Tiwari","Joshi","Dubey","Pandey","Shukla","Mehta","Shah","Desai",
    "Nair","Pillai","Rao","Reddy","Iyer","Menon","Bhat","Gaikwad",
    "Jadhav","Patil","Shinde","More","Bhosale","Sawant","Kadam",
    "Mane","Kamble","Pawar","Chavan","Wagh","Deshpande","Kulkarni",
    "Choudhary","Rana","Negi","Rawat","Bisht","Khan","Ansari",
]

AREAS_MH = ["Shivaji Nagar","Gandhi Nagar","Nehru Nagar","Patel Nagar","Ambedkar Nagar",
             "Tilak Nagar","Bharat Nagar","Azad Nagar","Lokmanya Nagar","Savarkar Nagar"]
AREAS_DL = ["Rajendra Nagar","Pratap Nagar","Laxmi Nagar","Vivek Vihar","Mayur Vihar",
             "Uttam Nagar","Vikaspuri","Hari Nagar","Tagore Garden","Janakpuri Extension"]
ROAD_PARTS = ["Marg","Road","Nagar","Colony","Chowk","Lane","Cross","Galli","Sector","Block","Phase","Extension"]

def rand_point(lat, lng, radius_km=1.8):
    r = radius_km * math.sqrt(random.random())
    theta = random.uniform(0, 2 * math.pi)
    dlat = r * math.cos(theta) / 111.0
    dlng = r * math.sin(theta) / (111.0 * math.cos(math.radians(lat)))
    return lat + dlat, lng + dlng

def make_geo(lat, lng):
    return {"type": "Point", "coordinates": [lng, lat]}

def make_address(zone_name, state_code, lat, lng):
    areas = AREAS_DL if state_code in ("DL","UP","HR") else AREAS_MH
    state_name = {"DL":"Delhi","UP":"Uttar Pradesh","HR":"Haryana","MH":"Maharashtra"}.get(state_code,"India")
    pincode = (random.randint(110001,110096) if state_code=="DL" else
               random.randint(201301,201310) if state_code=="UP" else
               random.randint(122001,122018) if state_code=="HR" else
               random.randint(400001,421605))
    return {
        "address": f"{random.randint(1,500)}, {random.choice(areas)} {random.choice(ROAD_PARTS)}, {zone_name}, {state_name} - {pincode}",
        "location": make_geo(lat, lng),
    }

def rand_driver_name():
    return f"{random.choice(DRIVER_FIRST)} {random.choice(DRIVER_LAST)}"

def rand_plate(state):
    dist = f"{random.randint(1,49):02d}"
    letters = ''.join(random.choices('ABCDEFGHJKLMNPRSTUVWXY', k=2))
    num = f"{random.randint(1000,9999)}"
    return f"{state}-{dist}-{letters}-{num}"


async def seed_database(db) -> bool:
    """
    Seed demo data. Returns True if the database was (re)seeded.

    Seeded data is intentionally limited to what a real deployment would already
    have on day one: users, drivers, the fleet, and 7 days of completed-order
    history. Incidents and optimization runs are NOT seeded - they are produced
    by the running system.

    A schema-version marker is stored in `meta`. When the version changes the
    operational collections are rebuilt from scratch (users are re-created).
    """
    meta = await db.meta.find_one({"_id": "schema"})
    existing = await db.vehicles.count_documents({})
    if meta and meta.get("version") == SCHEMA_VERSION and existing > 10:
        logger.info("Database already seeded", version=SCHEMA_VERSION, vehicles=existing)
        return False

    logger.info("Seeding database", version=SCHEMA_VERSION,
                previous_version=(meta or {}).get("version"))
    for col in ("vehicles", "drivers", "orders", "incidents", "optimization_runs",
                "telemetry", "routes", "alerts", "audit_logs"):
        await db[col].delete_many({})

    await _seed_users(db)
    drivers, vehicles = await _seed_fleet(db)
    await _seed_order_history(db, vehicles)
    await db.meta.replace_one(
        {"_id": "schema"},
        {"_id": "schema", "version": SCHEMA_VERSION, "seeded_at": datetime.utcnow()},
        upsert=True,
    )
    logger.info("Seeding complete", vehicles=len(vehicles), drivers=len(drivers))
    return True


async def _seed_users(db):
    await db.users.delete_many({})
    now = datetime.utcnow()
    users = [
        {"user_id": "usr-admin-001", "username": "admin", "email": "admin@fleetops.in",
         "full_name": "Sarvesh Bhardwaj", "role": "admin",
         "hashed_password": _hash("Admin123!"), "is_active": True, "created_at": now, "updated_at": now},
        {"user_id": "usr-ops-001", "username": "ops_manager", "email": "ops@fleetops.in",
         "full_name": "Pushpansh Pandey", "role": "operations_manager",
         "hashed_password": _hash("Ops123!"), "is_active": True, "created_at": now, "updated_at": now},
        {"user_id": "usr-disp-001", "username": "dispatcher", "email": "dispatch@fleetops.in",
         "full_name": "Namit Joshi", "role": "dispatcher",
         "hashed_password": _hash("Dispatch123!"), "is_active": True, "created_at": now, "updated_at": now},
        {"user_id": "usr-view-001", "username": "viewer", "email": "viewer@fleetops.in",
         "full_name": "Read-only Viewer", "role": "viewer",
         "hashed_password": _hash("Viewer123!"), "is_active": True, "created_at": now, "updated_at": now},
    ]
    await db.users.insert_many(users)
    logger.info("Users seeded", count=len(users))


# (id prefix, model pool, type, fuel options, capacity kg, count, zones)
FLEET_CONFIG = [
    ("mum-ace", TATA_ACE_VARIANTS,          "van",          ["diesel", "cng"],     800,  14, MUMBAI_ZONES),
    ("mum-mah", MAHINDRA_VANS,              "van",          ["diesel", "cng"],     1200,  8, MUMBAI_ZONES),
    ("mum-trk", TATA_TRUCKS,                "truck",        ["diesel"],            5000,  6, MUMBAI_ZONES),
    ("mum-eic", EICHER_TRUCKS,              "truck",        ["diesel"],            8000,  3, MUMBAI_ZONES),
    ("mum-ev",  ELECTRIC_BIKES,             "cargo_bike",   ["electric"],          120,   6, MUMBAI_ZONES),
    ("mum-mto", MOTORCYCLES,                "motorcycle",   ["petrol"],            20,    4, MUMBAI_ZONES),
    ("mum-ref", REFRIGERATED,               "refrigerated", ["diesel"],            2000,  3, MUMBAI_ZONES),
    ("del-ace", TATA_ACE_VARIANTS,          "van",          ["diesel", "cng"],     800,  10, DELHI_NCR_ZONES),
    ("del-mah", MAHINDRA_VANS + FORCE_MINI, "van",          ["diesel", "cng"],     1200,  6, DELHI_NCR_ZONES),
    ("del-trk", TATA_TRUCKS + BHARAT_BENZ,  "truck",        ["diesel"],            6000,  5, DELHI_NCR_ZONES),
    ("del-ash", ASHOK_LEYLAND_HT,           "truck",        ["diesel"],            9000,  3, DELHI_NCR_ZONES),
    ("del-ev",  ELECTRIC_BIKES,             "cargo_bike",   ["electric"],          120,   4, DELHI_NCR_ZONES),
    ("del-mto", MOTORCYCLES,                "motorcycle",   ["petrol", "electric"], 20,   4, DELHI_NCR_ZONES),
    ("del-ref", REFRIGERATED,               "refrigerated", ["diesel"],            2500,  2, DELHI_NCR_ZONES),
]


async def _seed_fleet(db):
    """Create vehicles and one driver per vehicle, linked both ways."""
    now = datetime.utcnow()
    vehicles, drivers = [], []

    for pfx, model_pool, vtype, fuels, max_cap, count, zone_pool in FLEET_CONFIG:
        for i in range(count):
            z_name, z_lat, z_lng, z_state = random.choice(zone_pool)
            lat, lng = rand_point(z_lat, z_lng)
            region = region_for_lng(lng)
            city = random.choice(["Delhi", "Noida", "Gurgaon", "Faridabad"] if region == DELHI
                                 else ["Mumbai", "Thane", "Navi Mumbai", "Kalyan"])
            fuel_type = random.choice(fuels)
            fuel = round(random.uniform(35, 100), 1)
            vehicle_id = f"veh-{pfx}-{i:02d}"
            driver_id = f"drv-{uuid.uuid4().hex[:8]}"
            name = rand_driver_name()
            state = z_state if z_state in ("MH", "DL", "UP", "HR") else "MH"

            drivers.append({
                "driver_id": driver_id,
                "full_name": name,
                "license_number": rand_plate(state).replace("-", ""),
                "phone": f"+91 {random.randint(7000000000, 9999999999)}",
                "email": f"{name.lower().replace(' ', '.')}{random.randint(1, 99)}@example.in",
                "vehicle_id": vehicle_id,
                "status": "on_duty",
                "shift_start": now - timedelta(hours=random.randint(1, 6)),
                "total_deliveries_today": 0,
                "rating": round(random.uniform(3.6, 5.0), 1),
                "city": city,
                "created_at": now, "updated_at": now,
            })
            # ~5% of the fleet starts in the workshop
            status = "maintenance" if random.random() < 0.05 else "available"
            vehicles.append({
                "vehicle_id": vehicle_id,
                "name": model_pool[i % len(model_pool)] if len(model_pool) > 1 else model_pool[0],
                "registration": rand_plate(state),
                "city": city,
                "region": region,
                "type": vtype,
                "fuel_type": fuel_type,
                "status": status,
                "driver_id": driver_id,
                "location": make_geo(lat, lng),
                "heading": round(random.uniform(0, 360), 1),
                "speed": 0.0,
                "max_capacity_kg": max_cap,
                "current_load_kg": 0.0,
                "fuel_level": fuel,
                "fuel_range_km": round(fuel * (4.2 if vtype in ("van", "truck", "refrigerated") else 2.0), 1),
                "current_order_id": None,
                "current_route_id": None,
                "health": {
                    "engine_temp": round(random.uniform(80, 98), 1),
                    "tire_pressure": round(random.uniform(88, 100), 1),
                    "brake_health": round(random.uniform(70, 100), 1),
                    "transmission_health": round(random.uniform(75, 100), 1),
                    "overall_score": round(random.uniform(65, 100), 1),
                },
                "odometer_km": round(random.uniform(2000, 180000), 0),
                "current_eta_minutes": None,
                "created_at": now, "updated_at": now,
            })

    await db.drivers.insert_many(drivers)
    await db.vehicles.insert_many(vehicles)
    logger.info("Fleet seeded", vehicles=len(vehicles),
                mumbai=sum(1 for v in vehicles if v["region"] == MUMBAI),
                delhi=sum(1 for v in vehicles if v["region"] == DELHI))
    return drivers, vehicles


def _history_created_at(now_utc: datetime) -> datetime:
    """A creation time within the last 7 India days, weighted to business hours."""
    now_ist = now_utc.replace(tzinfo=timezone.utc).astimezone(IST)
    hours = list(range(7, 22))
    weights = [2, 4, 7, 8, 7, 5, 5, 6, 7, 7, 6, 5, 3, 2, 1]
    for _ in range(20):
        day_offset = random.randint(0, 6)
        hour = random.choices(hours, weights)[0]
        created_ist = (now_ist - timedelta(days=day_offset)).replace(
            hour=hour, minute=random.randint(0, 59), second=random.randint(0, 59), microsecond=0)
        # must be old enough to have completed
        if created_ist <= now_ist - timedelta(hours=3):
            return created_ist.astimezone(timezone.utc).replace(tzinfo=None)
    return now_utc - timedelta(days=random.randint(1, 6), hours=random.randint(0, 5))


async def _seed_order_history(db, vehicles):
    """~7 days of completed orders with realistic punctuality (~90% on time, ~3% failed)."""
    now = datetime.utcnow()
    orders = []
    by_region = {MUMBAI: [v for v in vehicles if v["region"] == MUMBAI],
                 DELHI: [v for v in vehicles if v["region"] == DELHI]}

    for i in range(320):
        use_delhi = random.random() < 0.4
        region = DELHI if use_delhi else MUMBAI
        zones = DELHI_NCR_ZONES if use_delhi else MUMBAI_ZONES
        pz, dz = random.choice(zones), random.choice(zones)
        plat, plng = rand_point(pz[1], pz[2])
        dlat, dlng = rand_point(dz[1], dz[2])
        weight = random_cargo_weight()
        requires_ref = random.random() < 0.05

        eligible = [v for v in by_region[region]
                    if v["max_capacity_kg"] >= weight
                    and (v["type"] == "refrigerated") == requires_ref]
        if not eligible:
            requires_ref = False
            eligible = [v for v in by_region[region] if v["max_capacity_kg"] >= weight and v["type"] != "refrigerated"]
        if not eligible:
            continue
        vehicle = random.choice(eligible)

        created = _history_created_at(now)
        pickup_leg = random.uniform(1.0, 6.0)
        trip_km = max(1.5, haversine_km(plat, plng, dlat, dlng))
        distance = pickup_leg + trip_km
        speed = random.uniform(13, 24) if region == MUMBAI else random.uniform(18, 30)
        predicted = distance / speed * 60 + 18          # + loading/unloading handling
        actual = predicted * random.lognormvariate(0, 0.16)
        if random.random() < 0.10:                      # incidental delay: traffic, waiting at gate...
            actual += random.uniform(35, 110)
        assigned_at = created + timedelta(minutes=random.uniform(1, 12))
        delivered_at = assigned_at + timedelta(minutes=actual)
        deadline = created + timedelta(minutes=max(120.0, predicted * random.uniform(1.4, 2.6)))
        failed = random.random() < 0.03
        prefix = "DEL" if use_delhi else "MUM"
        priority = random.choices(["low", "normal", "high", "critical"], weights=[12, 52, 28, 8])[0]

        doc = {
            "order_id": f"ord-hist-{i:04d}",
            "reference": f"{prefix}-{created.strftime('%y%m%d')}-{1000 + i}",
            "region": region,
            "status": "failed" if failed else "delivered",
            "priority": priority,
            "customer_name": random.choice(INDIAN_COMPANIES),
            "pickup": make_address(pz[0], pz[3], plat, plng),
            "delivery": make_address(dz[0], dz[3], dlat, dlng),
            "weight_kg": weight,
            "requires_refrigeration": requires_ref,
            "fragile": False,
            "description": "",
            "assigned_vehicle_id": vehicle["vehicle_id"],
            "assigned_at": assigned_at,
            "deadline": deadline,
            "estimated_distance_km": round(distance, 1),
            "predicted_eta_minutes": round(predicted, 1),
            "sla_at_risk": False,
            "reassignment_count": 0,
            "cost_inr": round(distance * random.uniform(18, 30), 0),
            "created_at": created,
            "updated_at": delivered_at,
        }
        if not failed:
            doc.update({
                "picked_up_at": assigned_at + timedelta(minutes=actual * 0.35),
                "delivered_at": delivered_at,
                "actual_distance_km": round(distance * random.uniform(1.0, 1.1), 1),
                "actual_duration_min": round(actual, 1),
            })
        orders.append(doc)

    await db.orders.insert_many(orders)
    logger.info("Order history seeded", count=len(orders))
