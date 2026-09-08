"""
Database seeder — India fleet (Mumbai MMR + Delhi NCR dual-region operation).
Uses bcrypt directly to avoid passlib version issues.
"""
import random
import uuid
import math
import bcrypt
from datetime import datetime, timedelta
from typing import List
import structlog

logger = structlog.get_logger(__name__)

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


async def seed_database(db):
    existing = await db.vehicles.count_documents({})
    if existing > 10:
        logger.info("Already seeded", vehicles=existing)
        return None, None
    logger.info("Seeding India fleet — Mumbai MMR + Delhi NCR")
    await _seed_users(db)
    drivers = await _seed_drivers(db)
    vehicles = await _seed_vehicles(db, drivers)
    orders = await _seed_orders(db, vehicles)
    await _seed_incidents(db, vehicles, orders)
    await _seed_optimization_runs(db)
    logger.info("Seeding complete", total_vehicles=len(vehicles))
    return vehicles, orders


async def _seed_users(db):
    await db.users.delete_many({})
    now = datetime.utcnow()
    users = [
        {"user_id":"usr-admin-001","username":"admin","email":"admin@fleetops.in",
         "full_name":"Arjun Mehta","role":"admin",
         "hashed_password":_hash("Admin123!"),"is_active":True,"created_at":now,"updated_at":now},
        {"user_id":"usr-ops-001","username":"ops_manager","email":"ops@fleetops.in",
         "full_name":"Priya Sharma","role":"operations_manager",
         "hashed_password":_hash("Ops123!"),"is_active":True,"created_at":now,"updated_at":now},
        {"user_id":"usr-disp-001","username":"dispatcher","email":"dispatch@fleetops.in",
         "full_name":"Rahul Verma","role":"dispatcher",
         "hashed_password":_hash("Dispatch123!"),"is_active":True,"created_at":now,"updated_at":now},
        {"user_id":"usr-view-001","username":"viewer","email":"viewer@fleetops.in",
         "full_name":"Read-only Viewer","role":"viewer",
         "hashed_password":_hash("Viewer123!"),"is_active":True,"created_at":now,"updated_at":now},
    ]
    await db.users.insert_many(users)
    logger.info("Users seeded", count=len(users))


async def _seed_drivers(db):
    await db.drivers.delete_many({})
    now = datetime.utcnow()
    drivers = []
    for i in range(60):
        name = rand_driver_name()
        state = random.choice(["MH","DL","UP","HR","KA","TN","GJ","RJ","MP","BR"])
        drivers.append({
            "driver_id": f"drv-{uuid.uuid4().hex[:8]}",
            "full_name": name,
            "license_number": rand_plate(state).replace("-",""),
            "phone": f"+91 {random.randint(7000000000,9999999999)}",
            "email": f"{name.lower().replace(' ','.')}{random.randint(1,99)}@gmail.com",
            "vehicle_id": None,
            "status": random.choices(["available","on_duty","break","off_duty"], weights=[22,58,10,10])[0],
            "shift_start": (now - timedelta(hours=random.randint(1,8))).isoformat(),
            "total_deliveries_today": random.randint(0, 18),
            "rating": round(random.uniform(3.6, 5.0), 1),
            "city": random.choice(["Mumbai","Delhi","Thane","Navi Mumbai","Noida","Gurgaon","Faridabad","Ghaziabad"]),
            "created_at": now, "updated_at": now,
        })
    await db.drivers.insert_many(drivers)
    logger.info("Drivers seeded", count=len(drivers))
    return drivers


