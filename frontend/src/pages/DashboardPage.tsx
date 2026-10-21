import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Truck, Package, Clock, AlertTriangle, Activity, SlidersHorizontal, ChevronDown, ChevronUp,
} from 'lucide-react'
import { vehiclesApi, ordersApi, incidentsApi } from '../services/api'
import { useWSStore } from '../stores/wsStore'
import { formatPct, timeAgo, vehicleStatusColor, vehicleStatusLabel, cx } from '../lib/utils'
import type { FleetStats, OrderStats, IncidentStats, Region, VehicleStatus } from '../types'
import { PageHeader, StatTile, Segmented } from '../components/ui'
import FleetMap from '../components/map/FleetMap'
import VehicleDetailPanel from '../components/fleet/VehicleDetailPanel'
import SimulationMenu from '../components/dashboard/SimulationMenu'

type RegionFilter = Region | 'all'
const REGION_OPTS: { value: RegionFilter; label: string }[] = [
  { value: 'Mumbai MMR', label: 'Mumbai MMR' },
  { value: 'Delhi NCR', label: 'Delhi NCR' },
  { value: 'all', label: 'All' },
]

const FEED_DOT: Record<string, string> = {
  info: '#3b82f6', success: '#10b981', warning: '#f59e0b', error: '#ef4444',
}

const LEGEND: { status: VehicleStatus; label: string }[] = [
  { status: 'en_route', label: 'En route' },
  { status: 'available', label: 'Available' },
  { status: 'loading', label: 'Loading' },
  { status: 'breakdown', label: 'Breakdown' },
  { status: 'maintenance', label: 'Maintenance' },
]

