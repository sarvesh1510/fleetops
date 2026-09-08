import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Truck, RefreshCw, X } from 'lucide-react'
import { vehiclesApi } from '../services/api'
import { useWSStore } from '../stores/wsStore'
import { vehicleStatusColor, vehicleStatusLabel, vehicleTypeLabel, formatKg, formatMinutes, healthColor } from '../lib/utils'
import type { Vehicle } from '../types'

const STATUS_OPTS = ['all','available','en_route','loading','unloading','idle','maintenance','breakdown']
const TYPE_OPTS   = ['all','van','truck','cargo_bike','motorcycle','refrigerated']

function FuelBar({ level }: { level: number }) {
  const color = level > 30 ? '#059669' : level > 15 ? '#d97706' : '#dc2626'
  return (
    <div style={{ width:60, height:4, background:'var(--bg-hover)', borderRadius:2 }}>
      <div style={{ width:`${level}%`, height:'100%', background:color, borderRadius:2, transition:'width 0.5s' }}/>
    </div>
  )
}

function VehicleDrawer({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const { data: v, isLoading } = useQuery({
    queryKey: ['vehicle-detail', vehicleId],
    queryFn: () => vehiclesApi.get(vehicleId) as Promise<Record<string,unknown>>,
    refetchInterval: 3000,
  })
  const live = useWSStore(s => s.vehicleMap.get(vehicleId))

  if (isLoading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', fontSize:13 }}>
      Loading vehicle…
    </div>
  )
  if (!v) return <div style={{ padding:20, color:'var(--text-muted)' }}>Vehicle not found</div>

  const status = String(live?.status ?? v.status ?? '')
  const sc = vehicleStatusColor[status as keyof typeof vehicleStatusColor] || '#6b7280'
  const fuel = live?.fuel_level ?? Number(v.fuel_level ?? 0)
  const speed = live?.speed ?? Number(v.speed ?? 0)
  const load = live?.current_load_kg ?? Number(v.current_load_kg ?? 0)
  const health = live?.health_score ?? Number(v.health_score ?? 100)
  const eta = live?.eta_minutes ?? (v.current_eta_minutes as number | null)
  const driver = v.driver as Record<string,unknown> | null

  return (
    <>
      {/* Header */}
      <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ width:36, height:36, borderRadius:8, background:`${sc}18`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <Truck size={16} style={{ color:sc }}/>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{String(v.name)}</div>
          <div style={{ fontSize:11, color:sc, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em' }}>{vehicleStatusLabel[status as keyof typeof vehicleStatusLabel] || status}</div>
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:20, lineHeight:1, padding:'2px 4px' }}><X size={16}/></button>
      </div>
      <div style={{ height:3, background:sc }}/>

      <div style={{ padding:'14px 16px', overflowY:'auto', flex:1 }}>
        {/* Fuel bar */}
        <div style={{ marginBottom:16 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, fontWeight:600, color:'var(--text-muted)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>
            <span>Fuel / Battery</span><span>{Number(fuel).toFixed(0)}%</span>
          </div>
          <div style={{ height:8, background:'var(--bg-hover)', borderRadius:4 }}>
            <div style={{ height:'100%', borderRadius:4, width:`${Math.min(fuel,100)}%`, background: fuel>30?'#059669':fuel>15?'#d97706':'#dc2626', transition:'width 0.5s' }}/>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
          {([
            ['Speed',      `${Number(speed).toFixed(0)} km/h`],
            ['Load',       formatKg(Number(load))],
            ['Capacity',   formatKg(Number(v.max_capacity_kg ?? 0))],
            ['Health',     `${Number(health).toFixed(0)}/100`],
            ['Odometer',   `${Number(v.odometer_km ?? 0).toFixed(0)} km`],
            ['Type',       String(v.type ?? '').replace(/_/g,' ')],
            ['Fuel Type',  String(v.fuel_type ?? '').toUpperCase()],
            ['Region',     String(v.region ?? '—')],
          ] as [string,string][]).map(([l, val]) => (
            <div key={l} style={{ background:'var(--bg-elevated)', borderRadius:6, padding:'8px 10px' }}>
              <div className="stat-label" style={{ fontSize:9, marginBottom:3 }}>{l}</div>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)' }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Health bar */}
        <div style={{ marginBottom:16 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, fontWeight:600, color:'var(--text-muted)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>
            <span>Vehicle Health</span><span style={{ color: healthColor(Number(health)) }}>{Number(health).toFixed(0)}/100</span>
          </div>
          <div style={{ height:6, background:'var(--bg-hover)', borderRadius:3 }}>
            <div style={{ height:'100%', borderRadius:3, width:`${Number(health)}%`, background: healthColor(Number(health)), transition:'width 0.5s' }}/>
          </div>
        </div>

        {/* ETA */}
        {eta ? (
          <div style={{ marginBottom:14, padding:'10px 12px', background:'#eff6ff', borderRadius:8, border:'1px solid #dbeafe' }}>
            <div style={{ fontSize:10, color:'#2563eb', fontWeight:700, letterSpacing:'0.06em', marginBottom:4 }}>ETA TO DELIVERY</div>
            <div style={{ fontSize:22, fontWeight:800, color:'#2563eb' }}>{formatMinutes(eta)}</div>
          </div>
        ) : null}

        {/* Active order */}
        {v.current_order_id ? (
          <div style={{ marginBottom:14, padding:'10px 12px', background:'#f0f9ff', borderRadius:8, border:'1px solid #bae6fd' }}>
            <div style={{ fontSize:10, color:'#0891b2', fontWeight:700, letterSpacing:'0.06em', marginBottom:4 }}>ACTIVE ORDER</div>
            <div style={{ fontSize:13, fontFamily:'var(--font-mono)', color:'#0891b2' }}>{String(v.current_order_id).slice(-16)}</div>
          </div>
        ) : (
          <div style={{ marginBottom:14, padding:'10px 12px', background:'#f0fdf4', borderRadius:8, border:'1px solid #bbf7d0' }}>
            <div style={{ fontSize:11, color:'#059669', fontWeight:600 }}>✓ Available for dispatch</div>
          </div>
        )}

        {/* Registration */}
        {v.registration ? (
          <div style={{ marginBottom:14, padding:'8px 12px', background:'var(--bg-elevated)', borderRadius:6 }}>
            <div className="section-title" style={{ marginBottom:3 }}>REGISTRATION</div>
            <div style={{ fontSize:13, fontFamily:'var(--font-mono)', color:'var(--text-primary)', fontWeight:700 }}>{String(v.registration)}</div>
          </div>
        ) : null}

        {/* Driver */}
        {driver ? (
          <div style={{ padding:'12px', background:'var(--bg-elevated)', borderRadius:8 }}>
            <div className="section-title" style={{ marginBottom:8 }}>DRIVER</div>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', marginBottom:4 }}>{String(driver.full_name ?? '')}</div>
            {driver.phone ? <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:3 }}>{String(driver.phone)}</div> : null}
            {driver.rating ? (
              <div style={{ fontSize:12, color:'#d97706' }}>
                ★ {String(driver.rating)} · {String(driver.total_deliveries_today ?? 0)} deliveries today
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ padding:'10px 12px', background:'var(--bg-elevated)', borderRadius:8 }}>
            <div className="section-title" style={{ marginBottom:4 }}>DRIVER</div>
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>No driver assigned</div>
          </div>
        )}
      </div>
    </>
  )
}

function VehicleRow({ vehicle, isSelected, onClick }: { vehicle: Vehicle; isSelected: boolean; onClick: () => void }) {
  const liveData = useWSStore(s => s.vehicleMap.get(vehicle.vehicle_id))
  const status = (liveData?.status ?? vehicle.status) as Vehicle['status']
  const fuel = liveData?.fuel_level ?? vehicle.fuel_level
  const speed = liveData?.speed ?? vehicle.speed
  const load = liveData?.current_load_kg ?? vehicle.current_load_kg
  const health = liveData?.health_score ?? vehicle.health_score
  const sColor = vehicleStatusColor[status] || '#6b7280'

  return (
    <tr onClick={onClick} style={{
      cursor:'pointer',
      background: isSelected ? '#eff6ff' : 'transparent',
      borderBottom:'1px solid var(--border-subtle)',
      transition:'background 0.1s',
      borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent',
    }}
      onMouseEnter={e => { if(!isSelected) e.currentTarget.style.background='var(--bg-elevated)' }}
      onMouseLeave={e => { if(!isSelected) e.currentTarget.style.background='transparent' }}>
      <td style={{ padding:'10px 16px', width:36 }}>
        <div style={{ width:8, height:8, borderRadius:'50%', background:sColor }}/>
      </td>
      <td style={{ padding:'10px 8px' }}>
        <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)' }}>{vehicle.name}</div>
        <div style={{ fontSize:10, color:'var(--text-muted)' }}>{vehicleTypeLabel[vehicle.type] || vehicle.type}</div>
      </td>
      <td style={{ padding:'10px 8px' }}>
        <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:100, background:`${sColor}18`, color:sColor, textTransform:'uppercase', letterSpacing:'0.04em' }}>
          {vehicleStatusLabel[status] || status}
        </span>
      </td>
      <td style={{ padding:'10px 8px', fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-secondary)' }}>
        {speed > 0 ? `${speed.toFixed(0)} km/h` : '—'}
      </td>
      <td style={{ padding:'10px 8px' }}>
        <FuelBar level={fuel}/>
        <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>{fuel.toFixed(0)}%</div>
      </td>
      <td style={{ padding:'10px 8px', fontSize:12, color:'var(--text-secondary)' }}>
        {load > 0 ? formatKg(load) : <span style={{ color:'var(--text-muted)' }}>Empty</span>}
      </td>
      <td style={{ padding:'10px 8px' }}>
        <span style={{ fontSize:12, fontWeight:700, color:healthColor(health) }}>{health.toFixed(0)}</span>
        <span style={{ fontSize:10, color:'var(--text-muted)' }}>/100</span>
      </td>
      <td style={{ padding:'10px 8px', fontSize:11, color:'var(--text-muted)', maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {vehicle.current_order_id
          ? <span style={{ color:'#2563eb', fontFamily:'var(--font-mono)' }}>{vehicle.current_order_id.slice(-8)}</span>
          : '—'}
      </td>
      <td style={{ padding:'10px 8px', fontSize:11, color:'var(--text-muted)' }}>
        {(vehicle as unknown as Record<string,unknown>).region ? String((vehicle as unknown as Record<string,unknown>).region) : '—'}
      </td>
    </tr>
  )
}

export default function FleetPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['vehicles', statusFilter, typeFilter, page],
    queryFn: () => vehiclesApi.list({
      status: statusFilter !== 'all' ? statusFilter : undefined,
      type: typeFilter !== 'all' ? typeFilter : undefined,
      page, page_size: 50,
    }) as Promise<{ items: Vehicle[]; total: number; pages: number }>,
    refetchInterval: 5000,
  })

  const { data: statsData } = useQuery({
    queryKey: ['fleet-stats'],
    queryFn: () => vehiclesApi.stats() as Promise<Record<string,unknown>>,
    refetchInterval: 8000,
  })

  const filtered = (data?.items ?? []).filter(v =>
    !search ||
    v.name?.toLowerCase().includes(search.toLowerCase()) ||
    (v.driver_id ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ height:'100%', display:'flex', overflow:'hidden' }}>
      {/* Main table area */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
        {/* Header */}
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', background:'var(--bg-surface)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
            <Truck size={18} style={{ color:'#2563eb' }}/>
            <h1 style={{ margin:0, fontSize:16, fontWeight:700 }}>Fleet Management</h1>
            {data?.total !== undefined && (
              <span style={{ fontSize:12, color:'var(--text-muted)', background:'var(--bg-elevated)', padding:'2px 8px', borderRadius:4 }}>
                {data.total} vehicles
              </span>
            )}
            {/* Region breakdown */}
            {statsData && (
              <div style={{ display:'flex', gap:8, marginLeft:8 }}>
                {['Mumbai MMR','Delhi NCR'].map(r => {
                  const count = (data?.items ?? []).filter(v => (v as unknown as Record<string,unknown>).region === r).length
                  return count > 0 ? (
                    <span key={r} style={{ fontSize:11, color:'var(--text-muted)', background:'var(--bg-elevated)', padding:'2px 8px', borderRadius:4 }}>
                      {r}: {count}
                    </span>
                  ) : null
                })}
              </div>
            )}
            <div style={{ flex:1 }}/>
            <button onClick={() => refetch()} className="btn-ghost" style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
              <RefreshCw size={12}/> Refresh
            </button>
          </div>

          {/* Filters */}
          <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
            <div style={{ position:'relative' }}>
              <Search size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search vehicles…"
                style={{ paddingLeft:30, paddingRight:12, paddingTop:7, paddingBottom:7, borderRadius:6, background:'#f8faff', border:'1px solid var(--border)', color:'var(--text-primary)', fontSize:13, width:200, outline:'none' }}/>
            </div>
            <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1)}}
              style={{ padding:'7px 28px 7px 12px', borderRadius:6, border:'1px solid var(--border)', background:'#f8faff', color:'var(--text-primary)', fontSize:13, cursor:'pointer', outline:'none' }}>
              {STATUS_OPTS.map(s=><option key={s} value={s}>{s==='all'?'All Statuses':vehicleStatusLabel[s as keyof typeof vehicleStatusLabel]||s}</option>)}
            </select>
            <select value={typeFilter} onChange={e=>{setTypeFilter(e.target.value);setPage(1)}}
              style={{ padding:'7px 28px 7px 12px', borderRadius:6, border:'1px solid var(--border)', background:'#f8faff', color:'var(--text-primary)', fontSize:13, cursor:'pointer', outline:'none' }}>
              {TYPE_OPTS.map(t=><option key={t} value={t}>{t==='all'?'All Types':vehicleTypeLabel[t]||t}</option>)}
            </select>
            {selectedId && (
              <button onClick={() => setSelectedId(null)} className="btn-ghost" style={{ fontSize:12, display:'flex', alignItems:'center', gap:4 }}>
                <X size={12}/> Close detail
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div style={{ flex:1, overflowY:'auto' }}>
          {isLoading ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>Loading fleet…</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead style={{ position:'sticky', top:0, background:'var(--bg-surface)', zIndex:10 }}>
                <tr>
                  {['','Vehicle','Status','Speed','Fuel','Load','Health','Active Order','Region'].map((h,i)=>(
                    <th key={i} style={{ padding:'8px 8px', textAlign:'left', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:600, color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(v=>(
                  <VehicleRow key={v.vehicle_id} vehicle={v}
                    isSelected={selectedId === v.vehicle_id}
                    onClick={() => setSelectedId(selectedId === v.vehicle_id ? null : v.vehicle_id)}/>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>No vehicles match filters</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {data && data.pages > 1 && (
          <div style={{ padding:'10px 20px', borderTop:'1px solid var(--border)', display:'flex', alignItems:'center', gap:6, justifyContent:'flex-end', background:'var(--bg-surface)', flexShrink:0 }}>
            <span style={{ fontSize:12, color:'var(--text-muted)', marginRight:8 }}>{data.total} total</span>
            {Array.from({length:data.pages},(_,i)=>i+1).map(p=>(
              <button key={p} onClick={()=>setPage(p)} style={{ width:28, height:28, borderRadius:4, border:'1px solid var(--border)', cursor:'pointer', background:page===p?'#2563eb':'var(--bg-elevated)', color:page===p?'white':'var(--text-secondary)', fontSize:12, fontWeight:500 }}>{p}</button>
            ))}
          </div>
        )}
      </div>

      {/* Side detail drawer */}
      {selectedId && (
        <div style={{ width:320, flexShrink:0, borderLeft:'1px solid var(--border)', background:'var(--bg-surface)', display:'flex', flexDirection:'column', boxShadow:'-2px 0 8px rgba(15,28,63,0.06)' }}>
          <VehicleDrawer vehicleId={selectedId} onClose={() => setSelectedId(null)}/>
        </div>
      )}
    </div>
  )
}
