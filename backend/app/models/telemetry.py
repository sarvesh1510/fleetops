"""
Telemetry - time-series vehicle state snapshots stored to MongoDB.
Not every update is persisted — only sampled at configured intervals.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from .vehicle import GeoPoint


class TelemetryRecord(BaseModel):
    vehicle_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    location: GeoPoint
    speed: float
    heading: float
    fuel_level: float
    current_load_kg: float
    status: str
    engine_temp: float
    odometer_km: float
    current_order_id: Optional[str] = None
    eta_minutes: Optional[float] = None