export default function DashboardPage() {
  const navigate = useNavigate()
  const [region, setRegion] = useState<RegionFilter>('Mumbai MMR')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [simOpen, setSimOpen] = useState(false)
  const [feedOpen, setFeedOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1280 : false,
  )

  const connected = useWSStore(s => s.connected)
  const vehicleMap = useWSStore(s => s.vehicleMap)
  const liveEvents = useWSStore(s => s.liveEvents)
  const clearEvents = useWSStore(s => s.clearEvents)
  const traffic = useWSStore(s => s.traffic)

  const { data: fleetStats } = useQuery<FleetStats>({
    queryKey: ['fleet-stats'], queryFn: () => vehiclesApi.stats(), refetchInterval: 15_000,
  })
  const { data: orderStats } = useQuery<OrderStats>({
    queryKey: ['order-stats'], queryFn: () => ordersApi.stats(), refetchInterval: 15_000,
  })
  const { data: incidentStats } = useQuery<IncidentStats>({
    queryKey: ['incident-stats'], queryFn: () => incidentsApi.stats(), refetchInterval: 15_000,
  })

  // Vehicles shown on the map for the current region (fast count from the live store).
  const shown = region === 'all'
    ? vehicleMap.size
    : Array.from(vehicleMap.values()).filter(v => v.region === region).length

  const activeCount = fleetStats?.active ?? 0
  const totalCount = fleetStats?.total ?? vehicleMap.size

  const incidentsActive = incidentStats?.active ?? 0
  const trafficFactor = region !== 'all' ? traffic[region] ?? 1 : 1
  const showTraffic = region !== 'all' && trafficFactor >= 1.5

  const subtitle = `${region === 'all' ? 'All regions' : region} · ${shown} vehicle${shown === 1 ? '' : 's'} shown`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Operations"
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-2">
            {showTraffic && (
              <span className="hidden items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn sm:inline-flex">
                <AlertTriangle size={12} /> Heavy traffic in {region} (x{trafficFactor.toFixed(1)})
              </span>
            )}
            <Segmented<RegionFilter>
              label="Region filter"
              size="sm"
              value={region}
              onChange={r => { setRegion(r); setSelectedVehicleId(null) }}
              options={REGION_OPTS}
            />
            <div className="relative">
              <button
                className="btn btn-ghost btn-sm"
                aria-haspopup="dialog"
                aria-expanded={simOpen}
                onClick={() => setSimOpen(o => !o)}
              >
                <SlidersHorizontal size={14} /> Simulation
              </button>
              {simOpen && <SimulationMenu onClose={() => setSimOpen(false)} />}
            </div>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid flex-shrink-0 grid-cols-2 gap-3 border-b border-line bg-surface px-5 py-3 lg:grid-cols-4">
        <StatTile
          icon={Truck}
          tone="brand"
          label="Vehicles active"
          value={`${activeCount} of ${totalCount}`}
          sub="en route or working"
        />
        <StatTile
          icon={Package}
          tone="ok"
          label="Orders today"
          value={`${orderStats?.delivered_today ?? 0} of ${orderStats?.total_today ?? 0}`}
          sub={`${orderStats?.pending ?? 0} pending · ${orderStats?.active ?? 0} active`}
        />
        <StatTile
          icon={Clock}
          tone="cyan"
          label="On-time today"
          value={formatPct(orderStats?.on_time_rate ?? null, 0)}
          sub={`${orderStats?.at_risk ?? 0} at risk`}
        />
        <button
          type="button"
          onClick={() => navigate('/incidents')}
          className="rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          aria-label="Open incidents"
        >
          <StatTile
            icon={AlertTriangle}
            tone={incidentsActive > 0 ? 'bad' : 'neutral'}
            label="Open incidents"
            value={incidentsActive}
            sub={incidentsActive > 0 ? 'needs attention' : 'all clear'}
          />
        </button>
      </div>

      {/* Map hero + overlays */}
      <div className="relative min-h-0 flex-1">
        <FleetMap region={region} selectedVehicleId={selectedVehicleId} onSelect={setSelectedVehicleId} />

        {/* No vehicles yet */}
        {vehicleMap.size === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
            <div className="rounded-lg bg-surface/90 px-4 py-2 text-sm text-ink-2 shadow-card">
              Waiting for fleet data…
            </div>
          </div>
        )}

        {/* Disconnected banner */}
        {!connected && (
          <div className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-warn-soft px-3 py-1 text-xs font-semibold text-warn shadow-card" role="alert">
            Live updates paused — reconnecting…
          </div>
        )}

        {/* Live feed (top-left, collapsible) */}
        <div className="absolute left-3 top-3 z-[1000] w-[300px] max-w-[calc(100%-24px)]">
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left"
              onClick={() => setFeedOpen(o => !o)}
              aria-expanded={feedOpen}
            >
              <Activity size={14} className="text-brand" />
              <span className="text-[13px] font-bold text-ink">Live feed</span>
              <span className="rounded-full bg-hover px-1.5 text-[11px] font-semibold text-ink-2">{liveEvents.length}</span>
              <span className="flex-1" />
              {feedOpen && liveEvents.length > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  className="rounded px-1.5 py-0.5 text-xs text-ink-3 hover:bg-hover hover:text-ink"
                  onClick={(e) => { e.stopPropagation(); clearEvents() }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); clearEvents() } }}
                >
                  Clear
                </span>
              )}
              {feedOpen ? <ChevronUp size={14} className="text-ink-3" /> : <ChevronDown size={14} className="text-ink-3" />}
            </button>
            {feedOpen && (
              <div className="max-h-[60vh] overflow-y-auto border-t border-line">
                {liveEvents.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-ink-3">Waiting for events…</div>
                ) : (
                  liveEvents.map(ev => (
                    <div key={ev.id} className="flex items-start gap-2 border-b border-line px-3 py-2 last:border-b-0">
                      <span
                        style={{ backgroundColor: FEED_DOT[ev.severity] ?? FEED_DOT.info }}
                        className="mt-1 h-2 w-2 flex-shrink-0 rounded-full"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-ink">{ev.title}</div>
                        {ev.detail && <div className="truncate text-xs text-ink-3">{ev.detail}</div>}
                      </div>
                      <span className="flex-shrink-0 text-[11px] text-ink-3">{timeAgo(ev.timestamp)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Selected vehicle (top-right) */}
        {selectedVehicleId && (
          <div className="absolute right-3 top-3 z-[1000] w-[340px] max-w-[calc(100%-24px)]">
            <div className="card max-h-[calc(100%-24px)] overflow-hidden shadow-pop">
              <VehicleDetailPanel
                vehicleId={selectedVehicleId}
                onClose={() => setSelectedVehicleId(null)}
                className="max-h-[70vh]"
              />
            </div>
          </div>
        )}

        {/* Legend (bottom-left) */}
        <div className="absolute bottom-3 left-3 z-[1000] flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface/95 px-3 py-1.5 shadow-card">
          {LEGEND.map(({ status, label }) => (
            <span key={status} className={cx('flex items-center gap-1.5 text-[11px] text-ink-2')}>
              <span style={{ backgroundColor: vehicleStatusColor[status] }} className="h-2 w-2 rounded-full" />
              {vehicleStatusLabel[status] ?? label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