async def _seed_vehicles(db, drivers):
    await db.vehicles.delete_many({})
    now = datetime.utcnow()
    vehicles = []
    drv_idx = 0

    fleet_config = [
        # Mumbai fleet
        ("mum-ace", TATA_ACE_VARIANTS,           "van",          ["diesel","cng"],  800,  14, MUMBAI_ZONES, [20,42,8,10,15,5]),
        ("mum-mah", MAHINDRA_VANS,               "van",          ["diesel","cng"],  1200,  8, MUMBAI_ZONES, [18,45,8, 8,16,5]),
        ("mum-trk", TATA_TRUCKS,                 "truck",        ["diesel"],        5000,  6, MUMBAI_ZONES, [12,52,8, 8,15,5]),
        ("mum-eic", EICHER_TRUCKS,               "truck",        ["diesel"],        8000,  3, MUMBAI_ZONES, [10,55,8, 8,14,5]),
        ("mum-ev",  ELECTRIC_BIKES,              "cargo_bike",   ["electric"],      120,   6, MUMBAI_ZONES, [28,42,8, 8,12,2]),
        ("mum-mto", MOTORCYCLES,                 "motorcycle",   ["petrol"],         20,   4, MUMBAI_ZONES, [30,48,5, 5,10,2]),
        ("mum-ref", REFRIGERATED,                "refrigerated", ["diesel"],        2000,  3, MUMBAI_ZONES, [10,55,8, 8,14,5]),
        # Delhi NCR fleet
        ("del-ace", TATA_ACE_VARIANTS,           "van",          ["diesel","cng"],  800,  10, DELHI_NCR_ZONES, [20,42,8,10,15,5]),
        ("del-mah", MAHINDRA_VANS + FORCE_MINI,  "van",          ["diesel","cng"],  1200,  6, DELHI_NCR_ZONES, [18,45,8, 8,16,5]),
        ("del-trk", TATA_TRUCKS + BHARAT_BENZ,   "truck",        ["diesel"],        6000,  5, DELHI_NCR_ZONES, [12,52,8, 8,15,5]),
        ("del-ash", ASHOK_LEYLAND_HT,            "truck",        ["diesel"],        9000,  3, DELHI_NCR_ZONES, [10,55,8, 8,14,5]),
        ("del-ev",  ELECTRIC_BIKES,              "cargo_bike",   ["electric"],      120,   4, DELHI_NCR_ZONES, [28,42,8, 8,12,2]),
        ("del-mto", MOTORCYCLES,                 "motorcycle",   ["petrol","electric"], 15, 4, DELHI_NCR_ZONES, [30,48,5, 5,10,2]),
        ("del-ref", REFRIGERATED,                "refrigerated", ["diesel"],        2500,  2, DELHI_NCR_ZONES, [10,55,8, 8,14,5]),
    ]

    for pfx, model_pool, vtype, fuels, max_cap, count, zone_pool, sw in fleet_config:
        for i in range(count):
            zone = random.choice(zone_pool)
            z_name, z_lat, z_lng, z_state = zone
            lat, lng = rand_point(z_lat, z_lng)
            model = random.choice(model_pool)
            plate = rand_plate(z_state)
            is_delhi = z_state in ("DL","UP","HR")
            region = "Delhi NCR" if is_delhi else "Mumbai MMR"
            city = random.choice(["Delhi","Noida","Gurgaon","Faridabad"] if is_delhi else ["Mumbai","Thane","Navi Mumbai","Kalyan"])

            status = random.choices(
                ["available","en_route","loading","unloading","idle","maintenance"],
                weights=sw
            )[0]
            drv = drivers[drv_idx % len(drivers)] if drv_idx < len(drivers) else None
            drv_idx += 1
            fuel = round(random.uniform(18, 100), 1)
            load = round(random.uniform(0, max_cap * 0.75), 1) if status in ("en_route","loading","unloading") else 0.0

            vehicles.append({
                "vehicle_id": f"veh-{pfx}-{i:02d}",
                "name": model,
                "registration": plate,
                "city": city,
                "region": region,
                "type": vtype,
                "fuel_type": random.choice(fuels),
                "status": status,
                "driver_id": drv["driver_id"] if drv else None,
                "location": make_geo(lat, lng),
                "heading": round(random.uniform(0, 360), 1),
                "speed": round(random.uniform(14, 42), 1) if status == "en_route" else 0.0,
                "max_capacity_kg": max_cap,
                "current_load_kg": load,
                "fuel_level": fuel,
                "fuel_range_km": round(fuel * (4.2 if vtype in ("van","truck","refrigerated") else 2.0), 1),
                "current_order_id": None,
                "current_route_id": None,
                "health": {
                    "engine_temp": round(random.uniform(80, 104), 1),
                    "tire_pressure": round(random.uniform(85, 100), 1),
                    "brake_health": round(random.uniform(65, 100), 1),
                    "transmission_health": round(random.uniform(70, 100), 1),
                    "overall_score": round(random.uniform(60, 100), 1),
                },
                "odometer_km": round(random.uniform(2000, 220000), 0),
                "current_eta_minutes": None,
                "created_at": now, "updated_at": now,
            })

    await db.vehicles.insert_many(vehicles)
    mum_c = sum(1 for v in vehicles if v["region"]=="Mumbai MMR")
    del_c = sum(1 for v in vehicles if v["region"]=="Delhi NCR")
    logger.info("Vehicles seeded", total=len(vehicles), mumbai=mum_c, delhi=del_c)
    return vehicles


