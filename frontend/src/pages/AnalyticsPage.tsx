import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  ScatterChart, Scatter, ReferenceLine, ZAxis,
} from 'recharts'
import { analyticsApi } from '../services/api'
import {
  Page, PageHeader, PageContent, StatTile, Section, LoadingRows, ErrorState, EmptyState, Skeleton,
} from '../components/ui'
import type { Tone } from '../components/ui'
import {
  CHART, axisTick, tooltipStyle, tooltipLabelStyle, tooltipItemStyle,
} from '../components/analytics/ChartKit'
import { formatMinutes, formatKm, formatInr, formatPct, formatNumber } from '../lib/utils'
import type { AnalyticsOverview, HourlyDeliveries, EtaPerformancePoint } from '../types'

// ── Deliveries-today chart ───────────────────────────────────────────────────────
function DeliveriesByHour() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['deliveries-hour'],
    queryFn: () => analyticsApi.deliveriesPerHour(),
    refetchInterval: 60_000,
  })

  if (isLoading) return <Skeleton className="h-[220px] w-full" />
  if (isError) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />

  const rows = data ?? []
  const anyDeliveries = rows.some(r => !r.is_future && r.deliveries > 0)
  if (!anyDeliveries) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No deliveries completed yet today (India time)"
        hint="Hourly delivery counts appear here as orders are delivered through the day."
      />
    )
  }

  // Trim only leading empty hours that fall before 06:00, keeping the axis readable.
  let start = 0
  for (const r of rows) {
    const h = parseInt(r.hour.slice(0, 2), 10)
    if (h >= 6 || r.deliveries > 0 || r.is_future) break
    start += 1
  }
  const trimmed = rows.slice(start).map((r: HourlyDeliveries) => ({
    hour: r.hour,
    on_time: r.is_future ? 0 : Math.max(0, r.deliveries - r.late),
    late: r.is_future ? 0 : r.late,
    is_future: r.is_future,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={trimmed} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="hour" tick={axisTick} interval={1} tickLine={false} axisLine={{ stroke: CHART.grid }} />
        <YAxis tick={axisTick} allowDecimals={false} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}
          cursor={{ fill: 'rgba(37,99,235,0.06)' }}
          formatter={(v, name) => [Number(v), name === 'on_time' ? 'On time' : 'Late']}
        />
        <Legend
          wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8}
          formatter={(v) => (v === 'on_time' ? 'On time' : 'Late')}
        />
        <Bar dataKey="on_time" stackId="d" fill={CHART.ok} radius={[0, 0, 0, 0]} maxBarSize={28} />
        <Bar dataKey="late" stackId="d" fill={CHART.warn} radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── ETA predicted vs actual chart ─────────────────────────────────────────────────
function EtaScatter() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['eta-performance'],
    queryFn: () => analyticsApi.etaPerformance(50),
    refetchInterval: 60_000,
  })

  if (isLoading) return <Skeleton className="h-[220px] w-full" />
  if (isError) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />

  const points = (data ?? []).map((p: EtaPerformancePoint) => ({
    predicted: p.predicted_min,
    actual: p.actual_min,
    order_ref: p.order_ref,
  }))
  if (points.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No completed deliveries to compare yet"
        hint="Once orders are delivered, their predicted and actual durations are plotted here."
      />
    )
  }

  const maxVal = Math.ceil(Math.max(...points.map(p => Math.max(p.predicted, p.actual))) / 10) * 10
  const domain: [number, number] = [0, maxVal || 10]

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 4, right: 12, left: -14, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
        <XAxis
          type="number" dataKey="predicted" name="Predicted" domain={domain} unit="m"
          tick={axisTick} tickLine={false} axisLine={{ stroke: CHART.grid }}
        />
        <YAxis
          type="number" dataKey="actual" name="Actual" domain={domain} unit="m"
          tick={axisTick} tickLine={false} axisLine={false}
        />
        <ZAxis range={[42, 42]} />
        <ReferenceLine
          segment={[{ x: domain[0], y: domain[0] }, { x: domain[1], y: domain[1] }]}
          stroke={CHART.muted} strokeDasharray="5 4"
          ifOverflow="extendDomain"
        />
        <Tooltip
          contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}
          cursor={{ strokeDasharray: '3 3' }}
          formatter={(v, name) => [`${formatNumber(Number(v), 0)} min`, name]}
          labelFormatter={() => ''}
        />
        <Scatter data={points} fill={CHART.brand} fillOpacity={0.65} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

