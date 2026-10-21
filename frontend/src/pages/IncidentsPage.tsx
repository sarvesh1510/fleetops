import { useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { incidentsApi } from '../services/api'
import { useRole } from '../hooks/useRole'
import { incidentTypeLabel, formatMinutes } from '../lib/utils'
import {
  Page, PageHeader, Segmented, Select, EmptyState, ErrorState, LoadingRows, Pagination,
} from '../components/ui'
import { IncidentRow } from '../components/incidents/IncidentRow'
import { IncidentDetail } from '../components/incidents/IncidentDetail'
import { ResolveIncidentModal } from '../components/incidents/ResolveIncidentModal'
import type { Incident, IncidentList, IncidentStats } from '../types'

type StatusFilter = 'active' | 'resolved' | 'all'

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
]

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'All severity' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

const TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  ...Object.entries(incidentTypeLabel).map(([value, label]) => ({ value, label })),
]

function buildSubtitle(stats: IncidentStats | undefined): string {
  if (!stats) return 'Autonomous incident response'
  const open = stats.active
  const resolved = (stats.by_status?.resolved ?? 0)
  const mttr = stats.mean_time_to_resolve_min
  const parts = [
    `${open} open`,
    `${resolved} resolved`,
    `avg resolution ${mttr == null ? '—' : formatMinutes(mttr)}`,
  ]
  return parts.join(' · ')
}

export default function IncidentsPage() {
  const { canResolveIncidents, isViewer } = useRole()

  const [status, setStatus] = useState<StatusFilter>('active')
  const [severity, setSeverity] = useState('all')
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [resolveOpen, setResolveOpen] = useState(false)

  const filters = { status, severity, type }

  const list = useQuery({
    queryKey: ['incidents', filters, page],
    queryFn: () => incidentsApi.list({ status, severity, type, page, page_size: 25 }) as Promise<IncidentList>,
    placeholderData: keepPreviousData,
    refetchInterval: 20000,
  })

  const stats = useQuery({
    queryKey: ['incident-stats'],
    queryFn: () => incidentsApi.stats(),
    refetchInterval: 20000,
  })

  const items = useMemo(() => list.data?.items ?? [], [list.data])

  // Selection is derived, not stored in an effect:
  //  - the user's explicit pick (selectedId) wins if it's still visible in the list;
  //  - otherwise, if the pick vanished from the filtered list we keep showing it via a
  //    standalone fetch (detailQuery);
  //  - with no pick, default to the first row.
  const pickInList = selectedId != null ? items.find(i => i.incident_id === selectedId) : undefined
  const effectiveId = selectedId ?? items[0]?.incident_id ?? null

  // Fallback fetch for a selection that disappeared from the filtered list.
  const detailQuery = useQuery({
    queryKey: ['incidents', 'detail', selectedId],
    queryFn: () => incidentsApi.get(selectedId as string),
    enabled: selectedId != null && !pickInList,
  })

  const selected: Incident | undefined =
    items.find(i => i.incident_id === effectiveId) ?? (selectedId != null ? detailQuery.data : undefined)

  // Reset to first page when filters change.
  const onStatus = (v: StatusFilter) => { setStatus(v); setPage(1) }
  const onSeverity = (v: string) => { setSeverity(v); setPage(1) }
  const onType = (v: string) => { setType(v); setPage(1) }

  const emptyCopy = status === 'resolved'
    ? { title: 'No resolved incidents', hint: 'Incidents you close, or that the system auto-resolves, will be listed here.' }
    : status === 'all'
      ? { title: 'No incidents recorded', hint: 'Breakdowns, traffic surges and low fuel from the running simulation appear here automatically.' }
      : { title: 'No open incidents', hint: 'Breakdowns, traffic surges and low-fuel events appear here automatically as the simulation detects them.' }

  const pages = list.data?.pages ?? 1
  const total = list.data?.total

  return (
    <Page>
      <PageHeader
        title="Incidents"
        subtitle={buildSubtitle(stats.data)}
        icon={AlertTriangle}
      />

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
        <Segmented<StatusFilter>
          label="Incident status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={onStatus}
        />
        <Select label="Severity" value={severity} onChange={onSeverity} options={SEVERITY_OPTIONS} />
        <Select label="Type" value={type} onChange={onType} options={TYPE_OPTIONS} />
      </div>

      {/* Master-detail */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: list */}
        <div className="flex w-[420px] flex-shrink-0 flex-col border-r border-line bg-canvas">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {list.isLoading ? (
              <LoadingRows rows={8} />
            ) : list.isError ? (
              <ErrorState message={(list.error as Error).message} onRetry={() => list.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState icon={ShieldCheck} title={emptyCopy.title} hint={emptyCopy.hint} />
            ) : (
              <div className="space-y-2">
                {items.map(incident => (
                  <IncidentRow
                    key={incident.incident_id}
                    incident={incident}
                    selected={incident.incident_id === effectiveId}
                    onSelect={() => setSelectedId(incident.incident_id)}
                  />
                ))}
              </div>
            )}
          </div>
          <Pagination page={page} pages={pages} total={total} onChange={setPage} />
        </div>

        {/* Right: detail */}
        <div className="min-h-0 flex-1 overflow-hidden bg-surface">
          {selected ? (
            <IncidentDetail
              key={selected.incident_id}
              incident={selected}
              canResolve={canResolveIncidents}
              isViewer={isViewer}
              onResolve={() => setResolveOpen(true)}
            />
          ) : detailQuery.isLoading ? (
            <LoadingRows rows={8} />
          ) : detailQuery.isError ? (
            <ErrorState message={(detailQuery.error as Error).message} onRetry={() => detailQuery.refetch()} />
          ) : (
            <EmptyState
              icon={AlertTriangle}
              title="Select an incident"
              hint="Choose an incident on the left to see its timeline and the autonomous actions the system took."
            />
          )}
        </div>
      </div>

      {selected && (
        <ResolveIncidentModal
          incident={selected}
          open={resolveOpen}
          onClose={() => setResolveOpen(false)}
        />
      )}
    </Page>
  )
}
