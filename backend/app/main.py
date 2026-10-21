"""
FleetOps - Real-Time Autonomous Logistics Platform
FastAPI application entry point.
"""
from contextlib import asynccontextmanager
from datetime import datetime
import asyncio

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.core.logging import configure_logging
from app.db.database import close_db, get_db, init_db
from app.ml.models import ml_engine
from app.models.incident import IncidentStatus
from app.models.optimization import OptimizationTrigger
from app.models.vehicle import Vehicle
from app.optimization.engine import optimization_engine
from app.routers.auth import router as auth_router
from app.routers.incidents import router as incidents_router
from app.routers.optimization import analytics_router, ml_router, opt_router
from app.routers.orders import router as orders_router
from app.routers.simulation import sim_router, ws_router
from app.routers.vehicles import router as vehicles_router
from app.simulation.engine import simulation_engine
from app.simulation.seeder import seed_database
from app.websocket.broadcaster import WSEventType, broadcaster

configure_logging()
logger = structlog.get_logger(__name__)

TERMINAL_ORDER_STATES = ["delivered", "failed", "cancelled"]
INITIAL_ORDER_COUNT = 24


async def _close_stale_incidents(db) -> int:
    """Incidents left open by a previous run can no longer be acted on - close them."""
    now = datetime.utcnow()
    res = await db.incidents.update_many(
        {"status": {"$ne": IncidentStatus.RESOLVED.value}},
        {
            "$set": {
                "status": IncidentStatus.RESOLVED.value,
                "resolved_at": now,
                "updated_at": now,
                "resolution_notes": "Closed automatically when the platform restarted",
            },
            "$push": {"timeline": {
                "timestamp": now, "event": "Incident closed on platform restart",
                "details": None, "actor": "system", "data": None,
            }},
        },
    )
    return res.modified_count


async def _load_vehicles(db) -> list:
    vehicles = []
    for doc in await db.vehicles.find({}, {"_id": 0}).to_list(length=500):
        try:
            vehicles.append(Vehicle.model_validate(doc))
        except Exception as e:
            logger.warning("Failed to load vehicle", vehicle_id=doc.get("vehicle_id"), error=str(e))
    return vehicles


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    logger.info("FleetOps starting", version=settings.APP_VERSION, env=settings.ENVIRONMENT)

    await init_db()
    db = get_db()

    await seed_database(db)
    closed = await _close_stale_incidents(db)
    if closed:
        logger.info("Closed stale incidents from previous run", count=closed)

    vehicles = await _load_vehicles(db)
    simulation_engine.set_db(db)
    simulation_engine.load_vehicles(vehicles)

    open_orders = await db.orders.find(
        {"status": {"$nin": TERMINAL_ORDER_STATES}}, {"_id": 0}).to_list(length=2000)
    await simulation_engine.restore_orders(open_orders)

    optimization_engine.set_db(db)
    optimization_engine.set_simulation(simulation_engine)

    async def dispatcher(trigger: OptimizationTrigger, **kwargs):
        return await optimization_engine.dispatch(trigger, **kwargs)

    simulation_engine.register_dispatcher(dispatcher)

    async def handle_incident(incident, is_new: bool):
        try:
            await db.incidents.replace_one(
                {"incident_id": incident.incident_id}, incident.model_dump(), upsert=True)
        except Exception:
            logger.error("Failed to persist incident", incident_id=incident.incident_id, exc_info=True)
        if is_new:
            event = WSEventType.INCIDENT_CREATED
        elif incident.status == IncidentStatus.RESOLVED:
            event = WSEventType.INCIDENT_RESOLVED
        else:
            event = WSEventType.INCIDENT_UPDATED
        await broadcaster.broadcast(event, {
            "incident_id": incident.incident_id,
            "type": incident.type.value,
            "severity": incident.severity.value,
            "status": incident.status.value,
            "title": incident.title,
            "description": incident.description,
            "vehicle_id": incident.vehicle_id,
            "vehicle_name": incident.vehicle_name,
        })

    simulation_engine.register_incident_callback(handle_incident)

    # ML training is not needed for core operations - train in the background.
    asyncio.create_task(ml_engine.train_all())

    await simulation_engine.start()
    if len(simulation_engine.get_all_orders()) < 8:
        await simulation_engine.seed_initial_orders(INITIAL_ORDER_COUNT)

    logger.info("FleetOps ready", vehicles=len(vehicles), open_orders=len(simulation_engine.get_all_orders()))

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("FleetOps shutting down")
    await simulation_engine.stop()
    await close_db()


app = FastAPI(
    title="FleetOps API",
    version=settings.APP_VERSION,
    description="Real-Time Autonomous Logistics & Fleet Optimization Platform",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception", path=str(request.url), error=str(exc), exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}


@app.get("/ready", tags=["health"])
async def ready():
    try:
        db = get_db()
        await db.command("ping")
        return {"status": "ready", "db": "connected", "sim": simulation_engine.running}
    except Exception as e:
        return JSONResponse(status_code=503, content={"status": "not ready", "error": str(e)})


PREFIX = settings.API_PREFIX
app.include_router(auth_router,      prefix=PREFIX)
app.include_router(vehicles_router,  prefix=PREFIX)
app.include_router(orders_router,    prefix=PREFIX)
app.include_router(incidents_router, prefix=PREFIX)
app.include_router(opt_router,       prefix=PREFIX)
app.include_router(analytics_router, prefix=PREFIX)
app.include_router(ml_router,        prefix=PREFIX)
app.include_router(sim_router,       prefix=PREFIX)
app.include_router(ws_router)
