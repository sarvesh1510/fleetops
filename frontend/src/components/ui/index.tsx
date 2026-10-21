/**
 * Shared UI primitives. Pages compose these instead of hand-styling every element,
 * which keeps spacing, typography and colour consistent across the app.
 */
/* oxlint-disable react/only-export-components -- barrel of primitives + tone maps + toast helper */
import { useEffect, type ComponentType, type ReactNode } from 'react'
import { create } from 'zustand'
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, Search, X } from 'lucide-react'
import { cx } from '../../lib/utils'

type IconType = ComponentType<{ size?: number; className?: string }>
export type Tone = 'brand' | 'ok' | 'warn' | 'bad' | 'violet' | 'cyan' | 'neutral'

export const TONE_TEXT: Record<Tone, string> = {
  brand: 'text-brand', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad',
  violet: 'text-violet', cyan: 'text-cyan', neutral: 'text-ink-2',
}
export const TONE_SOFT: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad', violet: 'bg-violet/10 text-violet', cyan: 'bg-cyan/10 text-cyan',
  neutral: 'bg-hover text-ink-2',
}
const TONE_BAR: Record<Tone, string> = {
  brand: 'bg-brand', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', violet: 'bg-violet', cyan: 'bg-cyan', neutral: 'bg-ink-3',
}

// ── Page scaffolding ───────────────────────────────────────────────────────────
export function Page({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col">{children}</div>
}

export function PageHeader({ title, subtitle, icon: Icon, actions }: {
  title: string; subtitle?: ReactNode; icon?: IconType; actions?: ReactNode
}) {
  return (
    <header className="flex min-h-14 flex-shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
      {Icon && (
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon size={16} /></span>
      )}
      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-bold leading-tight text-ink">{title}</h1>
        {subtitle && <div className="truncate text-xs text-ink-3">{subtitle}</div>}
      </div>
      <div className="flex-1" />
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function PageContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('min-h-0 flex-1 overflow-y-auto p-5', className)}>{children}</div>
}

export function Section({ title, subtitle, action, children, className, bodyClassName }: {
  title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string
}) {
  return (
    <section className={cx('card overflow-hidden', className)}>
      {(title || action) && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold text-ink">{title}</h2>
            {subtitle && <div className="text-xs text-ink-3">{subtitle}</div>}
          </div>
          <div className="flex-1" />
          {action}
        </div>
      )}
      <div className={bodyClassName ?? 'p-4'}>{children}</div>
    </section>
  )
}

// ── Data display ───────────────────────────────────────────────────────────────
export function StatTile({ label, value, sub, tone = 'brand', icon: Icon }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: IconType
}) {
  return (
    <div className="card flex items-start gap-3 px-4 py-3">
      {Icon && <span className={cx('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg', TONE_SOFT[tone])}><Icon size={16} /></span>}
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</div>
        <div className="truncate text-xl font-bold leading-tight text-ink">{value}</div>
        {sub && <div className="truncate text-xs text-ink-3">{sub}</div>}
      </div>
    </div>
  )
}

export function Badge({ children, tone = 'neutral', color, className }: {
  children: ReactNode; tone?: Tone; color?: string; className?: string
}) {
  // `color` lets callers pass a status hex from lib/utils; otherwise a semantic tone is used
  const style = color ? { backgroundColor: `${color}1a`, color } : undefined
  return (
    <span style={style} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', !color && TONE_SOFT[tone], className)}>
      {children}
    </span>
  )
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span style={{ backgroundColor: color }} className={cx('inline-block h-2 w-2 flex-shrink-0 rounded-full', className)} />
}

export function ProgressBar({ value, tone = 'brand', color, className }: {
  value: number; tone?: Tone; color?: string; className?: string
}) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-hover', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%`, backgroundColor: color }} className={cx('h-full rounded-full transition-[width] duration-500', !color && TONE_BAR[tone])} />
    </div>
  )
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</div>
      <div className="truncate text-[13px] font-semibold text-ink">{children}</div>
    </div>
  )
}

