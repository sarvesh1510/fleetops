import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useWSStore } from '../../stores/wsStore'
import { vehicleStatusColor } from '../../lib/utils'
import type { LiveVehicle, Region } from '../../types'

interface Props {
  region: Region | 'all'
  selectedVehicleId: string | null
  onSelect: (id: string | null) => void
}

const REGION_VIEW: Record<Region, { center: [number, number]; zoom: number }> = {
  'Mumbai MMR': { center: [19.1, 72.95], zoom: 11 },
  'Delhi NCR': { center: [28.58, 77.2], zoom: 10 },
}

/** Round heading into 15-degree buckets so we only re-draw the icon when it visibly turns. */
function iconKey(v: LiveVehicle, selected: boolean): string {
  const bucket = Math.round(((v.heading ?? 0) % 360) / 15)
  return `${v.status}|${selected ? 1 : 0}|${bucket}`
}

function buildIcon(status: LiveVehicle['status'], heading: number, selected: boolean): L.DivIcon {
  const color = vehicleStatusColor[status] ?? '#6b7280'
  const dim = status === 'maintenance' || status === 'offline'
  const breakdown = status === 'breakdown'
  const size = selected ? 30 : 20
  const half = size / 2
  const ring = selected
    ? `box-shadow:0 0 0 3px ${color}66;`
    : breakdown
      ? `box-shadow:0 0 0 3px #ef444488;`
      : ''
  const html =
    `<div style="width:${size}px;height:${size}px;${dim ? 'opacity:0.55;' : ''}position:relative;">` +
      `<div style="position:absolute;inset:0;border-radius:50%;background:${color};border:2px solid #fff;${ring}"></div>` +
      `<div style="position:absolute;left:50%;top:1px;width:2px;height:${half - 1}px;background:#fff;border-radius:1px;` +
        `transform-origin:bottom center;transform:translateX(-50%) rotate(${heading}deg);"></div>` +
    `</div>`
  return L.divIcon({ html, className: 'fleet-marker', iconSize: [size, size], iconAnchor: [half, half] })
}

function tooltipHtml(v: LiveVehicle): string {
  const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c))
  const label = v.status.replace(/_/g, ' ')
  const eta = v.eta_minutes != null ? `${Math.round(v.eta_minutes)} min` : '—'
  return (
    `<div style="font:12px system-ui;min-width:150px">` +
      `<div style="font-weight:700">${esc(v.name)}</div>` +
      `<div style="color:#6b7280;text-transform:capitalize">${esc(label)}</div>` +
      `<div>Speed ${v.speed.toFixed(0)} km/h · Fuel ${v.fuel_level.toFixed(0)}%</div>` +
      `<div>ETA ${eta}</div>` +
    `</div>`
  )
}

interface Anim {
  from: L.LatLng
  to: L.LatLng
  start: number
  duration: number
}

/** Jumps larger than this (metres) are teleports (e.g. a vehicle returning from repair): don't glide. */
const MAX_GLIDE_M = 1500

