"""
Machine Learning Module

All models are trained at startup on synthetic data. The ETA model is trained on trips
generated with the simulator's own rules (speeds, rush hours, stop handling), so its
numbers describe how well it learned that simulated world, not real-world accuracy.

Model 1: ETA Prediction (XGBoost regression, monotone-constrained)
  - Inputs: distance, free-flow speed, time of day, stops, vehicle type, traffic, sim speed
  - Output: minutes from order assignment to delivery
  - Used by the simulation engine to quote the ETA of every newly assigned order
  - Metric: MAE, RMSE on held-out trips, next to a simple formula and a fixed-speed guess

Model 2: Demand Forecast (gradient boosting)
  - Inputs: hour, day_of_week, zone
  - Output: expected order count per zone per hour
  - Metric: MAE (on a held-out split)

Model 3: Anomaly Detection (Isolation Forest)
  - Inputs: speed, fuel_consumption_rate, stop_duration, route_deviation, engine temp
  - Output: anomaly_score (lower = more anomalous) and a flag
"""

import random
import warnings
import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import structlog

from app.simulation.profile import (
    BASE_SPEED_KMH, DELIVERY_HANDLING_SEC, PICKUP_HANDLING_SEC, ROAD_CIRCUITY, TRAFFIC_TABLE,
    TYPE_SPEED_FACTOR, VEHICLE_TYPES, fixed_speed_eta_minutes, formula_eta_minutes, region_index,
    handling_minutes, trip_window_hours, typical_traffic_ahead,
)
from app.utils.geo import DELHI, MUMBAI

warnings.filterwarnings("ignore")

try:
    import xgboost as xgb
    XGBOOST_AVAILABLE = True
except ImportError:
    from sklearn.ensemble import GradientBoostingRegressor
    XGBOOST_AVAILABLE = False

logger = structlog.get_logger(__name__)



def error_stats(actual, predicted) -> Dict[str, float]:
    """Mean absolute error and root-mean-square error, in the unit of the inputs (minutes)."""
    err = np.asarray(predicted, dtype=float) - np.asarray(actual, dtype=float)
    return {
        "mae": round(float(np.mean(np.abs(err))), 2),
        "rmse": round(float(np.sqrt(np.mean(err ** 2))), 2),
    }


