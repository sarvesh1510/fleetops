import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Package, Plus, AlertTriangle } from 'lucide-react'
import { ordersApi } from '../services/api'
import { useRole } from '../hooks/useRole'
import { useWSStore } from '../stores/wsStore'
import {
  Page, PageHeader, PageContent, Section, Badge, SearchInput, Select, Segmented,
  Pagination, LoadingRows, ErrorState, EmptyState,
} from '../components/ui'
import {
  orderStatusColor, orderStatusLabel, priorityColor,
  formatKg, formatMinutes, formatDateTime, timeAgo, parseApiDate,
} from '../lib/utils'
import { REGIONS, type Order } from '../types'
import { areaFromAddress } from '../components/orders/zones'
import OrderDrawer from '../components/orders/OrderDrawer'
import CreateOrderModal from '../components/orders/CreateOrderModal'

const PAGE_SIZE = 25

// Status tabs map to a single `status` filter value ('' = all).
const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'delivered', label: 'Delivered' },
]

// Exact-status Select covers the full lifecycle (one source of truth with the tabs).
const STATUS_SELECT: { value: string; label: string }[] = [
  { value: '', label: 'Any status' },
  { value: 'pending', label: 'Pending' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'pickup_en_route', label: 'To pickup' },
  { value: 'picked_up', label: 'Picked up' },
  { value: 'delivery_en_route', label: 'Delivering' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const PRIORITY_SELECT: { value: string; label: string }[] = [
  { value: '', label: 'Any priority' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

const REGION_SEGMENTS: { value: string; label: string }[] = [
  { value: '', label: 'All regions' },
  ...REGIONS.map(r => ({ value: r, label: r })),
]

function StatusCell({ order }: { order: Order }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge color={orderStatusColor[order.status]}>{orderStatusLabel[order.status]}</Badge>
      {order.sla_at_risk && order.status !== 'delivered' && (
        <Badge tone="warn" className="gap-0.5"><AlertTriangle size={10} /> SLA at risk</Badge>
      )}
    </div>
  )
}

function DueCell({ order }: { order: Order }) {
  if (order.status === 'delivered') {
    const late = order.delivered_at && order.deadline
      ? parseApiDate(order.delivered_at).getTime() > parseApiDate(order.deadline).getTime()
      : null
    return (
      <div>
        <div className="text-ink">{formatDateTime(order.delivered_at)}</div>
        {late != null && (
          <div className={late ? 'text-xs text-bad' : 'text-xs text-ok'}>{late ? 'Late' : 'On time'}</div>
        )}
      </div>
    )
  }
  return (
    <div>
      <div className="text-ink">{formatDateTime(order.deadline)}</div>
      {order.eta_minutes != null && <div className="text-xs text-ink-3">ETA {formatMinutes(order.eta_minutes)}</div>}
    </div>
  )
}

export default function OrdersPage() {
  const { canCreateOrders } = useRole()
  const vehicleMap = useWSStore(s => s.vehicleMap)
  const [searchParams, setSearchParams] = useSearchParams()

  // Search: initialise from ?search= and debounce the server param by 300ms.
  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') ?? '')
  const [search, setSearch] = useState(searchInput)
  const firstRun = useRef(true)
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
      // keep the URL in sync so links to this page stay shareable
      const next = new URLSearchParams(searchParams)
      if (searchInput) next.set('search', searchInput)
      else next.delete('search')
      setSearchParams(next, { replace: true })
    }, firstRun.current ? 0 : 300)
    firstRun.current = false
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [region, setRegion] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const filters = { status, priority, region, search }

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['orders', filters, page],
    queryFn: () => ordersApi.list({
      status: status || undefined,
      priority: priority || undefined,
      region: region || undefined,
      search: search || undefined,
      page,
      page_size: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  })

  const { data: stats } = useQuery({
    queryKey: ['order-stats'],
    queryFn: () => ordersApi.stats(),
    refetchInterval: 20_000,
  })

  const subtitle = stats
    ? `${stats.pending} pending · ${stats.active} in progress · ${stats.delivered_today} delivered today`
    : 'Delivery orders across Mumbai MMR and Delhi NCR'

  function clearFilters() {
    setStatus(''); setPriority(''); setRegion('')
    setSearchInput('')
    setPage(1)
  }

  const activeFilters = Boolean(status || priority || region || search)
  const orders = data?.items ?? []

  const vehicleLabel = (id: string | null) => {
    if (!id) return '—'
    const v = vehicleMap.get(id)
    if (v) return v.name
    return id.length > 14 ? id.slice(-8) : id
  }

  const newOrderButton = canCreateOrders ? (
    <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
      <Plus size={15} /> New order
    </button>
  ) : (
    <button className="btn btn-primary" disabled title="Requires dispatcher role" aria-label="New order (requires dispatcher role)">
      <Plus size={15} /> New order
    </button>
  )

  return (
    <Page>
      <PageHeader title="Orders" subtitle={subtitle} icon={Package} actions={newOrderButton} />

      <PageContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            className="w-64"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search reference or customer…"
          />
          <Segmented
            label="Status"
            value={STATUS_TABS.some(t => t.value === status) ? status : ''}
            onChange={v => { setStatus(v); setPage(1) }}
            options={STATUS_TABS}
          />
          <Select
            label="Exact status"
            value={status}
            onChange={v => { setStatus(v); setPage(1) }}
            options={STATUS_SELECT}
          />
          <Select
            label="Priority"
            value={priority}
            onChange={v => { setPriority(v); setPage(1) }}
            options={PRIORITY_SELECT}
          />
          <Segmented
            label="Region"
            value={region}
            onChange={v => { setRegion(v); setPage(1) }}
            options={REGION_SEGMENTS}
          />
          {isFetching && !isLoading && <span className="text-xs text-ink-3">Updating…</span>}
        </div>

        <Section bodyClassName="p-0">
          {isLoading ? (
            <LoadingRows rows={8} />
          ) : isError ? (
            <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
          ) : orders.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No orders match"
              hint={activeFilters ? 'Try widening or clearing the filters.' : 'New orders from the simulation will appear here.'}
              action={activeFilters ? <button className="btn btn-ghost btn-sm mt-1" onClick={clearFilters}>Clear filters</button> : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Customer</th>
                    <th>Route</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Vehicle</th>
                    <th>Due / ETA</th>
                    <th>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr
                      key={o.order_id}
                      className={selectedId === o.order_id ? 'is-clickable is-selected' : 'is-clickable'}
                      onClick={() => setSelectedId(o.order_id)}
                    >
                      <td>
                        <div className="font-mono text-[13px] font-bold text-ink">{o.reference}</div>
                        <div className="text-xs text-ink-3">{timeAgo(o.created_at)}</div>
                      </td>
                      <td className="max-w-[160px] truncate text-ink-2">{o.customer_name}</td>
                      <td className="whitespace-nowrap text-ink-2">
                        {areaFromAddress(o.pickup?.address)} <span className="text-ink-3">→</span> {areaFromAddress(o.delivery?.address)}
                      </td>
                      <td><Badge color={priorityColor[o.priority]} className="uppercase">{o.priority}</Badge></td>
                      <td><StatusCell order={o} /></td>
                      <td className="whitespace-nowrap text-ink-2">{vehicleLabel(o.assigned_vehicle_id)}</td>
                      <td className="whitespace-nowrap text-[13px]"><DueCell order={o} /></td>
                      <td className="whitespace-nowrap text-ink-2">{formatKg(o.weight_kg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && (
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              onChange={setPage}
            />
          )}
        </Section>
      </PageContent>

      {selectedId && <OrderDrawer orderId={selectedId} onClose={() => setSelectedId(null)} />}
      <CreateOrderModal open={showCreate} onClose={() => setShowCreate(false)} />
    </Page>
  )
}
