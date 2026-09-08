# FleetOps India 🚚

**Real-Time Autonomous Logistics & Fleet Optimization Platform**

A production-quality command centre for managing a live fleet of delivery vehicles across Mumbai and the Mumbai Metropolitan Region. The platform continuously ingests telemetry, makes autonomous routing and assignment decisions, detects incidents, and presents everything through a polished dark-mode dashboard.

---

## What Makes This Different

Most "fleet dashboards" are CRUD applications with a map. FleetOps is built around an autonomous decision loop:

```
OBSERVE → ANALYZE → PREDICT → OPTIMIZE → ACT → EXPLAIN
```

Every action the system takes is recorded, explained, and auditable. When a vehicle breaks down, the platform doesn't just alert — it reassigns the active orders, recalculates ETAs, and shows you exactly why each decision was made.

---

## Features

| Category | Capability |
|---|---|
| **Real-time** | WebSocket fleet updates every 2 seconds, live event feed |
| **Simulation** | 58-vehicle fleet across Mumbai MMR, realistic Indian traffic patterns |
| **Optimization** | OR-Tools CVRPTW solver, multi-factor vehicle scoring, transparent decisions |
| **ML** | XGBoost ETA prediction, demand forecasting, Isolation Forest anomaly detection |
| **Incidents** | Automated detection, timeline tracking, autonomous resolution actions |
| **Auth** | JWT + bcrypt, 4 role levels (Admin / Ops Manager / Dispatcher / Viewer) |
| **Map** | Live Leaflet map with animated vehicle markers, dark tile styling |
| **Analytics** | Delivery KPIs, ETA accuracy, fleet utilization, demand heatmaps |

---

## Architecture

```
Browser (React + Vite)
        │  REST + WebSocket
        ▼
FastAPI (Python)
  ├── Auth Service (JWT)
  ├── Vehicle Router
  ├── Order Router
  ├── Incident Router
  ├── Optimization Router (OR-Tools)
  ├── Analytics Router
  ├── ML Router (XGBoost / sklearn)
  └── WebSocket Broadcaster
        │
        ├── Simulation Engine (async loop, 2s ticks)
        │     └── Mumbai MMR fleet: vans, trucks, e-bikes, motorcycles, refrigerated
        └── MongoDB (vehicles, orders, incidents, telemetry, optimization_runs)
```

See [`docs/architecture.md`](docs/architecture.md) for full detail.

---

## Tech Stack

**Frontend:** React 18 · TypeScript · Vite · Tailwind CSS · TanStack Query · Zustand · Recharts · Leaflet · Framer Motion · Lucide

**Backend:** Python 3.11 · FastAPI · Pydantic v2 · Motor (async MongoDB) · python-jose · passlib

**Optimization:** Google OR-Tools 9.9 (CVRPTW solver)

**ML:** XGBoost · scikit-learn · NumPy · Pandas

**Infrastructure:** Docker · Docker Compose · MongoDB (local or Atlas)

---

## Quick Start

### Option 1: Docker Compose (recommended)

```bash
git clone <repo>
cd fleetops
cp .env.example .env
# Edit .env if needed (defaults work for local development)

docker compose up
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/api/docs
- MongoDB: localhost:27017

### Option 2: Local development

**Prerequisites:** Python 3.11+, Node 20+, MongoDB 7.0 (local or Atlas)

```bash
# Backend
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env  # edit MONGODB_URI if needed
uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install --legacy-peer-deps
npm run dev
```

Open http://localhost:5173

---

## Demo Accounts

| Username | Password | Role |
|---|---|---|
| `admin` | `Admin123!` | Full access |
| `ops_manager` | `Ops123!` | Operations Manager |
| `dispatcher` | `Dispatch123!` | Can create orders |
| `viewer` | `Viewer123!` | Read-only |

---

## Demo Scenarios

Once logged in, use the **Sim Controls** in the top bar:

| Control | Effect |
|---|---|
| **1× / 3× / 5× / 10×** | Simulation speed multiplier |
| **Pause / Resume** | Freeze/unfreeze all vehicles |
| **Traffic** | Trigger Western Express Highway congestion surge |
| **Breakdown** | Force a random en-route vehicle to break down |
| **+ Order** | Inject a new high-priority order |

**Recommended demo flow:**
1. Open Dashboard — watch vehicles move on the map
2. Click a vehicle to see live telemetry, driver, ETA
3. Hit **Breakdown** — watch an incident appear with autonomous actions
4. Go to Optimization → Run Optimization — see before/after metrics
5. Go to Incidents — expand an incident, read the timeline
6. Go to AI Predictions — inspect real ML model metrics and forecasts

---

## Project Structure

```
fleetops/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app, lifespan
│   │   ├── config/settings.py      # Pydantic settings
│   │   ├── core/auth.py            # JWT + bcrypt
│   │   ├── db/database.py          # Motor connection, indexes
│   │   ├── models/                 # Domain models (Vehicle, Order, etc.)
│   │   ├── routers/                # FastAPI route handlers
│   │   ├── simulation/
│   │   │   ├── engine.py           # 58-vehicle async simulation loop
│   │   │   └── seeder.py           # Database seed data (Mumbai fleet)
│   │   ├── optimization/engine.py  # OR-Tools VRP + vehicle scorer
│   │   ├── ml/models.py            # ETA/demand/anomaly ML models
│   │   └── websocket/broadcaster.py # WebSocket connection manager
│   └── tests/test_suite.py         # 31 tests across all components
│
├── frontend/
│   └── src/
│       ├── app/                    # React entry, router
│       ├── components/
│       │   ├── layout/AppLayout.tsx
│       │   └── map/FleetMap.tsx    # Leaflet live map
│       ├── pages/                  # One file per page
│       ├── services/api.ts         # Typed API client
│       ├── stores/                 # Zustand (auth, websocket)
│       ├── lib/utils.ts            # Formatters, color maps
│       └── types/index.ts          # All TypeScript types
│
├── docs/                           # Architecture, API, decisions
├── docker-compose.yml
├── docker-compose.dev.yml
└── .env.example
```

---

## API Reference

Full interactive docs at `/api/docs` (Swagger UI) when backend is running.

```
POST   /api/v1/auth/login
GET    /api/v1/auth/me