class ETAPredictor:
    """
    Predicts how long an order takes from assignment to delivery (drive to the pickup,
    load, drive to the customer, unload).

    How it works (in plain terms): the simple formula is
        minutes = distance / (free-flow speed / congestion) + handling time
    and the only thing it gets wrong is `congestion`, because it uses the reading from the
    moment of assignment. The XGBoost model's job is to predict the congestion the trip will
    actually meet on average - e.g. higher when rush hour starts part-way through the trip.
    That prediction is then dropped into the same formula.

    Trained on trips generated with the simulator's own rules (see app/simulation/profile.py):
    regional speeds, vehicle-type speeds, congestion by IST hour, handling time at stops.
    Each training trip is "driven" in 30-second steps, so traffic really does change part-way
    through, and the recorded congestion is whatever the trip actually experienced.

    Inputs: congestion now (`traffic_factor`), typical congestion over the time window the trip
    will occupy (`traffic_ahead`), the time of day and the length of that window. Distance,
    speed and stops stay in the formula, so more distance, more stops or a slower vehicle can
    never shorten the ETA, and the congestion estimate is constrained so that more traffic now
    never lowers it.

    `hour_of_day` is fractional IST time (10.5 = 10:30). `sim_speed` is the simulation speed
    multiplier: at 10x a trip lasts a tenth of the wall-clock time, so the traffic profile
    changes less during it. Day of week, vehicle type and load do not change travel time in the
    simulated world, so they are not model inputs.
    """

    # Simulation speeds the live system can run at, with how often each is seen in training.
    SIM_SPEEDS = (1.0, 2.0, 5.0, 10.0)
    SIM_SPEED_WEIGHTS = (0.5, 0.2, 0.15, 0.15)

    def __init__(self) -> None:
        self.model = None
        self.is_trained = False
        self.mae: Optional[float] = None
        self.rmse: Optional[float] = None
        # Same held-out trips scored three ways: ML model, simple formula, fixed-speed guess
        self.evaluation: Optional[Dict] = None
        self.feature_names = [
            "traffic_factor", "traffic_ahead", "hour_of_day", "window_hours",
        ]
        # +1 = the predicted congestion must not fall as the feature grows
        self.monotone_constraints = (1, 1, 0, 0)

    def _generate_training_data(self, n_samples: int = 8000) -> pd.DataFrame:
        """Drive `n_samples` simulated trips in 30-second steps and record how long each took."""
        rng = np.random.default_rng(42)
        n = n_samples
        dt = 0.5                                        # minutes per step

        delhi = rng.random(n) < 0.4
        region_idx = delhi.astype(int)
        vtype = rng.integers(0, len(VEHICLE_TYPES), n)
        type_factor = np.array([TYPE_SPEED_FACTOR[t] for t in VEHICLE_TYPES])[vtype]
        base_speed = np.where(delhi, BASE_SPEED_KMH[DELHI], BASE_SPEED_KMH[MUMBAI])
        free_flow = base_speed * type_factor

        # Trip: vehicle -> pickup -> customer. Distances follow what the simulation's orders look
        # like (zone-to-zone inside one region: mostly 8-30 km, up to ~50 km). The app only knows
        # an *estimated* road distance; the road actually driven differs a little from it.
        pickup_km = np.clip(rng.gamma(2.0, 2.5, n), 0.3, 25.0)
        trip_km = np.where(rng.random(n) < 0.06,
                           rng.uniform(0.5, 4.0, n),
                           np.clip(rng.gamma(3.0, 6.2, n), 4.0, 52.0))
        est_km = (pickup_km + trip_km) * ROAD_CIRCUITY
        road_noise = rng.lognormal(0.0, 0.08, n)
        rem1 = pickup_km * ROAD_CIRCUITY * road_noise
        rem2 = trip_km * ROAD_CIRCUITY * road_noise

        n_stops = rng.choice([1, 2, 3, 4, 5, 6, 8], size=n, p=[0.05, 0.55, 0.12, 0.10, 0.08, 0.05, 0.05])
        extra_handling = (n_stops - 1) * DELIVERY_HANDLING_SEC / 60
        start_hour = rng.uniform(0.0, 24.0, n)
        day = rng.integers(0, 7, n)
        weight_norm = rng.uniform(0.0, 1.0, n)
        sim_speed = rng.choice(self.SIM_SPEEDS, size=n, p=self.SIM_SPEED_WEIGHTS)

        # Congestion by region and hour comes straight from the simulator's own profile.
        def traffic_at(t_min: np.ndarray) -> np.ndarray:
            wall_hour = (start_hour + t_min / (60.0 * sim_speed)) % 24.0
            base = TRAFFIC_TABLE[region_idx, wall_hour.astype(int)] + rng.normal(0, 0.02, n)
            return np.clip(base, 0.7, 2.6)

        traffic_now = traffic_at(np.zeros(n))
        window_hours = trip_window_hours(region_idx, start_hour, est_km, free_flow, n_stops, sim_speed)
        traffic_ahead = typical_traffic_ahead(region_idx, start_hour, window_hours)

        t = np.zeros(n)
        phase = np.zeros(n, dtype=int)                  # 0 drive to pickup, 1 load, 2 drive to customer, 3 unload, 4 done
        hold = np.zeros(n)                              # handling minutes left in phases 1 and 3
        noise = rng.uniform(0.85, 1.15, n)              # the vehicle's speed wobble
        for _ in range(3000):
            active = phase < 4
            if not active.any():
                break
            noise = np.clip(noise + rng.normal(0, 0.055, n), 0.85, 1.15)
            traffic = traffic_at(t)
            speed = np.maximum(4.0, np.maximum(5.0, free_flow / np.maximum(traffic, 0.6)) * noise)
            km_step = speed * dt / 60.0
            t = np.where(active, t + dt, t)

            d1 = active & (phase == 0)
            d2 = active & (phase == 2)
            rem1 = np.where(d1, rem1 - km_step, rem1)
            rem2 = np.where(d2, rem2 - km_step, rem2)
            hold = np.where(active & ((phase == 1) | (phase == 3)), hold - dt, hold)

            # Phase changes. Time not used in the step where a phase ends is handed back.
            end0 = d1 & (rem1 <= 0)
            t = np.where(end0, t + rem1 / speed * 60.0, t)
            phase = np.where(end0, 1, phase)
            hold = np.where(end0, PICKUP_HANDLING_SEC / 60, hold)

            end1 = active & (phase == 1) & ~end0 & (hold <= 0)
            t = np.where(end1, t + hold, t)
            phase = np.where(end1, 2, phase)

            end2 = d2 & (rem2 <= 0)
            t = np.where(end2, t + rem2 / speed * 60.0, t)
            phase = np.where(end2, 3, phase)
            hold = np.where(end2, extra_handling, hold)

            end3 = active & (phase == 3) & ~end2 & (hold <= 0)
            t = np.where(end3, t + hold, t)
            phase = np.where(end3, 4, phase)
            # No further stops to handle: done as soon as the customer is reached
            done_now = end2 & (extra_handling <= 0)
            phase = np.where(done_now, 4, phase)

        duration = np.maximum(t, 1.0)
        # The congestion the trip really met, by inverting  minutes = km / (speed / congestion) * 60 + handling
        congestion_met = (duration - handling_minutes(n_stops)) * free_flow / (60.0 * est_km)
        return pd.DataFrame({
            "distance_km": est_km,
            "free_flow_speed_kmh": free_flow,
            "n_stops": n_stops,
            "traffic_factor": traffic_now,
            "traffic_ahead": traffic_ahead,
            "hour_of_day": start_hour,
            "window_hours": window_hours,
            "duration_minutes": duration,
            "congestion_met": np.clip(congestion_met, 0.3, 5.0),
        })

    def _congestion_to_minutes(self, df: pd.DataFrame, congestion) -> np.ndarray:
        return formula_eta_minutes(df["distance_km"].to_numpy(), df["free_flow_speed_kmh"].to_numpy(),
                                   np.clip(congestion, 0.5, 4.0), df["n_stops"].to_numpy())

    def train(self) -> Dict[str, float]:
        logger.info("Training ETA prediction model")
        df = self._generate_training_data()

        train_idx, test_idx = train_test_split(np.arange(len(df)), test_size=0.2, random_state=42)
        train_df, test_df = df.iloc[train_idx], df.iloc[test_idx]

        if XGBOOST_AVAILABLE:
            self.model = xgb.XGBRegressor(
                n_estimators=250,
                max_depth=4,
                learning_rate=0.06,
                min_child_weight=5,
                subsample=0.8,
                colsample_bytree=1.0,
                monotone_constraints=self.monotone_constraints,
                n_jobs=4,                      # small data: more threads only add overhead
                random_state=42,
                verbosity=0,
            )
        else:
            from sklearn.ensemble import GradientBoostingRegressor
            self.model = GradientBoostingRegressor(n_estimators=150, max_depth=4, random_state=42)

        self.model.fit(train_df[self.feature_names], train_df["congestion_met"])

        # Score on trips the model never saw: predicted congestion -> minutes, against the real time
        actual = test_df["duration_minutes"].to_numpy()
        preds = self._congestion_to_minutes(test_df, self.model.predict(test_df[self.feature_names]))

        self.mae = float(mean_absolute_error(actual, preds))
        self.rmse = float(np.sqrt(np.mean((preds - actual) ** 2)))
        self.is_trained = True

        # The same unseen trips, estimated the two simple ways the ML model has to beat.
        formula = formula_eta_minutes(test_df["distance_km"].to_numpy(), test_df["free_flow_speed_kmh"].to_numpy(),
                                      test_df["traffic_factor"].to_numpy(), test_df["n_stops"].to_numpy())
        fixed = fixed_speed_eta_minutes(test_df["distance_km"].to_numpy(), test_df["n_stops"].to_numpy())
        self.evaluation = {
            "samples": int(len(actual)),
            "methods": {
                "ml": error_stats(actual, preds),
                "formula": error_stats(actual, formula),
                "fixed_speed": error_stats(actual, fixed),
            },
        }

        metrics = {"mae_minutes": round(self.mae, 2), "rmse_minutes": round(self.rmse, 2)}
        logger.info("ETA model trained", **metrics, formula_mae=self.evaluation["methods"]["formula"]["mae"])
        return metrics

    def predict(
        self,
        distance_km: float,
        speed_kmh: float,
        hour: float,
        day_of_week: int = 0,
        n_stops: int = 1,
        vehicle_type_enc: int = 0,
        traffic_factor: float = 1.0,
        weight_kg_norm: float = 0.5,
        sim_speed: float = 1.0,
        region: str = MUMBAI,
    ) -> Tuple[float, float]:
        """
        Returns (predicted_minutes, confidence_pct).
        `speed_kmh` is the vehicle's free-flow speed; congestion right now goes in `traffic_factor`.
        `hour` is IST time as a fraction (10.5 = 10:30). `day_of_week`, `vehicle_type_enc` and
        `weight_kg_norm` are accepted for API compatibility but do not change travel time in the
        simulated world, so the model ignores them.
        """
        if not self.is_trained or self.model is None:
            # Not trained yet: fall back to the simple formula
            return round(formula_eta_minutes(distance_km, speed_kmh, traffic_factor, n_stops), 1), 70.0

        ridx = region_index(region)
        window = trip_window_hours(ridx, hour, distance_km, speed_kmh, n_stops, max(sim_speed, 0.1))
        features = pd.DataFrame([[
            traffic_factor, typical_traffic_ahead(ridx, hour, window), hour, window,
        ]], columns=self.feature_names)
        congestion = float(np.clip(self.model.predict(features)[0], 0.5, 4.0))
        pred = formula_eta_minutes(distance_km, speed_kmh, congestion, n_stops)
        # Confidence based on training MAE relative to prediction
        confidence = max(50.0, min(98.0, 100 - (self.mae / max(pred, 1)) * 50))
        return round(max(pred, 1.0), 1), round(confidence, 1)


