"""
Simulation control router — role-restricted demo controls.
WebSocket handler for real-time fleet updates.

Role requirements:
  - View sim status: any authenticated user
  - Pause/resume/speed: ops_manager or above
  - Demo triggers (traffic/breakdown/order): dispatcher or above
  - Start/stop simulation: admin only
"""
import uuid
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel
import structlog

from app.core.auth import get_current_user, require_dispatcher_or_above, require_ops_or_above, require_admin
from app.simulation.engine import simulation_engine
from app.websocket.broadcaster import broadcaster, WSEventType

logger = structlog.get_logger(__name__)

sim_router = APIRouter(prefix="/simulation", tags=["simulation"])


class SpeedRequest(BaseModel):
    speed: float


@sim_router.get("/status")
async def sim_status(current_user: dict = Depends(get_current_user)):
    """Any authenticated user can view simulation status."""
    return {
        "running": simulation_engine.running,
        "paused": simulation_engine.paused,
        "speed": simulation_engine.speed,
        "tick_count": simulation_engine.tick_count,
        "vehicle_count": len(simulation_engine._vehicles),
        "pending_orders": len(simulation_engine._pending_orders),
        "connections": broadcaster.connection_count,
    }


@sim_router.post("/start")
async def start_sim(current_user: dict = Depends(require_admin)):
    """Admin only — start simulation."""
    await simulation_engine.start()
    logger.info("Simulation started", by=current_user["username"])
    return {"status": "started"}


@sim_router.post("/pause")
async def pause_sim(current_user: dict = Depends(require_ops_or_above)):
    """Ops manager and above can pause."""
    simulation_engine.pause()
    logger.info("Simulation paused", by=current_user["username"])
    return {"status": "paused"}


@sim_router.post("/resume")
async def resume_sim(current_user: dict = Depends(require_ops_or_above)):
    """Ops manager and above can resume."""
    simulation_engine.resume()
    logger.info("Simulation resumed", by=current_user["username"])
    return {"status": "resumed"}


@sim_router.post("/speed")
async def set_speed(req: SpeedRequest, current_user: dict = Depends(require_ops_or_above)):
    """Ops manager and above can change sim speed."""
    simulation_engine.set_speed(req.speed)
    await broadcaster.broadcast(WSEventType.SIMULATION_STATUS, {
        "speed": simulation_engine.speed,
        "running": simulation_engine.running,
        "paused": simulation_engine.paused,
        "changed_by": current_user["username"],
    })
    logger.info("Simulation speed changed", speed=simulation_engine.speed, by=current_user["username"])
    return {"speed": simulation_engine.speed}


@sim_router.post("/trigger/traffic")
async def trigger_traffic(current_user: dict = Depends(require_dispatcher_or_above)):
    """Dispatcher and above can trigger traffic events."""
    await simulation_engine.trigger_traffic_event()
    logger.info("Traffic event triggered", by=current_user["username"])
    return {"message": "Traffic surge triggered"}


@sim_router.post("/trigger/breakdown")
async def trigger_breakdown(
    vehicle_id: str = Query(None),
    current_user: dict = Depends(require_dispatcher_or_above),
):
    """Dispatcher and above can trigger breakdowns."""
    await simulation_engine.trigger_breakdown_event(vehicle_id)
    logger.info("Breakdown triggered", vehicle_id=vehicle_id, by=current_user["username"])
    return {"message": "Breakdown triggered"}


@sim_router.post("/trigger/order")
async def trigger_order(current_user: dict = Depends(require_dispatcher_or_above)):
    """Dispatcher and above can inject a new random order."""
    await simulation_engine._generate_random_order()
    logger.info("Demo order injected", by=current_user["username"])
    return {"message": "Random order created"}


# ── WebSocket Handler ─────────────────────────────────────────────────────────
ws_router = APIRouter(tags=["websocket"])


@ws_router.websocket("/ws/fleet")
async def fleet_websocket(websocket: WebSocket):
    """
    WebSocket endpoint — no auth required (token optional via query param).
    All data sent is read-only fleet state.
    """
    conn_id = str(uuid.uuid4())
    await broadcaster.connect(websocket, conn_id)

    # Send immediate snapshot
    vehicles = simulation_engine.get_all_vehicles()
    snapshot = {
        "vehicles": [
            {
                "vehicle_id": v.vehicle_id,
                "name": v.name,
                "status": v.status.value,
                "lat": v.location.coordinates[1],
                "lng": v.location.coordinates[0],
                "speed": round(v.speed, 1),
                "heading": round(v.heading, 1),
                "fuel_level": round(v.fuel_level, 1),
                "current_load_kg": round(v.current_load_kg, 1),
                "current_order_id": v.current_order_id,
                "eta_minutes": round(v.current_eta_minutes, 1) if v.current_eta_minutes else None,
                "health_score": round(v.health.overall_score, 1),
            }
            for v in vehicles
        ],
        "tick": simulation_engine.tick_count,
        "sim_speed": simulation_engine.speed,
        "pending_orders": len(simulation_engine._pending_orders),
    }
    await broadcaster.send_to(conn_id, WSEventType.FLEET_SNAPSHOT, snapshot)

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "subscribe":
                broadcaster.subscribe(conn_id, data.get("events", []))
            elif data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        broadcaster.disconnect(conn_id)
    except Exception as e:
        logger.error("WebSocket error", conn_id=conn_id, error=str(e))
        broadcaster.disconnect(conn_id)
