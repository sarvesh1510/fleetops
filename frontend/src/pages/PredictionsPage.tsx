import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { keepPreviousData } from '@tanstack/react-query'
import { Brain, Info, Clock3, TrendingUp, AlertTriangle, Target } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, ReferenceDot, Cell, ScatterChart, Scatter, ReferenceLine, Legend,
} from 'recharts'
import { mlApi, ApiError } from '../services/api'
import {
  Page, PageHeader, PageContent, Section, Badge, LoadingRows, Skeleton, EmptyState, ErrorState,
} from '../components/ui'
import { CHART, axisTick, tooltipStyle, tooltipLabelStyle, tooltipItemStyle } from '../components/analytics/ChartKit'
import { formatMinutes, formatNumber, formatDateTime, formatPct } from '../lib/utils'
import type { MLStatus, MLModelStatus, EtaPrediction, DemandForecast, EtaEvaluation, EtaErrors, EtaMethod } from '../types'

// A 503 means the model is still training; we retry those automatically.
function isTraining(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503
}
function retryTraining(_count: number, err: unknown): boolean {
  return isTraining(err)
}

// ── Model status cards ────────────────────────────────────────────────────────────
const MODEL_META: Record<keyof MLStatus['models'], { title: string; icon: typeof Clock3 }> = {
  eta_prediction: { title: 'ETA prediction', icon: Clock3 },
  demand_forecast: { title: 'Demand forecast', icon: TrendingUp },
  anomaly_detection: { title: 'Anomaly detection', icon: AlertTriangle },
}

const METRIC_LABELS: Record<string, { label: string; format: (v: number) => string }> = {
  mae_minutes: { label: 'Mean error', format: v => `${formatNumber(v, 1)} min` },
  rmse_minutes: { label: 'RMS error', format: v => `${formatNumber(v, 1)} min` },
  mae_orders: { label: 'Mean error', format: v => `${formatNumber(v, 2)} orders/hour` },
  contamination_rate: { label: 'Flagged share', format: v => formatPct(v * 100, 1) },
}

function ModelCard({ keyName, model, trainedAt }: {
  keyName: keyof MLStatus['models']; model: MLModelStatus; trainedAt: string | null
}) {
  const meta = MODEL_META[keyName]
  const Icon = meta.icon
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-ink">{meta.title}</div>
        </div>
        {model.ready
          ? <Badge tone="ok">Ready</Badge>
          : <Badge tone="warn"><span className="pulse-live">Training…</span></Badge>}
      </div>

      <p className="text-xs leading-relaxed text-ink-2">{model.description}</p>

      <dl className="mt-auto space-y-1.5">
        {Object.entries(model.metrics).map(([k, v]) => {
          const m = METRIC_LABELS[k]
          return (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] uppercase tracking-wide text-ink-3">{m ? m.label : k.replace(/_/g, ' ')}</dt>
              <dd className="font-mono text-[13px] font-semibold text-ink">{m ? m.format(v) : formatNumber(v, 3)}</dd>
            </div>
          )
        })}
      </dl>

      <div className="border-t border-line pt-2 text-[11px] text-ink-3">
        {trainedAt ? `Trained ${formatDateTime(trainedAt)}` : 'Not yet trained'}
      </div>
    </div>
  )
}

function ModelStatusGrid() {
  const { data, isLoading, isError, error, refetch } = useQuery<MLStatus>({
    queryKey: ['ml-status'],
    queryFn: () => mlApi.status(),
    // Poll quickly while any model is still training; otherwise leave it alone.
    refetchInterval: q => {
      const s = q.state.data as MLStatus | undefined
      if (!s) return 3_000
      const allReady = Object.values(s.models).every(m => m.ready)
      return allReady ? false : 3_000
    },
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[180px] w-full" />)}
      </div>
    )
  }
  if (isError || !data) return <ErrorState message={(error as Error | undefined)?.message} onRetry={() => refetch()} />

  const order: (keyof MLStatus['models'])[] = ['eta_prediction', 'demand_forecast', 'anomaly_detection']
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {order.map(k => <ModelCard key={k} keyName={k} model={data.models[k]} trainedAt={data.trained_at} />)}
    </div>
  )
}

