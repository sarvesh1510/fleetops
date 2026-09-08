import { useEffect, useRef, useState } from 'react'
import { useWSStore } from '../../stores/wsStore'
import { vehicleStatusColor } from '../../lib/utils'

let L: typeof import('leaflet') | null = null

interface VehiclePoint {
  vehicle_id: string; name: string; status: string; lat: number; lng: number
  speed: number; heading: number; fuel_level: number; current_order_id: string | null
  eta_minutes: number | null; health_score: number; region?: string
}

interface Props {
  selectedVehicleId?: string | null
  onVehicleSelect?: (id: string) => void
  filteredVehicles?: Map<string, unknown>
}

function buildIcon(status: string, heading: number, selected: boolean) {
  if (!L) return undefined
  const color = vehicleStatusColor[status as keyof typeof vehicleStatusColor] || '#6b7280'
  const s = selected ? 22 : 15
  const svg = `<svg width="${s*2}" height="${s*2}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="15" fill="${color}25" stroke="${color}" stroke-width="2"/>
    ${selected ? `<circle cx="20" cy="20" r="14" fill="none" stroke="${color}" stroke-width="2.5" opacity="0.5"/>` : ''}
    <circle cx="20" cy="20" r="6" fill="${color}"/>
    <line x1="20" y1="20" x2="20" y2="7" stroke="${color}" stroke-width="2.5" stroke-linecap="round" transform="rotate(${heading} 20 20)"/>
  </svg>`
  return L.divIcon({ html: svg, className: '', iconSize: [s*2, s*2], iconAnchor: [s, s] })
}

export default function FleetMap({ selectedVehicleId, onVehicleSelect, filteredVehicles }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<import('leaflet').Map | null>(null)
  const markersRef = useRef<Map<string, import('leaflet').Marker>>(new Map())
  const hasAutoFit = useRef(false)
  const { vehicleMap } = useWSStore()
  const [ready, setReady] = useState(false)

  const displayMap = filteredVehicles ?? vehicleMap

  // Init map
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const lf = await import('leaflet')
      await import('leaflet/dist/leaflet.css')
      L = (lf.default ?? lf) as typeof import('leaflet')
      if (cancelled || !mapRef.current || mapInstance.current) return

      const map = L.map(mapRef.current, {
        center: [22.5, 78.5],  // India center
        zoom: 5,
        zoomControl: true,
        attributionControl: true,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 18,
      }).addTo(map)

      mapInstance.current = map
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [])

  // Update markers on each frame
  useEffect(() => {
    if (!ready || !mapInstance.current || !L) return
    const map = mapInstance.current

    const points: VehiclePoint[] = []

    displayMap.forEach((raw, id) => {
      const v = raw as VehiclePoint
      if (!v.lat || !v.lng) return
      points.push(v)

      const selected = id === selectedVehicleId
      const icon = buildIcon(v.status, v.heading || 0, selected)
      if (!icon) return

      const tip = `<div style="font-family:system-ui;font-size:12px;min-width:150px;padding:2px 0">
        <strong>${v.name}</strong>${v.region ? ` <span style="font-size:10px;color:#6b7280">${v.region}</span>` : ''}<br/>
        <span style="color:#6b7280">${v.status.replace(/_/g,' ')} · ${v.speed.toFixed(0)} km/h</span><br/>
        Fuel: <strong>${v.fuel_level.toFixed(0)}%</strong>
        ${v.eta_minutes ? `<br/>ETA: <strong>${v.eta_minutes.toFixed(0)} min</strong>` : ''}
      </div>`

      if (markersRef.current.has(id)) {
        const mk = markersRef.current.get(id)!
        mk.setLatLng([v.lat, v.lng])
        mk.setIcon(icon)
        if ((mk as any)._tooltip) mk.setTooltipContent(tip)
      } else {
        const mk = L!.marker([v.lat, v.lng], { icon })
          .addTo(map)
          .on('click', () => onVehicleSelect?.(id))
        mk.bindTooltip(tip, { direction: 'top', offset: [0, -12] })
        markersRef.current.set(id, mk)
      }
    })

    // Remove gone markers
    markersRef.current.forEach((mk, id) => {
      if (!displayMap.has(id)) { mk.remove(); markersRef.current.delete(id) }
    })

    // Auto-fit to show ALL vehicles (both Mumbai + Delhi) on first load
    if (!hasAutoFit.current && points.length > 5) {
      hasAutoFit.current = true
      const lats = points.map(p => p.lat)
      const lngs = points.map(p => p.lng)
      const minLat = Math.min(...lats), maxLat = Math.max(...lats)
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
      // Add padding so markers aren't at edge
      map.fitBounds(
        [[minLat - 0.5, minLng - 0.5], [maxLat + 0.5, maxLng + 0.5]],
        { padding: [50, 50], maxZoom: 11 }
      )
    }
  }, [displayMap, ready, selectedVehicleId, onVehicleSelect])

  // Pan to selected
  useEffect(() => {
    if (!ready || !mapInstance.current || !selectedVehicleId) return
    const v = displayMap.get(selectedVehicleId) as VehiclePoint | undefined
    if (v?.lat && v?.lng) {
      mapInstance.current.setView([v.lat, v.lng], Math.max(mapInstance.current.getZoom(), 13), { animate: true })
    }
  }, [selectedVehicleId, ready, displayMap])

  const mumbaiCount = Array.from(vehicleMap.values()).filter(v => (v as VehiclePoint).region === 'Mumbai MMR').length
  const delhiCount  = Array.from(vehicleMap.values()).filter(v => (v as VehiclePoint).region === 'Delhi NCR').length

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Legend */}
      <div style={{ position:'absolute', bottom:20, left:12, zIndex:1000, background:'rgba(255,255,255,0.96)', border:'1px solid #dce5f5', borderRadius:8, padding:'10px 14px', boxShadow:'0 2px 8px rgba(15,28,63,0.10)' }}>
        <div style={{ fontSize:10, fontWeight:700, color:'#7a90b8', letterSpacing:'0.08em', marginBottom:8 }}>REGIONS</div>
        {[['Mumbai MMR','#f97316', mumbaiCount], ['Delhi NCR','#7c3aed', delhiCount]].map(([r,col,cnt])=>(
          <div key={String(r)} style={{ display:'flex', alignItems:'center', gap:7, marginBottom:5, fontSize:11 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:String(col), flexShrink:0 }}/>
            <span style={{ color:'#3d5280', flex:1 }}>{String(r)}</span>
            <span style={{ fontWeight:700, color:'#0f1c3f' }}>{String(cnt)}</span>
          </div>
        ))}
        <div style={{ borderTop:'1px solid #eaf0fb', marginTop:8, paddingTop:8 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#7a90b8', letterSpacing:'0.08em', marginBottom:6 }}>STATUS</div>
          {[['En Route','#2563eb'],['Available','#059669'],['Loading/Unloading','#d97706'],['Breakdown','#dc2626'],['Maintenance','#7c3aed']].map(([l,c])=>(
            <div key={l} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3, fontSize:10, color:'#3d5280' }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:c, flexShrink:0 }}/>{l}
            </div>
          ))}
        </div>
      </div>

      {/* Vehicle count */}
      <div style={{ position:'absolute', top:52, right:10, zIndex:1000, background:'rgba(255,255,255,0.96)', border:'1px solid #dce5f5', borderRadius:6, padding:'4px 10px', fontSize:11, color:'#3d5280', boxShadow:'0 1px 4px rgba(15,28,63,0.08)' }}>
        {displayMap.size} / {vehicleMap.size} vehicles
      </div>
    </div>
  )
}
