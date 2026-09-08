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

## ADR-004: OR-Tools for Vehicle Routing

**Decision:** Use Google OR-Tools for the optimization engine core.

**Reasons:**
- Production-grade CVRPTW (Capacitated VRP with Time Windows) solver used by Google Maps
- Handles pickup-delivery pairs with capacity constraints in milliseconds
- Open source (Apache 2.0), no API cost or rate limits
- Local search metaheuristics (GLS) find near-optimal solutions within the 2-second time budget

**Trade-offs:** Larger binary than a hand-rolled greedy; requires integer-scaled distance matrix.

**Fallback:** Greedy best-fit scorer runs when OR-Tools isn't available or problem size is trivial (< 2 orders).

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
- OR-Tools, NumPy, and scikit-learn have complex native dependencies — Docker guarantees a consistent build
- The `python:3.11-slim` base keeps the image under 600MB
- Health check endpoint (`/health`) integrates with Docker Compose's `condition: service_healthy`
- Non-root user (`appuser`) follows the principle of least privilege
- Same container runs locally, on any VPS, or on container platforms (Railway, Fly.io, GCP Cloud Run)

---

## ADR-007: Leaflet over Mapbox GL

**Decision:** Use Leaflet with OpenStreetMap tiles instead of Mapbox GL JS.

**Reasons:**
- No API key required — the project runs immediately after `git clone`
- OpenStreetMap tiles are free and sufficient for a demo at Mumbai MMR scale
- Dark tile styling via CSS `filter: brightness(0.65) saturate(0.5) hue-rotate(200deg)` approximates a dark map
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

## ADR-009: India/Mumbai as Operating Geography

**Decision:** Set the fleet simulation in Mumbai, India (not London or a generic city).

**Reasons:**
- Adds specificity and narrative authenticity to the demo
- Mumbai traffic patterns are distinctive (peak hours 8–11am, 6–9pm, monsoon delays)
- Indian logistics is a high-growth sector — realistic for interview context
- Vehicle names (ACE, LPT, Bolero) and company names (Reliance Retail, BigBasket, Delhivery) are recognisable
- 25 Mumbai MMR zones provide geographic spread within a realistic operating radius

---

## ADR-010: ML at Startup (not deferred)

**Decision:** Train all ML models synchronously at application startup.

**Reasons:**
- Training on 5,000 synthetic samples takes ~2 seconds — acceptable startup cost
- No external ML infrastructure required (no MLflow, no model store)
- Models are immediately available for prediction from the first API request
- Synthetic training data is deterministic (fixed random seeds) — results are reproducible

**Trade-offs:** Longer startup time; models can't be updated without restart.

**Production path:** Serialize trained models with `joblib`, load from disk on startup, retrain on a schedule.
