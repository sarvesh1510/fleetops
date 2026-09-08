/**
 * Centralized API client with authentication, error handling and typed responses.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

function getToken(): string | null {
  return localStorage.getItem('fleetops_token')
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })

  if (res.status === 401) {
    localStorage.removeItem('fleetops_token')
    localStorage.removeItem('fleetops_user')
    window.location.href = '/login'
    throw new ApiError(401, 'Session expired')
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      detail = body.detail || detail
    } catch {}
    throw new ApiError(res.status, detail)
  }

  return res.json() as Promise<T>
}

const get  = <T>(path: string)         => request<T>(path)
const post = <T>(path: string, data?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(data) })

// ── Auth ───────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    post<{ access_token: string; user_id: string; username: string; role: string; full_name: string }>(
      '/auth/login', { username, password }
    ),
  me: () => get<{ user_id: string; username: string; email: string; full_name: string; role: string }>('/auth/me'),
  logout: () => post('/auth/logout'),
}

// ── Vehicles ───────────────────────────────────────────────────────────────────
export const vehiclesApi = {
  list: (params?: { status?: string; type?: string; page?: number; page_size?: number }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString()
    return get<{ items: unknown[]; total: number; page: number; pages: number }>(`/vehicles${q ? '?' + q : ''}`)
  },
  get: (id: string) => get<unknown>(`/vehicles/${id}`),
  stats: () => get<unknown>('/vehicles/stats'),
}

// ── Orders ─────────────────────────────────────────────────────────────────────
export const ordersApi = {
  list: (params?: { status?: string; priority?: string; page?: number; page_size?: number }) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params || {}).filter(([,v]) => v != null).map(([k,v]) => [k, String(v)]))
    ).toString()
    return get<{ items: unknown[]; total: number; page: number; pages: number }>(`/orders${q ? '?' + q : ''}`)
  },
  get: (id: string) => get<unknown>(`/orders/${id}`),
  stats: () => get<unknown>('/orders/stats'),
  create: (data: unknown) => post<unknown>('/orders', data),
}

// ── Incidents ──────────────────────────────────────────────────────────────────
export const incidentsApi = {
  list: (params?: { status?: string; severity?: string; page?: number }) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params || {}).filter(([,v]) => v != null).map(([k,v]) => [k, String(v)]))
    ).toString()
    return get<{ items: unknown[]; total: number; active_count: number }>(`/incidents${q ? '?' + q : ''}`)
  },
  get: (id: string) => get<unknown>(`/incidents/${id}`),
  stats: () => get<unknown>('/incidents/stats'),
  resolve: (id: string) => post(`/incidents/${id}/resolve`),
}

// ── Optimization ───────────────────────────────────────────────────────────────
export const optimizationApi = {
  run: () => post<unknown>('/optimization/run'),
  listRuns: (page = 1) => get<{ items: unknown[]; total: number }>(`/optimization/runs?page=${page}&page_size=20`),
  getRun: (id: string) => get<unknown>(`/optimization/runs/${id}`),
  stats: () => get<unknown>('/optimization/stats'),
}

// ── Analytics ──────────────────────────────────────────────────────────────────
export const analyticsApi = {
  overview: () => get<unknown>('/analytics/overview'),
  deliveriesPerHour: () => get<unknown[]>('/analytics/deliveries-per-hour'),
  etaPerformance: () => get<unknown[]>('/analytics/eta-performance'),
}

// ── ML ─────────────────────────────────────────────────────────────────────────
export const mlApi = {
  status: () => get<unknown>('/predictions/status'),
  predictEta: (params: { distance_km: number; speed_kmh?: number; n_stops?: number; traffic_factor?: number }) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k,v]) => [k, String(v)]))).toString()
    return post<unknown>(`/predictions/eta?${q}`)
  },
  demand: () => get<unknown>('/predictions/demand'),
}

// ── Simulation ─────────────────────────────────────────────────────────────────
export const simApi = {
  status: () => get<unknown>('/simulation/status'),
  start: () => post('/simulation/start'),
  pause: () => post('/simulation/pause'),
  resume: () => post('/simulation/resume'),
  setSpeed: (speed: number) => post('/simulation/speed', { speed }),
  triggerTraffic: () => post('/simulation/trigger/traffic'),
  triggerBreakdown: (vehicle_id?: string) => {
    const q = vehicle_id ? `?vehicle_id=${vehicle_id}` : ''
    return post(`/simulation/trigger/breakdown${q}`)
  },
  triggerOrder: () => post('/simulation/trigger/order'),
}
