import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Route, Send, Truck, CheckCircle2, Clock } from 'lucide-react'
import { optimizationApi } from '../services/api'
import { useRole } from '../hooks/useRole'
import {
  Page, PageHeader, PageContent, Section, StatTile, Badge, Pagination,
  LoadingRows, EmptyState, ErrorState, Skeleton, toast,
} from '../components/ui'
import {
  formatKm, formatMinutes, formatNumber, timeAgo, formatDateTime, triggerLabel,
} from '../lib/utils'
import type { OptimizationRun, OptimizationStats } from '../types'
import RunComparison from '../components/optimization/RunComparison'
import RunDecisions from '../components/optimization/RunDecisions'

const PAGE_SIZE = 15

/** Signed percentage, lower-distance-is-better framing. Null -> em dash. */
function signedImprovement(pct: number | null | undefined): string {
  if (pct == null) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function improvementTone(pct: number | null | undefined): 'ok' | 'warn' | 'neutral' {
  if (pct == null) return 'neutral'
  if (pct > 0) return 'ok'
  if (pct < 0) return 'warn'
  return 'neutral'
}

// ── Stat tiles ──────────────────────────────────────────────────────────────
function StatRow({ stats, loading }: { stats?: OptimizationStats; loading: boolean }) {
  if (loading && !stats) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[72px] w-full" />)}
      </div>
    )
  }
  if (!stats) return null

  const avg = stats.avg_improvement_pct
  const avgLabel = avg == null ? '—' : `${signedImprovement(avg)} shorter`

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile icon={Route} label="Runs recorded" value={formatNumber(stats.total_runs)} tone="brand" />
      <StatTile icon={Truck} label="Orders dispatched" value={formatNumber(stats.total_assignments)} tone="violet" />
      <StatTile
        icon={CheckCircle2}
        label="Avg distance vs baseline"
        value={avgLabel}
        sub={`over ${formatNumber(stats.runs_with_comparison)} comparable run${stats.runs_with_comparison === 1 ? '' : 's'}`}
        tone={improvementTone(avg)}
      />
      <StatTile
        icon={Clock}
        label="Distance saved"
        value={formatKm(stats.total_distance_saved_km)}
        sub={`${formatMinutes(stats.total_time_saved_min)} saved`}
        tone="cyan"
      />
    </div>
  )
}

// ── How dispatch works (collapsible, default collapsed) ──────────────────────
function HowItWorks() {
  const [open, setOpen] = useState(false)
  return (
    <Section
      title="How dispatch works"
      action={
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="btn btn-ghost btn-sm"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {open ? 'Hide' : 'Show'}
        </button>
      }
      bodyClassName={open ? 'p-4' : 'hidden'}
    >
      <ul className="space-y-1.5 text-xs text-ink-3">
        <li>Each run takes every pending order and every available vehicle in the same region (dispatch never crosses regions).</li>
        <li>Hard constraints filter candidates: region, capacity, cold-chain and fuel range. Pickup distance, vehicle health and deadline pressure are soft factors in the score.</li>
        <li>The Hungarian algorithm picks the assignment that minimises total pickup distance, with a bonus for high-priority orders.</li>
        <li>That plan is compared with a first-come, nearest-vehicle baseline. The difference can be zero or negative — it is a comparison, not a guaranteed saving.</li>
      </ul>
    </Section>
  )
}