// ── States ─────────────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, hint, action }: {
  icon?: IconType; title: string; hint?: ReactNode; action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {Icon && <span className="flex h-11 w-11 items-center justify-center rounded-full bg-hover text-ink-3"><Icon size={20} /></span>}
      <div className="text-sm font-semibold text-ink">{title}</div>
      {hint && <div className="max-w-sm text-xs text-ink-3">{hint}</div>}
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center" role="alert">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-bad-soft text-bad"><AlertCircle size={20} /></span>
      <div className="text-sm font-semibold text-ink">Something went wrong</div>
      <div className="max-w-sm text-xs text-ink-3">{message ?? 'The request failed.'}</div>
      {onRetry && <button className="btn btn-ghost btn-sm mt-1" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  )
}

// ── Controls ───────────────────────────────────────────────────────────────────
export function SearchInput({ value, onChange, placeholder = 'Search…', className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string
}) {
  return (
    <div className={cx('relative', className)}>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
      <input className="input pl-8" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  )
}

export function Select<T extends string>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string
}) {
  return (
    <select className={cx('input w-auto cursor-pointer pr-7', className)} value={value} onChange={e => onChange(e.target.value as T)} aria-label={label}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Segmented<T extends string | number>({ options, value, onChange, label, size = 'md' }: {
  options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; size?: 'sm' | 'md'
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
      {options.map(o => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className={cx('rounded-md font-semibold transition-colors', size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-[13px]',
            o.value === value ? 'bg-surface text-brand shadow-card' : 'text-ink-2 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, error, hint, children, className }: {
  label: string; error?: string; hint?: string; children: ReactNode; className?: string
}) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span>
        : hint ? <span className="mt-1 block text-xs text-ink-3">{hint}</span> : null}
    </label>
  )
}

export function Pagination({ page, pages, total, onChange }: {
  page: number; pages: number; total?: number; onChange: (p: number) => void
}) {
  if (pages <= 1 && total == null) return null
  return (
    <div className="flex items-center justify-end gap-2 border-t border-line bg-surface px-4 py-2 text-xs text-ink-3">
      {total != null && <span className="mr-auto">{total.toLocaleString('en-IN')} total</span>}
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
      <span>Page {page} of {Math.max(pages, 1)}</span>
      <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
    </div>
  )
}

// ── Modal ──────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer, width = 560 }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-ink/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }} className="card flex max-h-[90vh] w-full flex-col shadow-pop">
        <div className="flex items-center border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold">{title}</h2>
          <div className="flex-1" />
          <button className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

// ── Toasts ─────────────────────────────────────────────────────────────────────
interface ToastItem { id: number; kind: 'success' | 'error' | 'info'; text: string }
interface ToastStore { items: ToastItem[]; push: (kind: ToastItem['kind'], text: string) => void; dismiss: (id: number) => void }

let toastSeq = 0
const useToastStore = create<ToastStore>((set, get) => ({
  items: [],
  push(kind, text) {
    const id = ++toastSeq
    set(s => ({ items: [...s.items.slice(-3), { id, kind, text }] }))
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3500)
  },
  dismiss: id => set(s => ({ items: s.items.filter(t => t.id !== id) })),
}))

export const toast = {
  success: (text: string) => useToastStore.getState().push('success', text),
  error: (text: string) => useToastStore.getState().push('error', text),
  info: (text: string) => useToastStore.getState().push('info', text),
}

export function ToastHost() {
  const { items, dismiss } = useToastStore()
  const icon = { success: CheckCircle2, error: AlertCircle, info: Info }
  const color = { success: 'text-ok', error: 'text-bad', info: 'text-brand' }
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[3000] flex w-80 flex-col gap-2" aria-live="polite">
      {items.map(t => {
        const Icon = icon[t.kind]
        return (
          <div key={t.id} className="card pointer-events-auto flex items-start gap-2 px-3 py-2.5 shadow-pop">
            <Icon size={16} className={cx('mt-0.5 flex-shrink-0', color[t.kind])} />
            <div className="flex-1 text-[13px] text-ink">{t.text}</div>
            <button className="text-ink-3 hover:text-ink" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} /></button>
          </div>
        )
      })}
    </div>
  )
}
