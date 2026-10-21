import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import { ordersApi } from '../../services/api'
import { Modal, Field, Select, Segmented, toast } from '../ui'
import { formatMinutes } from '../../lib/utils'
import { REGIONS, type Region, type OrderPriority } from '../../types'
import { zonesForRegion } from './zones'

const CUSTOM = '__custom__'

const PRIORITY_OPTIONS: { value: OrderPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const DEADLINE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'No deadline' },
  { value: '2', label: 'In 2 hours' },
  { value: '4', label: 'In 4 hours' },
  { value: '8', label: 'In 8 hours' },
  { value: '24', label: 'In 24 hours' },
]

interface Errors {
  customer_name?: string
  weight_kg?: string
  pickup?: string
  delivery?: string
  zone?: string
  pickup_lat?: string
  delivery_lat?: string
}

function addressFor(zoneName: string, region: Region) {
  return `${zoneName}, ${region}`
}

export default function CreateOrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [region, setRegion] = useState<Region>('Mumbai MMR')
  const [pickupZone, setPickupZone] = useState('')
  const [deliveryZone, setDeliveryZone] = useState('')
  const [pickupAddress, setPickupAddress] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  // custom lat/lng (strings for controlled number inputs)
  const [pickupLat, setPickupLat] = useState('')
  const [pickupLng, setPickupLng] = useState('')
  const [deliveryLat, setDeliveryLat] = useState('')
  const [deliveryLng, setDeliveryLng] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [priority, setPriority] = useState<OrderPriority>('normal')
  const [weight, setWeight] = useState('')
  const [deadlineHours, setDeadlineHours] = useState('')
  const [refrigeration, setRefrigeration] = useState(false)
  const [fragile, setFragile] = useState(false)
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Errors>({})

  const zones = useMemo(() => zonesForRegion(region), [region])
  const zoneOptions = [
    { value: '', label: 'Select a zone…' },
    ...zones.map(z => ({ value: z.name, label: z.name })),
    { value: CUSTOM, label: 'Custom location (manual lat/lng)' },
  ]

  function reset() {
    setRegion('Mumbai MMR')
    setPickupZone(''); setDeliveryZone('')
    setPickupAddress(''); setDeliveryAddress('')
    setPickupLat(''); setPickupLng(''); setDeliveryLat(''); setDeliveryLng('')
    setCustomerName(''); setPriority('normal'); setWeight(''); setDeadlineHours('')
    setRefrigeration(false); setFragile(false); setDescription('')
    setErrors({})
    mutation.reset()
  }

  function close() { reset(); onClose() }

  function onRegionChange(r: Region) {
    setRegion(r)
    // zones differ per region; clear selections to prevent cross-region dispatch
    setPickupZone(''); setDeliveryZone('')
    setPickupAddress(''); setDeliveryAddress('')
    setPickupLat(''); setPickupLng(''); setDeliveryLat(''); setDeliveryLng('')
  }

  function selectPickupZone(name: string) {
    setPickupZone(name)
    if (name === CUSTOM || name === '') {
      setPickupAddress(name === CUSTOM ? pickupAddress : '')
      setPickupLat(''); setPickupLng('')
      return
    }
    const z = zones.find(x => x.name === name)
    if (z) {
      setPickupLat(String(z.lat)); setPickupLng(String(z.lng))
      setPickupAddress(addressFor(z.name, region))
    }
  }

  function selectDeliveryZone(name: string) {
    setDeliveryZone(name)
    if (name === CUSTOM || name === '') {
      setDeliveryAddress(name === CUSTOM ? deliveryAddress : '')
      setDeliveryLat(''); setDeliveryLng('')
      return
    }
    const z = zones.find(x => x.name === name)
    if (z) {
      setDeliveryLat(String(z.lat)); setDeliveryLng(String(z.lng))
      setDeliveryAddress(addressFor(z.name, region))
    }
  }

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        customer_name: customerName.trim(),
        priority,
        pickup_address: pickupAddress.trim(),
        pickup_lat: parseFloat(pickupLat),
        pickup_lng: parseFloat(pickupLng),
        delivery_address: deliveryAddress.trim(),
        delivery_lat: parseFloat(deliveryLat),
        delivery_lng: parseFloat(deliveryLng),
        weight_kg: parseFloat(weight),
        requires_refrigeration: refrigeration,
        fragile,
        description: description.trim() || undefined,
        deadline_hours: deadlineHours ? parseFloat(deadlineHours) : undefined,
      }
      return ordersApi.create(payload)
    },
    onSuccess: ({ order, assignment }) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['order-stats'] })
      if (assignment) {
        toast.success(`${order.reference} assigned to ${assignment.vehicle_name ?? assignment.vehicle_id} (ETA ${formatMinutes(assignment.eta_minutes)})`)
      } else {
        toast.success(`${order.reference} created — waiting for an available vehicle`)
      }
      close()
    },
  })

  function validate(): boolean {
    const e: Errors = {}
    if (!customerName.trim()) e.customer_name = 'Customer name is required.'
    const w = parseFloat(weight)
    if (!weight.trim() || Number.isNaN(w)) e.weight_kg = 'Weight is required.'
    else if (w <= 0 || w > 20000) e.weight_kg = 'Weight must be between 0 and 20000 kg.'

    const pLat = parseFloat(pickupLat), pLng = parseFloat(pickupLng)
    const dLat = parseFloat(deliveryLat), dLng = parseFloat(deliveryLng)
    if (!pickupZone) e.pickup = 'Choose a pickup zone.'
    else if (Number.isNaN(pLat) || Number.isNaN(pLng)) e.pickup_lat = 'Enter a valid pickup lat/lng.'
    if (!deliveryZone) e.delivery = 'Choose a delivery zone.'
    else if (Number.isNaN(dLat) || Number.isNaN(dLng)) e.delivery_lat = 'Enter a valid delivery lat/lng.'

    if (!pickupAddress.trim() && pickupZone) e.pickup = 'Pickup address is required.'
    if (!deliveryAddress.trim() && deliveryZone) e.delivery = 'Delivery address is required.'

    // pickup != delivery
    if (pickupZone && deliveryZone) {
      const samePreset = pickupZone !== CUSTOM && pickupZone === deliveryZone
      const sameCoords = !Number.isNaN(pLat) && pLat === dLat && pLng === dLng
      if (samePreset || sameCoords) e.zone = 'Pickup and delivery must be different locations.'
    }

    setErrors(e)
    return Object.keys(e).length === 0
  }

  function submit() {
    if (!validate()) return
    mutation.mutate()
  }

  const backendError = mutation.error instanceof Error ? mutation.error.message : null

  return (
    <Modal
      open={open}
      onClose={close}
      title="New order"
      width={560}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={mutation.isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create order'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {backendError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" /> {backendError}
          </div>
        )}

        <div>
          <span className="label">Region</span>
          <Segmented
            label="Region"
            value={region}
            onChange={onRegionChange}
            options={REGIONS.map(r => ({ value: r, label: r }))}
          />
          <span className="mt-1 block text-xs text-ink-3">Pickup and delivery stay within one region — dispatch never crosses regions.</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Pickup zone" error={errors.pickup}>
            <Select label="Pickup zone" className="w-full" value={pickupZone} onChange={selectPickupZone} options={zoneOptions} />
          </Field>
          <Field label="Delivery zone" error={errors.delivery}>
            <Select label="Delivery zone" className="w-full" value={deliveryZone} onChange={selectDeliveryZone} options={zoneOptions} />
          </Field>
        </div>
        {errors.zone && <div className="text-xs text-bad" role="alert">{errors.zone}</div>}

        {/* Pickup address / custom coords */}
        {pickupZone && (
          <Field label="Pickup address" error={errors.pickup_lat}>
            <input className="input" value={pickupAddress} onChange={e => setPickupAddress(e.target.value)} placeholder="Pickup address" aria-label="Pickup address" />
            {pickupZone === CUSTOM && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input className="input" type="number" step="any" value={pickupLat} onChange={e => setPickupLat(e.target.value)} placeholder="Latitude" aria-label="Pickup latitude" />
                <input className="input" type="number" step="any" value={pickupLng} onChange={e => setPickupLng(e.target.value)} placeholder="Longitude" aria-label="Pickup longitude" />
              </div>
            )}
          </Field>
        )}

        {/* Delivery address / custom coords */}
        {deliveryZone && (
          <Field label="Delivery address" error={errors.delivery_lat}>
            <input className="input" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} placeholder="Delivery address" aria-label="Delivery address" />
            {deliveryZone === CUSTOM && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input className="input" type="number" step="any" value={deliveryLat} onChange={e => setDeliveryLat(e.target.value)} placeholder="Latitude" aria-label="Delivery latitude" />
                <input className="input" type="number" step="any" value={deliveryLng} onChange={e => setDeliveryLng(e.target.value)} placeholder="Longitude" aria-label="Delivery longitude" />
              </div>
            )}
          </Field>
        )}

        <Field label="Customer name" error={errors.customer_name}>
          <input className="input" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="e.g. Reliance Retail Ltd" aria-label="Customer name" />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Priority">
            <Select label="Priority" className="w-full" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
          </Field>
          <Field label="Weight (kg)" error={errors.weight_kg}>
            <input className="input" type="number" min="0" max="20000" step="any" value={weight} onChange={e => setWeight(e.target.value)} placeholder="100" aria-label="Weight in kilograms" />
          </Field>
          <Field label="Deadline">
            <Select label="Deadline" className="w-full" value={deadlineHours} onChange={setDeadlineHours} options={DEADLINE_OPTIONS} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={refrigeration} onChange={e => setRefrigeration(e.target.checked)} />
            Requires refrigeration
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={fragile} onChange={e => setFragile(e.target.checked)} />
            Fragile
          </label>
        </div>

        <Field label="Description">
          <textarea className="input" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional notes about the shipment" aria-label="Description" />
        </Field>
      </div>
    </Modal>
  )
}
