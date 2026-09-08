import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Zap, Play, BarChart3, Brain, TrendingDown, Clock,
  CheckCircle, AlertCircle, Lock, RefreshCw, ChevronRight
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend
} from 'recharts'
import { optimizationApi, analyticsApi, mlApi } from '../services/api'
import { useRole } from '../hooks/useRole'
import { timeAgo, formatKm, formatMinutes } from '../lib/utils'
import type { OptimizationRun } from '../types'

// ─────────────────────────────────────────────────────────────
// SHARED TOOLTIP STYLE
// ─────────────────────────────────────────────────────────────
const TT_STYLE = {
  background: '#fff',
  border: '1px solid #dce5f5',
  borderRadius: 8,
  fontSize: 12,
  boxShadow: '0 2px 8px rgba(15,28,63,0.10)',
  color: '#0f1c3f',
}

// ─────────────────────────────────────────────────────────────
// OPTIMIZATION PAGE
// ─────────────────────────────────────────────────────────────
function ImprovementBar({ before, after, label, unit }: { before: number; after: number; label: string; unit: string }) {
  if (!before || before === 0) return null
  const pct = Math.max(0, Math.min(100, ((before - after) / before) * 100))
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#7a90b8', marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: '#059669', fontWeight: 700 }}>-{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 6, background: '#f0f4fa', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #059669, #34d399)', borderRadius: 3 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#7a90b8', marginTop: 3 }}>
        <span>Before: {before.toFixed(1)} {unit}</span>
        <span>After: {after.toFixed(1)} {unit}</span>
      </div>
    </div>
  )
}