// ── Runs list (master) ───────────────────────────────────────────────────────
function RunRow({ run, selected, onSelect }: { run: OptimizationRun; selected: boolean; onSelect: () => void }) {
  const assigned = run.decisions.filter(d => d.type === 'assign').length
  const impTone = improvementTone(run.improvement_pct)
  return (
    <tr
      className={`is-clickable${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
    >
      <td className="whitespace-nowrap text-ink-2">{timeAgo(run.created_at)}</td>
      <td><Badge tone="neutral">{triggerLabel[run.trigger] ?? run.trigger}</Badge></td>
      <td className="whitespace-nowrap tabular-nums text-ink-2">
        {assigned} / {run.orders_in_scope}
      </td>
      <td
        className={`whitespace-nowrap text-right tabular-nums font-semibold ${
          impTone === 'ok' ? 'text-ok' : impTone === 'warn' ? 'text-warn' : 'text-ink-3'
        }`}
      >
        {signedImprovement(run.improvement_pct)}
      </td>
      <td>
        {run.status === 'failed'
          ? <Badge tone="bad">Failed</Badge>
          : run.status === 'running'
            ? <Badge tone="warn">Running</Badge>
            : <Badge tone="ok">Completed</Badge>}
      </td>
    </tr>
  )
}

function RunsList({
  page, setPage, selectedId, onSelect,
}: {
  page: number
  setPage: (p: number) => void
  selectedId: string | null
  onSelect: (run: OptimizationRun) => void
}) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['opt-runs', page],
    queryFn: () => optimizationApi.listRuns({ page, page_size: PAGE_SIZE }),
    refetchInterval: 15_000,
  })

  // Auto-select the first run once the first page loads and nothing is picked.
  useEffect(() => {
    if (page === 1 && !selectedId && data?.items?.length) {
      onSelect(data.items[0])
    }
  }, [page, selectedId, data, onSelect])

  return (
    <Section
      title="Dispatch runs"
      subtitle={data ? `${formatNumber(data.total)} recorded` : undefined}
      bodyClassName="p-0"
    >
      {isLoading ? (
        <LoadingRows rows={8} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon={Route}
          title="No dispatch runs yet"
          hint="Runs appear automatically as orders arrive, vehicles break down, or when you run one manually."
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Trigger</th>
                  <th>Assigned / in scope</th>
                  <th className="text-right">vs baseline</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data!.items.map(run => (
                  <RunRow
                    key={run.run_id}
                    run={run}
                    selected={run.run_id === selectedId}
                    onSelect={() => onSelect(run)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={data!.pages} total={data!.total} onChange={setPage} />
        </>
      )}
    </Section>
  )
}

// ── Run detail (detail pane) ─────────────────────────────────────────────────
function RunMeta({ run }: { run: OptimizationRun }) {
  const items: [string, string][] = [
    ['Solver time', run.solver_duration_ms != null ? `${run.solver_duration_ms.toFixed(0)} ms` : '—'],
    ['Vehicles considered', formatNumber(run.vehicles_considered)],
    ['Orders in scope', formatNumber(run.orders_in_scope)],
    ['Completed', run.completed_at ? formatDateTime(run.completed_at) : '—'],
  ]
  if (run.triggering_order_id) items.push(['Triggered by order', run.triggering_order_id])
  if (run.triggering_vehicle_id) items.push(['Triggered by vehicle', run.triggering_vehicle_id])

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</div>
          <div className="truncate font-mono text-[12px] text-ink-2">{value}</div>
        </div>
      ))}
    </div>
  )
}

function RunDetail({ run, loading }: { run: OptimizationRun | null; loading: boolean }) {
  if (loading && !run) {
    return (
      <Section title="Run detail" bodyClassName="p-4">
        <div className="space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Section>
    )
  }
  if (!run) {
    return (
      <Section title="Run detail" bodyClassName="p-0">
        <EmptyState icon={Route} title="Select a run" hint="Pick a dispatch run on the left to see its decisions and comparison." />
      </Section>
    )
  }

  return (
    <div className="space-y-4">
      <Section
        title={<span className="font-mono">{run.run_id}</span>}
        subtitle={<span>{triggerLabel[run.trigger] ?? run.trigger} · {timeAgo(run.created_at)}</span>}
        bodyClassName="space-y-4 p-4"
      >
        {run.status === 'failed' && run.error_message && (
          <div role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">
            {run.error_message}
          </div>
        )}
        <p className="text-[13px] leading-relaxed text-ink-2">{run.summary}</p>
        <RunComparison run={run} />
        <div className="border-t border-line pt-3">
          <RunMeta run={run} />
        </div>
      </Section>

      <RunDecisions run={run} />
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function OptimizationPage() {
  const qc = useQueryClient()
  const { canRunOptimization } = useRole()
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // A run selected from the list already carries decisions/candidates. We keep a
  // local copy so the detail pane can render instantly; a fetch backfills if a
  // list item ever lacks them.
  const [selectedRun, setSelectedRun] = useState<OptimizationRun | null>(null)

  const handleSelect = (run: OptimizationRun) => {
    setSelectedId(run.run_id)
    setSelectedRun(run)
  }

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['opt-stats'],
    queryFn: optimizationApi.stats,
    refetchInterval: 30_000,
  })

  // Fall back to a full fetch only when the chosen run has no decisions loaded.
  const needsDetail = selectedId != null && selectedRun != null && selectedRun.decisions == null
  const { data: fetchedDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['opt-runs', 'detail', selectedId],
    queryFn: () => optimizationApi.getRun(selectedId as string),
    enabled: needsDetail,
  })

  const detailRun = useMemo(() => {
    if (selectedRun?.decisions != null) return selectedRun
    return fetchedDetail ?? selectedRun
  }, [selectedRun, fetchedDetail])

  const runMutation = useMutation({
    mutationFn: optimizationApi.run,
    onSuccess: run => {
      if (run.orders_in_scope === 0) {
        toast.info('Nothing to dispatch - no orders are waiting')
      } else {
        toast.success(run.summary)
      }
      // Show the fresh run immediately, then refresh the lists it affected.
      handleSelect(run)
      setPage(1)
      qc.invalidateQueries({ queryKey: ['opt-runs'] })
      qc.invalidateQueries({ queryKey: ['opt-stats'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['order-stats'] })
    },
    onError: err => toast.error((err as Error).message || 'Dispatch failed'),
  })

  const runDisabledTitle = canRunOptimization
    ? undefined
    : 'Requires a Dispatcher role or higher'

  return (
    <Page>
      <PageHeader
        title="Dispatch"
        subtitle="Order-to-vehicle assignment decisions"
        icon={Route}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canRunOptimization || runMutation.isPending}
            title={runDisabledTitle}
            onClick={() => runMutation.mutate()}
          >
            <Send size={14} />
            {runMutation.isPending ? 'Dispatching…' : 'Run dispatch now'}
          </button>
        }
      />

      <PageContent className="space-y-4">
        <StatRow stats={stats} loading={statsLoading} />
        <HowItWorks />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <RunsList page={page} setPage={setPage} selectedId={selectedId} onSelect={handleSelect} />
          <RunDetail run={detailRun} loading={detailLoading && needsDetail} />
        </div>
      </PageContent>
    </Page>
  )
}
