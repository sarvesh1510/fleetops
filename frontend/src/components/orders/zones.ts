import type { Region } from '../../types'

/**
 * Zone presets for the "New order" form, preserved from the previous OrdersPage.
 * Each preset carries a representative lat/lng; the form derives an editable
 * address string from the chosen zone. Dispatch never crosses regions, so the
 * delivery zone list is always scoped to the same region as the pickup.
 */
export interface ZonePreset {
  name: string
  lat: number
  lng: number
  region: Region
}

export const ZONE_PRESETS: ZonePreset[] = [
  // Mumbai MMR
  { name: 'Bandra', lat: 19.0596, lng: 72.8295, region: 'Mumbai MMR' },
  { name: 'Andheri', lat: 19.1136, lng: 72.8697, region: 'Mumbai MMR' },
  { name: 'Thane', lat: 19.2183, lng: 72.9781, region: 'Mumbai MMR' },
  { name: 'Powai', lat: 19.1197, lng: 72.9050, region: 'Mumbai MMR' },
  { name: 'Kurla', lat: 19.0726, lng: 72.8795, region: 'Mumbai MMR' },
  { name: 'Navi Mumbai', lat: 19.0368, lng: 73.0158, region: 'Mumbai MMR' },
  { name: 'Borivali', lat: 19.2318, lng: 72.8567, region: 'Mumbai MMR' },
  { name: 'Goregaon', lat: 19.1663, lng: 72.8526, region: 'Mumbai MMR' },
  // Delhi NCR
  { name: 'Connaught Place', lat: 28.6315, lng: 77.2167, region: 'Delhi NCR' },
  { name: 'Karol Bagh', lat: 28.6508, lng: 77.1900, region: 'Delhi NCR' },
  { name: 'Noida Sec 18', lat: 28.5705, lng: 77.3219, region: 'Delhi NCR' },
  { name: 'Gurgaon DLF', lat: 28.4672, lng: 77.0435, region: 'Delhi NCR' },
  { name: 'Lajpat Nagar', lat: 28.5665, lng: 77.2433, region: 'Delhi NCR' },
  { name: 'Rohini', lat: 28.7041, lng: 77.1025, region: 'Delhi NCR' },
]

export function zonesForRegion(region: Region): ZonePreset[] {
  return ZONE_PRESETS.filter(z => z.region === region)
}

/**
 * Short, human-readable area name from a FleetOps address string.
 * Addresses look like "132, Shivaji Nagar Colony, Vasant Kunj, Delhi - 110077";
 * the 3rd comma-separated segment is the zone. Falls back to a truncated address.
 */
export function areaFromAddress(address: string | null | undefined): string {
  if (!address) return '—'
  const parts = address.split(',').map(p => p.trim()).filter(Boolean)
  if (parts.length >= 3) return parts[2]
  return address.length > 24 ? address.slice(0, 24) + '…' : address
}
