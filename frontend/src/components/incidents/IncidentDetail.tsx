import { Link } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, Clock, Zap, Package, Truck, ListChecks,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { Badge, KeyValue, type Tone } from '../ui'
import {
  severityColor, incidentStatusLabel, incidentTypeLabel,
  formatDateTime, formatTime, formatMinutes, parseApiDate, cx,
} from '../../lib/utils'
import type { Incident, AutonomousAction, IncidentTimelineEntry } from '../../types'

const STATUS_TONE: Record<string, Tone> = {
  detected: 'bad',
  analyzing: 'warn',
  action_taken: 'brand',
  monitoring: 'violet',
  resolved: 'ok',
  escalated: 'bad',
}

/** Resolution duration in minutes (created -> resolved). */
function resolutionMinutes(incident: Incident): number | null {
  if (!incident.resolved_at) return null
  const start = parseApiDate(incident.created_at).getTime()
  const end = parseApiDate(incident.resolved_at).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null
  return (end - start) / 60000
}

function actorLabel(actor: string | null | undefined): string {
  if (!actor) return 'system'
  return actor
}

function SectionTitle({ icon: Icon, children }: { icon?: ComponentType<{ size?: number; className?: string }>; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
      {Icon && <Icon size={13} />}
      {children}
    </div>
  )
}

function ActionCard({ action }: { action: AutonomousAction }) {
  const done = Boolean(action.outcome)
  return (
    <div className="rounded-lg border border-line bg-subtle p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
          <Zap size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">{action.description}</div>
          <div className="mt-1 text-xs text-ink-2">
            <span className="font-semibold text-ink-3">Reason: </span>{action.reason}
          </div>
          <div className="mt-0.5 text-xs text-ink-2">
            <span className="font-semibold text-ink-3">Expected: </span>{action.expected_impact}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {done ? (
              <span className="inline-flex items-center gap-1 font-semibold text-ok">
                <CheckCircle2 size={12} /> {action.outcome}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-ink-3">
                <Clock size={12} /> In progress
              </span>
            )}
            <span className="text-ink-3">{formatTime(action.executed_at)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TimelineRow({ entry, last }: { entry: IncidentTimelineEntry; last: boolean }) {
  return (
    <li className="relative pl-5">
      {!last && <span className="absolute left-[5px] top-3 bottom-[-10px] w-px bg-line" aria-hidden />}
      <span className="absolute left-0 top-[5px] h-[11px] w-[11px] rounded-full border-2 border-line bg-surface" aria-hidden />
      <div className="text-[11px] text-ink-3">
        <span title={formatDateTime(entry.timestamp)}>{formatTime(entry.timestamp)}</span>
        <span className="mx-1.5">·</span>
        <span>{actorLabel(entry.actor)}</span>
      </div>
      <div className="text-[13px] font-semibold text-ink">{entry.event}</div>
      {entry.details && <div className="mt-0.5 text-xs text-ink-2">{entry.details}</div>}
    </li>
  )
}

export function IncidentDetail({
  incident,
  canResolve,
  isViewer,
  onResolve,
}: {
  incident: Incident
  canResolve: boolean
  isViewer: boolean
  onResolve: () => void
}) {
  const sev = severityColor[incident.severity]
  const resolved = incident.status === 'resolved'
  const durationMin = resolutionMinutes(incident)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex flex-shrink-0 items-start gap-3 border-b border-line px-5 py-4">
        <span
          className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${sev}1a`, color: sev }}
        >
          <AlertTriangle size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold leading-snug text-ink">{incident.title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge color={sev} className="uppercase">{incident.severity}</Badge>
            <Badge tone={STATUS_TONE[incident.status] ?? 'neutral'}>{incidentStatusLabel[incident.status] ?? incident.status}</Badge>
            <Badge tone="neutral">{incidentTypeLabel[incident.type] ?? incident.type}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1" title={formatDateTime(incident.created_at)}>
              <Clock size={12} /> {formatDateTime(incident.created_at)}
            </span>
            {incident.vehicle_name && (
              <span className="inline-flex items-center gap-1 text-ink-2">
                <Truck size={12} /> {incident.vehicle_name}
              </span>
            )}
            {incident.region && <span>{incident.region}</span>}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          {!resolved && canResolve && (
            <button className="btn btn-primary btn-sm" onClick={onResolve}>Resolve</button>
          )}
          {!resolved && isViewer && (
            <span className="max-w-[150px] text-right text-[11px] text-ink-3">Resolving requires dispatcher access</span>
          )}
          {resolved && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok">
              <CheckCircle2 size={14} /> Resolved
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* Description */}
        <p className="text-[13px] leading-relaxed text-ink-2">{incident.description}</p>

        {/* SLA impact */}
        {incident.sla_impact && (
          <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
            <span className="font-semibold">SLA impact: </span>{incident.sla_impact}
          </div>
        )}

        {/* Resolution notes */}
        {resolved && (
          <div className="rounded-lg border border-ok/30 bg-ok-soft px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
              <span className="inline-flex items-center gap-1 font-semibold text-ok">
                <CheckCircle2 size={13} /> Resolved {formatDateTime(incident.resolved_at)}
              </span>
              {durationMin != null && <span>Time to resolve: {formatMinutes(durationMin)}</span>}
            </div>
            {incident.resolution_notes && (
              <p className="mt-1.5 text-[13px] text-ink-2">{incident.resolution_notes}</p>
            )}
          </div>
        )}

        {/* Autonomous actions */}
        <section>
          <SectionTitle icon={Zap}>What the system did</SectionTitle>
          {incident.autonomous_actions.length === 0 ? (
            <p className="text-xs text-ink-3">No automated action was needed.</p>
          ) : (
            <div className="space-y-2">
              {incident.autonomous_actions.map((action, i) => (
                <ActionCard key={`${action.action_type}-${i}`} action={action} />
              ))}
            </div>
          )}
        </section>

        {/* Timeline */}
        <section>
          <SectionTitle icon={ListChecks}>Timeline</SectionTitle>
          {incident.timeline.length === 0 ? (
            <p className="text-xs text-ink-3">No timeline entries recorded.</p>
          ) : (
            <ol className="space-y-3">
              {incident.timeline.map((entry, i) => (
                <TimelineRow key={i} entry={entry} last={i === incident.timeline.length - 1} />
              ))}
            </ol>
          )}
        </section>

        {/* Affected orders */}
        {incident.order_ids.length > 0 && (
          <section>
            <SectionTitle icon={Package}>Affected orders</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {incident.order_ids.map(id => (
                <Link
                  key={id}
                  to={`/orders?search=${encodeURIComponent(id)}`}
                  title={id}
                  className={cx(
                    'max-w-[160px] truncate rounded-md border border-line bg-subtle px-2 py-1',
                    'font-mono text-[11px] text-brand hover:bg-hover hover:underline',
                  )}
                >
                  {id}
                </Link>
              ))}
            </div>
          </section>
        )}

        <KeyValue label="Incident ID"><span className="font-mono">{incident.incident_id}</span></KeyValue>
      </div>
    </div>
  )
}
