/**
 * WebSocket store — manages the live connection and processes incoming events.
 * Uses Zustand for state with WebSocket integration.
 */
import { create } from 'zustand'
import type { FleetSnapshot, LiveEvent, WSEventType } from '../types'

const WS_URL = import.meta.env.VITE_WS_BASE_URL || `ws://${window.location.host}/ws/fleet`

interface WSStore {
  connected: boolean
  fleetSnapshot: FleetSnapshot | null
  liveEvents: LiveEvent[]
  vehicleMap: Map<string, FleetSnapshot['vehicles'][0]>
  simSpeed: number
  pendingOrders: number

  connect: () => void
  disconnect: () => void
  clearEvents: () => void
}

function makeEvent(type: WSEventType, data: Record<string, unknown>): LiveEvent {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const timestamp = new Date().toISOString()

  switch (type) {
    case 'order.assigned':
      return { id, type, timestamp, title: 'Order Assigned', detail: `${data.reference} → ${data.vehicle_id}`, severity: 'info', vehicle_id: data.vehicle_id as string }
    case 'delivery.completed':
      return { id, type, timestamp, title: 'Delivery Completed', detail: `${data.reference} for ${data.customer}`, severity: 'success', vehicle_id: data.vehicle_id as string }
    case 'order.created':
      return { id, type, timestamp, title: 'New Order', detail: `${data.reference} — ${data.priority} priority`, severity: (data.priority === 'critical' || data.priority === 'high') ? 'warning' : 'info' }
    case 'incident.created':
      return { id, type, timestamp, title: `Incident: ${data.title}`, detail: data.description as string || '', severity: (data.severity === 'critical' || data.severity === 'high') ? 'error' : 'warning', vehicle_id: data.vehicle_id as string }
    case 'vehicle.rerouted':
      return { id, type, timestamp, title: 'Vehicle Rerouted', detail: `${data.vehicle_id} — ${data.reason}`, severity: 'info', vehicle_id: data.vehicle_id as string }
    case 'optimization.completed':
      return { id, type, timestamp, title: 'Optimization Complete', detail: `${data.improvement_pct ?? 0}% improvement — ${data.assignments_changed} changes`, severity: 'success' }
    case 'alert.created':
      return { id, type, timestamp, title: data.message as string, detail: '', severity: data.severity === 'high' ? 'error' : 'warning' }
    default:
      return { id, type, timestamp, title: type, detail: '', severity: 'info' }
  }
}

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

export const useWSStore = create<WSStore>((set, get) => ({
  connected: false,
  fleetSnapshot: null,
  liveEvents: [],
  vehicleMap: new Map(),
  simSpeed: 1,
  pendingOrders: 0,

  connect() {
    if (socket?.readyState === WebSocket.OPEN) return

    const token = localStorage.getItem('fleetops_token')
    const url = token ? `${WS_URL}?token=${token}` : WS_URL

    socket = new WebSocket(url)

    socket.onopen = () => {
      set({ connected: true })
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { event: WSEventType; data: Record<string, unknown> }
        const { event, data } = msg

        if (event === 'fleet.snapshot') {
          const snapshot = data as unknown as FleetSnapshot
          const vehicleMap = new Map(snapshot.vehicles.map(v => [v.vehicle_id, v]))
          set({
            fleetSnapshot: snapshot,
            vehicleMap,
            simSpeed: snapshot.sim_speed,
            pendingOrders: snapshot.pending_orders,
          })
          return
        }

        // All other events go to the live feed (max 100 entries)
        const liveEvent = makeEvent(event, data)
        set(state => ({
          liveEvents: [liveEvent, ...state.liveEvents].slice(0, 100),
        }))
      } catch {}
    }

    socket.onerror = () => {}

    socket.onclose = () => {
      set({ connected: false })
      // Auto-reconnect after 3s
      reconnectTimer = setTimeout(() => get().connect(), 3000)
    }
  },

  disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    socket?.close()
    socket = null
    set({ connected: false })
  },

  clearEvents() {
    set({ liveEvents: [] })
  },
}))
