import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Package, Search, Plus, X, AlertOctagon, CheckCircle, Lock, ChevronDown, ChevronUp } from 'lucide-react'
import { ordersApi } from '../services/api'
import { useRole } from '../hooks/useRole'
import { orderStatusColor, orderStatusLabel, priorityColor, formatMinutes, formatDateTime, timeAgo } from '../lib/utils'
import type { Order } from '../types'

const STATUS_OPTS = ['all','pending','assigned','pickup_en_route','picked_up','delivery_en_route','delivered','failed']
const PRIORITY_OPTS = ['all','critical','high','normal','low']

function PriorityBadge({ p }: { p: string }) {
  const color = priorityColor[p as keyof typeof priorityColor] || '#6b7280'
  return <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:100, background:`${color}20`, color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{p}</span>
}

function StatusBadge({ s }: { s: string }) {
  const color = orderStatusColor[s as keyof typeof orderStatusColor] || '#6b7280'
  return <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:100, background:`${color}18`, color, textTransform:'uppercase', letterSpacing:'0.04em' }}>{orderStatusLabel[s as keyof typeof orderStatusLabel] || s}</span>
}

// Mumbai + Delhi NCR zone presets
const ZONES = [
  // Mumbai
  { name:'Bandra',          lat:'19.0596', lng:'72.8295', city:'Mumbai' },
  { name:'Andheri',         lat:'19.1136', lng:'72.8697', city:'Mumbai' },
  { name:'Thane',           lat:'19.2183', lng:'72.9781', city:'Mumbai' },
  { name:'Powai',           lat:'19.1197', lng:'72.9050', city:'Mumbai' },
  { name:'Kurla',           lat:'19.0726', lng:'72.8795', city:'Mumbai' },
  { name:'Navi Mumbai',     lat:'19.0368', lng:'73.0158', city:'Mumbai' },
  { name:'Borivali',        lat:'19.2318', lng:'72.8567', city:'Mumbai' },
  { name:'Goregaon',        lat:'19.1663', lng:'72.8526', city:'Mumbai' },
  // Delhi NCR
  { name:'Connaught Place', lat:'28.6315', lng:'77.2167', city:'Delhi' },
  { name:'Karol Bagh',      lat:'28.6508', lng:'77.1900', city:'Delhi' },
  { name:'Noida Sec 18',    lat:'28.5705', lng:'77.3219', city:'Delhi' },
  { name:'Gurgaon DLF',     lat:'28.4672', lng:'77.0435', city:'Delhi' },
  { name:'Lajpat Nagar',    lat:'28.5665', lng:'77.2433', city:'Delhi' },
  { name:'Rohini',          lat:'28.7041', lng:'77.1025', city:'Delhi' },
]

function CreateOrderModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    customer_name: '', priority: 'normal',
    pickup_address: '', pickup_lat: '', pickup_lng: '',
    delivery_address: '', delivery_lat: '', delivery_lng: '',
    weight_kg: '100', deadline_hours: '4',
    requires_refrigeration: false,
  })
  const [assignResult, setAssignResult] = useState<null | { vehicle_id: string; eta_minutes: number; distance_km: number; reasons: string[] }>(null)
  const [step, setStep] = useState<'form'|'assigned'>('form')

  const mutation = useMutation({
    mutationFn: () => ordersApi.create({
      ...form,
      pickup_lat: parseFloat(form.pickup_lat),
      pickup_lng: parseFloat(form.pickup_lng),
      delivery_lat: parseFloat(form.delivery_lat),
      delivery_lng: parseFloat(form.delivery_lng),
      weight_kg: parseFloat(form.weight_kg),
      deadline_hours: parseFloat(form.deadline_hours),
    }) as Promise<{ order: Order; recommended_vehicle: { vehicle_id: string; eta_minutes: number; distance_to_pickup_km: number; selection_reasons: string[] } | null }>,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['order-stats'] })
      if (data.recommended_vehicle) {
        setAssignResult({
          vehicle_id: data.recommended_vehicle.vehicle_id,
          eta_minutes: data.recommended_vehicle.eta_minutes,
          distance_km: data.recommended_vehicle.distance_to_pickup_km,
          reasons: data.recommended_vehicle.selection_reasons,
        })
        setStep('assigned')
      } else {
        onClose()
      }
    },
  })

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 6,
    background: '#f8faff', border: '1px solid var(--border)',
    color: 'var(--text-primary)', fontSize: 13, outline: 'none', marginTop: 4,
  }
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase' }

  const isValid = form.customer_name && form.pickup_lat && form.delivery_lat && parseFloat(form.weight_kg) > 0

  const mumbaiZones = ZONES.filter(z => z.city === 'Mumbai')
  const delhiZones  = ZONES.filter(z => z.city === 'Delhi')

  // ── Success state ──────────────────────────────────────────────────────────
  if (step === 'assigned' && assignResult) {
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
        <div className="card" style={{ width:440, padding:28 }}>
          <div style={{ textAlign:'center', marginBottom:20 }}>
            <div style={{ width:56, height:56, borderRadius:'50%', background:'#f0fdf4', border:'2px solid #bbf7d0', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px' }}>
              <CheckCircle size={28} style={{ color:'#059669' }}/>
            </div>
            <h2 style={{ margin:'0 0 6px', fontSize:18, fontWeight:700, color:'var(--text-primary)' }}>Order Created & Assigned!</h2>
            <p style={{ margin:0, fontSize:13, color:'var(--text-muted)' }}>The optimization engine selected the best available vehicle.</p>
          </div>

          <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:16, marginBottom:16 }}>
            <div className="section-title" style={{ marginBottom:10, color:'#059669' }}>AUTONOMOUS DECISION</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
              {[
                ['Vehicle Assigned', assignResult.vehicle_id.split('-').slice(-2).join('-').toUpperCase()],
                ['ETA to Pickup', `${assignResult.eta_minutes.toFixed(0)} min`],
                ['Distance', `${assignResult.distance_km.toFixed(1)} km`],
                ['Status', 'Assigned ✓'],
              ].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize:10, color:'#6b7 280', fontWeight:600, textTransform:'uppercase', marginBottom:2 }}>{l}</div>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)' }}>{v}</div>
                </div>
              ))}
            </div>
            {assignResult.reasons.length > 0 && (
              <>
                <div style={{ fontSize:11, fontWeight:600, color:'#059669', marginBottom:6 }}>Why this vehicle?</div>
                {assignResult.reasons.slice(0,4).map((r,i) => (
                  <div key={i} style={{ fontSize:11, color:'var(--text-secondary)', display:'flex', gap:6, marginBottom:3 }}>
                    <span style={{ color:'#059669', flexShrink:0 }}>✓</span> {r}
                  </div>
                ))}
              </>
            )}
          </div>

          <button onClick={onClose} className="btn-primary" style={{ width:'100%', padding:'10px' }}>
            Done — View in Orders
          </button>
        </div>
      </div>
    )
  }

  // ── Create form ────────────────────────────────────────────────────────────
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:16 }}>
      <div className="card" style={{ width:540, maxHeight:'90vh', overflowY:'auto', padding:24 }}>
        <div style={{ display:'flex', alignItems:'center', marginBottom:20 }}>
          <Package size={16} style={{ color:'#2563eb', marginRight:8 }}/>
          <h2 style={{ margin:0, fontSize:16, fontWeight:700 }}>Create New Order</h2>
          <button onClick={onClose} style={{ marginLeft:'auto', background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:4 }}><X size={18}/></button>
        </div>

        <div style={{ display:'grid', gap:14 }}>
          <div>
            <label style={labelStyle}>Customer / Company Name</label>
            <input value={form.customer_name} onChange={f('customer_name')} style={inputStyle} placeholder="e.g. Reliance Retail Ltd"/>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
            <div>
              <label style={labelStyle}>Priority</label>
              <select value={form.priority} onChange={f('priority')} style={{ ...inputStyle }}>
                {['low','normal','high','critical'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Weight (kg)</label>
              <input type="number" value={form.weight_kg} onChange={f('weight_kg')} style={inputStyle} min="1" max="10000"/>
            </div>
            <div>
              <label style={labelStyle}>Deadline (hrs)</label>
              <input type="number" value={form.deadline_hours} onChange={f('deadline_hours')} style={inputStyle} min="1" max="48"/>
            </div>
          </div>

          {/* Pickup */}
          <div style={{ background:'#f8faff', borderRadius:8, padding:12, border:'1px solid var(--border)' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text-primary)', marginBottom:8 }}>📍 Pickup Location</div>
            <div style={{ marginBottom:8 }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, fontWeight:600 }}>Mumbai Zones</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
                {mumbaiZones.map(z => (
                  <button key={z.name} onClick={() => setForm(p => ({ ...p, pickup_lat:z.lat, pickup_lng:z.lng, pickup_address:`Warehouse, ${z.name}, Maharashtra` }))}
                    style={{ padding:'3px 8px', borderRadius:4, fontSize:11, cursor:'pointer', border:'1px solid var(--border)', background: form.pickup_lat===z.lat ? '#2563eb' : '#fff', color: form.pickup_lat===z.lat ? 'white' : 'var(--text-secondary)', transition:'all 0.1s' }}>
                    {z.name}
                  </button>
                ))}
              </div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, fontWeight:600 }}>Delhi NCR Zones</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:8 }}>
                {delhiZones.map(z => (
                  <button key={z.name} onClick={() => setForm(p => ({ ...p, pickup_lat:z.lat, pickup_lng:z.lng, pickup_address:`Warehouse, ${z.name}, Delhi NCR` }))}
                    style={{ padding:'3px 8px', borderRadius:4, fontSize:11, cursor:'pointer', border:'1px solid var(--border)', background: form.pickup_lat===z.lat ? '#2563eb' : '#fff', color: form.pickup_lat===z.lat ? 'white' : 'var(--text-secondary)', transition:'all 0.1s' }}>
                    {z.name}
                  </button>
                ))}
              </div>
            </div>
            <input value={form.pickup_address} onChange={f('pickup_address')} style={inputStyle} placeholder="Full pickup address"/>
          </div>

          {/* Delivery */}
          <div style={{ background:'#f0fdf4', borderRadius:8, padding:12, border:'1px solid #bbf7d0' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text-primary)', marginBottom:8 }}>🎯 Delivery Location</div>
            <div style={{ marginBottom:8 }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, fontWeight:600 }}>Mumbai Zones</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
                {mumbaiZones.map(z => (
                  <button key={z.name} onClick={() => setForm(p => ({ ...p, delivery_lat:z.lat, delivery_lng:z.lng, delivery_address:`Customer, ${z.name}, Maharashtra` }))}
                    style={{ padding:'3px 8px', borderRadius:4, fontSize:11, cursor:'pointer', border:'1px solid #bbf7d0', background: form.delivery_lat===z.lat ? '#059669' : '#fff', color: form.delivery_lat===z.lat ? 'white' : 'var(--text-secondary)', transition:'all 0.1s' }}>
                    {z.name}
                  </button>
                ))}
              </div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, fontWeight:600 }}>Delhi NCR Zones</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:8 }}>
                {delhiZones.map(z => (
                  <button key={z.name} onClick={() => setForm(p => ({ ...p, delivery_lat:z.lat, delivery_lng:z.lng, delivery_address:`Customer, ${z.name}, Delhi NCR` }))}
                    style={{ padding:'3px 8px', borderRadius:4, fontSize:11, cursor:'pointer', border:'1px solid #bbf7d0', background: form.delivery_lat===z.lat ? '#059669' : '#fff', color: form.delivery_lat===z.lat ? 'white' : 'var(--text-secondary)', transition:'all 0.1s' }}>
                    {z.name}
                  </button>
                ))}
              </div>
            </div>
            <input value={form.delivery_address} onChange={f('delivery_address')} style={inputStyle} placeholder="Full delivery address"/>
          </div>
        </div>

        {mutation.error && (
          <div style={{ marginTop:12, padding:'8px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:6, fontSize:13, color:'#dc2626' }}>
            {(mutation.error as Error).message}
          </div>
        )}

        {!isValid && (
          <div style={{ marginTop:10, fontSize:11, color:'var(--text-muted)' }}>
            ⚠ Select pickup and delivery zones, enter customer name and weight to continue.
          </div>
        )}

        <div style={{ display:'flex', gap:10, marginTop:18, justifyContent:'flex-end' }}>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !isValid} className="btn-primary" style={{ minWidth:160 }}>
            {mutation.isPending ? 'Creating & Assigning…' : '✓ Create & Auto-Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Order detail expandable row
function OrderRow({ order, expanded, onToggle }: { order: Order; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} style={{ borderBottom: expanded ? 'none' : '1px solid var(--border-subtle)', cursor:'pointer', transition:'background 0.1s' }}
        onMouseEnter={e => { if(!expanded) e.currentTarget.style.background='var(--bg-elevated)' }}
        onMouseLeave={e => { if(!expanded) e.currentTarget.style.background='transparent' }}>
        <td style={{ padding:'10px 12px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            {order.sla_at_risk && <AlertOctagon size={12} style={{ color:'#dc2626', flexShrink:0 }}/>}
            <span style={{ fontFamily:'var(--font-mono)', fontSize:12, fontWeight:600, color:'var(--text-primary)' }}>{order.reference}</span>
          </div>
        </td>
        <td style={{ padding:'10px 12px' }}><PriorityBadge p={order.priority}/></td>
        <td style={{ padding:'10px 12px', fontSize:12, color:'var(--text-secondary)', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{order.customer_name}</td>
        <td style={{ padding:'10px 12px' }}><StatusBadge s={order.status}/></td>
        <td style={{ padding:'10px 12px', fontSize:11, color:'var(--text-muted)', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{(order.pickup as any)?.address || '—'}</td>
        <td style={{ padding:'10px 12px', fontSize:11, color:'var(--text-muted)', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{(order.delivery as any)?.address || '—'}</td>
        <td style={{ padding:'10px 12px', fontSize:12, color:'var(--text-secondary)', whiteSpace:'nowrap' }}>{order.weight_kg} kg</td>
        <td style={{ padding:'10px 12px', fontSize:12, color: order.sla_at_risk ? '#d97706' : 'var(--text-secondary)', whiteSpace:'nowrap' }}>
          {order.eta_minutes ? formatMinutes(order.eta_minutes) : '—'}
        </td>
        <td style={{ padding:'10px 12px', fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>{order.deadline ? formatDateTime(order.deadline) : '—'}</td>
        <td style={{ padding:'10px 12px', fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>{timeAgo(order.created_at)}</td>
        <td style={{ padding:'10px 12px' }}>{expanded ? <ChevronUp size={13} style={{ color:'var(--text-muted)' }}/> : <ChevronDown size={13} style={{ color:'var(--text-muted)' }}/>}</td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom:'1px solid var(--border-subtle)' }}>
          <td colSpan={11} style={{ padding:'0 12px 14px', background:'#f8faff' }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, paddingTop:12 }}>
              {[
                ['Order ID', order.order_id],
                ['Assigned Vehicle', order.assigned_vehicle_id || '—'],
                ['Status', order.status],
                ['Weight', `${order.weight_kg} kg`],
              ].map(([l,v]) => (
                <div key={l}>
                  <div className="stat-label" style={{ marginBottom:3 }}>{l}</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', fontFamily: l==='Order ID'||l==='Assigned Vehicle' ? 'var(--font-mono)' : 'inherit' }}>{String(v)}</div>
                </div>
              ))}
            </div>
            {order.sla_at_risk && (
              <div style={{ marginTop:10, padding:'8px 12px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:6, fontSize:12, color:'#92400e', display:'flex', gap:8, alignItems:'center' }}>
                <AlertOctagon size={13}/> SLA at risk — delivery may miss deadline
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function OrdersPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedId, setExpandedId] = useState<string|null>(null)
  const { canCreateOrders, roleLabel } = useRole()

  const { data, isLoading } = useQuery({
    queryKey: ['orders', statusFilter, priorityFilter, page],
    queryFn: () => ordersApi.list({ status: statusFilter!=='all'?statusFilter:undefined, priority: priorityFilter!=='all'?priorityFilter:undefined, page, page_size:50 }) as Promise<{ items: Order[]; total: number; pages: number }>,
    refetchInterval: 5000,
  })
  const { data: stats } = useQuery({ queryKey: ['order-stats'], queryFn: () => ordersApi.stats() as Promise<Record<string,number>>, refetchInterval: 8000 })

  const filtered = (data?.items ?? []).filter(o =>
    !search || o.reference?.toLowerCase().includes(search.toLowerCase()) || o.customer_name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {showCreate && <CreateOrderModal onClose={() => setShowCreate(false)}/>}

      <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', background:'var(--bg-surface)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
          <Package size={18} style={{ color:'#2563eb' }}/>
          <h1 style={{ margin:0, fontSize:16, fontWeight:700 }}>Orders</h1>
          <div style={{ flex:1 }}/>
          {/* Quick stats */}
          {stats && ['pending','active','at_risk'].map(k => (
            <div key={k} style={{ padding:'4px 12px', borderRadius:6, background:'var(--bg-elevated)', border:'1px solid var(--border)', fontSize:12 }}>
              <span style={{ color:'var(--text-muted)', textTransform:'capitalize' }}>{k.replace('_',' ')}: </span>
              <span style={{ fontWeight:700, color: k==='at_risk'&&(stats[k]??0)>0 ? '#dc2626' : 'var(--text-primary)' }}>{stats[k]??0}</span>
            </div>
          ))}

          {canCreateOrders ? (
            <button onClick={() => setShowCreate(true)} className="btn-primary" style={{ display:'flex', alignItems:'center', gap:6 }}>
              <Plus size={14}/> New Order
            </button>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--text-muted)', padding:'6px 12px', background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:6 }}>
              <Lock size={11} style={{ marginRight:4 }} /> {roleLabel} — read only
            </div>
          )}
        </div>

        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <div style={{ position:'relative' }}>
            <Search size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search reference or customer…"
              style={{ paddingLeft:30, paddingRight:12, paddingTop:7, paddingBottom:7, borderRadius:6, background:'#f8faff', border:'1px solid var(--border)', color:'var(--text-primary)', fontSize:13, width:260, outline:'none' }}/>
          </div>
          <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1)}}
            style={{ padding:'7px 24px 7px 12px', borderRadius:6, border:'1px solid var(--border)', background:'#f8faff', color:'var(--text-primary)', fontSize:13, cursor:'pointer', outline:'none' }}>
            {STATUS_OPTS.map(s=><option key={s} value={s}>{s==='all'?'All Statuses':orderStatusLabel[s as keyof typeof orderStatusLabel]||s}</option>)}
          </select>
          <select value={priorityFilter} onChange={e=>{setPriorityFilter(e.target.value);setPage(1)}}
            style={{ padding:'7px 24px 7px 12px', borderRadius:6, border:'1px solid var(--border)', background:'#f8faff', color:'var(--text-primary)', fontSize:13, cursor:'pointer', outline:'none' }}>
            {PRIORITY_OPTS.map(p=><option key={p} value={p}>{p==='all'?'All Priorities':p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
          </select>
          <span style={{ fontSize:12, color:'var(--text-muted)', marginLeft:'auto' }}>{data?.total ?? 0} orders</span>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead style={{ position:'sticky', top:0, background:'var(--bg-surface)', zIndex:10 }}>
            <tr>
              {['Reference','Priority','Customer','Status','Pickup','Delivery','Weight','ETA','Deadline','Created',''].map(h=>(
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:600, color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? <tr><td colSpan={11} style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>Loading orders…</td></tr>
              : filtered.length === 0
                ? <tr><td colSpan={11} style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>No orders match filters</td></tr>
                : filtered.map(order => (
                    <OrderRow key={order.order_id} order={order}
                      expanded={expandedId === order.order_id}
                      onToggle={() => setExpandedId(expandedId===order.order_id ? null : order.order_id)}/>
                  ))}
          </tbody>
        </table>
      </div>

      {data && data.pages > 1 && (
        <div style={{ padding:'10px 20px', borderTop:'1px solid var(--border)', display:'flex', gap:4, justifyContent:'flex-end', background:'var(--bg-surface)' }}>
          {Array.from({length:Math.min(data.pages,10)},(_,i)=>i+1).map(p=>(
            <button key={p} onClick={()=>setPage(p)} style={{ width:28, height:28, borderRadius:4, border:'1px solid var(--border)', cursor:'pointer', background:page===p?'#2563eb':'var(--bg-elevated)', color:page===p?'white':'var(--text-secondary)', fontSize:12 }}>{p}</button>
          ))}
        </div>
      )}
    </div>
  )
}
