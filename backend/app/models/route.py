"""
Route domain model - planned or active route for a vehicle.
"""
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from .vehicle import GeoPoint


class RouteStatus(str, Enum):
    PLANNED = "planned"
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class Waypoint(BaseModel):
    sequence: int
    location: GeoPoint
    address: str
    order_id: Optional[str] = None
    action: str = "delivery"  # "pickup" | "delivery" | "depot"
    estimated_arrival: Optional[datetime] = None
    actual_arrival: Optional[datetime] = None
    completed: bool = False


class RouteSegment(BaseModel):
    """A segment between two waypoints."""
    from_idx: int
    to_idx: int
    distance_km: float
    estimated_duration_minutes: float
    polyline: Optional[List[List[float]]] = None  # list of [lng, lat] pairs


class Route(BaseModel):
    route_id: str
    vehicle_id: str
    driver_id: Optional[str] = None
    status: RouteStatus = RouteStatus.PLANNED

    waypoints: List[Waypoint] = Field(default_factory=list)
    segments: List[RouteSegment] = Field(default_factory=list)

    # Metrics
    total_distance_km: float = 0.0
    total_duration_minutes: float = 0.0
    actual_distance_km: Optional[float] = None

    # Traffic / optimization
    traffic_factor: float = 1.0  # multiplier on baseline duration
    is_optimized: bool = False
    optimization_run_id: Optional[str] = None

    # Previous route (for rerouting comparison)
    previous_route_id: Optional[str] = None
    rerouting_reason: Optional[str] = None
    distance_delta_km: Optional[float] = None  # vs previous route
    time_delta_minutes: Optional[float] = None

    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
