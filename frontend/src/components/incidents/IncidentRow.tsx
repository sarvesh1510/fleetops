import { Badge, type Tone } from '../ui'
import { severityColor, incidentStatusLabel, timeAgo, cx } from '../../lib/utils'
import type { Incident } from '../../types'

const STATUS_TONE: Record<string, Tone> = {
  detected: 'bad',
  analyzing: 'warn',
  action_taken: 'brand',
  monitoring: 'violet',
  resolved: 'ok',
  escalated: 'bad',
}

export function IncidentRow({
  incident,
  selected,
  onSelect,
}: {
  incident: Incident
  selected: boolean
  onSelect: () => void
}) {
  const sev = severityColor[incident.severity]
  const sub = incident.vehicle_name || incident.region

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${incident.title}, ${incident.severity} severity`}
      className={cx(
        'relative flex w-full items-start gap-3 rounded-lg border py-2.5 pl-4 pr-3 text-left transition-colors',
        selected ? 'border-brand/40 bg-brand-soft' : 'border-line bg-surface hover:bg-hover',
      )}
    >
      {/* severity colour bar on the left edge */}
      <span
        className="absolute left-0 top-2 bottom-2 w-1 rounded-full"
        style={{ backgroundColor: sev }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: sev }}>
            {incident.severity}
          </span>
          <span className="truncate text-[13px] font-semibold text-ink">{incident.title}</span>
        </div>
        {sub && <div className="mt-0.5 truncate text-xs text-ink-3">{sub}</div>}
        <div className="mt-1 flex items-center gap-2">
          <Badge tone={STATUS_TONE[incident.status] ?? 'neutral'}>
            {incidentStatusLabel[incident.status] ?? incident.status}
          </Badge>
          <span className="text-[11px] text-ink-3">{timeAgo(incident.created_at)}</span>
        </div>
      </div>
    </button>
  )
}
