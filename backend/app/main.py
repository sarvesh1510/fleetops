"""
FleetOps — Real-Time Autonomous Logistics Platform
FastAPI application entry point.
"""
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import structlog

from app.config import settings
from app.core.logging import configure_logging
from app.db.database import init_db, close_db, get_db
from app.simulation.engine import simulation_engine
from app.simulation.seeder import seed_database
from app.optimization.engine import optimization_engine, OptimizationTrigger
from app.ml.models import ml_engine
from app.routers.auth import router as auth_router
from app.routers.vehicles import router as vehicles_router
from app.routers.orders import router as orders_router
from app.routers.incidents import router as incidents_router
from app.routers.optimization import opt_router, analytics_router, ml_router
from app.routers.simulation import sim_router, ws_router

configure_logging()
logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    logger.info("FleetOps starting", version=settings.APP_VERSION, env=settings.ENVIRONMENT)

    await init_db()
    db = get_db()

    # Seed data
    result = await seed_database(db)

    # Load simulation state from seeded vehicles/orders
    vehicles_docs = await db.vehicles.find({}, {"_id": 0}).to_list(length=200)
    orders_docs = await db.orders.find({}, {"_id": 0}).to_list(length=500)

    from app.models.vehicle import Vehicle, GeoPoint, VehicleHealth, VehicleStatus, VehicleType, FuelType
    from app.models.order import Order, OrderStatus, OrderPriority, AddressPoint

    vehicles = []
    for doc in vehicles_docs:
        try:
            loc = doc.get("location", {})
            health_data = doc.get("health", {})
            v = Vehicle(
                vehicle_id=doc["vehicle_id"],
                name=doc["name"],
                type=VehicleType(doc.get("type", "van")),
                fuel_type=FuelType(doc.get("fuel_type", "diesel")),
                status=VehicleStatus(doc.get("status", "available")),
                driver_id=doc.get("driver_id"),
                location=GeoPoint(coordinates=loc.get("coordinates", [72.87, 19.07])),
                heading=doc.get("heading", 0),
                speed=doc.get("speed", 0),
                max_capacity_kg=doc.get("max_capacity_kg", 1000),
                current_load_kg=doc.get("current_load_kg", 0),
                fuel_level=doc.get("fuel_level", 80),
                fuel_range_km=doc.get("fuel_range_km", 300),
                health=VehicleHealth(
                    engine_temp=health_data.get("engine_temp", 90),
                    tire_pressure=health_data.get("tire_pressure", 100),
                    brake_health=health_data.get("brake_health", 100),
                    transmission_health=health_data.get("transmission_health", 100),
                    overall_score=health_data.get("overall_score", 95),
                ),
                odometer_km=doc.get("odometer_km", 0),
            )
            vehicles.append(v)
        except Exception as e:
            logger.warning("Failed to load vehicle", vehicle_id=doc.get("vehicle_id"), error=str(e))

    simulation_engine.load_vehicles(vehicles)
    simulation_engine.set_db(db)

    # Connect optimization engine to simulation
    optimization_engine.set_db(db)
    optimization_engine.set_simulation(simulation_engine)

    # Register incident callback
    async def handle_incident(incident):
        from app.routers.incidents import register_incident
        register_incident(incident)
        try:
            await db.incidents.insert_one(incident.model_dump())
        except Exception:
            pass
        from app.websocket.broadcaster import broadcaster, WSEventType
        await broadcaster.broadcast(WSEventType.INCIDENT_CREATED, {
            "incident_id": incident.incident_id,
            "type": incident.type.value,
            "severity": incident.severity.value,
            "title": incident.title,
            "vehicle_id": incident.vehicle_id,
        })

    simulation_engine.register_incident_callback(handle_incident)

    # Train ML models
    await ml_engine.train_all()

    # Start simulation
    await simulation_engine.start()

    # Periodic optimization loop
    async def optimization_loop():
        while True:
            await asyncio.sleep(settings.OPTIMIZATION_INTERVAL_SECONDS / max(simulation_engine.speed, 1))
            if simulation_engine.running and not simulation_engine.paused:
                try:
                    await optimization_engine.run(trigger=OptimizationTrigger.SCHEDULED)
                except Exception as e:
                    logger.error("Optimization loop error", error=str(e))

    asyncio.create_task(optimization_loop())
    logger.info("FleetOps ready", vehicles=len(vehicles))

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

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global error handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception", path=str(request.url), error=str(exc), exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# Health endpoints
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

# Register routers
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
