import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { RefreshCw, Truck } from 'lucide-react'
import { vehiclesApi } from '../services/api'
import { useWSStore } from '../stores/wsStore'
import {
  cx, formatKg, healthColor, vehicleStatusColor, vehicleStatusLabel, vehicleTypeLabel,
} from '../lib/utils'
import type { FleetStats, Paginated, Region, Vehicle, VehicleStatus, VehicleType } from '../types'
import {
  Badge, EmptyState, ErrorState, LoadingRows, Page, PageHeader, Pagination,
  ProgressBar, SearchInput, Segmented, Select,
} from '../components/ui'
import VehicleDetailPanel from '../components/fleet/VehicleDetailPanel'

const PAGE_SIZE = 25

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  ...(['available', 'en_route', 'loading', 'unloading', 'idle', 'maintenance', 'breakdown', 'offline'] as VehicleStatus[])
    .map(s => ({ value: s, label: vehicleStatusLabel[s] })),
]

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All types' },
  ...(['van', 'truck', 'cargo_bike', 'motorcycle', 'refrigerated'] as VehicleType[])
    .map(t => ({ value: t, label: vehicleTypeLabel[t] ?? t })),
]

const REGION_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'Mumbai MMR', label: 'Mumbai MMR' },
  { value: 'Delhi NCR', label: 'Delhi NCR' },
]

/** Debounce a changing value so the server-side search only fires after typing settles. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/** One table row. Live socket values override the slower REST row where present. */
function FleetRow({ vehicle, selected, onToggle }: {
  vehicle: Vehicle; selected: boolean; onToggle: () => void
}) {
  const live = useWSStore(s => s.vehicleMap.get(vehicle.vehicle_id))
  const status = live?.status ?? vehicle.status
  const speed = live?.speed ?? vehicle.speed
  const fuel = live?.fuel_level ?? vehicle.fuel_level
  const load = live?.current_load_kg ?? vehicle.current_load_kg
  const health = live?.health_score ?? vehicle.health_score
  const capacity = vehicle.max_capacity_kg

  const color = vehicleStatusColor[status]
  const fuelColor = fuel < 15 ? '#dc2626' : fuel < 30 ? '#d97706' : '#059669'
  const loadPct = capacity > 0 ? (load / capacity) * 100 : 0

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggle()
    }
  }

  return (
    <tr
      className={cx('is-clickable', selected && 'is-selected')}
      onClick={onToggle}
      onKeyDown={onKey}
      tabIndex={0}
      aria-selected={selected}
    >
      <td>
        <div className="font-semibold text-ink">{vehicle.name}</div>
        <div className="text-xs text-ink-3">
          {vehicle.registration ?? vehicle.vehicle_id} · {vehicleTypeLabel[vehicle.type] ?? vehicle.type}
        </div>
      </td>
      <td><Badge color={color}>{vehicleStatusLabel[status]}</Badge></td>
      <td className="text-ink-2">{vehicle.region}</td>
      <td className="font-mono text-ink-2">{speed > 0 ? `${speed.toFixed(0)} km/h` : '—'}</td>
      <td>
        <div className="flex items-center gap-2">
          <ProgressBar value={fuel} color={fuelColor} className="w-16" />
          <span className={cx('tabular-nums text-xs', fuel < 15 ? 'font-semibold text-bad' : 'text-ink-2')}>
            {fuel.toFixed(0)}%
          </span>
        </div>
      </td>
      <td>
        <div className="flex items-center gap-2">
          <ProgressBar value={loadPct} tone="brand" className="w-16" />
          <span className="whitespace-nowrap text-xs text-ink-2">
            {formatKg(load)} / {formatKg(capacity)}
          </span>
        </div>
      </td>
      <td style={{ color: healthColor(health) }} className="font-semibold tabular-nums">{health.toFixed(0)}</td>
      <td className="font-mono text-xs">
        {vehicle.current_order_id
          ? <span className="text-brand">{vehicle.current_order_id.slice(-8)}</span>
          : <span className="text-ink-3">—</span>}
      </td>
    </tr>
  )
}

