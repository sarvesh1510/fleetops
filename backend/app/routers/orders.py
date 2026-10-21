import re
import uuid
from datetime import datetime, timedelta
from typing import Literal, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import get_current_user, require_dispatcher_or_above
from app.db.database import get_db
from app.models.order import AddressPoint, Order, OrderPriority, OrderStatus
from app.models.vehicle import GeoPoint
from app.simulation.engine import simulation_engine
from app.utils.geo import DELHI, MUMBAI, haversine_km, ist_day_start_utc

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/orders", tags=["orders"])

ACTIVE_STATES = ["assigned", "pickup_en_route", "picked_up", "delivery_en_route"]
NON_TERMINAL_STATES = ["pending"] + ACTIVE_STATES

# Service areas (centre lat, centre lng, radius km). Orders outside are rejected.
SERVICE_AREAS = {
    MUMBAI: (19.10, 72.98, 60.0),
    DELHI: (28.58, 77.22, 60.0),
}


def _service_region(lat: float, lng: float) -> Optional[str]:
    for region, (clat, clng, radius) in SERVICE_AREAS.items():
        if haversine_km(lat, lng, clat, clng) <= radius:
            return region
    return None


class CreateOrderRequest(BaseModel):
    customer_name: str = Field(..., min_length=1, max_length=120)
    priority: Literal["low", "normal", "high", "critical"] = "normal"
    pickup_address: str = Field(..., min_length=3, max_length=300)
    pickup_lat: float = Field(..., ge=-90, le=90)
    pickup_lng: float = Field(..., ge=-180, le=180)
    delivery_address: str = Field(..., min_length=3, max_length=300)
    delivery_lat: float = Field(..., ge=-90, le=90)
    delivery_lng: float = Field(..., ge=-180, le=180)
    weight_kg: float = Field(..., gt=0, le=20000)
    requires_refrigeration: bool = False
    fragile: bool = False
    description: str = Field("", max_length=500)
    deadline_hours: Optional[float] = Field(None, gt=0, le=168)


@router.get("")
async def list_orders(
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    region: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    query: dict = {}
    if status and status != "all":
        query["status"] = status
    if priority and priority != "all":
        query["priority"] = priority
    if region and region != "all":
        query["region"] = region
    if search:
        rx = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [{"reference": rx}, {"customer_name": rx}]

    total = await db.orders.count_documents(query)
    cursor = (db.orders.find(query, {"_id": 0}).sort("created_at", -1)
              .skip((page - 1) * page_size).limit(page_size))
    docs = await cursor.to_list(length=page_size)

    live = {o.order_id: o for o in simulation_engine.get_all_orders()}
    for doc in docs:
        so = live.get(doc.get("order_id"))
        if so:
            doc["status"] = so.status.value
            doc["eta_minutes"] = so.eta_minutes
            doc["sla_at_risk"] = so.sla_at_risk
            doc["assigned_vehicle_id"] = so.assigned_vehicle_id

    return {
        "items": docs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/stats")
async def order_stats(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Operational counts. 'Today' is the current India (IST) calendar day."""
    start_of_day = ist_day_start_utc()

    # Everything still in flight, plus everything created today.
    pipeline = [
        {"$match": {"$or": [
            {"created_at": {"$gte": start_of_day}},
            {"status": {"$in": NON_TERMINAL_STATES}},
        ]}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    by_status = {doc["_id"]: doc["count"] async for doc in db.orders.aggregate(pipeline)}

    created_today = await db.orders.count_documents({"created_at": {"$gte": start_of_day}})
    delivered_today_pipeline = [
        {"$match": {"status": "delivered", "delivered_at": {"$gte": start_of_day}}},
        {"$group": {
            "_id": None,
            "count": {"$sum": 1},
            "on_time": {"$sum": {"$cond": [
                {"$lte": ["$delivered_at", {"$ifNull": ["$deadline", "$delivered_at"]}]}, 1, 0]}},
        }},
    ]
    res = await db.orders.aggregate(delivered_today_pipeline).to_list(1)
    delivered_today = res[0]["count"] if res else 0
    on_time_today = res[0]["on_time"] if res else 0

    live = simulation_engine.get_all_orders()
    return {
        "total_today": created_today,
        "delivered_today": delivered_today,
        "active": sum(1 for o in live if o.status.value in ACTIVE_STATES),
        "pending": sum(1 for o in live if o.status == OrderStatus.PENDING),
        "at_risk": sum(1 for o in live if o.sla_at_risk),
        # None when nothing has been delivered yet today (avoids a misleading 0%)
        "on_time_rate": round(on_time_today / delivered_today * 100, 1) if delivered_today else None,
        "by_status": by_status,
    }


@router.post("", status_code=201)
async def create_order(
    req: CreateOrderRequest,
    current_user: dict = Depends(require_dispatcher_or_above),
):
    pickup_region = _service_region(req.pickup_lat, req.pickup_lng)
    delivery_region = _service_region(req.delivery_lat, req.delivery_lng)
    if pickup_region is None or delivery_region is None:
        raise HTTPException(
            status_code=422,
            detail="Pickup and delivery must be inside the Mumbai MMR or Delhi NCR service area",
        )
    if pickup_region != delivery_region:
        raise HTTPException(
            status_code=422,
            detail=f"Cross-region delivery is not supported ({pickup_region} to {delivery_region})",
        )

    now = datetime.utcnow()
    prefix = "DEL" if pickup_region == DELHI else "MUM"
    order = Order(
        order_id=f"ord-{uuid.uuid4().hex[:12]}",
        reference=f"{prefix}-{now.strftime('%y%m%d')}-{uuid.uuid4().hex[:4].upper()}",
        status=OrderStatus.PENDING,
        priority=OrderPriority(req.priority),
        customer_name=req.customer_name.strip(),
        region=pickup_region,
        pickup=AddressPoint(address=req.pickup_address.strip(),
                            location=GeoPoint(coordinates=[req.pickup_lng, req.pickup_lat])),
        delivery=AddressPoint(address=req.delivery_address.strip(),
                              location=GeoPoint(coordinates=[req.delivery_lng, req.delivery_lat])),
        weight_kg=req.weight_kg,
        requires_refrigeration=req.requires_refrigeration,
        fragile=req.fragile,
        description=req.description,
        deadline=now + timedelta(hours=req.deadline_hours) if req.deadline_hours else None,
        estimated_distance_km=round(
            haversine_km(req.pickup_lat, req.pickup_lng, req.delivery_lat, req.delivery_lng), 1),
    )

    # Persists, announces and dispatches the order through the optimization engine.
    await simulation_engine.add_order(order)

    assigned = None
    if order.assigned_vehicle_id:
        vehicle = simulation_engine.get_vehicle(order.assigned_vehicle_id)
        assigned = {
            "vehicle_id": order.assigned_vehicle_id,
            "vehicle_name": vehicle.name if vehicle else None,
            "eta_minutes": order.eta_minutes,
        }
    logger.info("Order created", order_id=order.order_id, priority=order.priority.value,
                assigned=bool(assigned), by=current_user["username"])
    return {"order": order.model_dump(), "assignment": assigned}


@router.get("/{order_id}")
async def get_order(
    order_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    for o in simulation_engine.get_all_orders():
        if o.order_id == order_id:
            return o.model_dump()
    doc = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    return doc
