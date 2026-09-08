"""
WebSocket broadcaster — manages connections and dispatches typed events
to all connected clients. Events are structured JSON with typed event names.
"""
import asyncio
import json
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Set
from fastapi import WebSocket
import structlog

logger = structlog.get_logger(__name__)


class WSEventType(str, Enum):
    # Vehicle events
    VEHICLE_UPDATED = "vehicle.updated"
    VEHICLE_STATUS_CHANGED = "vehicle.status_changed"

    # Order events
    ORDER_CREATED = "order.created"
    ORDER_UPDATED = "order.updated"
    ORDER_ASSIGNED = "order.assigned"
    DELIVERY_COMPLETED = "delivery.completed"

    # Route events
    ROUTE_UPDATED = "route.updated"
    VEHICLE_REROUTED = "vehicle.rerouted"

    # Incident events
    INCIDENT_CREATED = "incident.created"
    INCIDENT_UPDATED = "incident.updated"
    INCIDENT_RESOLVED = "incident.resolved"

    # Optimization events
    OPTIMIZATION_STARTED = "optimization.started"
    OPTIMIZATION_COMPLETED = "optimization.completed"

    # Alert events
    ALERT_CREATED = "alert.created"

    # System events
    FLEET_SNAPSHOT = "fleet.snapshot"
    SIMULATION_STATUS = "simulation.status"


def build_event(event_type: WSEventType, data: Any, meta: Optional[Dict] = None) -> str:
    """Construct a structured WebSocket message."""
    payload = {
        "event": event_type.value,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "data": data,
    }
    if meta:
        payload["meta"] = meta
    return json.dumps(payload, default=str)


class ConnectionManager:
    """
    Manages the pool of active WebSocket connections.
    Supports topic-based subscriptions — a client can subscribe to specific
    event types or all events (default).
    """

    def __init__(self) -> None:
        self._connections: Dict[str, WebSocket] = {}  # conn_id -> ws
        self._subscriptions: Dict[str, Set[str]] = {}  # conn_id -> set of event types

    async def connect(self, websocket: WebSocket, conn_id: str) -> None:
        await websocket.accept()
        self._connections[conn_id] = websocket
        self._subscriptions[conn_id] = set()  # empty = subscribe to all
        logger.info("WebSocket connected", conn_id=conn_id, total=len(self._connections))

    def disconnect(self, conn_id: str) -> None:
        self._connections.pop(conn_id, None)
        self._subscriptions.pop(conn_id, None)
        logger.info("WebSocket disconnected", conn_id=conn_id, total=len(self._connections))

    def subscribe(self, conn_id: str, event_types: List[str]) -> None:
        if conn_id in self._subscriptions:
            self._subscriptions[conn_id].update(event_types)

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def broadcast(self, event_type: WSEventType, data: Any, meta: Optional[Dict] = None) -> None:
        """Send an event to all subscribed connections."""
        message = build_event(event_type, data, meta)
        event_str = event_type.value
        dead_connections = []

        for conn_id, ws in self._connections.items():
            subs = self._subscriptions.get(conn_id, set())
            # Empty subs = subscribe to all
            if subs and event_str not in subs:
                continue
            try:
                await ws.send_text(message)
            except Exception:
                dead_connections.append(conn_id)

        for conn_id in dead_connections:
            self.disconnect(conn_id)

    async def send_to(self, conn_id: str, event_type: WSEventType, data: Any) -> None:
        """Send an event to a specific connection."""
        ws = self._connections.get(conn_id)
        if ws:
            try:
                await ws.send_text(build_event(event_type, data))
            except Exception:
                self.disconnect(conn_id)


# Singleton instance shared across the application
broadcaster = ConnectionManager()
