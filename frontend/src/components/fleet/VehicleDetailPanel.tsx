import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Truck, User, X } from 'lucide-react'
import { vehiclesApi } from '../../services/api'
import { useWSStore } from '../../stores/wsStore'
import {
  cx, formatKg, formatMinutes, formatDateTime, healthColor, vehicleStatusColor, vehicleStatusLabel, vehicleTypeLabel,
  orderStatusLabel,
} from '../../lib/utils'
import { Badge, ErrorState, KeyValue, ProgressBar, Skeleton } from '../ui'

const fuelColor = (pct: number) => (pct > 30 ? '#059669' : pct > 15 ? '#d97706' : '#dc2626')

/**
 * Detail view for one vehicle. Slow facts come from GET /vehicles/{id};
 * fast-changing numbers (status, speed, fuel, load) are overlaid from the live socket.
 */
export default function VehicleDetailPanel({ vehicleId, onClose, className }: {
  vehicleId: string; onClose?: () => void; className?: string
}) {
  const { data: v, isLoading, error, refetch } = useQuery({
    queryKey: ['vehicle-detail', vehicleId],
    queryFn: () => vehiclesApi.get(vehicleId),
    refetchInterval: 10_000,
  })
  const live = useWSStore(s => s.vehicleMap.get(vehicleId))

  if (isLoading) {
    return (
      <div className={cx('space-y-3 p-4', className)}>
        <Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-32 w-full" />
      </div>
    )
  }
  if (error || !v) return <ErrorState message={error instanceof Error ? error.message : 'Vehicle not found'} onRetry={() => refetch()} />

  const status = live?.status ?? v.status
  const color = vehicleStatusColor[status]
  const fuel = live?.fuel_level ?? v.fuel_level
  const speed = live?.speed ?? v.speed
  const load = live?.current_load_kg ?? v.current_load_kg
  const health = live?.health_score ?? v.health_score
  const eta = live ? live.eta_minutes : v.eta_minutes
  const o = v.current_order

  return (
    <div className={cx('flex min-h-0 flex-col', className)}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span style={{ backgroundColor: `${color}1a`, color }} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"><Truck size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-ink">{v.name}</div>
          <div className="truncate text-xs text-ink-3">{v.registration ?? v.vehicle_id} · {vehicleTypeLabel[v.type] ?? v.type} · {v.region}</div>
        </div>
        <Badge color={color}>{vehicleStatusLabel[status]}</Badge>
        {onClose && <button className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink" onClick={onClose} aria-label="Close vehicle details"><X size={16} /></button>}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs"><span className="font-semibold text-ink-2">{v.fuel_type === 'electric' ? 'Battery' : 'Fuel'}</span><span className="text-ink-3">{fuel.toFixed(0)}% · ~{v.fuel_range_km.toFixed(0)} km range</span></div>
            <ProgressBar value={fuel} color={fuelColor(fuel)} />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs"><span className="font-semibold text-ink-2">Load</span><span className="text-ink-3">{formatKg(load)} / {formatKg(v.max_capacity_kg)}</span></div>
            <ProgressBar value={v.max_capacity_kg ? (load / v.max_capacity_kg) * 100 : 0} tone="brand" />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs"><span className="font-semibold text-ink-2">Health</span><span className="text-ink-3">{health.toFixed(0)}/100</span></div>
            <ProgressBar value={health} color={healthColor(health)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-lg bg-subtle p-3">
          <KeyValue label="Speed">{speed > 0 ? `${speed.toFixed(0)} km/h` : '—'}</KeyValue>
          <KeyValue label="Odometer">{v.odometer_km.toLocaleString('en-IN')} km</KeyValue>
          <KeyValue label="Today">{v.deliveries_today} drops</KeyValue>
        </div>

        {o ? (
          <div className="rounded-lg border border-line p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Current job</span>
              <div className="flex-1" />
              {o.sla_at_risk && <Badge tone="bad">SLA at risk</Badge>}
              <Badge tone="brand">{orderStatusLabel[o.status]}</Badge>
            </div>
            <Link to={`/orders?search=${encodeURIComponent(o.reference)}`} className="font-mono text-[13px] font-semibold text-brand hover:underline">{o.reference}</Link>
            <div className="text-xs text-ink-2">{o.customer_name} · {formatKg(o.weight_kg)}</div>
            <div className="mt-2 space-y-1 text-xs text-ink-2">
              <div><span className="text-ink-3">From </span>{o.pickup_address}</div>
              <div><span className="text-ink-3">To </span>{o.delivery_address}</div>
              <div><span className="text-ink-3">Deadline </span>{formatDateTime(o.deadline)}</div>
            </div>
            {eta != null && <div className="mt-2 text-sm font-bold text-brand">ETA {formatMinutes(eta)}</div>}
          </div>
        ) : (
          <div className="rounded-lg border border-line px-3 py-2 text-xs text-ink-3">
            {status === 'available' ? 'Idle and available for dispatch.' : 'No active job.'}
          </div>
        )}

        <div className="rounded-lg border border-line p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3"><User size={12} /> Driver</div>
          {v.driver ? (
            <div className="text-[13px]">
              <div className="font-semibold text-ink">{v.driver.full_name}</div>
              <div className="text-xs text-ink-3">{v.driver.phone ?? '—'}{v.driver.rating ? ` · ★ ${v.driver.rating}` : ''}</div>
            </div>
          ) : <div className="text-xs text-ink-3">No driver assigned</div>}
        </div>
      </div>
    </div>
  )
}
