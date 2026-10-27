import { useQuery } from '@tanstack/react-query'
import { X, MapPin, Package, Truck, Snowflake, AlertTriangle } from 'lucide-react'
import { ordersApi } from '../../services/api'
import { useWSStore } from '../../stores/wsStore'
import {
  orderStatusColor, orderStatusLabel, priorityColor,
  formatKg, formatKm, formatMinutes, formatDateTime, timeAgo, parseApiDate,
} from '../../lib/utils'
import { Badge, KeyValue, ErrorState, Skeleton } from '../ui'
import type { Order } from '../../types'

function StatusBadge({ status }: { status: Order['status'] }) {
  return <Badge color={orderStatusColor[status]}>{orderStatusLabel[status]}</Badge>
}

function PriorityBadge({ priority }: { priority: Order['priority'] }) {
  return <Badge color={priorityColor[priority]} className="uppercase">{priority}</Badge>
}

interface Milestone { label: string; at: string }

function Timeline({ order }: { order: Order }) {
  const milestones: Milestone[] = [
    order.created_at && { label: 'Created', at: order.created_at },
    order.assigned_at && { label: 'Assigned to vehicle', at: order.assigned_at },
    order.picked_up_at && { label: 'Picked up', at: order.picked_up_at },
    order.delivered_at && { label: 'Delivered', at: order.delivered_at },
  ].filter(Boolean) as Milestone[]

  if (!milestones.length) return null
  return (
    <ol className="relative ml-1 space-y-3 border-l border-line pl-4">
      {milestones.map((m, i) => (
        <li key={m.label} className="relative">
          <span
            className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface"
            style={{ backgroundColor: i === milestones.length - 1 ? orderStatusColor[order.status] : '#8190ad' }}
          />
          <div className="text-[13px] font-semibold text-ink">{m.label}</div>
          <div className="text-xs text-ink-3">{formatDateTime(m.at)} · {timeAgo(m.at)}</div>
        </li>
      ))}
    </ol>
  )
}