class DemandForecaster:
    """
    Predicts order volume per zone per hour (orders/hour) from cyclic time features.
    Each zone has its own base demand level (commercial hubs are busier), so the
    forecast genuinely differs by zone as well as by hour and weekday.
    """

    def __init__(self) -> None:
        self.model = None
        self.is_trained = False
        self.mae: Optional[float] = None
        self.zones = [
            "Bandra", "Andheri", "Kurla", "Thane", "Navi Mumbai",
            "Connaught Place", "Karol Bagh", "Noida Sector 18",
            "Gurgaon DLF", "Faridabad",
        ]
        self.zone_enc = {z: i for i, z in enumerate(self.zones)}
        # Relative demand level per zone (orders/hour at the baseline hour factor)
        self.zone_base = {
            "Bandra": 2.6, "Andheri": 3.0, "Kurla": 2.2, "Thane": 1.8, "Navi Mumbai": 1.6,
            "Connaught Place": 2.8, "Karol Bagh": 2.0, "Noida Sector 18": 2.4,
            "Gurgaon DLF": 2.7, "Faridabad": 1.2,
        }

    def _generate_training_data(self, n_samples: int = 6000) -> pd.DataFrame:
        rng = np.random.default_rng(123)
        rows = []
        for _ in range(n_samples):
            hour = int(rng.integers(0, 24))
            day = int(rng.integers(0, 7))
            zone_idx = int(rng.integers(0, len(self.zones)))
            zone_demand_base = self.zone_base[self.zones[zone_idx]]

            # Demand peaks: morning (9-11) and afternoon (14-17)
            hour_factor = 1.0
            if 9 <= hour <= 11:
                hour_factor = 2.5
            elif 14 <= hour <= 17:
                hour_factor = 2.0
            elif 18 <= hour <= 21:
                hour_factor = 1.5
            elif hour < 7 or hour > 22:
                hour_factor = 0.2

            if day >= 5:
                hour_factor *= 0.7

            demand = zone_demand_base * hour_factor + rng.normal(0, 0.3)
            demand = max(0.0, demand)

            rows.append({
                "hour_sin": np.sin(2 * np.pi * hour / 24),
                "hour_cos": np.cos(2 * np.pi * hour / 24),
                "day_sin": np.sin(2 * np.pi * day / 7),
                "day_cos": np.cos(2 * np.pi * day / 7),
                "zone_idx": zone_idx,
                "demand": demand,
            })
        return pd.DataFrame(rows)

    def train(self) -> Dict[str, float]:
        logger.info("Training demand forecast model")
        from sklearn.ensemble import GradientBoostingRegressor
        df = self._generate_training_data()

        feature_cols = ["hour_sin", "hour_cos", "day_sin", "day_cos", "zone_idx"]
        X = df[feature_cols]
        y = df["demand"]
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

        self.model = GradientBoostingRegressor(n_estimators=100, max_depth=3, random_state=42)
        self.model.fit(X_train, y_train)
        preds = self.model.predict(X_test)
        self.mae = float(mean_absolute_error(y_test, preds))
        self.is_trained = True

        metrics = {"mae_orders": round(self.mae, 3)}
        logger.info("Demand model trained", **metrics)
        return metrics

    def predict_zone_demand(self, zone: str, hour: int, day: int) -> Tuple[float, float]:
        """Returns (predicted_demand, confidence_pct)."""
        if not self.is_trained or self.model is None:
            return 2.0, 60.0

        zone_idx = self.zone_enc.get(zone, 0)
        features = np.array([[
            np.sin(2 * np.pi * hour / 24),
            np.cos(2 * np.pi * hour / 24),
            np.sin(2 * np.pi * day / 7),
            np.cos(2 * np.pi * day / 7),
            zone_idx,
        ]])
        pred = float(max(0.0, self.model.predict(features)[0]))
        confidence = max(55.0, min(92.0, 90 - self.mae * 20))
        return round(pred, 2), round(confidence, 1)

    def predict_all_zones(self, hour: int, day: int) -> List[Dict]:
        results = []
        for zone in self.zones:
            demand, confidence = self.predict_zone_demand(zone, hour, day)
            results.append({
                "zone": zone,
                "predicted_orders": demand,
                "confidence": confidence,
            })
        return results


