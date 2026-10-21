import { formatKm, formatMinutes, formatPct } from '../../lib/utils'
import type { OptimizationRun } from '../../types'

/**
 * Horizontal "baseline vs chosen plan" bars. The baseline is a first-come,
 * nearest-vehicle dispatch; the chosen plan is the Hungarian assignment.
 * Bars are scaled to the larger of the two values so the difference is honest.
 * Lower is better (less total pickup distance / time), so we never dress a
 * zero or negative improvement up as a saving.
 */
function CompareRow({
  label, before, after, format, betterPct,
}: {
  label: string
  before: number
  after: number
  format: (v: number) => string
  betterPct: number | null
}) {
  const max = Math.max(before, after, 0.0001)
  const beforePct = (before / max) * 100
  const afterPct = (after / max) * 100
  const improved = betterPct != null && betterPct > 0
  const worse = betterPct != null && betterPct < 0

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-ink-2">{label}</span>
        <span
          className={
            improved ? 'text-xs font-bold text-ok' : worse ? 'text-xs font-bold text-warn' : 'text-xs font-semibold text-ink-3'
          }
        >
          {betterPct == null
            ? '—'
            : improved
              ? `${formatPct(betterPct)} shorter`
              : worse
                ? `${formatPct(Math.abs(betterPct))} longer`
                : 'No change'}
        </span>
      </div>

      <div className="space-y-1.5">
        {/* Baseline */}
        <div className="flex items-center gap-2">
          <span className="w-16 flex-shrink-0 text-[11px] text-ink-3">Baseline</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-hover">
            <div className="h-full rounded bg-ink-3/50" style={{ width: `${beforePct}%` }} />
          </div>
          <span className="w-20 flex-shrink-0 text-right text-[11px] font-semibold tabular-nums text-ink-2">{format(before)}</span>
        </div>
        {/* Chosen plan */}
        <div className="flex items-center gap-2">
          <span className="w-16 flex-shrink-0 text-[11px] text-ink-2">Dispatch</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-hover">
            <div className={`h-full rounded ${improved ? 'bg-ok' : worse ? 'bg-warn' : 'bg-brand'}`} style={{ width: `${afterPct}%` }} />
          </div>
          <span className="w-20 flex-shrink-0 text-right text-[11px] font-bold tabular-nums text-ink">{format(after)}</span>
        </div>
      </div>
    </div>
  )
}

export default function RunComparison({ run }: { run: OptimizationRun }) {
  const hasDistance = run.before_total_distance_km != null && run.after_total_distance_km != null
  const hasDuration = run.before_total_duration_min != null && run.after_total_duration_min != null

  if (!hasDistance && !hasDuration) {
    return (
      <p className="text-xs text-ink-3">
        No baseline comparison for this run — there was nothing to compare against.
      </p>
    )
  }

  // improvement_pct describes the overall plan (distance). Duration delta is derived
  // from the two duration values so we never invent a percentage.
  const durationPct =
    hasDuration && run.before_total_duration_min
      ? ((run.before_total_duration_min - (run.after_total_duration_min ?? 0)) / run.before_total_duration_min) * 100
      : null

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-ink-3">Baseline: first-come, nearest vehicle. Lower is better.</p>
      {hasDistance && (
        <CompareRow
          label="Total pickup distance"
          before={run.before_total_distance_km as number}
          after={run.after_total_distance_km as number}
          format={formatKm}
          betterPct={run.improvement_pct}
        />
      )}
      {hasDuration && (
        <CompareRow
          label="Total pickup time"
          before={run.before_total_duration_min as number}
          after={run.after_total_duration_min as number}
          format={formatMinutes}
          betterPct={durationPct}
        />
      )}
    </div>
  )
}
