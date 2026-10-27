// ── Regions ────────────────────────────────────────────────────────────────────
export type Region = 'Mumbai MMR' | 'Delhi NCR'
export const REGIONS: Region[] = ['Mumbai MMR', 'Delhi NCR']

// ── Vehicle ────────────────────────────────────────────────────────────────────
export type VehicleStatus =
  | 'available' | 'en_route' | 'loading' | 'unloading'
  | 'idle' | 'maintenance' | 'breakdown' | 'offline'

export type VehicleType = 'van' | 'truck' | 'cargo_bike' | 'motorcycle' | 'refrigerated'
export type FuelType = 'diesel' | 'electric' | 'hybrid' | 'petrol' | 'cng'

export interface VehicleHealth {
  engine_temp: number
  tire_pressure: number
  brake_health: number
  transmission_health: number
  overall_score: number
}

/** Row returned by GET /vehicles (and the core of GET /vehicles/{id}). */
export interface Vehicle {
  vehicle_id: string
  name: string
  registration: string | null
  type: VehicleType
  fuel_type: FuelType
  status: VehicleStatus
  driver_id: string | null
  region: Region
  lat: number
  lng: number
  speed: number
  heading: number
  fuel_level: number
  fuel_range_km: number
  current_load_kg: number
  max_capacity_kg: number
  current_order_id: string | null
  eta_minutes: number | null
  health_score: number
  odometer_km: number
  updated_at: string
}

export interface Driver {
  driver_id: string
  full_name: string
  phone?: string | null
  rating?: number | null
  total_deliveries_today?: number
}

export interface TelemetryPoint {
  timestamp: string
  lat: number
  lng: number
  speed: number
  fuel_level: number
}

export interface CurrentOrderSummary {
  order_id: string
  reference: string
  status: OrderStatus
  priority: OrderPriority
  customer_name: string
  pickup_address: string
  delivery_address: string
  weight_kg: number
  deadline: string | null
  sla_at_risk: boolean
}

/** GET /vehicles/{id} */
export interface VehicleDetail extends Vehicle {
  health: VehicleHealth
  telemetry: TelemetryPoint[]
  driver: Driver | null
  current_order: CurrentOrderSummary | null
  deliveries_today: number
}

