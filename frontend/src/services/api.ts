/**
 * Typed API client. One function per backend endpoint the UI uses.
 * 401 on an authenticated request clears the session; errors surface as ApiError.
 */
import type {
  AnalyticsOverview, CreateOrderPayload, CreateOrderResponse, DemandForecast, EtaPerformancePoint,
  EtaPrediction, FleetStats, HourlyDeliveries, Incident, IncidentList, IncidentStats, MLStatus,
  OptimizationRun, OptimizationStats, Order, OrderStats, Paginated, Region, SimulationStatus,
  Vehicle, VehicleDetail,
} from '../types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'
const TOKEN_KEY = 'fleetops_token'
const USER_KEY = 'fleetops_user'

export class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

function describeDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail
  // FastAPI validation errors: [{loc: [...], msg: '...'}, ...]
  if (Array.isArray(detail)) {
    return detail.map((d: { loc?: unknown[]; msg?: string }) =>
      `${(d.loc ?? []).filter(p => p !== 'body').join('.')}: ${d.msg ?? 'invalid'}`).join('; ')
  }
  return fallback
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY)
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) }
  if (options.body) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  } catch {
    throw new ApiError(0, 'Cannot reach the FleetOps API. Is the backend running?')
  }

  if (res.status === 401 && token) {
    // Session expired / revoked - drop it and send the user to sign in again
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    window.location.assign('/login')
    throw new ApiError(401, 'Session expired')
  }

  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status})`
    try {
      const body = await res.json()
      detail = describeDetail(body.detail, detail)
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, detail)
  }

  return res.json() as Promise<T>
}

const qs = (params?: Record<string, string | number | boolean | undefined | null>) => {
  const entries = Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all')
  return entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : ''
}

const get = <T>(path: string) => request<T>(path)
const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) })

// ── Auth ───────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    post<{ access_token: string; user_id: string; username: string; role: string; full_name: string }>(
      '/auth/login', { username, password }),
  me: () => get<{ user_id: string; username: string; email: string; full_name: string; role: string }>('/auth/me'),
}

// ── Vehicles ───────────────────────────────────────────────────────────────────
export const vehiclesApi = {
  list: (p?: { status?: string; type?: string; region?: string; search?: string; page?: number; page_size?: number }) =>
    get<Paginated<Vehicle>>(`/vehicles${qs(p)}`),
  get: (id: string) => get<VehicleDetail>(`/vehicles/${id}`),
  stats: () => get<FleetStats>('/vehicles/stats'),
}

// ── Orders ─────────────────────────────────────────────────────────────────────
export const ordersApi = {
  list: (p?: { status?: string; priority?: string; region?: string; search?: string; page?: number; page_size?: number }) =>
    get<Paginated<Order>>(`/orders${qs(p)}`),
  get: (id: string) => get<Order>(`/orders/${id}`),
  stats: () => get<OrderStats>('/orders/stats'),
  create: (data: CreateOrderPayload) => post<CreateOrderResponse>('/orders', data),
}

// ── Incidents ──────────────────────────────────────────────────────────────────
export const incidentsApi = {
  /** status may be 'active' (anything unresolved) or a concrete status */
  list: (p?: { status?: string; severity?: string; type?: string; page?: number; page_size?: number }) =>
    get<IncidentList>(`/incidents${qs(p)}`),
  get: (id: string) => get<Incident>(`/incidents/${id}`),
  stats: () => get<IncidentStats>('/incidents/stats'),
  resolve: (id: string, notes?: string) => post<Incident>(`/incidents/${id}/resolve`, notes ? { notes } : undefined),
}

// ── Optimization ───────────────────────────────────────────────────────────────
export const optimizationApi = {
  run: () => post<OptimizationRun>('/optimization/run'),
  listRuns: (p?: { page?: number; page_size?: number; trigger?: string }) =>
    get<Paginated<OptimizationRun>>(`/optimization/runs${qs({ page_size: 20, ...p })}`),
  getRun: (id: string) => get<OptimizationRun>(`/optimization/runs/${id}`),
  stats: () => get<OptimizationStats>('/optimization/stats'),
}

// ── Analytics ──────────────────────────────────────────────────────────────────
export const analyticsApi = {
  overview: () => get<AnalyticsOverview>('/analytics/overview'),
  deliveriesPerHour: () => get<HourlyDeliveries[]>('/analytics/deliveries-per-hour'),
  etaPerformance: (limit = 50) => get<EtaPerformancePoint[]>(`/analytics/eta-performance?limit=${limit}`),
}

// ── ML ─────────────────────────────────────────────────────────────────────────
export const mlApi = {
  status: () => get<MLStatus>('/predictions/status'),
  /** speed_kmh is the vehicle's FREE-FLOW speed; congestion goes in traffic_factor. */
  predictEta: (p: { distance_km: number; speed_kmh: number; n_stops: number; traffic_factor: number }) =>
    post<EtaPrediction>(`/predictions/eta${qs(p)}`),
  demand: () => get<DemandForecast>('/predictions/demand'),
}

// ── Simulation ─────────────────────────────────────────────────────────────────
export const simApi = {
  status: () => get<SimulationStatus>('/simulation/status'),
  pause: () => post<{ paused: boolean }>('/simulation/pause'),
  resume: () => post<{ paused: boolean }>('/simulation/resume'),
  setSpeed: (speed: number) => post<{ speed: number }>('/simulation/speed', { speed }),
  triggerTraffic: (region?: Region) =>
    post<{ message: string; region: Region; affected: number }>(`/simulation/trigger/traffic${qs({ region })}`),
  triggerBreakdown: (vehicle_id?: string) =>
    post<{ message: string; vehicle_id: string }>(`/simulation/trigger/breakdown${qs({ vehicle_id })}`),
  triggerOrder: () => post<{ message: string; order_id: string | null }>('/simulation/trigger/order'),
}