GET    /api/v1/vehicles?status=en_route&page=1
GET    /api/v1/vehicles/stats
GET    /api/v1/vehicles/{id}

GET    /api/v1/orders?status=pending&priority=critical
POST   /api/v1/orders
GET    /api/v1/orders/stats
GET    /api/v1/orders/{id}

GET    /api/v1/incidents?severity=high
GET    /api/v1/incidents/stats
GET    /api/v1/incidents/{id}
POST   /api/v1/incidents/{id}/resolve

POST   /api/v1/optimization/run
GET    /api/v1/optimization/runs
GET    /api/v1/optimization/stats

GET    /api/v1/analytics/overview
GET    /api/v1/analytics/deliveries-per-hour
GET    /api/v1/analytics/eta-performance

POST   /api/v1/predictions/eta
GET    /api/v1/predictions/demand
POST   /api/v1/predictions/anomaly

GET    /api/v1/simulation/status
POST   /api/v1/simulation/speed
POST   /api/v1/simulation/trigger/traffic
POST   /api/v1/simulation/trigger/breakdown

GET    /health
GET    /ready

WS     /ws/fleet
```

---

## WebSocket Events

All events follow the structure:
```json
{
  "event": "vehicle.rerouted",
  "timestamp": "2024-01-15T10:23:44Z",
  "data": { ... }
}
```

Event types: `fleet.snapshot` · `order.assigned` · `delivery.completed` · `incident.created` · `optimization.completed` · `alert.created` · `simulation.status`

---

## Optimization Logic

The OR-Tools engine solves a **Capacitated VRP with Time Windows** across the active Mumbai fleet:

1. Build distance matrix (Haversine)
2. Score each vehicle per order (distance, capacity, fuel, health, deadline pressure, refrigeration)
3. If ≥2 vehicles and ≥2 orders: run CVRPTW solver (2-second time limit)
4. Fall back to greedy best-fit for smaller sets
5. Apply if improvement > 5% threshold
6. Persist run with full decision audit trail

Every candidate vehicle gets a **transparent score** (0–100) with explicit reasons shown in the UI.

---

## Machine Learning

All three models are trained at startup on synthetic data. Metrics shown in the UI are genuine evaluation results:

| Model | Algorithm | Typical MAE |
|---|---|---|
| ETA Prediction | XGBoost Regressor | ~9 minutes |
| Demand Forecast | Gradient Boosting | ~0.7 orders/hour |
| Anomaly Detection | Isolation Forest | 5% contamination rate |

Training data mirrors realistic Mumbai delivery patterns: peak hours (8–11am, 6–9pm), weekend demand reduction, monsoon traffic multipliers.

---

## Running Tests

```bash
cd backend
pip install -r requirements.txt
pytest tests/ -v
```

31 tests covering: auth · domain models · optimization scoring · VRP geometry · simulation movement · ML training & prediction · health endpoints

---

## Deployment

### MongoDB Atlas (free tier)
1. Create account at https://cloud.mongodb.com
2. Create M0 cluster (free)
3. Database user with `readWrite` role
4. Network access: add your server IP
5. Set `MONGODB_URI` in production environment

### Backend (any Docker host)
```bash
docker build -t fleetops-backend ./backend
docker run -p 8000:8000 \
  -e MONGODB_URI=<atlas_uri> \
  -e JWT_SECRET=<32_char_secret> \
  fleetops-backend
```

### Frontend (static)
```bash
cd frontend && npm run build
# Upload dist/ to Cloudflare Pages, Vercel, or any static host
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full reference. Minimum required for production:

```bash
MONGODB_URI=mongodb+srv://...
JWT_SECRET=<32-char-random>
CORS_ORIGINS=["https://yourdomain.com"]
SIMULATION_SPEED=1.0
```

---

## License

MIT — built as a portfolio/demonstration project.