export default function AnalyticsPage() {
  const { data: overview, isLoading, isError, error, refetch } = useQuery<AnalyticsOverview>({
    queryKey: ['analytics-overview'],
    queryFn: () => analyticsApi.overview(),
    refetchInterval: 30_000,
  })

  const subtitle = overview ? `Last ${overview.window_days} days of completed orders` : 'Completed-order performance'

  return (
    <Page>
      <PageHeader title="Analytics" subtitle={subtitle} icon={BarChart3} />
      <PageContent>
        {isLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[76px] w-full" />)}
            </div>
            <LoadingRows rows={5} />
          </div>
        ) : isError || !overview ? (
          <ErrorState message={(error as Error | undefined)?.message} onRetry={() => refetch()} />
        ) : (
          <div className="space-y-4">
            <AnalyticsKpis overview={overview} />

            <p className="text-xs text-ink-3">
              {formatNumber(overview.resolved_incidents)} of {formatNumber(overview.total_incidents)} incidents resolved in this window.
            </p>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Section title="Deliveries today by hour" subtitle="Completed deliveries, split by on-time and late (India time)">
                <DeliveriesByHour />
              </Section>

              <Section title="ETA: predicted vs actual" subtitle="Each point is one delivery">
                <p className="mb-3 text-xs text-ink-3">
                  Points above the dashed diagonal took longer than predicted; points below arrived sooner.
                  {overview.eta_mae_min != null && (
                    <> Model MAE over this window: <span className="font-semibold text-ink-2">{formatNumber(overview.eta_mae_min, 1)} min</span>.</>
                  )}
                </p>
                <EtaScatter />
              </Section>
            </div>
          </div>
        )}
      </PageContent>
    </Page>
  )
}

// ── KPI grid ──────────────────────────────────────────────────────────────────────
function AnalyticsKpis({ overview: o }: { overview: AnalyticsOverview }) {
  const onTimeTone: Tone = o.on_time_rate == null ? 'neutral' : o.on_time_rate >= 90 ? 'ok' : o.on_time_rate >= 75 ? 'warn' : 'bad'
  const etaTone: Tone = o.eta_accuracy_pct == null ? 'neutral' : o.eta_accuracy_pct >= 80 ? 'ok' : o.eta_accuracy_pct >= 60 ? 'warn' : 'bad'

  const tiles = [
    {
      label: 'On-time rate', tone: onTimeTone,
      value: formatPct(o.on_time_rate),
      sub: 'of delivered orders',
    },
    {
      label: 'Deliveries', tone: 'brand' as Tone,
      value: formatNumber(o.delivered),
      sub: `${formatNumber(o.failed)} failed`,
    },
    {
      label: 'Avg delivery time', tone: 'cyan' as Tone,
      value: formatMinutes(o.avg_delivery_minutes),
      sub: 'pickup to delivery',
    },
    {
      label: 'Avg distance / delivery', tone: 'violet' as Tone,
      value: formatKm(o.avg_route_distance_km),
      sub: `${formatKm(o.total_distance_km)} total`,
    },
    {
      label: 'ETA accuracy', tone: etaTone,
      value: formatPct(o.eta_accuracy_pct),
      sub: o.eta_mae_min == null
        ? `${formatNumber(o.eta_samples)} deliveries`
        : `MAE ${formatNumber(o.eta_mae_min, 1)} min over ${formatNumber(o.eta_samples)} deliveries`,
    },
    {
      label: 'Fleet in use now', tone: 'brand' as Tone,
      value: formatPct(o.fleet_utilization_pct),
      sub: `${formatNumber(o.active_vehicles)} of ${formatNumber(o.total_vehicles)} vehicles active`,
    },
    {
      label: 'Est. operating cost', tone: 'warn' as Tone,
      value: formatInr(o.estimated_cost_inr),
      sub: `ESTIMATE: ${formatNumber(o.cost_per_km_inr)} INR/km x distance`,
    },
    {
      label: 'Cost per delivery', tone: 'warn' as Tone,
      value: o.cost_per_delivery_inr == null ? '—' : formatInr(o.cost_per_delivery_inr),
      sub: 'ESTIMATE',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(t => (
        <StatTile key={t.label} label={t.label} value={t.value} sub={t.sub} tone={t.tone} />
      ))}
    </div>
  )
}
