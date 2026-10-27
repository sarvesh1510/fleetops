from datetime import datetime, timedelta
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import get_current_user, require_dispatcher_or_above
from app.db.database import get_db
from app.ml.models import error_stats, ml_engine
from app.models.optimization import OptimizationTrigger
from app.optimization.engine import optimization_engine
from app.simulation.engine import simulation_engine
from app.utils.geo import ist_day_start_utc, ist_now

logger = structlog.get_logger(__name__)

# Rough operating cost used for the *estimate* shown on dashboards (INR per km driven)
COST_PER_KM_INR = 22.0
ANALYTICS_WINDOW_DAYS = 7

# ── Optimization Router ───────────────────────────────────────────────────────
opt_router = APIRouter(prefix="/optimization", tags=["optimization"])


@opt_router.post("/run")
async def trigger_optimization(current_user: dict = Depends(require_dispatcher_or_above)):
    """Manually trigger a dispatch pass over all pending orders and available vehicles."""
    run = await optimization_engine.run(trigger=OptimizationTrigger.MANUAL)
    return run.model_dump()


@opt_router.get("/runs")
async def list_optimization_runs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    trigger: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    query: dict = {}
    if trigger and trigger != "all":
        query["trigger"] = trigger
    total = await db.optimization_runs.count_documents(query)
    cursor = (db.optimization_runs.find(query, {"_id": 0}).sort("created_at", -1)
              .skip((page - 1) * page_size).limit(page_size))
    docs = await cursor.to_list(length=page_size)
    return {
        "items": docs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@opt_router.get("/runs/{run_id}")
async def get_optimization_run(
    run_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    doc = await db.optimization_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Optimization run not found")
    return doc


@opt_router.get("/stats")
async def optimization_stats(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    totals = await db.optimization_runs.aggregate([
        {"$match": {"status": "completed"}},
        {"$group": {
            "_id": None,
            "total_runs": {"$sum": 1},
            "total_assignments": {"$sum": "$assignments_changed"},
            "total_distance_saved_km": {"$sum": {"$ifNull": ["$distance_saved_km", 0]}},
            "total_time_saved_min": {"$sum": {"$ifNull": ["$time_saved_min", 0]}},
            "avg_solver_ms": {"$avg": "$solver_duration_ms"},
        }},
    ]).to_list(1)
    # Average improvement only over runs that actually compared two plans
    improvement = await db.optimization_runs.aggregate([
        {"$match": {"status": "completed", "improvement_pct": {"$type": "number"}}},
        {"$group": {"_id": None, "avg": {"$avg": "$improvement_pct"}, "n": {"$sum": 1}}},
    ]).to_list(1)
    by_trigger = {d["_id"]: d["count"] async for d in db.optimization_runs.aggregate(
        [{"$group": {"_id": "$trigger", "count": {"$sum": 1}}}])}

    t = totals[0] if totals else {}
    return {
        "total_runs": t.get("total_runs", 0),
        "total_assignments": t.get("total_assignments", 0),
        "avg_improvement_pct": round(improvement[0]["avg"], 1) if improvement else None,
        "runs_with_comparison": improvement[0]["n"] if improvement else 0,
        "total_distance_saved_km": round(t.get("total_distance_saved_km", 0.0), 1),
        "total_time_saved_min": round(t.get("total_time_saved_min", 0.0), 1),
        "avg_solver_ms": round(t["avg_solver_ms"], 1) if t.get("avg_solver_ms") is not None else None,
        "by_trigger": by_trigger,
    }


# ── Analytics Router ──────────────────────────────────────────────────────────
analytics_router = APIRouter(prefix="/analytics", tags=["analytics"])


@analytics_router.get("/overview")
async def analytics_overview(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Fleet KPIs over the last 7 days of completed orders."""
    since = datetime.utcnow() - timedelta(days=ANALYTICS_WINDOW_DAYS)

    agg = await db.orders.aggregate([
        {"$match": {"status": {"$in": ["delivered", "failed"]}, "updated_at": {"$gte": since}}},
        {"$group": {
            "_id": None,
            "delivered": {"$sum": {"$cond": [{"$eq": ["$status", "delivered"]}, 1, 0]}},
            "failed": {"$sum": {"$cond": [{"$eq": ["$status", "failed"]}, 1, 0]}},
            "on_time": {"$sum": {"$cond": [{"$and": [
                {"$eq": ["$status", "delivered"]},
                {"$lte": ["$delivered_at", {"$ifNull": ["$deadline", "$delivered_at"]}]},
            ]}, 1, 0]}},
            "total_dist": {"$sum": {"$ifNull": ["$actual_distance_km", 0]}},
            "avg_minutes": {"$avg": "$actual_duration_min"},
        }},
    ]).to_list(1)
    a = agg[0] if agg else {"delivered": 0, "failed": 0, "on_time": 0, "total_dist": 0.0, "avg_minutes": None}
    completed = a["delivered"] + a["failed"]

    eta = await db.orders.aggregate([
        {"$match": {"status": "delivered", "updated_at": {"$gte": since},
                    "predicted_eta_minutes": {"$gt": 0}, "actual_duration_min": {"$gt": 0}}},
        {"$group": {
            "_id": None,
            "n": {"$sum": 1},
            "mae": {"$avg": {"$abs": {"$subtract": ["$actual_duration_min", "$predicted_eta_minutes"]}}},
            "ape": {"$avg": {"$divide": [
                {"$abs": {"$subtract": ["$actual_duration_min", "$predicted_eta_minutes"]}},
                "$predicted_eta_minutes"]}},
        }},
    ]).to_list(1)

    vehicles = simulation_engine.get_all_vehicles()
    total_v = len(vehicles)
    active_v = sum(1 for v in vehicles if v.status.value in ("en_route", "loading", "unloading"))

    total_incidents = await db.incidents.count_documents({})
    resolved = await db.incidents.count_documents({"status": "resolved"})

    total_dist = round(a["total_dist"], 1)
    estimated_cost = round(total_dist * COST_PER_KM_INR, 0)
    return {
        "window_days": ANALYTICS_WINDOW_DAYS,
        "on_time_rate": round(a["on_time"] / completed * 100, 1) if completed else None,
        "total_deliveries": completed,
        "delivered": a["delivered"],
        "failed": a["failed"],
        "avg_route_distance_km": round(total_dist / a["delivered"], 1) if a["delivered"] else None,
        "avg_delivery_minutes": round(a["avg_minutes"], 1) if a["avg_minutes"] else None,
        "total_distance_km": total_dist,
        "fleet_utilization_pct": round(active_v / total_v * 100, 1) if total_v else 0.0,
        "active_vehicles": active_v,
        "total_vehicles": total_v,
        "total_incidents": total_incidents,
        "resolved_incidents": resolved,
        "eta_samples": eta[0]["n"] if eta else 0,
        "eta_mae_min": round(eta[0]["mae"], 1) if eta else None,
        "eta_accuracy_pct": round(max(0.0, 1 - eta[0]["ape"]) * 100, 1) if eta else None,
        # An estimate: distance driven x flat per-km operating cost
        "estimated_cost_inr": estimated_cost,
        "cost_per_delivery_inr": round(estimated_cost / a["delivered"], 0) if a["delivered"] else None,
        "cost_per_km_inr": COST_PER_KM_INR,
    }


@analytics_router.get("/deliveries-per-hour")
async def deliveries_per_hour(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Deliveries completed per hour today (India time)."""
    start_of_day = ist_day_start_utc()
    results = await db.orders.aggregate([
        {"$match": {"status": "delivered", "delivered_at": {"$gte": start_of_day}}},
        {"$group": {
            "_id": {"$hour": {"date": "$delivered_at", "timezone": "Asia/Kolkata"}},
            "count": {"$sum": 1},
            "late": {"$sum": {"$cond": [
                {"$gt": ["$delivered_at", {"$ifNull": ["$deadline", "$delivered_at"]}]}, 1, 0]}},
        }},
    ]).to_list(24)
    by_hour = {r["_id"]: r for r in results}
    current_hour = ist_now().hour
    return [
        {
            "hour": f"{h:02d}:00",
            "deliveries": by_hour.get(h, {}).get("count", 0),
            "late": by_hour.get(h, {}).get("late", 0),
            "is_future": h > current_hour,
        }
        for h in range(24)
    ]


@analytics_router.get("/eta-performance")
async def eta_performance(
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Predicted vs actual delivery time for the most recent delivered orders (real recorded values)."""
    cursor = db.orders.find(
        {"status": "delivered", "predicted_eta_minutes": {"$gt": 0}, "actual_duration_min": {"$gt": 0}},
        {"_id": 0, "reference": 1, "predicted_eta_minutes": 1, "actual_duration_min": 1, "delivered_at": 1},
    ).sort("delivered_at", -1).limit(limit)
    docs = await cursor.to_list(limit)
    docs.reverse()  # oldest -> newest for charting
    return [
        {
            "order_ref": d.get("reference", ""),
            "predicted_min": round(d["predicted_eta_minutes"], 1),
            "actual_min": round(d["actual_duration_min"], 1),
            "variance_pct": round((d["actual_duration_min"] - d["predicted_eta_minutes"])
                                  / d["predicted_eta_minutes"] * 100, 1),
            "delivered_at": d.get("delivered_at"),
        }
        for d in docs
    ]


# ── ML/Predictions Router ─────────────────────────────────────────────────────
ml_router = APIRouter(prefix="/predictions", tags=["predictions"])


@ml_router.get("/status")
async def ml_status(current_user: dict = Depends(get_current_user)):
    return ml_engine.get_status()


@ml_router.post("/eta")
async def predict_eta(
    distance_km: float = Query(10.0, gt=0, le=200),
    speed_kmh: float = Query(28.0, gt=5, le=120, description="Free-flow speed of the vehicle"),
    n_stops: int = Query(2, ge=1, le=30),
    traffic_factor: float = Query(1.0, ge=0.5, le=4.0, description="Congestion multiplier (1 = free flow)"),
    current_user: dict = Depends(get_current_user),
):
    if not ml_engine.eta_predictor.is_trained:
        raise HTTPException(status_code=503, detail="ETA model is still training - try again in a few seconds")
    now = ist_now()
    predicted, confidence = ml_engine.eta_predictor.predict(
        distance_km=distance_km,
        speed_kmh=speed_kmh,
        hour=now.hour + now.minute / 60.0,
        day_of_week=now.weekday(),
        n_stops=n_stops,
        traffic_factor=traffic_factor,
    )
    spread = 1.28 * (ml_engine.eta_predictor.rmse or ml_engine.eta_predictor.mae or 0.0)
    return {
        "distance_km": distance_km,
        "speed_kmh": speed_kmh,
        "n_stops": n_stops,
        "traffic_factor": traffic_factor,
        "predicted_duration_minutes": predicted,
        "range_min": round(max(predicted - spread, 1.0), 1),
        "range_max": round(predicted + spread, 1),
        "confidence_pct": confidence,
        "model": "eta_xgboost_v3",
    }


def _improvement_pct(baseline_mae: Optional[float], ml_mae: Optional[float]) -> Optional[float]:
    """How much lower the ML model's mean error is than a baseline's (positive = ML is better)."""
    if not baseline_mae or ml_mae is None:
        return None
    return round((baseline_mae - ml_mae) / baseline_mae * 100, 1)


@ml_router.get("/eta-evaluation")
async def eta_evaluation(
    limit: int = Query(200, ge=10, le=1000, description="Most recent delivered orders to score"),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    How good is the ETA model? Two views of the same question:

    * held_out - the model vs two simple estimates on unseen synthetic trips (set aside before training)
    * live     - the estimates made when orders were assigned vs how long those orders really took in
                 the simulation (only orders assigned after the ML model came online have all three)
    """
    eta = ml_engine.eta_predictor
    held_out = None
    if eta.is_trained and eta.evaluation:
        methods = eta.evaluation["methods"]
        held_out = {
            "samples": eta.evaluation["samples"],
            "methods": methods,
            "ml_vs_formula_pct": _improvement_pct(methods["formula"]["mae"], methods["ml"]["mae"]),
            "ml_vs_fixed_speed_pct": _improvement_pct(methods["fixed_speed"]["mae"], methods["ml"]["mae"]),
        }

    docs = await db.orders.find(
        {"status": "delivered", "ml_eta_minutes": {"$gt": 0}, "formula_eta_minutes": {"$gt": 0},
         "fixed_speed_eta_minutes": {"$gt": 0}, "actual_duration_min": {"$gt": 0}},
        {"_id": 0, "reference": 1, "ml_eta_minutes": 1, "formula_eta_minutes": 1,
         "fixed_speed_eta_minutes": 1, "actual_duration_min": 1, "delivered_at": 1},
    ).sort("delivered_at", -1).limit(limit).to_list(limit)
    docs.reverse()  # oldest -> newest for charting

    live_methods = None
    ml_vs_formula = ml_vs_fixed = None
    if docs:
        actual = [d["actual_duration_min"] for d in docs]
        live_methods = {
            "ml": error_stats(actual, [d["ml_eta_minutes"] for d in docs]),
            "formula": error_stats(actual, [d["formula_eta_minutes"] for d in docs]),
            "fixed_speed": error_stats(actual, [d["fixed_speed_eta_minutes"] for d in docs]),
        }
        ml_vs_formula = _improvement_pct(live_methods["formula"]["mae"], live_methods["ml"]["mae"])
        ml_vs_fixed = _improvement_pct(live_methods["fixed_speed"]["mae"], live_methods["ml"]["mae"])

    return {
        "model_ready": eta.is_trained,
        "held_out": held_out,
        "live": {
            "samples": len(docs),
            "methods": live_methods,
            "ml_vs_formula_pct": ml_vs_formula,
            "ml_vs_fixed_speed_pct": ml_vs_fixed,
            "points": [
                {
                    "order_ref": d.get("reference", ""),
                    "ml_min": round(d["ml_eta_minutes"], 1),
                    "formula_min": round(d["formula_eta_minutes"], 1),
                    "actual_min": round(d["actual_duration_min"], 1),
                    "delivered_at": d.get("delivered_at"),
                }
                for d in docs
            ],
        },
    }


@ml_router.get("/demand")
async def predict_demand(current_user: dict = Depends(get_current_user)):
    if not ml_engine.demand_forecaster.is_trained:
        raise HTTPException(status_code=503, detail="Demand model is still training - try again in a few seconds")
    now = ist_now()
    forecasts = ml_engine.demand_forecaster.predict_all_zones(now.hour, now.weekday())
    return {
        "hour": now.hour,
        "day_of_week": now.weekday(),
        "forecasts": forecasts,
        "model": "demand_gbm_v2",
    }


@ml_router.post("/anomaly")
async def detect_anomaly(
    vehicle_id: str,
    speed: float = 35.0,
    fuel_level: float = 60.0,
    stop_duration_minutes: float = 5.0,
    route_deviation_km: float = 0.5,
    engine_temp: float = 90.0,
    current_user: dict = Depends(get_current_user),
):
    score, is_anomaly, reason = ml_engine.anomaly_detector.score_vehicle(
        speed=speed,
        fuel_level=fuel_level,
        stop_duration_minutes=stop_duration_minutes,
        route_deviation_km=route_deviation_km,
        engine_temp=engine_temp,
    )
    return {
        "vehicle_id": vehicle_id,
        "anomaly_score": score,
        "is_anomaly": is_anomaly,
        "reason": reason,
        "inputs": {
            "speed": speed,
            "fuel_level": fuel_level,
            "stop_duration_minutes": stop_duration_minutes,
            "route_deviation_km": route_deviation_km,
            "engine_temp": engine_temp,
        },
    }
