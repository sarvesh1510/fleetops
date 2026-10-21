/**
 * Small shared chart helpers used by the Analytics and Predictions pages.
 * Recharts needs raw colour values (SVG fills, tooltip styling), so the theme
 * token hex values are mirrored here as named constants - the single source of
 * truth for them is still src/styles/globals.css.
 */

export const CHART = {
  grid: '#e3e8f1',
  axis: '#8190ad',
  brand: '#2563eb',
  ok: '#059669',
  warn: '#d97706',
  bad: '#dc2626',
  violet: '#7c3aed',
  cyan: '#0891b2',
  muted: '#c9d3e6',
} as const

/** Shared axis tick style (recharts wants a plain object, not a class). */
export const axisTick = { fontSize: 11, fill: CHART.axis } as const

/** Tooltip container styled to match the .card / shadow-pop tokens. */
export const tooltipStyle = {
  background: '#ffffff',
  border: '1px solid #e3e8f1',
  borderRadius: 8,
  fontSize: 12,
  color: '#0f1c3f',
  boxShadow: '0 8px 28px rgba(15, 28, 63, 0.14), 0 2px 6px rgba(15, 28, 63, 0.06)',
  padding: '8px 10px',
} as const

export const tooltipLabelStyle = { color: '#46567a', fontWeight: 600, marginBottom: 2 } as const
export const tooltipItemStyle = { color: '#0f1c3f' } as const
