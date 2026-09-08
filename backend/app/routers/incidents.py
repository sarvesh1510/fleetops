import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import structlog

from app.core.auth import get_current_user, require_dispatcher_or_above
from app.db.database import get_db

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/incidents", tags=["incidents"])

# In-memory cache of active incidents (also persisted to DB)
_active_incidents: dict = {}


def register_incident(incident) -> None:
    _active_incidents[incident.incident_id] = incident


@router.get("")
async def list_incidents(
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    query: dict = {}
    if status:
        query["status"] = status
    if severity:
        query["severity"] = severity

    total = await db.incidents.count_documents(query)
    cursor = db.incidents.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size)
    docs = await cursor.to_list(length=page_size)

    # Overlay live incidents
    for doc in docs:
        iid = doc.get("incident_id")
        if iid in _active_incidents:
            live = _active_incidents[iid]
            doc["status"] = live.status.value

    return {
        "items": docs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
        "active_count": sum(1 for i in _active_incidents.values() if i.status.value != "resolved"),
    }


@router.get("/stats")
async def incident_stats(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    pipeline = [
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    by_status = {doc["_id"]: doc["count"] async for doc in db.incidents.aggregate(pipeline)}

    sev_pipeline = [
        {"$group": {"_id": "$severity", "count": {"$sum": 1}}},
    ]
    by_severity = {doc["_id"]: doc["count"] async for doc in db.incidents.aggregate(sev_pipeline)}

    active_live = sum(1 for i in _active_incidents.values() if i.status.value not in ("resolved",))

    return {
        "total": await db.incidents.count_documents({}),
        "active": active_live,
        "by_status": by_status,
        "by_severity": by_severity,
    }


@router.get("/{incident_id}")
async def get_incident(
    incident_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    if incident_id in _active_incidents:
        inc = _active_incidents[incident_id]
        return inc.model_dump()

    doc = await db.incidents.find_one({"incident_id": incident_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return doc


@router.post("/{incident_id}/resolve")
async def resolve_incident(
    incident_id: str,
    current_user: dict = Depends(require_dispatcher_or_above),
    db=Depends(get_db),
):
    now = datetime.utcnow()
    await db.incidents.update_one(
        {"incident_id": incident_id},
        {"$set": {"status": "resolved", "resolved_at": now.isoformat(), "updated_at": now.isoformat()}},
    )
    if incident_id in _active_incidents:
        from app.models.incident import IncidentStatus
        _active_incidents[incident_id].status = IncidentStatus.RESOLVED
        _active_incidents[incident_id].resolved_at = now

    logger.info("Incident resolved", incident_id=incident_id, by=current_user["username"])
    return {"message": "Incident resolved"}
