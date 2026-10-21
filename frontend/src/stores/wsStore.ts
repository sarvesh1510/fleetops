/**
 * Live connection to /ws/fleet. Holds the latest fleet snapshot, a short live-event feed,
 * and nudges React Query to refetch whatever a pushed event makes stale.
 */
import { create } from 'zustand'
import type { FleetSnapshot, LiveEvent, LiveVehicle, WSEventType } from '../types'
import { queryClient } from '../lib/queryClient'

const WS_BASE =
  import.meta.env.VITE_WS_BASE_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/fleet`

type EventData = Record<string, unknown>

interface WSStore {
  connected: boolean
  vehicleMap: Map<string, LiveVehicle>
  liveEvents: LiveEvent[]
  simSpeed: number
  paused: boolean
  pendingOrders: number
  traffic: Record<string, number>

  connect: () => void
  disconnect: () => void
  clearEvents: () => void
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)

/** Turn a pushed event into a feed entry, or null when it should not appear in the feed. */
function toFeedEvent(type: WSEventType, d: EventData): LiveEvent | null {
  const base = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, timestamp: new Date().toISOString() }
  switch (type) {
    case 'order.created':
      return { ...base, title: 'New order', detail: `${str(d.reference)} · ${str(d.priority)} priority`,
        severity: d.priority === 'critical' || d.priority === 'high' ? 'warning' : 'info' }
    case 'order.assigned':
      return { ...base, title: 'Order assigned', detail: `${str(d.reference)} → ${str(d.vehicle_name, str(d.vehicle_id))}`,
        severity: 'info', vehicle_id: str(d.vehicle_id) }
    case 'delivery.completed':
      return { ...base, title: d.on_time === false ? 'Delivered late' : 'Delivered',
        detail: `${str(d.reference)} · ${str(d.customer)}`,
        severity: d.on_time === false ? 'warning' : 'success', vehicle_id: str(d.vehicle_id) }
    case 'incident.created':
      return { ...base, title: str(d.title, 'Incident'), detail: str(d.description),
        severity: d.severity === 'critical' || d.severity === 'high' ? 'error' : 'warning', vehicle_id: str(d.vehicle_id) }
    case 'incident.resolved':
      return { ...base, title: `Resolved: ${str(d.title)}`, detail: '', severity: 'success' }
    case 'optimization.completed':
      return Number(d.assignments_changed) > 0
        ? { ...base, title: 'Dispatch run', detail: str(d.summary), severity: 'info' }
        : null
    case 'alert.created':
      return { ...base, title: str(d.message, 'Alert'), detail: '',
        severity: d.severity === 'high' ? 'error' : d.severity === 'low' ? 'info' : 'warning' }
    default:
      return null
  }
}

/** Which cached queries a pushed event invalidates. Throttled so bursts cause one refetch. */
const INVALIDATIONS: Partial<Record<WSEventType, string[]>> = {
  'order.created': ['orders', 'order-stats'],
  'order.assigned': ['orders', 'order-stats', 'vehicle-detail'],
  'delivery.completed': ['orders', 'order-stats', 'deliveries-hour', 'analytics-overview', 'vehicle-detail'],
  'incident.created': ['incidents', 'incident-stats'],
  'incident.updated': ['incidents', 'incident-stats'],
  'incident.resolved': ['incidents', 'incident-stats'],
  'optimization.completed': ['opt-runs', 'opt-stats', 'orders', 'order-stats'],
}
const pending = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
function scheduleInvalidate(keys: string[]) {
  keys.forEach(k => pending.add(k))
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    pending.forEach(k => queryClient.invalidateQueries({ queryKey: [k] }))
    pending.clear()
    flushTimer = null
  }, 800)
}

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let attempts = 0
let intentionalClose = false

export const useWSStore = create<WSStore>((set, get) => ({
  connected: false,
  vehicleMap: new Map(),
  liveEvents: [],
  simSpeed: 1,
  paused: false,
  pendingOrders: 0,
  traffic: {},

  connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
    const token = localStorage.getItem('fleetops_token')
    if (!token) return
    intentionalClose = false

    const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`)
    socket = ws

    ws.onopen = () => {
      attempts = 0
      set({ connected: true })
    }

    ws.onmessage = (e) => {
      let msg: { event: WSEventType; data: EventData }
      try { msg = JSON.parse(e.data) } catch { return }
      const { event, data } = msg

      if (event === 'fleet.snapshot') {
        const snap = data as unknown as FleetSnapshot
        set({
          vehicleMap: new Map(snap.vehicles.map(v => [v.vehicle_id, v])),
          simSpeed: snap.sim_speed,
          paused: snap.paused,
          pendingOrders: snap.pending_orders,
          traffic: snap.traffic ?? {},
        })
        return
      }
      if (event === 'simulation.status') {
        set({ simSpeed: Number(data.speed) || get().simSpeed, paused: Boolean(data.paused) })
        return
      }

      const feed = toFeedEvent(event, data)
      if (feed) set(s => ({ liveEvents: [feed, ...s.liveEvents].slice(0, 100) }))
      const keys = INVALIDATIONS[event]
      if (keys) scheduleInvalidate(keys)
    }

    ws.onclose = (ev) => {
      set({ connected: false })
      socket = null
      if (intentionalClose) return
      if (ev.code === 4401) {
        // Token rejected: the session is no longer valid
        localStorage.removeItem('fleetops_token')
        localStorage.removeItem('fleetops_user')
        window.location.assign('/login')
        return
      }
      attempts += 1
      reconnectTimer = setTimeout(() => get().connect(), Math.min(1000 * 2 ** attempts, 15_000))
    }
    ws.onerror = () => ws.close()
  },

  disconnect() {
    intentionalClose = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    socket?.close()
    socket = null
    set({ connected: false, vehicleMap: new Map(), liveEvents: [] })
  },

  clearEvents() {
    set({ liveEvents: [] })
  },
}))
