import type { VehicleStatus, OrderStatus, OrderPriority, IncidentSeverity, IncidentStatus } from '../types'

// ── Status colors ──────────────────────────────────────────────────────────────
export const vehicleStatusColor: Record<VehicleStatus, string> = {
  available:   '#10b981',
  en_route:    '#3b82f6',
  loading:     '#f59e0b',
  unloading:   '#f97316',
  idle:        '#6b7280',
  maintenance: '#8b5cf6',
  breakdown:   '#ef4444',
  offline:     '#374151',
}

export const vehicleStatusLabel: Record<VehicleStatus, string> = {
  available:   'Available',
  en_route:    'En Route',
  loading:     'Loading',
  unloading:   'Unloading',
  idle:        'Idle',
  maintenance: 'Maintenance',
  breakdown:   'Breakdown',
  offline:     'Offline',
}

export const orderStatusColor: Record<OrderStatus, string> = {
  pending:           '#6b7280',
  assigned:          '#3b82f6',
  pickup_en_route:   '#06b6d4',
  picked_up:         '#f59e0b',
  delivery_en_route: '#8b5cf6',
  delivered:         '#10b981',
  failed:            '#ef4444',
  cancelled:         '#374151',
}

export const orderStatusLabel: Record<OrderStatus, string> = {
  pending:           'Pending',
  assigned:          'Assigned',
  pickup_en_route:   'To Pickup',
  picked_up:         'Picked Up',
  delivery_en_route: 'Delivering',
  delivered:         'Delivered',
  failed:            'Failed',
  cancelled:         'Cancelled',
}

export const priorityColor: Record<OrderPriority, string> = {
  low:      '#6b7280',
  normal:   '#3b82f6',
  high:     '#f59e0b',
  critical: '#ef4444',
}

export const severityColor: Record<IncidentSeverity, string> = {
  low:      '#10b981',
  medium:   '#f59e0b',
  high:     '#f97316',
  critical: '#ef4444',
}

export const incidentStatusLabel: Record<IncidentStatus, string> = {
  detected:    'Detected',
  analyzing:   'Analyzing',
  action_taken: 'Action Taken',
  monitoring:  'Monitoring',
  resolved:    'Resolved',
  escalated:   'Escalated',
}

// ── Formatting ─────────────────────────────────────────────────────────────────
export function formatMinutes(min: number | null | undefined): string {
  if (min == null) return '—'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function formatKm(km: number | null | undefined): string {
  if (km == null) return '—'
  return `${km.toFixed(1)} km`
}

export function formatKg(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`
  return `${kg.toFixed(0)} kg`
}

export function formatCurrency(amount: number, unit = '₹'): string {
  if (amount >= 100000) return `${unit}${(amount/100000).toFixed(1)}L`
  if (amount >= 1000) return `${unit}${(amount/1000).toFixed(1)}k`
  return `${unit}${amount.toFixed(0)}`
}

export function formatPercent(val: number): string {
  return `${val.toFixed(1)}%`
}

export function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function formatDateTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

// ── Vehicle type icon letter ───────────────────────────────────────────────────
export const vehicleTypeLabel: Record<string, string> = {
  van: 'Van',
  truck: 'Truck',
  cargo_bike: 'Cargo Bike',
  motorcycle: 'Motorcycle',
  refrigerated: 'Refrigerated',
}

// ── Class name helper ──────────────────────────────────────────────────────────
export function cx(...args: (string | false | null | undefined)[]): string {
  return args.filter(Boolean).join(' ')
}

// ── Health score color ─────────────────────────────────────────────────────────
export function healthColor(score: number): string {
  if (score >= 85) return '#10b981'
  if (score >= 65) return '#f59e0b'
  if (score >= 40) return '#f97316'
  return '#ef4444'
}
