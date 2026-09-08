from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import uuid
import structlog

from app.core.auth import get_current_user, require_dispatcher_or_above
from app.db.database import get_db
from app.models.order import Order, OrderStatus, OrderPriority, AddressPoint
from app.models.vehicle import GeoPoint
from app.simulation.engine import simulation_engine
from app.optimization.engine import optimization_engine

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/orders", tags=["orders"])


class CreateOrderRequest(BaseModel):
    customer_name: str
    priority: str = "normal"
    pickup_address: str
    pickup_lat: float
    pickup_lng: float
    delivery_address: str
    delivery_lat: float
    delivery_lng: float
    weight_kg: float
    requires_refrigeration: bool = False
    fragile: bool = False
    description: str = ""
    deadline_hours: Optional[float] = None


@router.get("")
async def list_orders(
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    query: dict = {}
    if status:
        query["status"] = status
    if priority:
        query["priority"] = priority

    total = await db.orders.count_documents(query)
    cursor = db.orders.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size)
    docs = await cursor.to_list(length=page_size)

    # Overlay live simulation state
    sim_orders = {o.order_id: o for o in simulation_engine.get_all_orders()}
    items = []
    for doc in docs:
        oid = doc.get("order_id")
        if oid and oid in sim_orders:
            so = sim_orders[oid]
            doc["status"] = so.status.value
            doc["eta_minutes"] = so.eta_minutes
            doc["sla_at_risk"] = so.sla_at_risk
        items.append(doc)

    return {
        "items": items,
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
    now = datetime.utcnow()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)

    pipeline = [
        {"$match": {"created_at": {"$gte": start_of_day.isoformat()}}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    status_counts = {doc["_id"]: doc["count"] async for doc in db.orders.aggregate(pipeline)}

    total_today = sum(status_counts.values())
    delivered_today = status_counts.get("delivered", 0)
    pending = len(simulation_engine.get_pending_orders())
    active = sum(1 for o in simulation_engine.get_all_orders()
                 if o.status.value in ("assigned", "pickup_en_route", "picked_up", "delivery_en_route"))
    at_risk = sum(1 for o in simulation_engine.get_all_orders() if o.sla_at_risk)

    on_time_rate = 0.0
    if delivered_today > 0:
        # From historical data
        on_time_cursor = db.orders.find({
            "status": "delivered",
            "created_at": {"$gte": start_of_day.isoformat()},
            "sla_at_risk": {"$ne": True},
        })
        on_time = await on_time_cursor.to_list(length=1000)
        on_time_rate = round(len(on_time) / max(delivered_today, 1) * 100, 1)

    return {
        "total_today": total_today,
        "delivered_today": delivered_today,
        "active": active,
        "pending": pending,
        "at_risk": at_risk,
        "on_time_rate": on_time_rate,
        "by_status": status_counts,
    }


@router.post("", status_code=201)
async def create_order(
    req: CreateOrderRequest,
    current_user: dict = Depends(require_dispatcher_or_above),
    db=Depends(get_db),
):
    from datetime import timedelta
    deadline = datetime.utcnow() + timedelta(hours=req.deadline_hours) if req.deadline_hours else None

    order = Order(
        order_id=f"ord-{uuid.uuid4().hex[:12]}",
        reference=f"ORD-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}",
        status=OrderStatus.PENDING,
        priority=OrderPriority(req.priority),
        customer_name=req.customer_name,
        pickup=AddressPoint(
            address=req.pickup_address,
            location=GeoPoint(coordinates=[req.pickup_lng, req.pickup_lat]),
        ),
        delivery=AddressPoint(
            address=req.delivery_address,
            location=GeoPoint(coordinates=[req.delivery_lng, req.delivery_lat]),
        ),
        weight_kg=req.weight_kg,
        requires_refrigeration=req.requires_refrigeration,
        fragile=req.fragile,
        description=req.description,
        deadline=deadline,
    )

    await db.orders.insert_one(order.model_dump())
    simulation_engine._orders[order.order_id] = order
    simulation_engine._pending_orders.append(order)

    # Trigger optimization for best vehicle
    candidate = await optimization_engine.assign_order_to_best_vehicle(order)

    logger.info("Order created", order_id=order.order_id, priority=order.priority.value)
    return {
        "order": order.model_dump(),
        "recommended_vehicle": candidate.model_dump() if candidate else None,
    }


@router.get("/{order_id}")
async def get_order(
    order_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    # Check live state first
    sim_orders = simulation_engine.get_all_orders()
    for o in sim_orders:
        if o.order_id == order_id:
            return o.model_dump()

    doc = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    return doc
