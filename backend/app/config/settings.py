from pydantic_settings import BaseSettings
from pydantic import ConfigDict
from typing import List


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "FleetOps"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"

    # API
    API_PREFIX: str = "/api/v1"
    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Security
    JWT_SECRET: str = "change-me-in-production-use-32-char-random-string"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480  # 8 hours

    # MongoDB
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB: str = "fleetops"

    # Simulation
    SIMULATION_SPEED: float = 1.0
    SIMULATION_INTERVAL_SECONDS: float = 2.0
    TELEMETRY_PERSIST_INTERVAL: int = 10  # persist every Nth telemetry update

    # Road routing (OSRM). Vehicles follow real roads when enabled, straight lines otherwise.
    ROUTING_ENABLED: bool = True
    ROUTING_BASE_URL: str = "https://router.project-osrm.org"   # public demo server; self-host for heavy use
    ROUTING_TIMEOUT_SECONDS: float = 8.0
    ROUTING_MIN_INTERVAL_SECONDS: float = 1.0   # spacing between requests (demo server allows ~1 req/s)

    # Optimization
    OPTIMIZATION_INTERVAL_SECONDS: int = 30
    OPTIMIZATION_IMPROVEMENT_THRESHOLD: float = 0.05  # 5% improvement required

    # External APIs
    MAPBOX_TOKEN: str = ""

    model_config = ConfigDict(env_file='.env', case_sensitive=True)


settings = Settings()
