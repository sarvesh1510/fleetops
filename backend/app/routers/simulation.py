"""
Simulation control router - role-restricted demo controls.
WebSocket handler for real-time fleet updates.

Role requirements:
  - View sim status: any authenticated user
  - Pause/resume/speed: ops_manager or above
  - Demo triggers (traffic/breakdown/order): dispatcher or above
  - Start/stop simulation: admin only
"""
import uuid
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.core.auth import (
    decode_token, get_current_user, require_admin, require_dispatcher_or_above, require_ops_or_above,
)
from app.db.database import get_db
from app.simulation.engine import simulation_engine
from app.utils.geo import REGIONS
from app.websocket.broadcaster import WSEventType, broadcaster

logger = structlog.get_logger(__name__)

sim_router = APIRouter(prefix="/simulation", tags=["simulation"])


class SpeedRequest(BaseModel):
    speed: float = Field(..., ge=0.1, le=20.0)


@sim_router.get("/status")
async def sim_status(current_user: dict = Depends(get_current_user)):
    """Any authenticated user can view simulation status."""
    return {
        "running": simulation_engine.running,
        "paused": simulation_engine.paused,
        "speed": simulation_engine.speed,
        "tick_count": simulation_engine.tick_count,
        "vehicle_count": len(simulation_engine.get_all_vehicles()),
        "pending_orders": simulation_engine.pending_count,
        "traffic": {r: simulation_engine.traffic_factor(r) for r in REGIONS},
        "connections": broadcaster.connection_count,
    }


@sim_router.post("/start")
async def start_sim(current_user: dict = Depends(require_admin)):
    await simulation_engine.start()
    logger.info("Simulation started", by=current_user["username"])
    return {"status": "started"}


@sim_router.post("/pause")
async def pause_sim(current_user: dict = Depends(require_ops_or_above)):
    simulation_engine.pause()
    await _broadcast_status(current_user["username"])
    return {"status": "paused", "paused": True}


@sim_router.post("/resume")
async def resume_sim(current_user: dict = Depends(require_ops_or_above)):
    simulation_engine.resume()
    await _broadcast_status(current_user["username"])
    return {"status": "resumed", "paused": False}


@sim_router.post("/speed")
async def set_speed(req: SpeedRequest, current_user: dict = Depends(require_ops_or_above)):
    simulation_engine.set_speed(req.speed)
    await _broadcast_status(current_user["username"])
    return {"speed": simulation_engine.speed}


async def _broadcast_status(username: str):
    await broadcaster.broadcast(WSEventType.SIMULATION_STATUS, {
        "speed": simulation_engine.speed,
        "running": simulation_engine.running,
        "paused": simulation_engine.paused,
        "changed_by": username,
    })


@sim_router.post("/trigger/traffic")
async def trigger_traffic(
    region: Optional[str] = Query(None, description="'Mumbai MMR' or 'Delhi NCR' (default Mumbai MMR)"),
    current_user: dict = Depends(require_dispatcher_or_above),
):
    if region is not None and region not in REGIONS:
        raise HTTPException(status_code=422, detail=f"region must be one of {list(REGIONS)}")
    result = await simulation_engine.trigger_traffic_event(region)
    logger.info("Traffic event triggered", by=current_user["username"], **result)
    return {"message": f"Traffic surge in {result['region']} - {result['affected']} vehicle(s) affected", **result}


@sim_router.post("/trigger/breakdown")
async def trigger_breakdown(
    vehicle_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_dispatcher_or_above),
):
    hit = await simulation_engine.trigger_breakdown_event(vehicle_id)
    if hit is None:
        raise HTTPException(status_code=409, detail="No eligible vehicle to break down (none en route)")
    logger.info("Breakdown triggered", vehicle_id=hit, by=current_user["username"])
    return {"message": "Breakdown triggered", "vehicle_id": hit}


@sim_router.post("/trigger/order")
async def trigger_order(current_user: dict = Depends(require_dispatcher_or_above)):
    order = await simulation_engine.generate_random_order()
    logger.info("Demo order injected", by=current_user["username"])
    return {"message": "Random order created", "order_id": order.order_id if order else None}


# ── WebSocket Handler ─────────────────────────────────────────────────────────
ws_router = APIRouter(tags=["websocket"])


@ws_router.websocket("/ws/fleet")
async def fleet_websocket(websocket: WebSocket):
    """Live fleet feed. Requires a valid JWT as ?token=..."""
    token = websocket.query_params.get("token")
    try:
        payload = decode_token(token) if token else None
        user = await get_db().users.find_one({"user_id": payload["sub"]}) if payload else None
        if not user or not user.get("is_active"):
            raise ValueError("unauthorised")
    except Exception:
        await websocket.close(code=4401)
        return

    conn_id = str(uuid.uuid4())
    await broadcaster.connect(websocket, conn_id)
    await broadcaster.send_to(conn_id, WSEventType.FLEET_SNAPSHOT, simulation_engine.build_fleet_snapshot())

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