function RunCard({ run, expanded, onToggle }: { run: OptimizationRun; expanded: boolean; onToggle: () => void }) {
  const imp = run.improvement_pct ?? 0
  const impColor = imp > 10 ? '#059669' : imp > 5 ? '#2563eb' : imp > 0 ? '#d97706' : '#6b7280'
  const statusColor = run.status === 'completed' ? '#059669' : run.status === 'failed' ? '#dc2626' : '#d97706'

  return (
    <div className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
      <div style={{ height: 3, background: run.status === 'completed' ? impColor : '#dc2626' }} />
      <div
        onClick={onToggle}
        style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'flex-start' }}
      >
        {/* Icon */}
        <div style={{ width: 36, height: 36, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Zap size={16} style={{ color: '#2563eb' }} />
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: '#0f1c3f' }}>{run.run_id}</span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 100, background: `${statusColor}18`, color: statusColor, textTransform: 'uppercase' }}>
              {run.status}
            </span>
            <span style={{ fontSize: 11, color: '#7a90b8', textTransform: 'capitalize' }}>
              Trigger: {run.trigger.replace(/_/g, ' ')}
            </span>
            {(run as unknown as Record<string,unknown>).region ? (
              <span style={{ fontSize: 10, color: '#7c3aed', background: '#f5f3ff', padding: '1px 6px', borderRadius: 4 }}>
                {String((run as unknown as Record<string,unknown>).region)}
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: '#3d5280', marginBottom: 4 }}>{run.summary}</div>
          <div style={{ fontSize: 10, color: '#7a90b8', display: 'flex', gap: 12 }}>
            <span>{timeAgo(run.created_at)}</span>
            {run.solver_duration_ms && <span>Solved in {run.solver_duration_ms.toFixed(0)}ms</span>}
            <span>{run.vehicles_considered} vehicles · {run.orders_in_scope} orders</span>
          </div>
        </div>

        {/* Improvement badge */}
        <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {imp > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: impColor, letterSpacing: '-0.02em', lineHeight: 1 }}>
                -{imp.toFixed(1)}%
              </div>
              <div style={{ fontSize: 10, color: '#7a90b8' }}>improvement</div>
            </div>
          )}
          {run.assignments_changed > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#0f1c3f' }}>{run.assignments_changed}</div>
              <div style={{ fontSize: 10, color: '#7a90b8' }}>assigned</div>
            </div>
          )}
          <ChevronRight size={14} style={{ color: '#7a90b8', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', marginLeft: 4 }} />
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #eaf0fb' }}>
          <div style={{ paddingTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Before/after metrics */}
            {run.before_total_distance_km && run.after_total_distance_km && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#7a90b8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Route Metrics</div>
                <ImprovementBar before={run.before_total_distance_km} after={run.after_total_distance_km} label="Total Distance" unit="km" />
                {run.before_total_duration_min && run.after_total_duration_min && (
                  <ImprovementBar before={run.before_total_duration_min} after={run.after_total_duration_min} label="Total Duration" unit="min" />
                )}
                {/* Savings summary */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                  {[
                    ['Distance Saved', run.distance_saved_km ? formatKm(run.distance_saved_km) : '—'],
                    ['Time Saved', run.time_saved_min ? formatMinutes(run.time_saved_min) : '—'],
                  ].map(([l, v]) => (
                    <div key={l} style={{ background: '#f0fdf4', borderRadius: 6, padding: '8px 10px', border: '1px solid #bbf7d0' }}>
                      <div style={{ fontSize: 10, color: '#059669', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#059669' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Decisions */}
            {(run as unknown as {decisions?: unknown[]}).decisions && (run as unknown as {decisions: unknown[]}).decisions.length > 0 ? (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#7a90b8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Assignments Made</div>
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {(run as unknown as {decisions: Record<string,unknown>[]}).decisions.slice(0, 10).map((d, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #eaf0fb' }}>
                      <CheckCircle size={12} style={{ color: '#059669', flexShrink: 0 }} />
                      <div style={{ fontSize: 11, color: '#3d5280', minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: '#0f1c3f' }}>{String((d as Record<string,unknown>).order_ref || (d as Record<string,unknown>).order_id || '').slice(-10)}</span>
                        {(d as Record<string,unknown>).vehicle_name ? <span style={{ color: '#7a90b8' }}> → {String((d as Record<string,unknown>).vehicle_name)}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

export function OptimizationPage() {
  const qc = useQueryClient()
  const { canRunOptimization, roleLabel } = useRole()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['opt-runs'],
    queryFn: () => optimizationApi.listRuns() as Promise<{ items: OptimizationRun[]; total: number }>,
    refetchInterval: 10000,
  })

  const { data: stats } = useQuery({
    queryKey: ['opt-stats'],
    queryFn: () => optimizationApi.stats() as Promise<Record<string, number>>,
    refetchInterval: 30000,
  })

  const runMutation = useMutation({
    mutationFn: () => optimizationApi.run() as Promise<OptimizationRun>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opt-runs'] })
      qc.invalidateQueries({ queryKey: ['opt-stats'] })
      qc.invalidateQueries({ queryKey: ['fleet-stats'] })
      qc.invalidateQueries({ queryKey: ['order-stats'] })
    },
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={18} style={{ color: '#2563eb' }} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f1c3f' }}>Optimization Engine</h1>
            <div style={{ fontSize: 11, color: '#7a90b8', marginTop: 2 }}>OR-Tools CVRPTW Solver · Auto-assigns pending orders to best vehicles</div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => refetch()} className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <RefreshCw size={12} /> Refresh
          </button>
          {canRunOptimization ? (
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px', fontSize: 13 }}
            >
              {runMutation.isPending
                ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Optimizing…</>
                : <><Play size={14} /> Run Optimization</>}
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#7a90b8', padding: '8px 14px', background: '#f8faff', border: '1px solid var(--border)', borderRadius: 6 }}>
              <Lock size={12} /> {roleLabel} — view only
            </div>
          )}
        </div>

        {/* Stats row */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {[
              { label: 'Total Runs',       value: `${stats.total_runs ?? 0}`,  icon: Zap },
              { label: 'Avg Improvement',  value: stats.avg_improvement_pct ? `${stats.avg_improvement_pct.toFixed(1)}%` : '—', icon: TrendingDown },
              { label: 'Distance Saved',   value: stats.total_distance_saved ? formatKm(stats.total_distance_saved) : '—', icon: CheckCircle },
              { label: 'Time Saved',       value: stats.total_time_saved ? formatMinutes(stats.total_time_saved) : '—', icon: Clock },
              { label: 'Avg Solve Time',   value: stats.avg_solver_ms ? `${stats.avg_solver_ms.toFixed(0)}ms` : '—', icon: RefreshCw },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="card-elevated" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <Icon size={14} style={{ color: '#2563eb', flexShrink: 0 }} />
                <div>
                  <div className="stat-label" style={{ marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0f1c3f' }}>{value}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Mutation result */}
        {runMutation.isSuccess && runMutation.data && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle size={16} style={{ color: '#059669', flexShrink: 0 }} />
            <div style={{ fontSize: 13, color: '#059669', fontWeight: 600 }}>
              Optimization complete! {runMutation.data.assignments_changed} order(s) assigned.
              {runMutation.data.improvement_pct ? ` Route efficiency improved by ${runMutation.data.improvement_pct.toFixed(1)}%.` : ''}
            </div>
          </div>
        )}
        {runMutation.isError && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertCircle size={16} style={{ color: '#dc2626', flexShrink: 0 }} />
            <div style={{ fontSize: 13, color: '#dc2626' }}>{(runMutation.error as Error).message}</div>
          </div>
        )}
      </div>

      {/* Run list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', color: '#7a90b8', padding: 60 }}>Loading runs…</div>
        ) : (data?.items ?? []).length === 0 ? (
          <div style={{ textAlign: 'center', color: '#7a90b8', padding: 60 }}>
            <Zap size={36} style={{ marginBottom: 12, color: '#dce5f5' }} />
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No optimization runs yet</div>
            <div style={{ fontSize: 12 }}>Click "Run Optimization" to assign pending orders to the best vehicles.</div>
          </div>
        ) : (data?.items ?? []).map(run => (
          <RunCard
            key={run.run_id}
            run={run}
            expanded={expandedId === run.run_id}
            onToggle={() => setExpandedId(expandedId === run.run_id ? null : run.run_id)}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ANALYTICS PAGE
// ─────────────────────────────────────────────────────────────
export function AnalyticsPage() {
  const { data: overview } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => analyticsApi.overview() as Promise<Record<string, number>>,
    refetchInterval: 30000,
  })
  const { data: byHour } = useQuery({
    queryKey: ['deliveries-hour'],
    queryFn: () => analyticsApi.deliveriesPerHour() as Promise<{ hour: string; deliveries: number }[]>,
  })
  const { data: etaPerf } = useQuery({
    queryKey: ['eta-perf'],
    queryFn: () => analyticsApi.etaPerformance() as Promise<{ order_ref: string; predicted_min: number; actual_min: number; variance_pct: number }[]>,
  })

  const kpis = overview ? [
    { label: 'On-Time Rate',       value: `${overview.on_time_rate}%`,                           sub: `${overview.total_deliveries} total`,       color: overview.on_time_rate > 85 ? '#059669' : '#d97706' },
    { label: 'Total Deliveries',   value: overview.total_deliveries,                              sub: `${overview.failed} failed`,                color: '#2563eb' },
    { label: 'Fleet Utilization',  value: `${overview.fleet_utilization_pct}%`,                   sub: `${overview.active_vehicles} / ${overview.total_vehicles} active`, color: '#7c3aed' },
    { label: 'Avg Route Distance', value: formatKm(overview.avg_route_distance_km),               sub: `${formatKm(overview.total_distance_km)} total`, color: '#0891b2' },
    { label: 'Est. Cost Today',    value: `₹${((overview.estimated_cost_inr || 0) / 1000).toFixed(1)}k`, sub: `₹${Math.round(overview.cost_per_delivery_inr || 0)}/delivery`, color: '#d97706' },
  ] : []

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BarChart3 size={18} style={{ color: '#2563eb' }} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f1c3f' }}>Analytics</h1>
            <div style={{ fontSize: 11, color: '#7a90b8', marginTop: 2 }}>Mumbai MMR + Delhi NCR · Fleet performance overview</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
          {kpis.map(({ label, value, sub, color }) => (
            <div key={label} className="card" style={{ padding: '14px 16px' }}>
              <div className="stat-label">{label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4, letterSpacing: '-0.02em' }}>{value}</div>
              {sub && <div style={{ fontSize: 11, color: '#7a90b8', marginTop: 3 }}>{sub}</div>}
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#3d5280', marginBottom: 14 }}>DELIVERIES PER HOUR (TODAY)</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byHour ?? []} margin={{ left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eaf0fb" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#7a90b8' }} interval={3} />
                <YAxis tick={{ fontSize: 10, fill: '#7a90b8' }} />
                <Tooltip contentStyle={TT_STYLE} />
                <Bar dataKey="deliveries" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#3d5280', marginBottom: 14 }}>ETA ACCURACY — PREDICTED vs ACTUAL</div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={(etaPerf ?? []).slice(0, 30)} margin={{ left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eaf0fb" />
                <XAxis dataKey="order_ref" tick={{ fontSize: 9, fill: '#7a90b8' }} interval={4} />
                <YAxis tick={{ fontSize: 10, fill: '#7a90b8' }} unit="m" />
                <Tooltip contentStyle={TT_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="predicted_min" stroke="#2563eb" dot={false} strokeWidth={2} name="Predicted" />
                <Line type="monotone" dataKey="actual_min" stroke="#059669" dot={false} strokeWidth={2} name="Actual" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ETA table */}
        {etaPerf && etaPerf.length > 0 && (
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#3d5280', marginBottom: 12 }}>ETA VARIANCE SAMPLE</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Order Ref', 'Predicted', 'Actual', 'Variance', 'Rating'].map(h => (
                    <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#7a90b8', letterSpacing: '0.08em', borderBottom: '1px solid #eaf0fb', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {etaPerf.slice(0, 12).map((row, i) => {
                  const abs = Math.abs(row.variance_pct)
                  const vc = abs < 10 ? '#059669' : abs < 25 ? '#d97706' : '#dc2626'
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #eaf0fb' }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#0f1c3f' }}>{row.order_ref}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, color: '#3d5280' }}>{row.predicted_min} min</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, color: '#3d5280' }}>{row.actual_min} min</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, color: vc }}>{row.variance_pct > 0 ? '+' : ''}{row.variance_pct.toFixed(1)}%</td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: vc }}>{abs < 10 ? '✓ Accurate' : abs < 25 ? '~ Acceptable' : '✗ Off'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PREDICTIONS PAGE
// ─────────────────────────────────────────────────────────────
export function PredictionsPage() {
  const [etaInputs, setEtaInputs] = useState({ distance_km: 12, speed_kmh: 28, n_stops: 3, traffic_factor: 1.4 })

  const { data: status } = useQuery({
    queryKey: ['ml-status'],
    queryFn: () => mlApi.status() as Promise<Record<string, unknown>>,
    refetchInterval: 60000,
  })
  const { data: demand } = useQuery({
    queryKey: ['demand-forecast'],
    queryFn: () => mlApi.demand() as Promise<{ forecasts: { zone: string; predicted_orders: number; confidence: number }[]; hour: number }>,
    refetchInterval: 60000,
  })
  const { data: etaResult, refetch: fetchEta, isFetching: etaLoading } = useQuery({
    queryKey: ['eta-predict', etaInputs],
    queryFn: () => mlApi.predictEta(etaInputs) as Promise<{ predicted_duration_minutes: number; confidence_pct: number }>,
  })

  const models = ((status?.models as unknown) as Record<string, { ready: boolean; description: string; metrics: Record<string, number> }>) ?? {}
  const modelColors: Record<string, string> = { eta_prediction: '#2563eb', demand_forecast: '#059669', anomaly_detection: '#d97706' }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Brain size={18} style={{ color: '#7c3aed' }} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f1c3f' }}>AI & Predictions</h1>
            <div style={{ fontSize: 11, color: '#7a90b8', marginTop: 2 }}>
              {status?.trained_at ? `Models trained ${timeAgo(status.trained_at as string)} · All running` : 'Loading models…'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {/* Model cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
          {Object.entries(models).map(([key, model]) => {
            const color = modelColors[key] || '#7c3aed'
            return (
              <div key={key} className="card" style={{ padding: '16px', borderTop: `3px solid ${color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: model.ready ? '#059669' : '#d97706' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#7a90b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {key.replace(/_/g, ' ')}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: model.ready ? '#059669' : '#d97706', background: model.ready ? '#f0fdf4' : '#fffbeb', padding: '1px 6px', borderRadius: 4 }}>
                    {model.ready ? 'READY' : 'LOADING'}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: '#3d5280', margin: '0 0 10px', lineHeight: 1.5 }}>{model.description}</p>
                {Object.entries(model.metrics || {}).map(([mk, mv]) => (
                  <div key={mk} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, padding: '4px 0', borderBottom: '1px solid #eaf0fb' }}>
                    <span style={{ color: '#7a90b8' }}>{mk.replace(/_/g, ' ')}</span>
                    <span style={{ fontWeight: 700, color: '#0f1c3f', fontFamily: 'var(--font-mono)' }}>{Number(mv).toFixed(3)}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Interactive ETA predictor */}
          <div className="card" style={{ padding: '18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f1c3f', marginBottom: 4 }}>ETA Prediction Demo</div>
            <div style={{ fontSize: 11, color: '#7a90b8', marginBottom: 16 }}>Adjust inputs and predict delivery duration using the XGBoost model</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {([
                ['distance_km',   'Distance (km)',     1,   50,  1  ],
                ['speed_kmh',     'Speed (km/h)',      10,  60,  1  ],
                ['n_stops',       'Delivery Stops',    1,   10,  1  ],
                ['traffic_factor','Traffic Factor',    0.5, 3.0, 0.1],
              ] as [string, string, number, number, number][]).map(([k, lbl, min, max, step]) => (
                <div key={k}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#3d5280', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>{lbl}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="range" min={min} max={max} step={step}
                      value={etaInputs[k as keyof typeof etaInputs]}
                      onChange={e => setEtaInputs(p => ({ ...p, [k]: parseFloat(e.target.value) }))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0f1c3f', minWidth: 32, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {etaInputs[k as keyof typeof etaInputs]}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => fetchEta()} disabled={etaLoading} className="btn-primary" style={{ width: '100%', padding: '9px', fontSize: 13, marginBottom: 16 }}>
              {etaLoading ? 'Predicting…' : 'Predict ETA'}
            </button>

            {etaResult && (
              <div style={{ textAlign: 'center', background: '#eff6ff', borderRadius: 10, padding: '20px 16px', border: '1px solid #dbeafe' }}>
                <div style={{ fontSize: 52, fontWeight: 900, color: '#2563eb', letterSpacing: '-0.03em', lineHeight: 1 }}>
                  {etaResult.predicted_duration_minutes.toFixed(0)}
                  <span style={{ fontSize: 20, fontWeight: 400, color: '#7a90b8' }}> min</span>
                </div>
                <div style={{ fontSize: 12, color: '#3d5280', marginTop: 8 }}>
                  Confidence: <strong style={{ color: '#059669' }}>{etaResult.confidence_pct.toFixed(0)}%</strong>
                  {' · '}Traffic factor {etaInputs.traffic_factor}× adds ~{((etaInputs.traffic_factor - 1) * 100).toFixed(0)}% delay
                </div>
              </div>
            )}
          </div>

          {/* Demand forecast */}
          {demand && (
            <div className="card" style={{ padding: '18px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f1c3f', marginBottom: 4 }}>Demand Forecast</div>
              <div style={{ fontSize: 11, color: '#7a90b8', marginBottom: 16 }}>
                Predicted order volume by zone · Hour {demand.hour}:00 IST
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={demand.forecasts} layout="vertical" margin={{ left: 0, right: 36 }}>
                  <XAxis type="number" tick={{ fontSize: 9, fill: '#7a90b8' }} domain={[0, 'dataMax']} />
                  <YAxis type="category" dataKey="zone" tick={{ fontSize: 9, fill: '#7a90b8' }} width={95} />
                  <Tooltip contentStyle={TT_STYLE} formatter={(v) => [`${Number(v).toFixed(1)} orders`, 'Forecast']} />
                  <Bar dataKey="predicted_orders" fill="#059669" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#7a90b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Confidence by Zone</div>
                {demand.forecasts.slice(0, 5).map(f => (
                  <div key={f.zone} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: '#3d5280', width: 92, flexShrink: 0 }}>{f.zone}</div>
                    <div style={{ flex: 1, height: 4, background: '#eaf0fb', borderRadius: 2 }}>
                      <div style={{ height: '100%', borderRadius: 2, width: `${f.confidence}%`, background: f.confidence > 80 ? '#059669' : '#d97706' }} />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#0f1c3f', width: 32, textAlign: 'right' }}>{f.confidence.toFixed(0)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
