"""
Optimization run model - records every autonomous optimization decision.
"""
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class OptimizationTrigger(str, Enum):
    SCHEDULED = "scheduled"
    NEW_ORDER = "new_order"
    VEHICLE_BREAKDOWN = "vehicle_breakdown"
    TRAFFIC_CHANGE = "traffic_change"
    MANUAL = "manual"
    SLA_RISK = "sla_risk"


class VehicleCandidate(BaseModel):
    vehicle_id: str
    distance_to_pickup_km: float
    eta_minutes: float
    available_capacity_kg: float
    fuel_level: float
    current_load_kg: float
    score: float
    disqualified: bool = False
    disqualification_reason: Optional[str] = None
    selection_reasons: List[str] = Field(default_factory=list)


class OptimizationRun(BaseModel):
    run_id: str
    trigger: OptimizationTrigger
    status: str = "running"  # running | completed | failed

    # What triggered this
    triggering_vehicle_id: Optional[str] = None
    triggering_order_id: Optional[str] = None
    triggering_incident_id: Optional[str] = None

    # Inputs snapshot
    vehicles_considered: int = 0
    orders_in_scope: int = 0
    candidates: List[VehicleCandidate] = Field(default_factory=list)

    # Before/after metrics
    before_total_distance_km: Optional[float] = None
    after_total_distance_km: Optional[float] = None
    before_total_duration_min: Optional[float] = None
    after_total_duration_min: Optional[float] = None
    distance_saved_km: Optional[float] = None
    time_saved_min: Optional[float] = None
    improvement_pct: Optional[float] = None

    # Decisions made
    assignments_changed: int = 0
    routes_updated: int = 0
    decisions: List[Dict[str, Any]] = Field(default_factory=list)

    # Explanation
    summary: str = ""

    solver_duration_ms: Optional[float] = None
    error_message: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
