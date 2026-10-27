import { NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, BarChart3, Brain, KeyRound, LayoutDashboard, LogOut, Package, Truck, Zap } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWSStore } from '../../stores/wsStore'
import { useRole } from '../../hooks/useRole'
import { incidentsApi } from '../../services/api'
import { cx } from '../../lib/utils'
import { ToastHost } from '../ui'
import ChangePasswordModal from './ChangePasswordModal'

const NAV = [
  {
    heading: 'Operations',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/fleet', icon: Truck, label: 'Fleet' },
      { to: '/orders', icon: Package, label: 'Orders' },
      { to: '/incidents', icon: AlertTriangle, label: 'Incidents', badge: true },
    ],
  },
  {
    heading: 'Insights',
    items: [
      { to: '/optimization', icon: Zap, label: 'Dispatch' },
      { to: '/analytics', icon: BarChart3, label: 'Analytics' },
      { to: '/predictions', icon: Brain, label: 'Predictions' },
    ],
  },
]

export default function AppLayout() {
  const { user, logout } = useAuthStore()
  const connected = useWSStore(s => s.connected)
  const { roleLabel } = useRole()
  const [pwdOpen, setPwdOpen] = useState(false)

  const { data: incidentStats } = useQuery({
    queryKey: ['incident-stats'],
    queryFn: incidentsApi.stats,
    refetchInterval: 30_000,
  })
  const activeIncidents = incidentStats?.active ?? 0

  const initials = (user?.full_name ?? '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <aside className="flex w-52 flex-shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-cyan text-sm font-extrabold text-white">F</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-extrabold leading-tight text-ink">FleetOps</div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
              <span className={cx('h-1.5 w-1.5 rounded-full', connected ? 'pulse-live bg-ok' : 'bg-bad')} />
              {connected ? 'Live' : 'Reconnecting…'}
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 py-2" aria-label="Main">
          {NAV.map(group => (
            <div key={group.heading}>
              <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-ink-3">{group.heading}</div>
              {group.items.map(({ to, icon: Icon, label, end, badge }) => (
                <NavLink key={to} to={to} end={end}
                  className={({ isActive }) => cx(
                    'mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                    isActive ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-hover hover:text-ink')}>
                  <Icon size={16} className="flex-shrink-0" />
                  <span className="flex-1">{label}</span>
                  {badge && activeIncidents > 0 && (
                    <span className="min-w-5 rounded-full bg-bad px-1.5 text-center text-[10px] font-bold leading-4 text-white">{activeIncidents}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 border-t border-line px-3 py-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-hover text-xs font-bold text-ink-2" aria-hidden>{initials}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold leading-tight text-ink">{user?.full_name}</div>
            <div className="truncate text-[11px] text-ink-3">{roleLabel}</div>
          </div>
          <button onClick={() => setPwdOpen(true)} className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink" aria-label="Change password" title="Change password">
            <KeyRound size={15} />
          </button>
          <button onClick={logout} className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink" aria-label="Sign out" title="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
      <ToastHost />
      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  )
}