export interface FleetStats {
  total: number
  by_status: Record<string, number>
  by_region: Record<string, number>
  en_route: number
  available: number
  active: number
  avg_fuel_pct: number
  fleet_utilization_pct: number
  load_utilization_pct: number
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

// ── Order ──────────────────────────────────────────────────────────────────────
export type OrderStatus =
  | 'pending' | 'assigned' | 'pickup_en_route' | 'picked_up'
  | 'delivery_en_route' | 'delivered' | 'failed' | 'cancelled'

export type OrderPriority = 'low' | 'normal' | 'high' | 'critical'

export interface GeoPoint {
  type: 'Point'
  coordinates: [number, number] // [lng, lat]
}

export interface AddressPoint {
  address: string
  location: GeoPoint
  contact_name?: string | null
  contact_phone?: string | null
}

export interface Order {
  order_id: string
  reference: string
  status: OrderStatus
  priority: OrderPriority
  region: Region | null
  customer_name: string
  pickup: AddressPoint
  delivery: AddressPoint
  weight_kg: number
  requires_refrigeration: boolean
  fragile: boolean
  description: string
  assigned_vehicle_id: string | null
  deadline: string | null
  eta_minutes: number | null
  predicted_eta_minutes: number | null
  /** Which estimate was quoted at assignment: the ML model, or the simple formula before it was trained */
  eta_source?: 'ml' | 'formula' | null
  actual_duration_min: number | null
  sla_at_risk: boolean
  reassignment_count: number
  estimated_distance_km: number | null
  actual_distance_km: number | null
  created_at: string
  updated_at: string
  assigned_at: string | null
  picked_up_at: string | null
  delivered_at: string | null
}

export interface OrderStats {
  total_today: number
  delivered_today: number
  active: number
  pending: number
  at_risk: number
  /** null until the first delivery of the day */
  on_time_rate: number | null
  by_status: Record<string, number>
}

export interface CreateOrderPayload {
  customer_name: string
  priority: OrderPriority
  pickup_address: string
  pickup_lat: number
  pickup_lng: number
  delivery_address: string
  delivery_lat: number
  delivery_lng: number
  weight_kg: number
  requires_refrigeration?: boolean
  fragile?: boolean
  description?: string
  deadline_hours?: number
}

export interface CreateOrderResponse {
  order: Order
  assignment: { vehicle_id: string; vehicle_name: string | null; eta_minutes: number | null } | null
}

// ── Incident ───────────────────────────────────────────────────────────────────
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical'
export type IncidentType =
  | 'vehicle_breakdown' | 'low_fuel' | 'low_battery' | 'route_deviation'
  | 'traffic_spike' | 'delivery_sla_risk' | 'prolonged_stop' | 'overload'
  | 'driver_unreachable' | 'vehicle_stopped'

export type IncidentStatus = 'detected' | 'analyzing' | 'action_taken' | 'monitoring' | 'resolved' | 'escalated'

export interface IncidentTimelineEntry {
  timestamp: string
  event: string
  actor: string
  details?: string | null
}

export interface AutonomousAction {
  action_type: string
  description: string
  vehicle_id?: string | null
  order_id?: string | null
  reason: string
  expected_impact: string
  executed_at: string
  outcome?: string | null
}

export interface Incident {
  incident_id: string
  type: IncidentType
  severity: IncidentSeverity
  status: IncidentStatus
  title: string
  description: string
  vehicle_id: string | null
  vehicle_name: string | null
  region: Region | null
  order_ids: string[]
  autonomous_actions: AutonomousAction[]
  timeline: IncidentTimelineEntry[]
  sla_impact: string | null
  resolution_notes: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export interface IncidentList extends Paginated<Incident> {
  active_count: number
}

export interface IncidentStats {
  total: number
  active: number
  by_status: Record<string, number>
  by_severity: Record<string, number>
  by_type: Record<string, number>
  mean_time_to_resolve_min: number | null
}

// ── Optimization ───────────────────────────────────────────────────────────────
export interface VehicleCandidate {
  vehicle_id: string
  distance_to_pickup_km: number
  eta_minutes: number
  available_capacity_kg: number
  fuel_level: number
  current_load_kg: number
  score: number
  disqualified: boolean
  disqualification_reason: string | null
  selection_reasons: string[]
}

export interface AssignDecision {
  type: 'assign'
  order_id: string
  order_ref: string
  priority: OrderPriority
  vehicle_id: string
  vehicle_name: string
  distance_km: number
  eta_minutes: number
  score: number
  reason: string
}

export interface UnassignedDecision {
  type: 'unassigned'
  order_id: string
  order_ref: string
  priority: OrderPriority
  reason: string
}

export type OptimizationDecision = AssignDecision | UnassignedDecision

export type OptimizationTrigger =
  | 'scheduled' | 'new_order' | 'vehicle_breakdown' | 'traffic_change' | 'manual' | 'sla_risk'

export interface OptimizationRun {
  run_id: string
  trigger: OptimizationTrigger
  status: 'running' | 'completed' | 'failed'
  triggering_vehicle_id: string | null
  triggering_order_id: string | null
  triggering_incident_id: string | null
  vehicles_considered: number
  orders_in_scope: number
  /** Like-for-like comparison against first-come nearest-vehicle dispatch. Null when nothing to compare. */
  before_total_distance_km: number | null
  after_total_distance_km: number | null
  before_total_duration_min: number | null
  after_total_duration_min: number | null
  distance_saved_km: number | null
  time_saved_min: number | null
  improvement_pct: number | null
  assignments_changed: number
  routes_updated: number
  decisions: OptimizationDecision[]
  candidates: VehicleCandidate[]
  summary: string
  solver_duration_ms: number | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

export interface OptimizationStats {
  total_runs: number
  total_assignments: number
  avg_improvement_pct: number | null
  runs_with_comparison: number
  total_distance_saved_km: number
  total_time_saved_min: number
  avg_solver_ms: number | null
  by_trigger: Record<string, number>
}

// ── Analytics ──────────────────────────────────────────────────────────────────
export interface AnalyticsOverview {
  window_days: number
  on_time_rate: number | null
  total_deliveries: number
  delivered: number
  failed: number
  avg_route_distance_km: number | null
  avg_delivery_minutes: number | null
  total_distance_km: number
  fleet_utilization_pct: number
  active_vehicles: number
  total_vehicles: number
  total_incidents: number
  resolved_incidents: number
  eta_samples: number
  eta_mae_min: number | null
  eta_accuracy_pct: number | null
  /** Estimate = distance driven × cost_per_km_inr */
  estimated_cost_inr: number
  cost_per_delivery_inr: number | null
  cost_per_km_inr: number
}

export interface HourlyDeliveries {
  hour: string // "14:00"
  deliveries: number
  late: number
  is_future: boolean
}

export interface EtaPerformancePoint {
  order_ref: string
  predicted_min: number
  actual_min: number
  variance_pct: number
  delivered_at: string | null
}

// ── Predictions (ML) ───────────────────────────────────────────────────────────
export interface MLModelStatus {
  ready: boolean
  metrics: Record<string, number>
  description: string
}

export interface MLStatus {
  trained_at: string | null
  models: {
    eta_prediction: MLModelStatus
    demand_forecast: MLModelStatus
    anomaly_detection: MLModelStatus
  }
}

export interface EtaPrediction {
  distance_km: number
  speed_kmh: number
  n_stops: number
  traffic_factor: number
  predicted_duration_minutes: number
  range_min: number
  range_max: number
  confidence_pct: number
  model: string
}

export interface DemandForecast {
  hour: number
  day_of_week: number
  forecasts: { zone: string; predicted_orders: number; confidence: number }[]
  model: string
}

// ── Auth ───────────────────────────────────────────────────────────────────────
export type UserRole = 'admin' | 'operations_manager' | 'dispatcher' | 'viewer'

export interface AuthUser {
  user_id: string
  username: string
  email: string
  full_name: string
  role: UserRole
}

export interface AuthState {
  token: string | null
  user: AuthUser | null
  isAuthenticated: boolean
}

// ── Simulation ─────────────────────────────────────────────────────────────────
export interface SimulationStatus {
  running: boolean
  paused: boolean
  speed: number
  tick_count: number
  vehicle_count: number
  pending_orders: number
  traffic: Record<string, number>
  connections: number
}

// ── WebSocket ──────────────────────────────────────────────────────────────────
export type WSEventType =
  | 'fleet.snapshot'
  | 'vehicle.updated'
  | 'vehicle.status_changed'
  | 'order.created'
  | 'order.updated'
  | 'order.assigned'
  | 'delivery.completed'
  | 'route.updated'
  | 'vehicle.rerouted'
  | 'incident.created'
  | 'incident.updated'
  | 'incident.resolved'
  | 'optimization.started'
  | 'optimization.completed'
  | 'alert.created'
  | 'simulation.status'

/** One vehicle inside the 'fleet.snapshot' event (pushed every tick). */
export interface LiveVehicle {
  vehicle_id: string
  name: string
  type: VehicleType
  status: VehicleStatus
  region: Region
  lat: number
  lng: number
  speed: number
  heading: number
  fuel_level: number
  current_load_kg: number
  max_capacity_kg: number
  current_order_id: string | null
  eta_minutes: number | null
  health_score: number
}

export interface FleetSnapshot {
  vehicles: LiveVehicle[]
  tick: number
  sim_speed: number
  paused: boolean
  pending_orders: number
  traffic: Record<string, number>
}

export interface LiveEvent {
  id: string
  type: WSEventType
  timestamp: string
  title: string
  detail: string
  severity: 'info' | 'warning' | 'error' | 'success'
  vehicle_id?: string
  order_id?: string
}
export type EtaMethod = 'ml' | 'formula' | 'fixed_speed'
export type EtaErrors = Record<EtaMethod, { mae: number; rmse: number }>

export interface EtaEvaluation {
  model_ready: boolean
  /** Unseen synthetic trips set aside before training; null while the model trains */
  held_out: {
    samples: number
    methods: EtaErrors
    /** Positive = the ML model's mean error is that much lower */
    ml_vs_formula_pct: number | null
    ml_vs_fixed_speed_pct: number | null
  } | null
  /** Orders delivered in the simulation, scored against the estimates made at assignment */
  live: {
    samples: number
    methods: EtaErrors | null
    ml_vs_formula_pct: number | null
    ml_vs_fixed_speed_pct: number | null
    points: { order_ref: string; ml_min: number; formula_min: number; actual_min: number; delivered_at: string | null }[]
  }
}