async def _seed_orders(db, vehicles):
    await db.orders.delete_many({})
    now = datetime.utcnow()
    orders = []
    active_vehicles = [v for v in vehicles if v["status"] == "en_route"]

    def pick_zone_for(vehicle):
        return DELHI_NCR_ZONES if vehicle.get("region") == "Delhi NCR" else MUMBAI_ZONES

    # Historical (7 days)
    for i in range(300):
        hours_ago = random.uniform(0.5, 168)
        use_delhi = random.random() < 0.4
        zones = DELHI_NCR_ZONES if use_delhi else MUMBAI_ZONES
        pz, dz = random.choice(zones), random.choice(zones)
        plat, plng = rand_point(pz[1], pz[2])
        dlat, dlng = rand_point(dz[1], dz[2])
        created = now - timedelta(hours=hours_ago)
        delivered = created + timedelta(hours=random.uniform(0.4, 5))
        dist = round(random.uniform(3, 32), 1)
        prefix = "DEL" if use_delhi else "MUM"
        orders.append({
            "order_id": f"ord-hist-{i:04d}",
            "reference": f"{prefix}-{created.strftime('%y%m%d')}-{1000+i}",
            "region": "Delhi NCR" if use_delhi else "Mumbai MMR",
            "status": "delivered",
            "priority": random.choices(["low","normal","high","critical"], weights=[12,52,28,8])[0],
            "customer_name": random.choice(INDIAN_COMPANIES),
            "pickup": make_address(pz[0], pz[3], plat, plng),
            "delivery": make_address(dz[0], dz[3], dlat, dlng),
            "weight_kg": round(random.uniform(5, 1500), 1),
            "assigned_vehicle_id": random.choice(vehicles)["vehicle_id"],
            "deadline": (created + timedelta(hours=random.randint(2,8))).isoformat(),
            "picked_up_at": (created + timedelta(minutes=random.randint(20,60))).isoformat(),
            "delivered_at": delivered.isoformat(),
            "estimated_distance_km": dist,
            "actual_distance_km": round(dist * random.uniform(1.0, 1.12), 1),
            "cost_inr": round(dist * random.uniform(18, 30), 0),
            "sla_at_risk": False,
            "created_at": created.isoformat(), "updated_at": delivered.isoformat(),
        })

    # Active
    for i, v in enumerate(active_vehicles[:min(len(active_vehicles), 28)]):
        zones = pick_zone_for(v)
        pz, dz = random.choice(zones), random.choice(zones)
        plat, plng = rand_point(pz[1], pz[2])
        dlat, dlng = rand_point(dz[1], dz[2])
        created = now - timedelta(minutes=random.randint(5, 120))
        status = random.choice(["assigned","pickup_en_route","picked_up","delivery_en_route"])
        eta = round(random.uniform(10, 95), 1)
        dist = round(random.uniform(4, 28), 1)
        prefix = "DEL" if v.get("region") == "Delhi NCR" else "MUM"
        orders.append({
            "order_id": f"ord-active-{i:03d}",
            "reference": f"{prefix}-{now.strftime('%y%m%d')}-{2000+i}",
            "region": v.get("region","Mumbai MMR"),
            "status": status,
            "priority": random.choices(["normal","high","critical"], weights=[50,38,12])[0],
            "customer_name": random.choice(INDIAN_COMPANIES),
            "pickup": make_address(pz[0], pz[3], plat, plng),
            "delivery": make_address(dz[0], dz[3], dlat, dlng),
            "weight_kg": round(random.uniform(10, 1000), 1),
            "assigned_vehicle_id": v["vehicle_id"],
            "assigned_at": created.isoformat(),
            "deadline": (now + timedelta(hours=random.randint(1,5))).isoformat(),
            "estimated_delivery_at": (now + timedelta(minutes=eta)).isoformat(),
            "eta_minutes": eta,
            "sla_at_risk": random.random() < 0.18,
            "estimated_distance_km": dist,
            "cost_inr": round(dist * random.uniform(18, 30), 0),
            "created_at": created.isoformat(), "updated_at": now.isoformat(),
        })

    # Pending
    for i in range(22):
        use_delhi = random.random() < 0.4
        zones = DELHI_NCR_ZONES if use_delhi else MUMBAI_ZONES
        pz, dz = random.choice(zones), random.choice(zones)
        plat, plng = rand_point(pz[1], pz[2])
        dlat, dlng = rand_point(dz[1], dz[2])
        dist = round(random.uniform(4, 30), 1)
        prefix = "DEL" if use_delhi else "MUM"
        orders.append({
            "order_id": f"ord-pending-{i:03d}",
            "reference": f"{prefix}-{now.strftime('%y%m%d')}-{3000+i}",
            "region": "Delhi NCR" if use_delhi else "Mumbai MMR",
            "status": "pending",
            "priority": random.choices(["low","normal","high","critical"], weights=[12,45,35,8])[0],
            "customer_name": random.choice(INDIAN_COMPANIES),
            "pickup": make_address(pz[0], pz[3], plat, plng),
            "delivery": make_address(dz[0], dz[3], dlat, dlng),
            "weight_kg": round(random.uniform(5, 1200), 1),
            "deadline": (now + timedelta(hours=random.randint(2,10))).isoformat(),
            "estimated_distance_km": dist,
            "cost_inr": round(dist * random.uniform(18, 30), 0),
            "sla_at_risk": False,
            "created_at": (now - timedelta(minutes=random.randint(1,45))).isoformat(),
            "updated_at": now.isoformat(),
        })

    await db.orders.insert_many(orders)
    logger.info("Orders seeded", count=len(orders))
    return orders


