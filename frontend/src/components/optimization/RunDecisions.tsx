import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '../ui'
import { formatKm, formatMinutes, priorityColor } from '../../lib/utils'
import type { OptimizationRun, OptimizationDecision, VehicleCandidate } from '../../types'

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge color={priorityColor[priority as keyof typeof priorityColor] ?? '#6b7280'} className="uppercase">
      {priority}
    </Badge>
  )
}

function DecisionsTable({ decisions }: { decisions: OptimizationDecision[] }) {
  const assigns = decisions.filter((d): d is Extract<OptimizationDecision, { type: 'assign' }> => d.type === 'assign')
  const unassigned = decisions.filter((d): d is Extract<OptimizationDecision, { type: 'unassigned' }> => d.type === 'unassigned')

  if (decisions.length === 0) {
    return <p className="px-4 py-6 text-center text-xs text-ink-3">This run made no assignment decisions.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Priority</th>
            <th>Vehicle</th>
            <th className="text-right">Pickup</th>
            <th className="text-right">ETA</th>
            <th className="text-right">Score</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {assigns.map(d => (
            <tr key={`a-${d.order_id}`}>
              <td className="whitespace-nowrap font-mono text-xs font-semibold text-ink">{d.order_ref}</td>
              <td><PriorityBadge priority={d.priority} /></td>
              <td className="whitespace-nowrap text-ink-2">{d.vehicle_name}</td>
              <td className="whitespace-nowrap text-right tabular-nums text-ink-2">{formatKm(d.distance_km)}</td>
              <td className="whitespace-nowrap text-right tabular-nums text-ink-2">{formatMinutes(d.eta_minutes)}</td>
              <td className="whitespace-nowrap text-right tabular-nums font-semibold text-ink">{d.score.toFixed(0)}</td>
              <td className="max-w-xs text-xs text-ink-3">{d.reason}</td>
            </tr>
          ))}
          {unassigned.map(d => (
            <tr key={`u-${d.order_id}`} className="bg-warn-soft/40">
              <td className="whitespace-nowrap font-mono text-xs font-semibold text-ink">{d.order_ref}</td>
              <td><PriorityBadge priority={d.priority} /></td>
              <td className="text-warn" colSpan={2}>Not assigned</td>
              <td />
              <td />
              <td className="max-w-xs text-xs text-warn">{d.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CandidatesList({ candidates }: { candidates: VehicleCandidate[] }) {
  const [open, setOpen] = useState(false)
  if (candidates.length === 0) return null

  // Best score first; disqualified sink to the bottom
  const sorted = [...candidates].sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1
    return b.score - a.score
  })

  return (
    <div className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-bold text-ink hover:bg-subtle"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Top candidates considered
        <span className="font-normal text-ink-3">({candidates.length})</span>
      </button>
      {open && (
        <div className="overflow-x-auto px-1 pb-2">
          <table className="table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th className="text-right">Pickup</th>
                <th className="text-right">ETA</th>
                <th className="text-right">Capacity</th>
                <th className="text-right">Fuel</th>
                <th className="text-right">Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => (
                <tr key={c.vehicle_id}>
                  <td className="whitespace-nowrap font-mono text-xs text-ink-2">{c.vehicle_id}</td>
                  <td className="whitespace-nowrap text-right tabular-nums text-ink-2">{formatKm(c.distance_to_pickup_km)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums text-ink-2">{formatMinutes(c.eta_minutes)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums text-ink-2">{c.available_capacity_kg.toFixed(0)} kg</td>
                  <td className="whitespace-nowrap text-right tabular-nums text-ink-2">{c.fuel_level.toFixed(0)}%</td>
                  <td className="whitespace-nowrap text-right tabular-nums font-semibold text-ink">
                    {c.disqualified ? '—' : c.score.toFixed(0)}
                  </td>
                  <td className="text-xs">
                    {c.disqualified ? (
                      <span className="text-warn">{c.disqualification_reason ?? 'Disqualified'}</span>
                    ) : (
                      <span className="text-ok">Eligible</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function RunDecisions({ run }: { run: OptimizationRun }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[13px] font-bold text-ink">Decisions</h2>
        <p className="text-xs text-ink-3">What each pending order was matched to, and why.</p>
      </div>
      <DecisionsTable decisions={run.decisions} />
      <CandidatesList candidates={run.candidates} />
    </div>
  )
}