class AnomalyDetector:
    """
    Isolation Forest anomaly detection on vehicle telemetry.
    Flags unusual behavior: prolonged stops, fuel anomalies, route deviations.
    """

    def __init__(self) -> None:
        self.model: Optional[IsolationForest] = None
        self.is_trained = False
        self.contamination = 0.05  # expected ~5% anomaly rate
        self.feature_names = [
            "speed_norm", "fuel_burn_rate", "stop_duration_norm",
            "deviation_km", "engine_temp_norm",
        ]

    def _generate_training_data(self, n_samples: int = 4000) -> pd.DataFrame:
        np.random.seed(999)
        rows = []
        for i in range(n_samples):
            is_anomaly = i < int(n_samples * self.contamination)
            if is_anomaly:
                speed_norm = np.random.choice([
                    np.random.uniform(-3, -1),  # stopped unexpectedly
                    np.random.uniform(2.5, 5),   # excessive speed
                ])
                fuel_burn_rate = np.random.uniform(2.0, 5.0)
                stop_duration_norm = np.random.uniform(3, 8)
                deviation_km = np.random.uniform(3, 10)
                engine_temp_norm = np.random.uniform(2.5, 5)
            else:
                speed_norm = np.random.normal(0, 1)
                fuel_burn_rate = np.random.normal(1.0, 0.2)
                stop_duration_norm = np.random.normal(0, 1)
                deviation_km = np.random.uniform(0, 1.5)
                engine_temp_norm = np.random.normal(0, 1)

            rows.append({
                "speed_norm": speed_norm,
                "fuel_burn_rate": fuel_burn_rate,
                "stop_duration_norm": stop_duration_norm,
                "deviation_km": deviation_km,
                "engine_temp_norm": engine_temp_norm,
            })
        return pd.DataFrame(rows)

    def train(self) -> Dict[str, float]:
        logger.info("Training anomaly detection model")
        df = self._generate_training_data()
        X = df[self.feature_names]

        self.model = IsolationForest(
            n_estimators=100,
            contamination=self.contamination,
            random_state=42,
            n_jobs=-1,
        )
        self.model.fit(X)
        self.is_trained = True
        logger.info("Anomaly detection model trained")
        return {"contamination_rate": self.contamination}

    def score_vehicle(
        self,
        speed: float,
        fuel_level: float,
        stop_duration_minutes: float,
        route_deviation_km: float,
        engine_temp: float,
    ) -> Tuple[float, bool, str]:
        """
        Returns (anomaly_score, is_anomaly, reason).
        Score < 0 = more anomalous.
        """
        if not self.is_trained or self.model is None:
            return 0.5, False, "Model not ready"

        # Normalize features
        speed_norm = (speed - 35) / 15
        fuel_burn_rate = max(0, (100 - fuel_level) / 30)
        stop_duration_norm = (stop_duration_minutes - 5) / 10
        engine_temp_norm = (engine_temp - 90) / 15

        features = np.array([[
            speed_norm, fuel_burn_rate, stop_duration_norm,
            route_deviation_km, engine_temp_norm,
        ]])

        score = float(self.model.score_samples(features)[0])
        prediction = int(self.model.predict(features)[0])
        is_anomaly = prediction == -1

        reason = "Normal operation"
        if is_anomaly:
            if abs(speed_norm) > 2.5:
                reason = "Unusual speed pattern"
            elif fuel_burn_rate > 2:
                reason = "High fuel consumption rate"
            elif stop_duration_norm > 3:
                reason = "Extended unplanned stop"
            elif route_deviation_km > 3:
                reason = "Significant route deviation"
            elif engine_temp_norm > 2.5:
                reason = "Engine temperature anomaly"
            else:
                reason = "Multiple unusual parameters"

        return round(score, 4), is_anomaly, reason