async def _seed_incidents(db, vehicles, orders):
    await db.incidents.delete_many({})
    now = datetime.utcnow()
    incidents = []
    active_orders = [o for o in orders if o.get("status") in ("assigned","delivery_en_route","picked_up")]

    MUM_ROADS = ["Western Express Highway","Eastern Freeway","NH-48","Sion-Panvel Highway","Thane-Belapur Road","JVLR"]
    DEL_ROADS = ["NH-48 Gurgaon","Delhi-Noida Direct Flyway","Outer Ring Road","NH-9 Ghaziabad","Mehrauli-Badarpur Road","Ring Road"]
    MUM_AREAS = ["Kurla Junction","Andheri flyover","Thane creek bridge","Vashi bridge","Ghatkopar flyover"]
    DEL_AREAS = ["Karol Bagh chowk","DND Flyway entry","Dhaula Kuan","Saket Metro","Mehrauli crossing"]

    templates = [
        ("vehicle_breakdown","high","Breakdown: {v} on {road}",
         "{v} ({plate}) engine failure near {area}. Temp: {temp}°C. Roadside assistance dispatched. Delivery reassigned.","action_taken"),
        ("low_fuel","medium","Low CNG: {v}",
         "{v} CNG level at 7.4%. Nearest IOCL CNG station at {area} assigned. ETA 3 min.","resolved"),
        ("delivery_sla_risk","high","SLA Risk: {o} — {delta} min delay",
         "Order {o} at risk due to congestion on {road}. Alternate route via {area} being evaluated.","monitoring"),
        ("traffic_spike","medium","Congestion — {road}",
         "Heavy jam on {road}. {count} vehicles affected. {rerouted} rerouted. Avg delay: {delta} min.","action_taken"),
        ("route_deviation","low","Route Deviation: {v}",
         "{v} deviated at {area}. Driver confirmed road closure due to civic works. Alternate accepted.","resolved"),
        ("prolonged_stop","medium","Extended Stop: {v} — {delta} min",
         "{v} stationary for {delta} min at {area}. Awaiting consignee signature.","monitoring"),
        ("vehicle_breakdown","critical","Tyre Burst: {v} — {road}",
         "{v} tyre burst on {road}. Vehicle secured. {count} deliveries reassigned.","action_taken"),
        ("traffic_spike","high","Waterlogging: {area}",
         "Waterlogging at {area}. 4 vehicles rerouted. Est delay 25-40 min.","action_taken"),
    ]

    for i, (itype, sev, title_t, desc_t, istatus) in enumerate(templates * 2):
        v = random.choice(vehicles)
        v2 = random.choice(vehicles)
        o = random.choice(active_orders) if active_orders else {"reference":"N/A","order_id":"none"}
        is_del = v.get("region","") == "Delhi NCR"
        road = random.choice(DEL_ROADS if is_del else MUM_ROADS)
        area = random.choice(DEL_AREAS if is_del else MUM_AREAS)
        delta = str(random.randint(8, 40))
        count = str(random.randint(3, 9))
        rerouted = str(random.randint(2, 5))
        plate = v.get("registration","MH-12-AB-1234")
        temp = str(random.randint(145, 168))
        created = now - timedelta(hours=random.uniform(0.1, 20))

        fmt = lambda t: (t.replace("{v}", v["name"]).replace("{v2}", v2["name"])
                          .replace("{o}", o.get("reference","")).replace("{road}", road)
                          .replace("{area}", area).replace("{delta}", delta)
                          .replace("{count}", count).replace("{rerouted}", rerouted)
                          .replace("{plate}", plate).replace("{temp}", temp))

        timeline = [
            {"timestamp": created.isoformat(), "event": "Incident detected by telemetry", "actor": "system"},
            {"timestamp": (created + timedelta(minutes=1, seconds=30)).isoformat(), "event": "Operations team alerted", "actor": "system"},
            {"timestamp": (created + timedelta(minutes=3)).isoformat(), "event": "Severity assessed", "actor": "system"},
        ]
        if istatus in ("action_taken","monitoring","resolved"):
            timeline.append({"timestamp": (created + timedelta(minutes=4)).isoformat(),
                             "event": "Autonomous action by optimization engine", "actor": "system"})
        if istatus == "resolved":
            timeline.append({"timestamp": (created + timedelta(minutes=random.randint(20,90))).isoformat(),
                             "event": "Incident resolved — normal operations resumed", "actor": "system"})

        incidents.append({
            "incident_id": f"INC-{uuid.uuid4().hex[:8].upper()}",
            "type": itype, "severity": sev, "status": istatus,
            "title": fmt(title_t), "description": fmt(desc_t),
            "vehicle_id": v["vehicle_id"], "vehicle_name": v["name"],
            "vehicle_registration": plate,
            "region": v.get("region","Mumbai MMR"),
            "order_ids": [o.get("order_id","")],
            "autonomous_actions": [{
                "action_type": "reroute_vehicle",
                "description": f"{v['name']} rerouted via alternate corridor",
                "vehicle_id": v["vehicle_id"],
                "reason": "Primary route congestion exceeded 1.8× threshold",
                "expected_impact": f"ETA reduction of {random.randint(8,22)} minutes",
                "executed_at": (created + timedelta(minutes=4)).isoformat(),
                "outcome": f"ETA reduced by {random.randint(6,20)} minutes" if istatus == "resolved" else None,
            }] if itype in ("traffic_spike","route_deviation","vehicle_breakdown") else [],
            "timeline": timeline,
            "created_at": created.isoformat(),
            "updated_at": (created + timedelta(minutes=random.randint(5,60))).isoformat(),
            "resolved_at": (created + timedelta(hours=random.uniform(0.3,2.5))).isoformat() if istatus == "resolved" else None,
        })

    await db.incidents.insert_many(incidents)
    logger.info("Incidents seeded", count=len(incidents))


