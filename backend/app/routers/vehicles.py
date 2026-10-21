from datetime import datetime
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import get_current_user
from app.db.database import get_db
from app.models.vehicle import Vehicle
from app.simulation.engine import simulation_engine
from app.utils.geo import ist_day_start_utc, region_for_lng

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/vehicles", tags=["vehicles"])


def _live_item(v: Vehicle) -> dict:
    return {
        "vehicle_id": v.vehicle_id,
        "name": v.name,
        "registration": v.registration,
        "type": v.type.value,
        "fuel_type": v.fuel_type.value,
        "status": v.status.value,
        "driver_id": v.driver_id,
        "lat": v.location.coordinates[1],
        "lng": v.location.coordinates[0],
        "speed": round(v.speed, 1),
        "heading": round(v.heading, 1),
        "fuel_level": round(v.fuel_level, 1),
        "fuel_range_km": round(v.fuel_range_km, 0),
        "current_load_kg": round(v.current_load_kg, 1),
        "max_capacity_kg": v.max_capacity_kg,
        "current_order_id": v.current_order_id,
        "eta_minutes": round(v.current_eta_minutes, 1) if v.current_eta_minutes else None,
        "health_score": round(v.health.overall_score, 1),
        "odometer_km": round(v.odometer_km, 0),
        "updated_at": v.updated_at.isoformat(),
        "region": v.region or region_for_lng(v.location.coordinates[0]),
    }


def _doc_item(doc: dict) -> dict:
    coords = doc.get("location", {}).get("coordinates", [0, 0])
    health = doc.get("health", {})
    return {
        "vehicle_id": doc["vehicle_id"],
        "name": doc["name"],
        "registration": doc.get("registration"),
        "type": doc["type"],
        "fuel_type": doc["fuel_type"],
        "status": doc["status"],
        "driver_id": doc.get("driver_id"),
        "lat": coords[1],
        "lng": coords[0],
        "speed": doc.get("speed", 0),
        "heading": doc.get("heading", 0),
        "fuel_level": doc.get("fuel_level", 0),
        "fuel_range_km": doc.get("fuel_range_km", 0),
        "current_load_kg": doc.get("current_load_kg", 0),
        "max_capacity_kg": doc.get("max_capacity_kg", 0),
        "current_order_id": doc.get("current_order_id"),
        "eta_minutes": doc.get("current_eta_minutes"),
        "health_score": health.get("overall_score", 100),
        "odometer_km": doc.get("odometer_km", 0),
        "updated_at": str(doc.get("updated_at", "")),
        "region": doc.get("region") or region_for_lng(coords[0]),
    }


def _norm(value: Optional[str]) -> Optional[str]:
    return None if value in (None, "", "all", "undefined") else value


@router.get("")
async def list_vehicles(
    status: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    region: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=60),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """List vehicles with optional filtering. Live state comes from the simulation."""
    status, type, region = _norm(status), _norm(type), _norm(region)
    needle = search.lower() if search else None

    sim_vehicles = simulation_engine.get_all_vehicles()
    if sim_vehicles:
        items = [_live_item(v) for v in sim_vehicles]
    else:
        docs = await db.vehicles.find({}, {"_id": 0}).to_list(length=500)
        items = [_doc_item(d) for d in docs]

    items = [
        i for i in items
        if (not status or i["status"] == status)
        and (not type or i["type"] == type)
        and (not region or i["region"] == region)
        and (not needle or needle in i["name"].lower() or needle in (i["registration"] or "").lower()
             or needle in i["vehicle_id"].lower())
    ]
    items.sort(key=lambda i: i["vehicle_id"])

    total = len(items)
    start = (page - 1) * page_size
    return {
        "items": items[start:start + page_size],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/stats")
async def fleet_stats(current_user: dict = Depends(get_current_user)):
    """Fleet-level KPIs used by the dashboard."""
    vehicles = simulation_engine.get_all_vehicles()
    if not vehicles:
        return {"total": 0, "by_status": {}, "by_region": {}, "en_route": 0, "available": 0,
                "avg_fuel_pct": 0, "fleet_utilization_pct": 0, "active": 0}

    by_status: dict = {}
    by_region: dict = {}
    total_fuel = total_load = total_capacity = 0.0
    for v in vehicles:
        by_status[v.status.value] = by_status.get(v.status.value, 0) + 1
        region = v.region or region_for_lng(v.location.coordinates[0])
        by_region[region] = by_region.get(region, 0) + 1
        total_fuel += v.fuel_level
        total_load += v.current_load_kg
        total_capacity += v.max_capacity_kg

    total = len(vehicles)
    active = by_status.get("en_route", 0) + by_status.get("loading", 0) + by_status.get("unloading", 0)
    return {
        "total": total,
        "by_status": by_status,
        "by_region": by_region,
        "en_route": by_status.get("en_route", 0),
        "available": by_status.get("available", 0),
        "avg_fuel_pct": round(total_fuel / total, 1),
        # share of the fleet that is out working, and share of total payload capacity in use
        "active": active,
        "fleet_utilization_pct": round(active / total * 100, 1),
        "load_utilization_pct": round(total_load / total_capacity * 100, 1) if total_capacity else 0.0,
    }


@router.get("/{vehicle_id}")
async def get_vehicle(
    vehicle_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Full vehicle detail: live state, driver, current job and recent telemetry."""
    v = simulation_engine.get_vehicle(vehicle_id)
    if v:
        data = {**_live_item(v), "health": v.health.model_dump()}
    else:
        doc = await db.vehicles.find_one({"vehicle_id": vehicle_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        data = {**_doc_item(doc), "health": doc.get("health", {})}

    telemetry_docs = await (db.telemetry.find({"vehicle_id": vehicle_id}, {"_id": 0})
                            .sort("timestamp", -1).limit(20).to_list(length=20))
    telemetry = [
        {
            "timestamp": t["timestamp"].isoformat() if isinstance(t.get("timestamp"), datetime) else str(t.get("timestamp", "")),
            "lat": t.get("location", {}).get("coordinates", [0, 0])[1],
            "lng": t.get("location", {}).get("coordinates", [0, 0])[0],
            "speed": t.get("speed", 0),
            "fuel_level": t.get("fuel_level", 0),
        }
        for t in telemetry_docs
    ]

    deliveries_today = await db.orders.count_documents({
        "assigned_vehicle_id": vehicle_id, "status": "delivered",
        "delivered_at": {"$gte": ist_day_start_utc()},
    })

    driver = None
    if data.get("driver_id"):
        d = await db.drivers.find_one({"driver_id": data["driver_id"]}, {"_id": 0})
        if d:
            driver = {
                "driver_id": d["driver_id"],
                "full_name": d["full_name"],
                "phone": d.get("phone"),
                "rating": d.get("rating"),
                "total_deliveries_today": deliveries_today,
            }

    current_order = None
    if data.get("current_order_id"):
        o = next((o for o in simulation_engine.get_all_orders() if o.order_id == data["current_order_id"]), None)
        if o:
            current_order = {
                "order_id": o.order_id,
                "reference": o.reference,
                "status": o.status.value,
                "priority": o.priority.value,
                "customer_name": o.customer_name,
                "pickup_address": o.pickup.address,
                "delivery_address": o.delivery.address,
                "weight_kg": o.weight_kg,
                "deadline": o.deadline.isoformat() if o.deadline else None,
                "sla_at_risk": o.sla_at_risk,
            }

    return {**data, "telemetry": telemetry, "driver": driver, "current_order": current_order,
            "deliveries_today": deliveries_today}
