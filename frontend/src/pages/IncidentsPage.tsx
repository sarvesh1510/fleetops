import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle, Zap, ChevronDown, ChevronUp,
  Clock, Lock, RefreshCw
} from 'lucide-react'
import { incidentsApi } from '../services/api'
import { useRole } from '../hooks/useRole'
import { severityColor, incidentStatusLabel, timeAgo, formatDateTime } from '../lib/utils'
import type { Incident, IncidentTimelineEntry, AutonomousAction } from '../types'

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  vehicle_breakdown:  'Vehicle Breakdown',
  low_fuel:           'Low Fuel / Battery',
  low_battery:        'Low Battery',
  route_deviation:    'Route Deviation',
  traffic_spike:      'Traffic Spike',
  delivery_sla_risk:  'SLA at Risk',
  prolonged_stop:     'Extended Stop',
  overload:           'Overload',
  driver_unreachable: 'Driver Unreachable',
  vehicle_stopped:    'Vehicle Stopped',
}

const STATUS_COLORS: Record<string, string> = {
  detected:    '#dc2626',
  analyzing:   '#d97706',
  action_taken:'#2563eb',
  monitoring:  '#7c3aed',
  resolved:    '#059669',
  escalated:   '#dc2626',
}

function IncidentCard({
  incident, expanded, onToggle, canResolve,
}: {
  incident: Incident; expanded: boolean; onToggle: () => void; canResolve: boolean
}) {
  const qc = useQueryClient()
  const sev = severityColor[incident.severity] || '#6b7280'
  const stColor = STATUS_COLORS[incident.status] || '#6b7280'

  const resolveMutation = useMutation({
    mutationFn: () => incidentsApi.resolve(incident.incident_id) as Promise<{ message: string }>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents'] })
      qc.invalidateQueries({ queryKey: ['incident-stats'] })
    },
  })

  return (
    <div className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
      {/* Severity stripe */}
      <div style={{ height: 3, background: sev }} />

      {/* Header row */}
      <div
        onClick={onToggle}
        style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }}
      >
        {/* Icon */}
        <div style={{ width: 36, height: 36, borderRadius: 8, background: `${sev}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
          <AlertTriangle size={16} style={{ color: sev }} />
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f1c3f' }}>{incident.title}</span>
            {/* Severity badge */}
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 100, background: `${sev}20`, color: sev, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {incident.severity}
            </span>
            {/* Status badge */}
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100, background: `${stColor}18`, color: stColor, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {incidentStatusLabel[incident.status] || incident.status}
            </span>
            {/* Type badge */}
            <span style={{ fontSize: 10, color: '#7a90b8', padding: '2px 7px', borderRadius: 4, background: '#f8faff', border: '1px solid #dce5f5' }}>
              {INCIDENT_TYPE_LABELS[incident.type] || incident.type}
            </span>
            {/* Region if present */}
            {(incident as unknown as Record<string,unknown>).region ? (
              <span style={{ fontSize: 10, color: '#7c3aed', background: '#f5f3ff', padding: '2px 6px', borderRadius: 4 }}>
                {String((incident as unknown as Record<string,unknown>).region)}
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: '#3d5280', lineHeight: 1.5, marginBottom: 6 }}>{incident.description}</div>
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#7a90b8', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={10} /> {timeAgo(incident.created_at)}
            </span>
            {incident.vehicle_id && (
              <span>Vehicle: <span style={{ fontFamily: 'var(--font-mono)', color: '#3d5280' }}>{incident.vehicle_id.slice(-10)}</span></span>
            )}
            {(incident as unknown as Record<string,unknown>).vehicle_name ? (
              <span style={{ color: '#0f1c3f', fontWeight: 600 }}>{String((incident as unknown as Record<string,unknown>).vehicle_name)}</span>
            ) : null}
            {incident.autonomous_actions.length > 0 && (
              <span style={{ color: '#2563eb', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Zap size={10} /> {incident.autonomous_actions.length} auto action{incident.autonomous_actions.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {incident.status !== 'resolved' && canResolve && (
            <button
              onClick={e => { e.stopPropagation(); resolveMutation.mutate() }}
              disabled={resolveMutation.isPending}
              className="btn-ghost"
              style={{ fontSize: 11, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5, color: '#059669', borderColor: '#bbf7d0' }}
            >
              <CheckCircle size={11} />
              {resolveMutation.isPending ? 'Resolving…' : 'Resolve'}
            </button>
          )}
          {incident.status !== 'resolved' && !canResolve && (
            <span style={{ fontSize: 10, color: '#7a90b8', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Lock size={9} /> Viewer
            </span>
          )}
          {incident.status === 'resolved' && (
            <span style={{ fontSize: 11, color: '#059669', display: 'flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle size={12} /> Resolved
            </span>
          )}
          {expanded
            ? <ChevronUp size={14} style={{ color: '#7a90b8' }} />
            : <ChevronDown size={14} style={{ color: '#7a90b8' }} />
          }
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop: '1px solid #eaf0fb', padding: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Timeline */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#7a90b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
                Incident Timeline
              </div>
              <div style={{ position: 'relative', paddingLeft: 20 }}>
                <div style={{ position: 'absolute', left: 7, top: 8, bottom: 8, width: 2, background: '#dce5f5', borderRadius: 1 }} />
                {incident.timeline.map((entry: IncidentTimelineEntry, i: number) => (
                  <div key={i} style={{ marginBottom: 14, position: 'relative' }}>
                    <div style={{ position: 'absolute', left: -20, top: 3, width: 10, height: 10, borderRadius: '50%', background: i === 0 ? sev : '#fff', border: `2px solid ${i === 0 ? sev : '#dce5f5'}` }} />
                    <div style={{ fontSize: 10, color: '#7a90b8', marginBottom: 2 }}>{formatDateTime(entry.timestamp)} · {entry.actor}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#0f1c3f' }}>{entry.event}</div>
                    {entry.details ? <div style={{ fontSize: 11, color: '#3d5280', marginTop: 2 }}>{entry.details}</div> : null}
                  </div>
                ))}
                {incident.resolved_at ? (
                  <div style={{ position: 'relative', marginBottom: 0 }}>
                    <div style={{ position: 'absolute', left: -20, top: 3, width: 10, height: 10, borderRadius: '50%', background: '#059669', border: '2px solid #059669' }} />
                    <div style={{ fontSize: 10, color: '#7a90b8', marginBottom: 2 }}>{formatDateTime(incident.resolved_at)}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#059669' }}>✓ Resolved</div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Autonomous Actions */}
            {incident.autonomous_actions.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#7a90b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={11} style={{ color: '#2563eb' }} /> Autonomous Actions
                </div>
                {incident.autonomous_actions.map((action: AutonomousAction, i: number) => (
                  <div key={i} style={{ background: '#f8faff', borderRadius: 8, padding: '12px 14px', marginBottom: 10, border: '1px solid #dce5f5' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ width: 24, height: 24, borderRadius: 6, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Zap size={12} style={{ color: '#2563eb' }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#0f1c3f' }}>{action.description}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#3d5280', marginBottom: 4 }}>
                      <strong>Reason:</strong> {action.reason}
                    </div>
                    <div style={{ fontSize: 11, color: '#059669', marginBottom: 4 }}>
                      <strong>Expected:</strong> {action.expected_impact}
                    </div>
                    {action.outcome && (
                      <div style={{ fontSize: 11, color: '#059669', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CheckCircle size={11} /> Outcome: {action.outcome}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#7a90b8', marginTop: 6 }}>
                      Executed {timeAgo(action.executed_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function IncidentsPage() {
  const [statusFilter, setStatusFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { canResolveIncidents } = useRole()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['incidents', statusFilter, severityFilter],
    queryFn: () => incidentsApi.list({
      status: statusFilter !== 'all' ? statusFilter : undefined,
      severity: severityFilter !== 'all' ? severityFilter : undefined,
    }) as Promise<{ items: Incident[]; total: number; active_count: number }>,
    refetchInterval: 8000,
  })

  const { data: stats } = useQuery({
    queryKey: ['incident-stats'],
    queryFn: () => incidentsApi.stats() as Promise<Record<string, unknown>>,
    refetchInterval: 10000,
  })

  const activeCount = data?.active_count ?? 0
  const totalCount = data?.total ?? 0

  const STATUS_FILTERS = [
    { key: 'all',         label: 'All'          },
    { key: 'detected',    label: 'Detected'     },
    { key: 'action_taken',label: 'Action Taken' },
    { key: 'monitoring',  label: 'Monitoring'   },
    { key: 'resolved',    label: 'Resolved'     },
  ]
  const SEVERITY_FILTERS = [
    { key: 'all',      label: 'All Severity' },
    { key: 'critical', label: 'Critical'     },
    { key: 'high',     label: 'High'         },
    { key: 'medium',   label: 'Medium'       },
    { key: 'low',      label: 'Low'          },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={18} style={{ color: '#ea580c' }} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f1c3f' }}>Incident Management</h1>
            <div style={{ fontSize: 11, color: '#7a90b8', marginTop: 2 }}>
              {activeCount > 0
                ? <span style={{ color: '#dc2626', fontWeight: 600 }}>{activeCount} active incident{activeCount > 1 ? 's' : ''} · </span>
                : null}
              {totalCount} total recorded
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {/* Severity summary */}
          {stats?.by_severity ? Object.entries((stats.by_severity as Record<string,number>))
            .filter(([,cnt]) => (cnt as number) > 0)
            .map(([sev, count]) => (
              <div key={sev} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, background: `${severityColor[sev as keyof typeof severityColor] || '#6b7280'}12`, border: `1px solid ${severityColor[sev as keyof typeof severityColor] || '#6b7280'}30` }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: severityColor[sev as keyof typeof severityColor] || '#6b7280' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: severityColor[sev as keyof typeof severityColor] || '#6b7280', textTransform: 'capitalize' }}>{sev}: {count as number}</span>
              </div>
            )) : null}
          <button onClick={() => refetch()} className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Status filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {STATUS_FILTERS.map(({ key, label }) => (
              <button key={key} onClick={() => setStatusFilter(key)} style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                border: `1px solid ${statusFilter === key ? '#2563eb' : 'var(--border)'}`,
                background: statusFilter === key ? '#2563eb' : 'var(--bg-elevated)',
                color: statusFilter === key ? 'white' : '#3d5280',
                fontWeight: 500, transition: 'all 0.12s',
              }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          {/* Severity filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {SEVERITY_FILTERS.map(({ key, label }) => {
              const color = severityColor[key as keyof typeof severityColor] || '#2563eb'
              const active = severityFilter === key
              return (
                <button key={key} onClick={() => setSeverityFilter(key)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  border: `1px solid ${active ? color : 'var(--border)'}`,
                  background: active ? color : 'var(--bg-elevated)',
                  color: active ? 'white' : '#3d5280',
                  fontWeight: 500, transition: 'all 0.12s',
                }}>
                  {label}
                </button>
              )
            })}
          </div>
          {!canResolveIncidents && (
            <div style={{ marginLeft: 'auto', fontSize: 11, color: '#7a90b8', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Lock size={10} /> Dispatcher+ required to resolve incidents
            </div>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', color: '#7a90b8', padding: 60 }}>Loading incidents…</div>
        ) : (data?.items ?? []).length === 0 ? (
          <div style={{ textAlign: 'center', color: '#7a90b8', padding: 60 }}>
            <CheckCircle size={36} style={{ marginBottom: 12, color: '#bbf7d0' }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: '#059669', marginBottom: 6 }}>All clear!</div>
            <div style={{ fontSize: 12 }}>No incidents match the current filters.</div>
          </div>
        ) : (data?.items ?? []).map(incident => (
          <IncidentCard
            key={incident.incident_id}
            incident={incident}
            expanded={expandedId === incident.incident_id}
            onToggle={() => setExpandedId(expandedId === incident.incident_id ? null : incident.incident_id)}
            canResolve={canResolveIncidents}
          />
        ))}
      </div>
    </div>
  )
}