async def _seed_optimization_runs(db):
    await db.optimization_runs.delete_many({})
    now = datetime.utcnow()
    runs = []
    for i in range(30):
        created = now - timedelta(hours=random.uniform(0.1, 96))
        before = random.uniform(280, 650)
        pct = random.uniform(0.04, 0.19)
        after = before * (1 - pct)
        speed = random.choice([26, 30, 34])
        before_dur = (before / speed) * 60
        after_dur = before_dur * (1 - pct * 0.8)
        region = random.choice(["Mumbai MMR", "Delhi NCR", "Both Regions"])
        runs.append({
            "run_id": f"OPT-{uuid.uuid4().hex[:8].upper()}",
            "trigger": random.choice(["scheduled","new_order","vehicle_breakdown","traffic_change","manual"]),
            "region": region,
            "status": "completed",
            "vehicles_considered": random.randint(8, 40),
            "orders_in_scope": random.randint(3, 22),
            "before_total_distance_km": round(before, 1),
            "after_total_distance_km": round(after, 1),
            "before_total_duration_min": round(before_dur, 1),
            "after_total_duration_min": round(after_dur, 1),
            "distance_saved_km": round(before - after, 1),
            "time_saved_min": round(before_dur - after_dur, 1),
            "improvement_pct": round(pct * 100, 1),
            "cost_saved_inr": round((before - after) * random.uniform(18, 28), 0),
            "assignments_changed": random.randint(1, 8),
            "routes_updated": random.randint(1, 12),
            "summary": f"Fleet distance reduced by {round(pct*100,1)}% across {region}. {random.randint(1,8)} reassignment(s) applied.",
            "solver_duration_ms": round(random.uniform(85, 580), 1),
            "created_at": created.isoformat(),
            "completed_at": (created + timedelta(milliseconds=random.randint(100,600))).isoformat(),
        })
    await db.optimization_runs.insert_many(runs)
    logger.info("Optimization runs seeded", count=len(runs))
