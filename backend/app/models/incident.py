"""
Incident domain model - lifecycle of a detected problem and its resolution.
"""
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class IncidentSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class IncidentType(str, Enum):
    VEHICLE_BREAKDOWN = "vehicle_breakdown"
    LOW_FUEL = "low_fuel"
    LOW_BATTERY = "low_battery"
    ROUTE_DEVIATION = "route_deviation"
    TRAFFIC_SPIKE = "traffic_spike"
    DELIVERY_SLA_RISK = "delivery_sla_risk"
    PROLONGED_STOP = "prolonged_stop"
    OVERLOAD = "overload"
    DRIVER_UNREACHABLE = "driver_unreachable"
    VEHICLE_STOPPED = "vehicle_stopped"


class IncidentStatus(str, Enum):
    DETECTED = "detected"
    ANALYZING = "analyzing"
    ACTION_TAKEN = "action_taken"
    MONITORING = "monitoring"
    RESOLVED = "resolved"
    ESCALATED = "escalated"


class IncidentTimelineEntry(BaseModel):
    timestamp: datetime
    event: str
    details: Optional[str] = None
    actor: str = "system"  # "system" | "user:username"
    data: Optional[Dict[str, Any]] = None


class AutonomousAction(BaseModel):
    action_type: str  # e.g. "reassign_order", "reroute_vehicle", "dispatch_support"
    description: str
    vehicle_id: Optional[str] = None
    order_id: Optional[str] = None
    reason: str
    expected_impact: str
    executed_at: datetime = Field(default_factory=datetime.utcnow)
    outcome: Optional[str] = None


class Incident(BaseModel):
    incident_id: str
    type: IncidentType
    severity: IncidentSeverity
    status: IncidentStatus = IncidentStatus.DETECTED

    title: str
    description: str

    # Affected entities
    vehicle_id: Optional[str] = None
    driver_id: Optional[str] = None
    order_ids: List[str] = Field(default_factory=list)
    route_id: Optional[str] = None

    # Detection context
    detected_by: str = "system"  # "system" | "simulation" | "user:x"
    detection_data: Optional[Dict[str, Any]] = None

    # Response
    autonomous_actions: List[AutonomousAction] = Field(default_factory=list)
    timeline: List[IncidentTimelineEntry] = Field(default_factory=list)

    # Impact
    sla_impact: Optional[str] = None
    affected_customers: List[str] = Field(default_factory=list)

    # Resolution
    resolved_at: Optional[datetime] = None
    resolution_notes: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
