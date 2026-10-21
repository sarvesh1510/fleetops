"""
Vehicle domain model - represents the canonical state of a fleet vehicle.
"""
from datetime import datetime
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field


class VehicleStatus(str, Enum):
    AVAILABLE = "available"
    EN_ROUTE = "en_route"
    LOADING = "loading"
    UNLOADING = "unloading"
    IDLE = "idle"
    MAINTENANCE = "maintenance"
    BREAKDOWN = "breakdown"
    OFFLINE = "offline"


class VehicleType(str, Enum):
    VAN = "van"
    TRUCK = "truck"
    CARGO_BIKE = "cargo_bike"
    MOTORCYCLE = "motorcycle"
    REFRIGERATED = "refrigerated"


class FuelType(str, Enum):
    DIESEL = "diesel"
    CNG = "cng"
    ELECTRIC = "electric"
    HYBRID = "hybrid"
    PETROL = "petrol"


class GeoPoint(BaseModel):
    type: str = "Point"
    coordinates: List[float]  # [longitude, latitude] — GeoJSON order


class VehicleHealth(BaseModel):
    engine_temp: float = 90.0  # Celsius
    tire_pressure: float = 100.0  # percent of optimal
    brake_health: float = 100.0  # percent
    transmission_health: float = 100.0
    overall_score: float = 100.0  # 0-100


class Vehicle(BaseModel):
    vehicle_id: str
    name: str  # e.g. "V-101"
    registration: Optional[str] = None  # number plate
    type: VehicleType
    fuel_type: FuelType
    status: VehicleStatus = VehicleStatus.AVAILABLE
    driver_id: Optional[str] = None

    # Location
    location: GeoPoint
    heading: float = 0.0  # degrees, 0 = North
    speed: float = 0.0  # km/h

    # Capacity
    max_capacity_kg: float
    current_load_kg: float = 0.0

    # Energy
    fuel_level: float = 100.0  # percent (also used for battery)
    fuel_range_km: float = 0.0  # estimated range

    # Operating region ("Mumbai MMR" | "Delhi NCR")
    region: Optional[str] = None

    # Current assignment
    current_order_id: Optional[str] = None
    current_route_id: Optional[str] = None

    # Health
    health: VehicleHealth = Field(default_factory=VehicleHealth)
    odometer_km: float = 0.0

    # ETAs
    current_eta_minutes: Optional[float] = None
    next_stop_address: Optional[str] = None

    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    @property
    def available_capacity_kg(self) -> float:
        return self.max_capacity_kg - self.current_load_kg

    @property
    def utilization_pct(self) -> float:
        if self.max_capacity_kg == 0:
            return 0.0
        return (self.current_load_kg / self.max_capacity_kg) * 100
