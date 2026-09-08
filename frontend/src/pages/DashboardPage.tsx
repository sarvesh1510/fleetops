import { useState, lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Truck, Package, AlertTriangle, Activity,
  TrendingUp, Clock, CloudRain, Wrench, IndianRupee,
  Zap, Play, Pause, Lock
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { vehiclesApi, ordersApi, incidentsApi, simApi, analyticsApi } from '../services/api'
import { useWSStore } from '../stores/wsStore'
import { useRole } from '../hooks/useRole'
import { formatMinutes, vehicleStatusColor, vehicleStatusLabel, timeAgo, orderStatusColor, orderStatusLabel } from '../lib/utils'
import type { Vehicle, LiveEvent } from '../types'

const FleetMap = lazy(() => import('../components/map/FleetMap'))

function StatCard({ label, value, sub, color, icon: Icon, alert }: {
  label: string; value: string | number; sub?: string
  color?: string; icon: React.ElementType; alert?: boolean
}) {
  return (
    <div className="card" style={{ padding: '13px 16px', display: 'flex', gap: 12, alignItems: 'flex-start', borderColor: alert ? '#dc262640' : undefined }}>
      <div style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0, background: `${color || '#2563eb'}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={16} style={{ color: color || '#2563eb' }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: alert ? '#dc2626' : 'var(--text-primary)', marginTop: 2, letterSpacing: '-0.02em' }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  )
}

function EventRow({ event }: { event: LiveEvent }) {
  const colors = { info: '#2563eb', warning: '#d97706', error: '#dc2626', success: '#059669' }
  const color = colors[event.severity || 'info']
  return (
    <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', alignItems: 'flex-start' }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, marginTop: 5, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>{event.title}</div>
        {event.detail && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.detail}</div>}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, marginTop: 1 }}>{timeAgo(event.timestamp)}</div>
    </div>
  )
}

function SimControls() {
  const { simSpeed, connected } = useWSStore()
  const { canControlSim, canTriggerEvents, isDispatcherOrAbove, roleLabel } = useRole()
  const navigate = useNavigate()
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState('')

  const run = async (fn: () => Promise<unknown>, key: string) => {
    setLoading(key)
    try { await fn() } finally { setLoading('') }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span className="section-title" style={{ marginRight: 2 }}>SIMULATION</span>

      {/* Pause/Resume - ops+ only */}
      {canControlSim ? (
        <button onClick={() => run(async () => { if (paused) { await simApi.resume(); setPaused(false) } else { await simApi.pause(); setPaused(true) } }, 'pause')}
          disabled={!connected || loading === 'pause'} className="btn-ghost"
          style={{ padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          {paused ? <Play size={11}/> : <Pause size={11}/>}
          {loading === 'pause' ? '…' : paused ? 'Resume' : 'Pause'}
        </button>
      ) : null}

      {/* Speed buttons - ops+ only */}
      {canControlSim ? (
        <div style={{ display: 'flex', gap: 3 }}>
          {[1,3,5,10].map(s => (
            <button key={s} onClick={() => run(() => simApi.setSpeed(s), `spd${s}`)}
              disabled={!connected} style={{ padding: '5px 9px', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)', minWidth: 32, background: Math.round(simSpeed) === s ? 'var(--accent-blue)' : 'var(--bg-elevated)', color: Math.round(simSpeed) === s ? 'white' : 'var(--text-secondary)' }}>
              {loading === `spd${s}` ? '…' : `${s}×`}
            </button>
          ))}
        </div>
      ) : null}

      {(canControlSim || canTriggerEvents) && <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 2px' }} />}

      {/* Event triggers - dispatcher+ */}
      {isDispatcherOrAbove ? (
        <>
          <button onClick={() => run(simApi.triggerTraffic, 'traffic')} disabled={!connected || loading === 'traffic'}
            className="btn-ghost" style={{ padding: '4px 9px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
            <CloudRain size={11}/> {loading === 'traffic' ? '…' : 'Traffic'}
          </button>
          <button onClick={() => run(() => simApi.triggerBreakdown(), 'breakdown')} disabled={!connected || loading === 'breakdown'}
            className="btn-ghost" style={{ padding: '4px 9px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
            <Wrench size={11}/> {loading === 'breakdown' ? '…' : 'Breakdown'}
          </button>
          {/* "New Order" navigates to orders page - NOT random inject */}
          <button onClick={() => navigate('/orders')}
            className="btn-primary" style={{ padding: '4px 12px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
            <Package size={11}/> New Order
          </button>
        </>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Lock size={10}/> {roleLabel} — view only
        </div>
      )}
    </div>
  )
}

function VehiclePanel({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const { data: v, isLoading } = useQuery({
    queryKey: ['vehicle-detail', vehicleId],
    queryFn: () => vehiclesApi.get(vehicleId) as Promise<Vehicle & { driver?: { full_name: string; phone: string; rating: number; total_deliveries_today: number } }>,
    refetchInterval: 3000,
  })
  const live = useWSStore(s => s.vehicleMap.get(vehicleId))
  if (isLoading) return <div className="card" style={{ padding: 16, width: 268 }}><div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div></div>
  if (!v) return null

  const status = (live?.status ?? v.status) as Vehicle['status']
  const sc = vehicleStatusColor[status] || '#6b7280'
  const fuel = live?.fuel_level ?? v.fuel_level
  const speed = live?.speed ?? v.speed
  const load = live?.current_load_kg ?? v.current_load_kg
  const health = live?.health_score ?? v.health_score
  const eta = live?.eta_minutes ?? v.eta_minutes

  return (
    <div className="card" style={{ width: 268, overflow: 'hidden' }}>
      <div style={{ height: 3, background: sc }} />
      <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: `${sc}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Truck size={13} style={{ color: sc }}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</div>
          <div style={{ fontSize: 10, color: sc, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{vehicleStatusLabel[status] || status}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
      </div>
      <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['Speed', `${speed.toFixed(0)} km/h`], ['Fuel/Charge', `${fuel.toFixed(0)}%`], ['Load', `${load.toFixed(0)} kg`], ['Health', `${health.toFixed(0)}/100`], ['Type', v.type?.replace('_',' ')], ['Fuel', (v.fuel_type||'').toUpperCase()]].map(([l, val]) => (
          <div key={l}>
            <div className="stat-label" style={{ fontSize: 9 }}>{l}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '0 14px 10px' }}>
        <div style={{ height: 4, background: 'var(--bg-hover)', borderRadius: 2 }}>
          <div style={{ height: '100%', borderRadius: 2, width: `${fuel}%`, background: fuel > 30 ? '#059669' : fuel > 15 ? '#d97706' : '#dc2626', transition: 'width 0.5s' }} />
        </div>
      </div>
      {eta ? <div style={{ margin: '0 14px 10px', padding: '8px 10px', background: '#eff6ff', borderRadius: 6, border: '1px solid #dbeafe' }}>
        <div style={{ fontSize: 9, color: '#2563eb', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 2 }}>ETA TO DELIVERY</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#2563eb' }}>{formatMinutes(eta)}</div>
      </div> : null}
      {v.driver ? <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-subtle)' }}>
        <div className="section-title" style={{ marginBottom: 5 }}>DRIVER</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{v.driver.full_name}</div>
        {v.driver.phone && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{v.driver.phone}</div>}
        {v.driver.rating ? <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>★ {v.driver.rating} · {v.driver.total_deliveries_today ?? 0} deliveries today</div> : null}
      </div> : null}
      {v.current_order_id ? <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-subtle)', background: '#f0f9ff' }}>
        <div className="section-title" style={{ marginBottom: 3, color: '#0891b2' }}>ACTIVE ORDER</div>
        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#0891b2' }}>{v.current_order_id.slice(-12)}</div>
      </div> : null}
    </div>
  )
}