export default function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const vehicleMap = useWSStore(s => s.vehicleMap)
  const { data: order, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['orders', 'detail', orderId],
    queryFn: () => ordersApi.get(orderId),
    refetchInterval: 20_000,
  })

  const vehicleName = (id: string | null) =>
    id ? (vehicleMap.get(id)?.name ?? id) : null

  // predicted vs actual variance for delivered orders
  let variance: { pct: number; late: boolean } | null = null
  if (order?.status === 'delivered' && order.predicted_eta_minutes != null && order.actual_duration_min != null && order.predicted_eta_minutes > 0) {
    const pct = ((order.actual_duration_min - order.predicted_eta_minutes) / order.predicted_eta_minutes) * 100
    variance = { pct, late: pct > 0 }
  }

  // delivered on-time vs late relative to deadline
  let deliveredLate: boolean | null = null
  if (order?.status === 'delivered' && order.delivered_at && order.deadline) {
    deliveredLate = parseApiDate(order.delivered_at).getTime() > parseApiDate(order.deadline).getTime()
  }

  return (
    <>
      <div className="fixed inset-0 z-[1500] bg-ink/30" onMouseDown={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Order detail"
        className="fixed right-0 top-0 z-[1600] flex h-full w-full max-w-[400px] flex-col border-l border-line bg-surface shadow-pop"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Package size={16} className="text-brand" />
          <h2 className="text-sm font-bold text-ink">Order detail</h2>
          <div className="flex-1" />
          <button className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : isError || !order ? (
            <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
          ) : (
            <div className="space-y-5">
              {/* Header */}
              <div className="space-y-2">
                <div className="font-mono text-sm font-bold text-ink">{order.reference}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={order.status} />
                  <PriorityBadge priority={order.priority} />
                  {order.sla_at_risk && (
                    <Badge tone="warn" className="gap-1"><AlertTriangle size={11} /> SLA at risk</Badge>
                  )}
                </div>
                <div className="text-[13px] text-ink-2">{order.customer_name}</div>
              </div>

              {/* Addresses */}
              <section className="space-y-3">
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="mt-0.5 flex-shrink-0 text-cyan" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Pickup</div>
                    <div className="text-[13px] text-ink">{order.pickup.address}</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="mt-0.5 flex-shrink-0 text-ok" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Delivery</div>
                    <div className="text-[13px] text-ink">{order.delivery.address}</div>
                  </div>
                </div>
              </section>

              {/* Cargo */}
              <section className="space-y-2 rounded-lg border border-line bg-subtle p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <KeyValue label="Weight">{formatKg(order.weight_kg)}</KeyValue>
                  {order.region && <KeyValue label="Region">{order.region}</KeyValue>}
                </div>
                {(order.requires_refrigeration || order.fragile) && (
                  <div className="flex flex-wrap gap-2">
                    {order.requires_refrigeration && <Badge tone="cyan" className="gap-1"><Snowflake size={11} /> Refrigerated</Badge>}
                    {order.fragile && <Badge tone="warn" className="gap-1"><AlertTriangle size={11} /> Fragile</Badge>}
                  </div>
                )}
                {order.description && <div className="text-xs text-ink-2">{order.description}</div>}
              </section>

              {/* Assignment */}
              <section className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Assignment</div>
                <div className="flex items-center gap-2 text-[13px] text-ink">
                  <Truck size={14} className="text-ink-3" />
                  {vehicleName(order.assigned_vehicle_id) ?? 'Not yet assigned'}
                </div>
                {order.reassignment_count > 0 && (
                  <div className="text-xs text-warn">
                    Reassigned {order.reassignment_count} time{order.reassignment_count > 1 ? 's' : ''} after a breakdown
                  </div>
                )}
              </section>

              {/* Timeline */}
              <section className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Timeline</div>
                <Timeline order={order} />
              </section>

              {/* Durations & distances */}
              <section className="grid grid-cols-2 gap-3 border-t border-line pt-4">
                {order.status === 'delivered' ? (
                  <>
                    <KeyValue label={order.eta_source === 'ml' ? 'Predicted (ML)' : 'Predicted'}>{formatMinutes(order.predicted_eta_minutes)}</KeyValue>
                    <KeyValue label="Actual">{formatMinutes(order.actual_duration_min)}</KeyValue>
                    {variance && (
                      <div className="col-span-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Variance</div>
                        <div className={variance.late ? 'text-[13px] font-semibold text-warn' : 'text-[13px] font-semibold text-ok'}>
                          {variance.late ? '+' : ''}{variance.pct.toFixed(0)}% {variance.late ? 'over prediction' : 'under prediction'}
                        </div>
                      </div>
                    )}
                    {deliveredLate != null && (
                      <div className="col-span-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Deadline</div>
                        <div className={deliveredLate ? 'text-[13px] font-semibold text-bad' : 'text-[13px] font-semibold text-ok'}>
                          {deliveredLate ? 'Delivered late' : 'Delivered on time'}
                        </div>
                      </div>
                    )}
                    <KeyValue label="Est. distance">{formatKm(order.estimated_distance_km)}</KeyValue>
                    <KeyValue label="Actual distance">{formatKm(order.actual_distance_km)}</KeyValue>
                  </>
                ) : (
                  <>
                    <KeyValue label="Deadline">{formatDateTime(order.deadline)}</KeyValue>
                    <KeyValue label="ETA">{formatMinutes(order.eta_minutes)}</KeyValue>
                    <KeyValue label="Est. distance">{formatKm(order.estimated_distance_km)}</KeyValue>
                    <KeyValue label={order.eta_source === 'ml' ? 'Quoted ETA (ML)' : 'Quoted ETA'}>{formatMinutes(order.predicted_eta_minutes)}</KeyValue>
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
