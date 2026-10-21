from datetime import datetime
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import get_current_user, require_dispatcher_or_above
from app.db.database import get_db
from app.simulation.engine import simulation_engine

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/incidents", tags=["incidents"])


class ResolveRequest(BaseModel):
    notes: Optional[str] = Field(None, max_length=500)


@router.get("")
async def list_incidents(
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    query: dict = {}
    if status and status != "all":
        # "active" is a convenience filter meaning anything not yet resolved
        query["status"] = {"$ne": "resolved"} if status == "active" else status
    if severity and severity != "all":
        query["severity"] = severity
    if type and type != "all":
        query["type"] = type

    total = await db.incidents.count_documents(query)
    cursor = (db.incidents.find(query, {"_id": 0}).sort("created_at", -1)
              .skip((page - 1) * page_size).limit(page_size))
    docs = await cursor.to_list(length=page_size)

    return {
        "items": docs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
        "active_count": await db.incidents.count_documents({"status": {"$ne": "resolved"}}),
    }


@router.get("/stats")
async def incident_stats(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    by_status = {d["_id"]: d["count"] async for d in db.incidents.aggregate(
        [{"$group": {"_id": "$status", "count": {"$sum": 1}}}])}
    by_severity = {d["_id"]: d["count"] async for d in db.incidents.aggregate(
        [{"$group": {"_id": "$severity", "count": {"$sum": 1}}}])}
    by_type = {d["_id"]: d["count"] async for d in db.incidents.aggregate(
        [{"$group": {"_id": "$type", "count": {"$sum": 1}}}])}

    mttr = await db.incidents.aggregate([
        {"$match": {"status": "resolved", "resolved_at": {"$type": "date"}}},
        {"$group": {"_id": None, "avg_ms": {"$avg": {"$subtract": ["$resolved_at", "$created_at"]}}}},
    ]).to_list(1)

    total = sum(by_status.values())
    return {
        "total": total,
        "active": total - by_status.get("resolved", 0),
        "by_status": by_status,
        "by_severity": by_severity,
        "by_type": by_type,
        "mean_time_to_resolve_min": round(mttr[0]["avg_ms"] / 60000, 1) if mttr and mttr[0]["avg_ms"] else None,
    }


@router.get("/{incident_id}")
async def get_incident(
    incident_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    doc = await db.incidents.find_one({"incident_id": incident_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return doc


@router.post("/{incident_id}/resolve")
async def resolve_incident(
    incident_id: str,
    body: Optional[ResolveRequest] = None,
    current_user: dict = Depends(require_dispatcher_or_above),
    db=Depends(get_db),
):
    doc = await db.incidents.find_one({"incident_id": incident_id}, {"_id": 0, "status": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")
    if doc["status"] == "resolved":
        raise HTTPException(status_code=409, detail="Incident is already resolved")

    notes = body.notes if body else None
    username = current_user["username"]
    handled_live = await simulation_engine.resolve_incident(incident_id, username, notes)
    if not handled_live:
        # Not tracked by the running simulation (e.g. created before a restart) - update the record directly.
        now = datetime.utcnow()
        await db.incidents.update_one(
            {"incident_id": incident_id},
            {"$set": {"status": "resolved", "resolved_at": now, "updated_at": now,
                      "resolution_notes": notes or f"Resolved manually by {username}"},
             "$push": {"timeline": {"timestamp": now, "event": "Incident resolved",
                                    "details": notes, "actor": f"user:{username}", "data": None}}},
        )
    logger.info("Incident resolved", incident_id=incident_id, by=username)
    return await db.incidents.find_one({"incident_id": incident_id}, {"_id": 0})
