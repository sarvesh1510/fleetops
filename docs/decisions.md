# Architecture Decision Records

## ADR-001: FastAPI over Django/Flask

**Decision:** Use FastAPI as the backend framework.

**Reasons:**
- Native async support — essential for concurrent WebSocket connections and simulation tick
- Pydantic v2 integration gives automatic validation and serialization across the entire request cycle
- Auto-generated OpenAPI docs with zero extra work
- `lifespan` context manager handles startup/shutdown cleanly (DB init, simulation start, ML training)
- Type annotations are first-class, aligning with the strongly-typed design goal

**Trade-offs:** Smaller ecosystem than Django; no built-in ORM (not needed with MongoDB).

---

## ADR-002: MongoDB over PostgreSQL

**Decision:** Use MongoDB as the primary datastore.

**Reasons:**
- Telemetry documents are heterogeneous (different fields per vehicle type, event type)
- GeoJSON geospatial indexes (`2dsphere`) are natively supported — critical for proximity queries
- Flexible schema suits rapid iteration during simulation design
- Motor (async driver) integrates cleanly with FastAPI's event loop
- No join complexity: a vehicle document naturally embeds health, location, and current order reference

**Trade-offs:** No ACID transactions across collections; referential integrity is application-enforced.

---

## ADR-003: WebSockets over Server-Sent Events or Polling

**Decision:** Use WebSockets for real-time fleet updates.

**Reasons:**
- Bidirectional: clients can send subscription preferences (which event types to receive)
- Single persistent connection handles all event types (vehicle positions, incidents, optimization results)
- Leaflet map updates need sub-2-second latency; polling at this rate would overload the server
- The `ConnectionManager` broadcaster pattern scales cleanly — one broadcast reaches all connected clients

**Trade-offs:** More complex reconnection handling than SSE; requires WebSocket support from hosting.

---

## ADR-004: Hungarian assignment (SciPy) for dispatch

**Decision:** Dispatch is a one-to-one order-to-vehicle assignment solved with `scipy.optimize.linear_sum_assignment`. It is not a multi-stop VRP, and OR-Tools is not used.

**Reasons:**
- Each vehicle carries one order at a time in the simulation, so assignment is the real decision; VRP machinery would be solving a problem the system does not have
- The Hungarian algorithm gives the optimal assignment for the cost matrix in milliseconds
- Hard constraints (region, capacity, cold chain, fuel range) are applied as infeasible pairs; soft factors and a priority bonus shape the cost
- SciPy is already a dependency, so there is no heavy native package to ship

**Honest baseline:** Each run also computes what a first-come-first-served, nearest-feasible-vehicle dispatcher would have done. The reported improvement is the measured difference in pickup distance/time between the two plans. It is often 0%, and that is shown as is.

**Trade-offs:** No route sequencing across several stops, no time-window optimisation. If vehicles ever carry multiple orders, revisit this (OR-Tools would then be the natural choice).

---

## ADR-005: React + TypeScript + Vite

**Decision:** Build the frontend with React, TypeScript, and Vite.

**Reasons:**
- TypeScript catches API contract mismatches at build time — critical when the backend evolves
- Vite's dev server proxying makes local development seamless (no CORS config during dev)
- TanStack Query handles server-state caching, refetch intervals, and loading states without boilerplate
- Zustand is minimal and synchronous — right size for the two global stores (auth, websocket)
- Recharts and Leaflet are MIT-licensed and composable

**Trade-offs:** More initial setup than Create React App; Leaflet needs dynamic import to avoid SSR issues.

---

## ADR-006: Containerized Deployment (Docker)

**Decision:** Package the backend as a Docker container.

**Reasons:**
- NumPy, SciPy, XGBoost and scikit-learn have native dependencies — Docker guarantees a consistent build
- The `python:3.11-slim` base keeps the image under 600MB
- Health check endpoint (`/health`) integrates with Docker Compose's `condition: service_healthy`
- Non-root user (`appuser`) follows the principle of least privilege
- Same container runs locally, on any VPS, or on container platforms (Railway, Fly.io, GCP Cloud Run)

---

## ADR-007: Leaflet over Mapbox GL

**Decision:** Use Leaflet with OpenStreetMap tiles instead of Mapbox GL JS.

**Reasons:**
- No API key required — the project runs immediately after `git clone`
- OpenStreetMap tiles are free and sufficient for a demo at city scale
- Standard OpenStreetMap tiles are used as is (light theme, matching the UI)
- `react-leaflet` integrates naturally with React's render cycle

**Trade-offs:** No 3D buildings, no custom vector tile styling, tile loading can flicker on slow connections.

**Migration path:** Swap `TileLayer` URL and add `mapbox-gl` package — all vehicle marker logic stays the same.

---

## ADR-008: Simulation in Process (not separate service)

**Decision:** Run the simulation engine as an async task inside the FastAPI process, not as a separate microservice.

**Reasons:**
- Shared in-memory state (vehicle positions, order queues) avoids serialization overhead
- For a portfolio/demo context, operational simplicity matters more than horizontal scaling
- The async loop (`asyncio.create_task`) coexists cleanly with FastAPI's event loop
- A single-process design is easier to reason about, debug, and demo

**Trade-offs:** Cannot scale simulation workers independently of the API; simulation crash affects the API.

**Production path:** Extract `SimulationEngine` into a separate Python process communicating via Redis pub/sub or Kafka.

---

## ADR-009: India (Mumbai MMR and Delhi NCR) as Operating Geography

**Decision:** Set the fleet simulation in two Indian regions, Mumbai MMR (44 vehicles) and Delhi NCR (34 vehicles).

**Reasons:**
- Adds specificity and narrative authenticity to the demo
- Peak-hour traffic patterns are distinctive (8–11am, 6–9pm, IST)
- Vehicle names (ACE, LPT, Bolero) and company names (Reliance Retail, BigBasket, Delhivery) are recognisable
- Two regions make the region constraint meaningful: a vehicle never serves an order in the other region, and cross-region orders are rejected at creation
- Day boundaries and the hourly analytics use IST; timestamps are stored and sent as UTC

**Trade-offs:** Region membership is derived from coordinates (longitude), so adding a third region needs a real lookup.

---

## ADR-010: ML at Startup (not deferred)

**Decision:** Train all ML models at application startup, in a background task.

**Reasons:**
- Training on a few thousand synthetic samples is quick, and no external ML infrastructure is needed (no MLflow, no model store)
- Core operations (simulation, dispatch) don't depend on the models, so the API serves requests immediately; prediction endpoints return `503` until training finishes
- Synthetic training data uses fixed random seeds — results are reproducible
- The data is synthetic, so reported MAE/RMSE describe that synthetic world, not real-world accuracy
- The ETA model has monotone constraints so that more traffic never lowers an estimate

**Trade-offs:** Models can't be updated without restart; predictions are unavailable for the first seconds after boot.

**Production path:** Serialize trained models with `joblib`, load from disk on startup, retrain on a schedule.