export default function FleetMap({ region, selectedVehicleId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, { marker: L.Marker; iconKey: string }>>(new Map())
  const fittedRegionRef = useRef<Region | 'all' | null>(null)

  // Positions arrive every simulation tick (~2 s). Instead of hopping marker-to-marker we glide
  // from where the marker is now to the new position over the time between snapshots.
  const animsRef = useRef<Map<string, Anim>>(new Map())
  const lastMapRef = useRef<Map<string, LiveVehicle> | null>(null)
  const lastSnapshotAtRef = useRef(0)
  const glideMsRef = useRef(2000)

  const vehicleMap = useWSStore(s => s.vehicleMap)

  // keep latest onSelect without re-initialising the map
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // ── Init map (guard against StrictMode double-mount) ──────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = L.map(containerRef.current, {
      center: REGION_VIEW['Mumbai MMR'].center,
      zoom: REGION_VIEW['Mumbai MMR'].zoom,
      zoomControl: true,
      attributionControl: true,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    map.on('click', () => onSelectRef.current(null))
    mapRef.current = map

    const markers = markersRef.current
    return () => {
      map.remove()
      mapRef.current = null
      markers.clear()
      fittedRegionRef.current = null
    }
  }, [])

  // ── Fit view when region changes (and on first data for 'all') ────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (region === 'all') {
      // fit all vehicles once we have them
      if (fittedRegionRef.current === 'all') return
      const pts: L.LatLngTuple[] = []
      vehicleMap.forEach(v => { if (v.lat && v.lng) pts.push([v.lat, v.lng]) })
      if (pts.length === 0) return
      map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 11 })
      fittedRegionRef.current = 'all'
    } else {
      if (fittedRegionRef.current === region) return
      const { center, zoom } = REGION_VIEW[region]
      map.setView(center, zoom, { animate: true })
      fittedRegionRef.current = region
    }
  }, [region, vehicleMap])

  // ── Sync markers each tick ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Learn how often snapshots arrive so the glide lasts exactly one interval.
    const now = performance.now()
    if (lastMapRef.current !== vehicleMap) {
      if (lastSnapshotAtRef.current) {
        const dt = now - lastSnapshotAtRef.current
        glideMsRef.current = Math.min(4000, Math.max(150, 0.5 * glideMsRef.current + 0.5 * dt))
      }
      lastSnapshotAtRef.current = now
      lastMapRef.current = vehicleMap
    }
    const anims = animsRef.current

    const inRegion = (v: LiveVehicle) => region === 'all' || v.region === region
    const live = new Set<string>()

    vehicleMap.forEach((v, id) => {
      if (!inRegion(v) || !v.lat || !v.lng) return
      live.add(id)
      const selected = id === selectedVehicleId
      const key = iconKey(v, selected)
      const existing = markersRef.current.get(id)

      if (existing) {
        const next = L.latLng(v.lat, v.lng)
        const shown = existing.marker.getLatLng()
        const dist = shown.distanceTo(next)
        if (dist > MAX_GLIDE_M) {
          existing.marker.setLatLng(next)
          anims.delete(id)
        } else if (dist > 0.5) {
          anims.set(id, { from: shown, to: next, start: now, duration: glideMsRef.current })
        }
        if (existing.iconKey !== key) {
          existing.marker.setIcon(buildIcon(v.status, v.heading ?? 0, selected))
          existing.iconKey = key
        }
        existing.marker.setTooltipContent(tooltipHtml(v))
      } else {
        const marker = L.marker([v.lat, v.lng], { icon: buildIcon(v.status, v.heading ?? 0, selected) })
          .addTo(map)
          .bindTooltip(tooltipHtml(v), { direction: 'top', offset: [0, -12], opacity: 0.95 })
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          onSelectRef.current(id)
        })
        markersRef.current.set(id, { marker, iconKey: key })
      }
    })

    // drop markers no longer visible
    markersRef.current.forEach((entry, id) => {
      if (!live.has(id)) {
        entry.marker.remove()
        markersRef.current.delete(id)
        anims.delete(id)
      }
    })
  }, [vehicleMap, region, selectedVehicleId])

  // ── Animation loop: move markers along their current glide ───────────────────
  useEffect(() => {
    let frame = 0
    const step = (t: number) => {
      const anims = animsRef.current
      anims.forEach((a, id) => {
        const entry = markersRef.current.get(id)
        if (!entry) { anims.delete(id); return }
        const p = Math.min(1, (t - a.start) / a.duration)
        entry.marker.setLatLng([
          a.from.lat + (a.to.lat - a.from.lat) * p,
          a.from.lng + (a.to.lng - a.from.lng) * p,
        ])
        if (p >= 1) anims.delete(id)
      })
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [])

  // ── Gently pan to the selected vehicle (no forced zoom-out) ──────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedVehicleId) return
    const v = vehicleMap.get(selectedVehicleId)
    if (v?.lat && v?.lng) {
      map.panTo([v.lat, v.lng], { animate: true })
    }
    // only pan when the selection itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId])

  return <div ref={containerRef} className="h-full w-full" />
}
