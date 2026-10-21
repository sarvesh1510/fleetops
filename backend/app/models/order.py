"""
Order domain model - represents a delivery order in the system.
"""
from datetime import datetime
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field
from .vehicle import GeoPoint


class OrderStatus(str, Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    PICKUP_EN_ROUTE = "pickup_en_route"
    PICKED_UP = "picked_up"
    DELIVERY_EN_ROUTE = "delivery_en_route"
    DELIVERED = "delivered"
    FAILED = "failed"
    CANCELLED = "cancelled"


class OrderPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class AddressPoint(BaseModel):
    address: str
    location: GeoPoint
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None


class Order(BaseModel):
    order_id: str
    reference: str  # human-readable, e.g. "ORD-2024-001045"
    status: OrderStatus = OrderStatus.PENDING
    priority: OrderPriority = OrderPriority.NORMAL

    # Parties
    customer_name: str
    customer_id: Optional[str] = None

    # Locations
    pickup: AddressPoint
    delivery: AddressPoint

    # Cargo
    weight_kg: float
    volume_m3: Optional[float] = None
    requires_refrigeration: bool = False
    fragile: bool = False
    description: str = ""

    # Assignment
    assigned_vehicle_id: Optional[str] = None
    assigned_driver_id: Optional[str] = None
    assigned_at: Optional[datetime] = None

    # Times
    requested_pickup_at: Optional[datetime] = None
    deadline: Optional[datetime] = None
    picked_up_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None

    # Region the order belongs to ("Mumbai MMR" | "Delhi NCR"); dispatch never crosses regions
    region: Optional[str] = None

    # ETA tracking
    estimated_delivery_at: Optional[datetime] = None
    eta_minutes: Optional[float] = None
    # ETA (minutes, pickup + delivery legs) computed at assignment time, and the
    # simulated minutes it actually took. Used for real ETA-accuracy analytics.
    predicted_eta_minutes: Optional[float] = None
    actual_duration_min: Optional[float] = None
    sla_at_risk: bool = False
    reassignment_count: int = 0

    # Distance
    estimated_distance_km: Optional[float] = None
    actual_distance_km: Optional[float] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
