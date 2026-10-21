import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Pause, Play, CloudRain, Wrench, PackagePlus } from 'lucide-react'
import { simApi, ApiError } from '../../services/api'
import { useWSStore } from '../../stores/wsStore'
import { useRole } from '../../hooks/useRole'
import { Segmented, Select, toast } from '../ui'
import { REGIONS, type Region } from '../../types'

const SPEEDS = [1, 3, 5, 10]

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.detail
  if (e instanceof Error) return e.message
  return 'Something went wrong'
}

/**
 * Popover body with live simulation state and (role-gated) controls.
 * Status is shown to everyone; sim speed/pause need canControlSim, demo
 * event triggers need canTriggerEvents. Pause/speed state is read from the
 * websocket store (authoritative), never local state.
 */
export default function SimulationMenu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { canControlSim, canTriggerEvents } = useRole()
  const paused = useWSStore(s => s.paused)
  const simSpeed = useWSStore(s => s.simSpeed)
  const traffic = useWSStore(s => s.traffic)
  const connected = useWSStore(s => s.connected)
  const [surgeRegion, setSurgeRegion] = useState<Region>('Mumbai MMR')

  // Close on outside click / Escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const pauseMut = useMutation({
    mutationFn: () => (paused ? simApi.resume() : simApi.pause()),
    onSuccess: () => toast.success(paused ? 'Simulation resumed' : 'Simulation paused'),
    onError: e => toast.error(errText(e)),
  })

  const speedMut = useMutation({
    mutationFn: (speed: number) => simApi.setSpeed(speed),
    onSuccess: r => toast.success(`Speed set to ${r.speed}x`),
    onError: e => toast.error(errText(e)),
  })

  const trafficMut = useMutation({
    mutationFn: (region: Region) => simApi.triggerTraffic(region),
    onSuccess: r => toast.success(r.message),
    onError: e => toast.error(errText(e)),
  })

  const breakdownMut = useMutation({
    mutationFn: () => simApi.triggerBreakdown(),
    onSuccess: r => toast.success(r.message),
    onError: e => toast.error(errText(e)),
  })

  const orderMut = useMutation({
    mutationFn: () => simApi.triggerOrder(),
    onSuccess: r => toast.success(r.message),
    onError: e => toast.error(errText(e)),
  })

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Simulation controls"
      className="absolute right-0 top-full z-[1200] mt-2 w-72 rounded-xl border border-line bg-surface p-4 shadow-pop"
    >
      {/* Status */}
      <div className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Status</div>
        <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <span className={paused ? 'text-warn' : 'text-ok'}>{paused ? 'Paused' : 'Running'}</span>
          <span className="text-ink-3">·</span>
          <span>{simSpeed}x speed</span>
          {!connected && <span className="text-ink-3">· offline</span>}
        </div>
        <div className="mt-2 space-y-0.5 text-xs text-ink-3">
          {REGIONS.map(r => (
            <div key={r} className="flex justify-between">
              <span>{r} traffic</span>
              <span className={(traffic[r] ?? 1) >= 1.5 ? 'font-semibold text-warn' : 'text-ink-2'}>
                x{(traffic[r] ?? 1).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Sim control (ops+) */}
      {canControlSim && (
        <div className="mb-3 border-t border-line pt-3">
          <div className="mb-2 flex items-center gap-2">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => pauseMut.mutate()}
              disabled={pauseMut.isPending || !connected}
              aria-label={paused ? 'Resume simulation' : 'Pause simulation'}
            >
              {paused ? <Play size={13} /> : <Pause size={13} />}
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Speed</div>
          <Segmented
            label="Simulation speed"
            size="sm"
            value={SPEEDS.includes(Math.round(simSpeed)) ? Math.round(simSpeed) : 1}
            onChange={v => speedMut.mutate(v)}
            options={SPEEDS.map(s => ({ value: s, label: `${s}x` }))}
          />
        </div>
      )}

      {/* Demo events (dispatcher+) */}
      {canTriggerEvents && (
        <div className="border-t border-line pt-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Demo events</div>
          <p className="mb-2 text-xs text-ink-3">These simulate real-world events in the running fleet.</p>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Select
                label="Traffic surge region"
                className="flex-1"
                value={surgeRegion}
                onChange={v => setSurgeRegion(v as Region)}
                options={REGIONS.map(r => ({ value: r, label: r }))}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => trafficMut.mutate(surgeRegion)}
                disabled={trafficMut.isPending}
                aria-label="Trigger traffic surge"
              >
                <CloudRain size={13} /> Surge
              </button>
            </div>

            <button
              className="btn btn-ghost btn-sm w-full justify-start"
              onClick={() => breakdownMut.mutate()}
              disabled={breakdownMut.isPending}
              aria-label="Break down a vehicle"
            >
              <Wrench size={13} /> Break down a vehicle
            </button>

            <button
              className="btn btn-ghost btn-sm w-full justify-start"
              onClick={() => orderMut.mutate()}
              disabled={orderMut.isPending}
              aria-label="Add a random order"
            >
              <PackagePlus size={13} /> Add random order
            </button>
          </div>
        </div>
      )}

      {/* Viewer */}
      {!canControlSim && !canTriggerEvents && (
        <div className="border-t border-line pt-3 text-xs text-ink-3">View only</div>
      )}
    </div>
  )
}