export default function FleetPage() {
  const [search, setSearch] = useState('')
  const [region, setRegion] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [type, setType] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const debouncedSearch = useDebounced(search, 300)

  const filters = useMemo(
    () => ({ status, type, region, search: debouncedSearch }),
    [status, type, region, debouncedSearch],
  )

  // Reset to the first page whenever any filter changes.
  const prevFilters = useRef(filters)
  useEffect(() => {
    if (prevFilters.current !== filters) {
      prevFilters.current = filters
      setPage(1)
    }
  }, [filters])

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['vehicles', filters, page],
    queryFn: () => vehiclesApi.list({
      status: status === 'all' ? undefined : status,
      type: type === 'all' ? undefined : type,
      region: region === 'all' ? undefined : (region as Region),
      search: debouncedSearch || undefined,
      page,
      page_size: PAGE_SIZE,
    }) as Promise<Paginated<Vehicle>>,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  })

  const { data: stats } = useQuery({
    queryKey: ['fleet-stats'],
    queryFn: () => vehiclesApi.stats() as Promise<FleetStats>,
    refetchInterval: 15_000,
  })

  const items = data?.items ?? []
  const total = data?.total
  const pages = data?.pages ?? 1

  const hasActiveFilters = status !== 'all' || type !== 'all' || region !== 'all' || debouncedSearch !== ''
  const clearFilters = () => { setSearch(''); setRegion('all'); setStatus('all'); setType('all') }

  const subtitle = total != null ? `${total.toLocaleString('en-IN')} vehicle${total === 1 ? '' : 's'}` : 'Loading…'

  // Status summary chips: show every status present in the fleet, with its live count.
  const statusChips = stats
    ? (Object.keys(stats.by_status) as VehicleStatus[])
      .filter(s => vehicleStatusLabel[s])
      .sort((a, b) => stats.by_status[b] - stats.by_status[a])
    : []

  return (
    <Page>
      <PageHeader
        title="Fleet"
        subtitle={subtitle}
        icon={Truck}
        actions={
          <button className="btn btn-ghost" onClick={() => refetch()} aria-label="Refresh fleet">
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} /> Refresh
          </button>
        }
      />

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-5">
        {/* Main column: filters + table */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search name, registration or ID"
              className="w-64"
            />
            <Segmented
              label="Region"
              options={REGION_OPTIONS}
              value={region}
              onChange={setRegion}
            />
            <Select label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
            <Select label="Type" value={type} onChange={setType} options={TYPE_OPTIONS} />
          </div>

          {/* Clickable status summary chips (replaces KPI cards) */}
          {statusChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
              {statusChips.map(s => {
                const active = status === s
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStatus(active ? 'all' : s)}
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                      active ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink-2 hover:bg-hover',
                    )}
                  >
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: vehicleStatusColor[s] }} />
                    {vehicleStatusLabel[s]}
                    <span className="tabular-nums text-ink-3">{stats!.by_status[s].toLocaleString('en-IN')}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Table card */}
          <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-auto">
              {isLoading ? (
                <LoadingRows rows={10} />
              ) : isError ? (
                <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
              ) : items.length === 0 ? (
                <EmptyState
                  icon={Truck}
                  title="No vehicles match"
                  hint={hasActiveFilters
                    ? 'No vehicles match the current filters. Try widening or clearing them.'
                    : 'No vehicles are available. The simulation may still be starting — try refreshing in a moment.'}
                  action={hasActiveFilters
                    ? <button className="btn btn-ghost btn-sm mt-1" onClick={clearFilters}>Clear filters</button>
                    : undefined}
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      <th>Status</th>
                      <th>Region</th>
                      <th>Speed</th>
                      <th>Fuel / Charge</th>
                      <th>Load</th>
                      <th>Health</th>
                      <th>Job</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(v => (
                      <FleetRow
                        key={v.vehicle_id}
                        vehicle={v}
                        selected={selectedId === v.vehicle_id}
                        onToggle={() => setSelectedId(id => (id === v.vehicle_id ? null : v.vehicle_id))}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {!isLoading && !isError && items.length > 0 && (
              <Pagination page={page} pages={pages} total={total} onChange={setPage} />
            )}
          </div>
        </div>

        {/* Right-hand detail drawer */}
        {selectedId && (
          <aside className="card flex w-[380px] flex-shrink-0 flex-col overflow-hidden" aria-label="Vehicle details">
            <VehicleDetailPanel
              vehicleId={selectedId}
              onClose={() => setSelectedId(null)}
              className="min-h-0 flex-1"
            />
          </aside>
        )}
      </div>
    </Page>
  )
}
