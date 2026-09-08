from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import structlog

from app.core.auth import get_current_user, require_ops_or_above
from app.db.database import get_db
from app.simulation.engine import simulation_engine

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/vehicles", tags=["vehicles"])


class VehicleListItem(BaseModel):
    vehicle_id: str
    name: str
    type: str
    fuel_type: str
    status: str
    driver_id: Optional[str]
    lat: float
    lng: float
    speed: float
    heading: float
    fuel_level: float
    current_load_kg: float
    max_capacity_kg: float
    current_order_id: Optional[str]
    eta_minutes: Optional[float]
    health_score: float
    odometer_km: float
    updated_at: str


def _vehicle_doc_to_item(v: dict) -> dict:
    coords = v.get("location", {}).get("coordinates", [0, 0])
    health = v.get("health", {})
    lng = coords[0]
    return {
        "vehicle_id": v["vehicle_id"],
        "name": v["name"],
        "type": v["type"],
        "fuel_type": v["fuel_type"],
        "status": v["status"],
        "driver_id": v.get("driver_id"),
        "lat": coords[1],
        "lng": lng,
        "speed": v.get("speed", 0),
        "heading": v.get("heading", 0),
        "fuel_level": v.get("fuel_level", 0),
        "current_load_kg": v.get("current_load_kg", 0),
        "max_capacity_kg": v.get("max_capacity_kg", 0),
        "current_order_id": v.get("current_order_id"),
        "eta_minutes": v.get("current_eta_minutes"),
        "health_score": health.get("overall_score", 100),
        "odometer_km": v.get("odometer_km", 0),
        "updated_at": str(v.get("updated_at", "")),
        "region": v.get("region", "Delhi NCR" if lng > 76.5 else "Mumbai MMR"),
    }


@router.get("")
async def list_vehicles(
    status: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """List all vehicles with optional filtering. Live state comes from simulation."""
    # Normalise filter params — treat "all", "undefined", or empty string as no filter
    if status in (None, "", "all", "undefined"):
        status = None
    if type in (None, "", "all", "undefined"):
        type = None

    # Prefer live simulation state; fall back to DB if simulation hasn't loaded yet
    sim_vehicles = simulation_engine.get_all_vehicles()

    items = []

    if sim_vehicles:
        for v in sim_vehicles:
            item = {
                "vehicle_id": v.vehicle_id,
                "name": v.name,
                "type": v.type.value,
                "fuel_type": v.fuel_type.value,
                "status": v.status.value,
                "driver_id": v.driver_id,
                "lat": v.location.coordinates[1],
                "lng": v.location.coordinates[0],
                "speed": round(v.speed, 1),
                "heading": round(v.heading, 1),
                "fuel_level": round(v.fuel_level, 1),
                "current_load_kg": round(v.current_load_kg, 1),
                "max_capacity_kg": v.max_capacity_kg,
                "current_order_id": v.current_order_id,
                "eta_minutes": round(v.current_eta_minutes, 1) if v.current_eta_minutes else None,
                "health_score": round(v.health.overall_score, 1),
                "odometer_km": round(v.odometer_km, 0),
                "updated_at": v.updated_at.isoformat(),
                "region": "Delhi NCR" if v.location.coordinates[0] > 76.5 else "Mumbai MMR",
            }
            if status and item["status"] != status:
                continue
            if type and item["type"] != type:
                continue
            items.append(item)
    else:
        # Simulation not yet loaded — fall back to MongoDB
        logger.warning("Simulation engine has no vehicles, falling back to DB")
        query: dict = {}
        if status:
            query["status"] = status
        if type:
            query["type"] = type
        cursor = db.vehicles.find(query, {"_id": 0}).skip((page - 1) * page_size).limit(page_size)
        docs = await cursor.to_list(length=page_size)
        total_db = await db.vehicles.count_documents(query)
        for doc in docs:
            items.append(_vehicle_doc_to_item(doc))
        return {
            "items": items,
            "total": total_db,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total_db + page_size - 1) // page_size),
        }

    total = len(items)
    start = (page - 1) * page_size
    paginated = items[start:start + page_size]

    return {
        "items": paginated,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/stats")
async def fleet_stats(
    current_user: dict = Depends(get_current_user),
):
    """Fleet-level KPIs used by the dashboard."""
    vehicles = simulation_engine.get_all_vehicles()
    if not vehicles:
        return {"total": 0}

    total = len(vehicles)
    by_status = {}
    total_fuel = 0.0
    total_load = 0.0
    total_capacity = 0.0
    en_route = 0

    for v in vehicles:
        s = v.status.value
        by_status[s] = by_status.get(s, 0) + 1
        total_fuel += v.fuel_level
        total_load += v.current_load_kg
        total_capacity += v.max_capacity_kg
        if s == "en_route":
            en_route += 1

    utilization = (total_load / total_capacity * 100) if total_capacity > 0 else 0

    return {
        "total": total,
        "by_status": by_status,
        "en_route": en_route,
        "available": by_status.get("available", 0),
        "avg_fuel_pct": round(total_fuel / total, 1),
        "fleet_utilization_pct": round(utilization, 1),
        "active": en_route + by_status.get("loading", 0) + by_status.get("unloading", 0),
    }


@router.get("/{vehicle_id}")
async def get_vehicle(
    vehicle_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Get full vehicle detail including recent telemetry."""
    v = simulation_engine.get_vehicle(vehicle_id)
    if not v:
        # Fall back to DB
        doc = await db.vehicles.find_one({"vehicle_id": vehicle_id})
        if not doc:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        v_data = _vehicle_doc_to_item(doc)
    else:
        v_data = {
            "vehicle_id": v.vehicle_id,
            "name": v.name,
            "type": v.type.value,
            "fuel_type": v.fuel_type.value,
            "status": v.status.value,
            "driver_id": v.driver_id,
            "lat": v.location.coordinates[1],
            "lng": v.location.coordinates[0],
            "speed": round(v.speed, 1),
            "heading": round(v.heading, 1),
            "fuel_level": round(v.fuel_level, 1),
            "current_load_kg": round(v.current_load_kg, 1),
            "max_capacity_kg": v.max_capacity_kg,
            "current_order_id": v.current_order_id,
            "eta_minutes": round(v.current_eta_minutes, 1) if v.current_eta_minutes else None,
            "health": v.health.model_dump(),
            "odometer_km": round(v.odometer_km, 0),
            "updated_at": v.updated_at.isoformat(),
        }

    # Get recent telemetry
    telemetry_cursor = db.telemetry.find(
        {"vehicle_id": vehicle_id},
        sort=[("timestamp", -1)],
        limit=20,
    )
    telemetry_docs = await telemetry_cursor.to_list(length=20)
    telemetry = [
        {
            "timestamp": str(t.get("timestamp", "")),
            "lat": t.get("location", {}).get("coordinates", [0, 0])[1],
            "lng": t.get("location", {}).get("coordinates", [0, 0])[0],
            "speed": t.get("speed", 0),
            "fuel_level": t.get("fuel_level", 0),
        }
        for t in telemetry_docs
    ]

    # Get driver
    driver = None
    if v_data.get("driver_id"):
        driver_doc = await db.drivers.find_one({"driver_id": v_data["driver_id"]})
        if driver_doc:
            driver = {
                "driver_id": driver_doc["driver_id"],
                "full_name": driver_doc["full_name"],
                "phone": driver_doc.get("phone"),
                "rating": driver_doc.get("rating"),
                "total_deliveries_today": driver_doc.get("total_deliveries_today", 0),
            }

    return {**v_data, "telemetry": telemetry, "driver": driver}