// ── ETA accuracy: ML model vs simple formulas ─────────────────────────────────────
const METHOD_META: Record<EtaMethod, { label: string; hint: string; color: string }> = {
  ml: { label: 'ML model', hint: 'Predicts the traffic the trip will meet, e.g. rush hour starting mid-trip', color: CHART.brand },
  formula: { label: 'Simple formula', hint: 'Distance ÷ speed in current traffic + handling time (what the app used before)', color: '#94a3b8' },
  fixed_speed: { label: 'Fixed-speed guess', hint: 'Distance ÷ 25 km/h + handling time, ignoring traffic', color: '#cbd5e1' },
}
const METHOD_ORDER: EtaMethod[] = ['ml', 'formula', 'fixed_speed']

function ErrorBars({ title, subtitle, methods }: { title: string; subtitle: string; methods: EtaErrors | null }) {
  const max = methods ? Math.max(...METHOD_ORDER.map(m => methods[m].mae), 0.1) : 1
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="text-[13px] font-bold text-ink">{title}</div>
      <p className="mb-3 text-[11px] text-ink-3">{subtitle}</p>
      {methods ? (
        <ul className="space-y-3">
          {METHOD_ORDER.map(m => (
            <li key={m}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-ink" title={METHOD_META[m].hint}>{METHOD_META[m].label}</span>
                <span className="font-mono text-[13px] font-semibold text-ink">{formatNumber(methods[m].mae, 1)} min</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-subtle" role="img"
                aria-label={`${METHOD_META[m].label}: average error ${formatNumber(methods[m].mae, 1)} minutes`}>
                <div className="h-full rounded-full"
                  style={{ width: `${Math.max(2, (methods[m].mae / max) * 100)}%`, background: METHOD_META[m].color }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-3">Nothing to show yet.</p>
      )}
    </div>
  )
}

function useEtaEvaluation() {
  return useQuery<EtaEvaluation>({
    queryKey: ['ml-eta-evaluation'],
    queryFn: () => mlApi.etaEvaluation(),
    refetchInterval: 15_000,
  })
}

function EtaAccuracy() {
  const { data, isLoading, isError, error, refetch } = useEtaEvaluation()

  let summary: string | null = null
  const held = data?.held_out
  if (held && held.ml_vs_formula_pct != null) {
    summary = `On ${formatNumber(held.samples, 0)} unseen test trips the ML model is off by ${formatNumber(held.methods.ml.mae, 1)} min on average, `
      + `the simple formula by ${formatNumber(held.methods.formula.mae, 1)} min `
      + `(${formatNumber(Math.abs(held.ml_vs_formula_pct), 0)}% ${held.ml_vs_formula_pct >= 0 ? 'lower' : 'higher'} for ML).`
  }

  return (
    <Section title="How accurate is the ETA model?"
      subtitle="Average error in minutes (lower is better). Every order the dispatcher assigns gets its ETA from the ML model.">
      {isLoading ? (
        <Skeleton className="h-[160px] w-full" />
      ) : isError || !data ? (
        <ErrorState message={(error as Error | undefined)?.message} onRetry={() => refetch()} />
      ) : !data.model_ready ? (
        <EmptyState icon={Clock3} title="Model is still training"
          hint="Orders assigned until now use the simple formula. This updates automatically." />
      ) : (
        <div className="space-y-3">
          {summary && <p className="text-[13px] leading-relaxed text-ink-2">{summary}</p>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ErrorBars title="Test trips (simulated history)"
              subtitle="Trips set aside before training, so the model has never seen them."
              methods={held?.methods ?? null} />
            <ErrorBars title={`Live deliveries (${data.live.samples})`}
              subtitle={data.live.samples
                ? 'Estimates made when each order was assigned vs how long it really took in this simulation.'
                : 'No order has been delivered since the ML model went live. Speed the simulation up to collect some.'}
              methods={data.live.methods} />
          </div>
          <ul className="grid grid-cols-1 gap-1 text-[11px] text-ink-3 md:grid-cols-3">
            {METHOD_ORDER.map(m => (
              <li key={m}><span className="font-semibold text-ink-2">{METHOD_META[m].label}:</span> {METHOD_META[m].hint}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

// ── Predicted vs actual ───────────────────────────────────────────────────────────────
function PredictedVsActual() {
  const { data, isLoading, isError, error, refetch } = useEtaEvaluation()
  const points = data?.live.points ?? []
  const top = Math.ceil(Math.max(10, ...points.flatMap(p => [p.ml_min, p.formula_min, p.actual_min])) / 10) * 10

  return (
    <Section title="Predicted vs actual delivery time"
      subtitle="Each dot is a delivered order. The closer a dot is to the dashed line, the better the estimate.">
      {isLoading ? (
        <Skeleton className="h-[300px] w-full" />
      ) : isError || !data ? (
        <ErrorState message={(error as Error | undefined)?.message} onRetry={() => refetch()} />
      ) : points.length === 0 ? (
        <EmptyState icon={Target} title="No deliveries to compare yet"
          hint="Orders delivered after the ML model came online appear here. Use Simulation → 10x to see results sooner." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
              <XAxis type="number" dataKey="predicted" name="Predicted" domain={[0, top]} tick={axisTick} tickLine={false}
                axisLine={{ stroke: CHART.grid }} label={{ value: 'Predicted (min)', position: 'insideBottom', offset: -10, style: axisTick }} />
              <YAxis type="number" dataKey="actual" name="Actual" domain={[0, top]} tick={axisTick} tickLine={false} axisLine={false}
                label={{ value: 'Actual (min)', angle: -90, position: 'insideLeft', style: axisTick }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}
                cursor={{ strokeDasharray: '3 3' }}
                formatter={(v) => `${formatNumber(Number(v), 1)} min`} />
              <Legend verticalAlign="top" height={28} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: top, y: top }]} stroke={CHART.warn} strokeDasharray="5 4" />
              <Scatter name="Simple formula" fill="#94a3b8" fillOpacity={0.75}
                data={points.map(p => ({ predicted: p.formula_min, actual: p.actual_min }))} />
              <Scatter name="ML model" fill={CHART.brand} fillOpacity={0.85}
                data={points.map(p => ({ predicted: p.ml_min, actual: p.actual_min }))} />
            </ScatterChart>
          </ResponsiveContainer>
          <p className="mt-1 text-[11px] text-ink-3">
            Last {points.length} delivered orders. Actual time runs from assignment (driving to pickup) to delivery, in simulated minutes.
          </p>
        </>
      )}
    </Section>
  )
}

// ── ETA estimator ──────────────────────────────────────────────────────────────────
interface EtaInputs { distance_km: number; speed_kmh: number; n_stops: number; traffic_factor: number }

function trafficLabel(f: number): string {
  if (f < 1.1) return 'free flow'
  if (f < 1.6) return 'moderate'
  if (f < 2.2) return 'heavy'
  return 'severe'
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

function Slider({ label, hint, min, max, step, value, unit, onChange }: {
  label: string; hint?: string; min: number; max: number; step: number; value: number; unit?: string; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="label mb-0">{label}</span>
        <span className="font-mono text-[13px] font-semibold text-ink">{value}{unit ? ` ${unit}` : ''}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-brand"
        aria-label={label}
        aria-valuetext={`${value}${unit ? ` ${unit}` : ''}`}
      />
      {hint && <p className="mt-1 text-[11px] text-ink-3">{hint}</p>}
    </div>
  )
}

function EtaEstimator() {
  const [inputs, setInputs] = useState<EtaInputs>({ distance_km: 12, speed_kmh: 28, n_stops: 3, traffic_factor: 1.4 })
  const debounced = useDebounced(inputs, 300)

  const prediction = useQuery<EtaPrediction>({
    queryKey: ['ml-eta', debounced],
    queryFn: () => mlApi.predictEta(debounced),
    placeholderData: keepPreviousData,
    retry: retryTraining,
    retryDelay: 3000,
  })

  // Traffic sensitivity sweep: hold the other inputs fixed, vary traffic 0.8..2.6.
  const sweepFactors = useMemo(() => Array.from({ length: 8 }, (_, i) => +(0.8 + i * (1.8 / 7)).toFixed(2)), [])
  const sweep = useQuery({
    queryKey: ['ml-eta-sweep', debounced.distance_km, debounced.speed_kmh, debounced.n_stops],
    queryFn: async () => {
      const results = await Promise.all(
        sweepFactors.map(tf => mlApi.predictEta({ ...debounced, traffic_factor: tf })),
      )
      return results.map((r, i) => ({ traffic: sweepFactors[i], minutes: r.predicted_duration_minutes }))
    },
    placeholderData: keepPreviousData,
    retry: retryTraining,
    retryDelay: 3000,
  })

  const training = isTraining(prediction.error)
  const err = prediction.error as Error | undefined

  // Highlight the sweep point nearest the current traffic factor.
  const currentSweepPoint = useMemo(() => {
    if (!sweep.data) return null
    return sweep.data.reduce((best, p) =>
      Math.abs(p.traffic - inputs.traffic_factor) < Math.abs(best.traffic - inputs.traffic_factor) ? p : best)
  }, [sweep.data, inputs.traffic_factor])

  return (
    <Section title="ETA estimator" subtitle="Estimate delivery duration for a single route. Values feed the XGBoost model directly.">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Controls */}
        <div className="space-y-4">
          <Slider label="Distance" unit="km" min={1} max={60} step={1}
            value={inputs.distance_km} onChange={v => setInputs(p => ({ ...p, distance_km: v }))} />
          <Slider label="Free-flow speed" unit="km/h" min={15} max={60} step={1}
            hint="Speed on empty roads - congestion is set separately."
            value={inputs.speed_kmh} onChange={v => setInputs(p => ({ ...p, speed_kmh: v }))} />
          <Slider label="Stops" min={1} max={10} step={1}
            value={inputs.n_stops} onChange={v => setInputs(p => ({ ...p, n_stops: v }))} />
          <Slider label={`Traffic factor (${trafficLabel(inputs.traffic_factor)})`} unit="x" min={0.7} max={3.0} step={0.1}
            value={inputs.traffic_factor} onChange={v => setInputs(p => ({ ...p, traffic_factor: v }))} />
        </div>

        {/* Result */}
        <div className="flex flex-col">
          {training ? (
            <EmptyState icon={Clock3} title="Model is still training"
              hint="The ETA model is warming up on synthetic data. This retries automatically every few seconds." />
          ) : prediction.isError ? (
            <ErrorState message={err?.message} onRetry={() => prediction.refetch()} />
          ) : !prediction.data ? (
            <Skeleton className="h-full min-h-[160px] w-full" />
          ) : (
            <div className={prediction.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
              <div className="rounded-xl border border-line bg-subtle p-5 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Predicted duration</div>
                <div className="mt-1 text-4xl font-bold leading-none text-ink">{formatMinutes(prediction.data.predicted_duration_minutes)}</div>
                <div className="mt-2 text-xs text-ink-2">
                  Likely range {formatNumber(prediction.data.range_min, 0)}–{formatNumber(prediction.data.range_max, 0)} min
                  <span className="mx-1.5 text-ink-3">·</span>
                  {formatPct(prediction.data.confidence_pct, 0)} confidence
                </div>
              </div>

              {/* Traffic sensitivity sweep */}
              <div className="mt-4">
                <div className="mb-1 text-xs font-semibold text-ink-2">Traffic sensitivity</div>
                <p className="mb-2 text-[11px] text-ink-3">Predicted minutes as traffic rises, with the current setting marked.</p>
                {sweep.isError && !sweep.data ? (
                  <p className="text-[11px] text-ink-3">Sensitivity unavailable while the model warms up.</p>
                ) : sweep.data ? (
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={sweep.data} margin={{ top: 4, right: 10, left: -22, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="traffic" tick={axisTick} tickLine={false} axisLine={{ stroke: CHART.grid }}
                        domain={['dataMin', 'dataMax']} type="number" tickFormatter={v => `${v}x`} />
                      <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}
                        formatter={(v) => [`${formatNumber(Number(v), 0)} min`, 'Predicted']}
                        labelFormatter={l => `Traffic ${l}x`} />
                      <Line type="monotone" dataKey="minutes" stroke={CHART.brand} strokeWidth={2} dot={{ r: 2.5, fill: CHART.brand }} />
                      {currentSweepPoint && (
                        <ReferenceDot x={currentSweepPoint.traffic} y={currentSweepPoint.minutes} r={5}
                          fill={CHART.warn} stroke="#fff" strokeWidth={2} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Skeleton className="h-[150px] w-full" />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}

// ── Demand forecast ─────────────────────────────────────────────────────────────────
function DemandForecastChart() {
  const { data, isLoading, error, refetch, isError } = useQuery<DemandForecast>({
    queryKey: ['ml-demand'],
    queryFn: () => mlApi.demand(),
    retry: retryTraining,
    retryDelay: 3000,
    refetchInterval: 60_000,
  })

  const training = isTraining(error)

  const sorted = useMemo(
    () => (data ? [...data.forecasts].sort((a, b) => b.predicted_orders - a.predicted_orders) : []),
    [data],
  )

  const hourLabel = data != null ? `${String(data.hour).padStart(2, '0')}:00 IST` : ''

  return (
    <Section
      title={data ? `Expected orders per hour, ${hourLabel}` : 'Expected orders per hour'}
      subtitle="Predicted order volume by zone for the current hour (India time)"
    >
      {isLoading ? (
        <LoadingRows rows={6} />
      ) : training ? (
        <EmptyState icon={Clock3} title="Model is still training"
          hint="The demand model is warming up on synthetic data. This retries automatically every few seconds." />
      ) : isError || !data ? (
        <ErrorState message={(error as Error | undefined)?.message} onRetry={() => refetch()} />
      ) : sorted.length === 0 ? (
        <EmptyState icon={TrendingUp} title="No demand forecast available" />
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, sorted.length * 30)}>
          <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
            <XAxis type="number" tick={axisTick} tickLine={false} axisLine={{ stroke: CHART.grid }} allowDecimals={false} />
            <YAxis type="category" dataKey="zone" tick={axisTick} tickLine={false} axisLine={false} width={110} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}
              cursor={{ fill: 'rgba(37,99,235,0.06)' }}
              formatter={(v, _n, item) => {
                const conf = (item?.payload as { confidence?: number } | undefined)?.confidence ?? 0
                return [`${formatNumber(Number(v), 1)} orders · ${formatPct(conf, 0)} confidence`, 'Forecast']
              }} />
            <Bar dataKey="predicted_orders" radius={[0, 3, 3, 0]} maxBarSize={22}>
              {sorted.map((_, i) => <Cell key={i} fill={CHART.brand} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Section>
  )
}

export default function PredictionsPage() {
  return (
    <Page>
      <PageHeader title="Predictions" subtitle="Machine-learning models used for ETA and demand forecasting" icon={Brain} />
      <PageContent>
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-line bg-brand-soft px-4 py-3 text-xs text-ink-2" role="note">
            <Info size={15} className="mt-0.5 flex-shrink-0 text-brand" />
            <p>
              These models are trained on <span className="font-semibold text-ink">synthetic data</span> generated with this
              simulation's own rules (speeds, rush hours, stop times). The accuracy figures describe how well they learned that
              simulated world, not real-world performance.
            </p>
          </div>

          <ModelStatusGrid />
          <EtaAccuracy />
          <PredictedVsActual />
          <EtaEstimator />
          <DemandForecastChart />
        </div>
      </PageContent>
    </Page>
  )
}