export default function DashboardPage() {
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [regionFilter, setRegionFilter] = useState<string>('all')
  const { liveEvents, vehicleMap, connected, pendingOrders } = useWSStore()

  const { data: fleetStats } = useQuery({ queryKey: ['fleet-stats'], queryFn: () => vehiclesApi.stats() as Promise<Record<string,unknown>>, refetchInterval: 7000 })
  const { data: orderStats } = useQuery({ queryKey: ['order-stats'], queryFn: () => ordersApi.stats() as Promise<Record<string,number>>, refetchInterval: 7000 })
  const { data: incidentStats } = useQuery({ queryKey: ['incident-stats'], queryFn: () => incidentsApi.stats() as Promise<Record<string,unknown>>, refetchInterval: 7000 })
  const { data: byHour } = useQuery({ queryKey: ['deliveries-hour'], queryFn: () => analyticsApi.deliveriesPerHour() as Promise<{hour:string;deliveries:number}[]>, refetchInterval: 30000 })
  const { data: overview } = useQuery({ queryKey: ['analytics-overview'], queryFn: () => analyticsApi.overview() as Promise<Record<string,number>>, refetchInterval: 20000 })

  const filteredVehicles = regionFilter === 'all' ? vehicleMap
    : new Map(Array.from(vehicleMap.entries()).filter(([,v]) => (v as Record<string,unknown>).region === regionFilter))

  const statsCards = [
    { label: 'Active Vehicles',  value: Number(fleetStats?.active ?? 0) || Array.from(vehicleMap.values()).filter(v=>v.status==='en_route').length, sub: `${Number(fleetStats?.total ?? vehicleMap.size)} fleet total`, color: '#2563eb', icon: Truck },
    { label: 'Deliveries Today', value: orderStats?.total_today ?? '—', sub: `${orderStats?.delivered_today ?? 0} completed`, color: '#059669', icon: Package },
    { label: 'On-Time Rate',     value: orderStats?.on_time_rate ? `${orderStats.on_time_rate}%` : '—', sub: `${orderStats?.at_risk ?? 0} SLA at risk`, color: (orderStats?.on_time_rate ?? 100) > 85 ? '#059669' : '#d97706', icon: TrendingUp },
    { label: 'Pending Orders',   value: pendingOrders || orderStats?.pending || 0, sub: 'awaiting dispatch', color: '#d97706', icon: Clock },
    { label: 'Active Incidents', value: Number(incidentStats?.active ?? 0), sub: `${Number(incidentStats?.total ?? 0)} total`, color: Number(incidentStats?.active ?? 0) > 0 ? '#dc2626' : '#6b7280', icon: AlertTriangle, alert: Number(incidentStats?.active ?? 0) > 2 },
    { label: 'Est. Cost Today',  value: overview?.estimated_cost_inr ? `₹${(overview.estimated_cost_inr/1000).toFixed(1)}k` : '—', sub: `₹${Math.round(overview?.cost_per_delivery_inr ?? 0)}/delivery`, color: '#7c3aed', icon: IndianRupee },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, background: 'var(--bg-surface)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Operations Centre</h1>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Mumbai MMR + Delhi NCR · Real-time</div>
        </div>
        <div style={{ flex: 1 }}/>
        <SimControls/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, background: connected ? '#f0fdf4' : '#fef2f2', border: `1px solid ${connected ? '#bbf7d0' : '#fecaca'}` }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#059669' : '#dc2626' }} className={connected ? 'pulse-live' : ''}/>
          <span style={{ fontSize: 11, fontWeight: 600, color: connected ? '#059669' : '#dc2626' }}>{connected ? 'LIVE' : 'CONNECTING'}</span>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8, flexShrink: 0 }}>
        {statsCards.map(c => <StatCard key={c.label} {...c}/>)}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left feed */}
        <div style={{ width: 248, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={12} style={{ color: '#2563eb' }}/>
            <span className="section-title">LIVE FEED</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 8 }}>{liveEvents.length}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {liveEvents.length === 0
              ? <div style={{ padding: '28px 16px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                  <Zap size={22} style={{ marginBottom: 8, color: '#d1d5db' }}/><br/>Waiting for events…
                  <div style={{ fontSize: 10, marginTop: 6, lineHeight: 1.5 }}>Events appear as vehicles move, orders are assigned, and incidents occur</div>
                </div>
              : liveEvents.slice(0,60).map(ev => <EventRow key={ev.id} event={ev}/>)}
          </div>
        </div>

        {/* Map */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1100, display: 'flex', gap: 4, background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border)', borderRadius: 8, padding: 4, boxShadow: '0 2px 8px rgba(15,28,63,0.10)' }}>
            {['all','Mumbai MMR','Delhi NCR'].map(r => (
              <button key={r} onClick={() => setRegionFilter(r)} style={{ padding: '4px 12px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: regionFilter === r ? '#2563eb' : 'transparent', color: regionFilter === r ? 'white' : 'var(--text-secondary)', transition: 'all 0.15s' }}>
                {r === 'all' ? 'All Regions' : r}
              </button>
            ))}
          </div>
          <Suspense fallback={<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexDirection: 'column', gap: 8 }}><div style={{ fontSize: 28 }}>🗺️</div><div>Loading map…</div></div>}>
            <FleetMap selectedVehicleId={selectedVehicleId} onVehicleSelect={setSelectedVehicleId} filteredVehicles={filteredVehicles}/>
          </Suspense>
          {selectedVehicleId && (
            <div style={{ position: 'absolute', top: 52, left: 12, zIndex: 1100 }}>
              <VehiclePanel vehicleId={selectedVehicleId} onClose={() => setSelectedVehicleId(null)}/>
            </div>
          )}
        </div>

        {/* Right charts */}
        <div style={{ width: 268, flexShrink: 0, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', overflowY: 'auto' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="section-title" style={{ marginBottom: 10 }}>FLEET STATUS</div>
            {fleetStats?.by_status ? Object.entries((fleetStats.by_status as unknown) as Record<string,number>).sort(([,a],[,b]) => b-a).map(([s,cnt]) => {
              const sc2 = vehicleStatusColor[s as keyof typeof vehicleStatusColor] || '#6b7280'
              const tot = Number(fleetStats.total||1)
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: sc2, flexShrink: 0 }}/>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>{vehicleStatusLabel[s as keyof typeof vehicleStatusLabel] || s}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', minWidth: 18, textAlign: 'right' }}>{cnt}</div>
                  <div style={{ width: 42, height: 4, borderRadius: 2, background: 'var(--bg-hover)', flexShrink: 0 }}>
                    <div style={{ height: '100%', borderRadius: 2, width: `${(cnt/tot)*100}%`, background: sc2 }}/>
                  </div>
                </div>
              )
            }) : null}
          </div>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="section-title" style={{ marginBottom: 10 }}>DELIVERIES / HOUR</div>
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={(byHour ?? []).slice(-12)} margin={{ top:0,right:0,left:-28,bottom:0 }}>
                <XAxis dataKey="hour" tick={{ fontSize:9, fill:'#9ca3af' }} interval={2}/>
                <YAxis tick={{ fontSize:9, fill:'#9ca3af' }}/>
                <Tooltip contentStyle={{ background:'#fff', border:'1px solid var(--border)', borderRadius:6, fontSize:11, boxShadow:'0 2px 8px rgba(0,0,0,0.08)' }}/>
                <Bar dataKey="deliveries" fill="#2563eb" radius={[2,2,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ padding: '12px 14px' }}>
            <div className="section-title" style={{ marginBottom: 10 }}>ORDER STATUS</div>
            {orderStats?.by_status ? Object.entries((orderStats.by_status as unknown) as Record<string,number>).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).map(([s,cnt2]) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: orderStatusColor[s as keyof typeof orderStatusColor] || '#6b7280', flexShrink: 0 }}/>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>{orderStatusLabel[s as keyof typeof orderStatusLabel] || s}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{cnt2}</div>
              </div>
            )) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
