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

export interface Vehicle {
  vehicle_id: string
  name: string
  type: VehicleType
  fuel_type: FuelType
  status: VehicleStatus
  driver_id: string | null
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
  odometer_km: number
  updated_at: string
  health?: VehicleHealth
  driver?: Driver | null
  telemetry?: TelemetryPoint[]
}

export interface FleetStats {
  total: number
  by_status: Record<string, number>
  en_route: number
  available: number
  avg_fuel_pct: number
  fleet_utilization_pct: number
  active: number
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
  contact_name?: string
  contact_phone?: string
}

export interface Order {
  order_id: string
  reference: string
  status: OrderStatus
  priority: OrderPriority
  customer_name: string
  pickup: AddressPoint
  delivery: AddressPoint
  weight_kg: number
  assigned_vehicle_id: string | null
  deadline: string | null
  eta_minutes: number | null
  sla_at_risk: boolean
  estimated_distance_km: number | null
  created_at: string
  updated_at: string
  delivered_at?: string
  picked_up_at?: string
}

export interface OrderStats {
  total_today: number
  delivered_today: number
  active: number
  pending: number
  at_risk: number
  on_time_rate: number
  by_status: Record<string, number>
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
  details?: string
}

export interface AutonomousAction {
  action_type: string
  description: string
  vehicle_id?: string
  order_id?: string
  reason: string
  expected_impact: string
  executed_at: string
  outcome?: string
}

export interface Incident {
  incident_id: string
  type: IncidentType
  severity: IncidentSeverity
  status: IncidentStatus
  title: string
  description: string
  vehicle_id?: string
  order_ids: string[]
  autonomous_actions: AutonomousAction[]
  timeline: IncidentTimelineEntry[]
  created_at: string
  updated_at: string
  resolved_at?: string
}

// ── Optimization ───────────────────────────────────────────────────────────────
export interface VehicleCandidate {
  vehicle_id: string
  distance_to_pickup_km: number
  eta_minutes: number
  available_capacity_kg: number
  fuel_level: number
  score: number
  disqualified: boolean
  disqualification_reason?: string
  selection_reasons: string[]
}

export interface OptimizationRun {
  run_id: string
  trigger: string
  status: string
  vehicles_considered: number
  orders_in_scope: number
  before_total_distance_km?: number
  after_total_distance_km?: number
  before_total_duration_min?: number
  after_total_duration_min?: number
  distance_saved_km?: number
  time_saved_min?: number
  improvement_pct?: number
  assignments_changed: number
  routes_updated: number
  candidates?: VehicleCandidate[]
  summary: string
  solver_duration_ms?: number
  created_at: string
  completed_at?: string
}

// ── Analytics ──────────────────────────────────────────────────────────────────
export interface AnalyticsOverview {
  on_time_rate: number
  total_deliveries: number
  delivered: number
  failed: number
  avg_route_distance_km: number
  total_distance_km: number
  fleet_utilization_pct: number
  active_vehicles: number
  total_vehicles: number
  total_incidents: number
  resolved_incidents: number
  estimated_cost_gbp: number
  cost_per_delivery_gbp: number
}

// ── Driver ─────────────────────────────────────────────────────────────────────
export interface Driver {
  driver_id: string
  full_name: string
  phone?: string
  rating?: number
  total_deliveries_today?: number
}

// ── Telemetry ──────────────────────────────────────────────────────────────────
export interface TelemetryPoint {
  timestamp: string
  lat: number
  lng: number
  speed: number
  fuel_level: number
}

// ── WebSocket Events ───────────────────────────────────────────────────────────
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

export interface WSMessage<T = unknown> {
  event: WSEventType
  timestamp: string
  data: T
}

export interface FleetSnapshot {
  vehicles: Array<{
    vehicle_id: string
    name: string
    status: VehicleStatus
    lat: number
    lng: number
    speed: number
    heading: number
    fuel_level: number
    current_load_kg: number
    current_order_id: string | null
    eta_minutes: number | null
    health_score: number
  }>
  tick: number
  sim_speed: number
  pending_orders: number
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
  connections: number
}

// ── Live event feed ────────────────────────────────────────────────────────────
export interface LiveEvent {
  id: string
  type: WSEventType
  timestamp: string
  title: string
  detail: string
  severity?: 'info' | 'warning' | 'error' | 'success'
  vehicle_id?: string
  order_id?: string
}