class MLEngine:
    """Container for all ML models. Trains at startup."""

    def __init__(self) -> None:
        self.eta_predictor = ETAPredictor()
        self.demand_forecaster = DemandForecaster()
        self.anomaly_detector = AnomalyDetector()
        self.training_metrics: Dict = {}
        self.trained_at: Optional[datetime] = None

    def _train_all_sync(self) -> None:
        """Train models without blocking the application's event loop."""
        logger.info("Training all ML models...")
        metrics = {}
        metrics["eta"] = self.eta_predictor.train()
        metrics["demand"] = self.demand_forecaster.train()
        metrics["anomaly"] = self.anomaly_detector.train()
        self.training_metrics = metrics
        self.trained_at = datetime.utcnow()
        logger.info("All ML models trained", metrics=metrics)

    async def train_all(self) -> None:
        """Train models in a worker thread so API startup remains responsive."""
        await asyncio.to_thread(self._train_all_sync)

    def get_status(self) -> Dict:
        return {
            "trained_at": self.trained_at.isoformat() if self.trained_at else None,
            "models": {
                "eta_prediction": {
                    "ready": self.eta_predictor.is_trained,
                    "metrics": self.training_metrics.get("eta", {}),
                    "description": "XGBoost - quotes the ETA of every order the dispatcher assigns, learning from the simple distance/speed formula where traffic is about to change",
                },
                "demand_forecast": {
                    "ready": self.demand_forecaster.is_trained,
                    "metrics": self.training_metrics.get("demand", {}),
                    "description": "Gradient boosting — predicts zone order volume by hour and day",
                },
                "anomaly_detection": {
                    "ready": self.anomaly_detector.is_trained,
                    "metrics": self.training_metrics.get("anomaly", {}),
                    "description": "Isolation Forest — flags unusual vehicle behavior from telemetry",
                },
            },
        }


# Singleton
ml_engine = MLEngine()
