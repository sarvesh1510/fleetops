import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard, Truck, Package, AlertTriangle,
  BarChart3, Brain, Zap, LogOut, Shield, Eye
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWSStore } from '../../stores/wsStore'
import { useRole } from '../../hooks/useRole'

const ROLE_COLOR: Record<string, string> = {
  admin: '#ef4444',
  operations_manager: '#f97316',
  dispatcher: '#3b82f6',
  viewer: '#6b7280',
}

const ROLE_BADGE_BG: Record<string, string> = {
  admin: '#fef2f2',
  operations_manager: '#fff7ed',
  dispatcher: '#eff6ff',
  viewer: '#f9fafb',
}

export default function AppLayout() {
  const { user, logout } = useAuthStore()
  const { connected, liveEvents } = useWSStore()
  const { role, isDispatcherOrAbove, isAdmin } = useRole()

  const activeIncidents = liveEvents.filter(e => e.type === 'incident.created').length

  // Nav items with role visibility
  const navItems = [
    { to: '/',             icon: LayoutDashboard, label: 'Dashboard',    exact: true, show: true },
    { to: '/fleet',        icon: Truck,           label: 'Fleet',         exact: false, show: true },
    { to: '/orders',       icon: Package,         label: 'Orders',        exact: false, show: true },
    { to: '/incidents',    icon: AlertTriangle,   label: 'Incidents',     exact: false, show: true },
    { to: '/optimization', icon: Zap,             label: 'Optimization',  exact: false, show: isDispatcherOrAbove },
    { to: '/analytics',    icon: BarChart3,       label: 'Analytics',     exact: false, show: true },
    { to: '/predictions',  icon: Brain,           label: 'AI Predictions',exact: false, show: true },
  ]

  const rc = ROLE_COLOR[role] || '#6b7280'
  const rb = ROLE_BADGE_BG[role] || '#f9fafb'

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* Sidebar */}
      <aside style={{
        width: 224,
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '2px 0 8px rgba(15,28,63,0.06)',
      }}>
        {/* Logo */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: 'linear-gradient(135deg, #2563eb, #0891b2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, fontWeight: 800, color: 'white', flexShrink: 0,
            }}>F</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>FleetOps</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', fontWeight: 600 }}>INDIA LOGISTICS</div>
            </div>
          </div>
        </div>

        {/* Live status */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#059669' : '#dc2626', flexShrink: 0 }}
            className={connected ? 'pulse-live' : ''} />
          <span style={{ fontSize: 11, fontWeight: 600, color: connected ? '#059669' : '#dc2626' }}>
            {connected ? 'LIVE' : 'RECONNECTING'}
          </span>
          {activeIncidents > 0 && (
            <span style={{ marginLeft: 'auto', background: '#dc2626', color: 'white', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>
              {activeIncidents}
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '8px 8px', overflowY: 'auto' }}>
          {navItems.filter(n => n.show).map(({ to, icon: Icon, label, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 10px', borderRadius: 7, marginBottom: 2,
                textDecoration: 'none', fontSize: 13, fontWeight: 500,
                color: isActive ? '#2563eb' : 'var(--text-secondary)',
                background: isActive ? '#eff6ff' : 'transparent',
                transition: 'all 0.12s',
              })}
            >
              {({ isActive }) => (
                <>
                  <Icon size={15} style={{ color: isActive ? '#2563eb' : 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{label}</span>
                  {label === 'Incidents' && activeIncidents > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: '#dc2626', color: 'white', borderRadius: 8, padding: '0 5px', minWidth: 16, textAlign: 'center' }}>
                      {activeIncidents}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-subtle)' }}>
          {/* Role badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '5px 8px', background: rb, borderRadius: 6, border: `1px solid ${rc}22` }}>
            {isAdmin ? <Shield size={11} style={{ color: rc, flexShrink: 0 }} /> :
             !isDispatcherOrAbove ? <Eye size={11} style={{ color: rc, flexShrink: 0 }} /> :
             <Shield size={11} style={{ color: rc, flexShrink: 0 }} />}
            <span style={{ fontSize: 11, fontWeight: 700, color: rc, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {role.replace(/_/g, ' ')}
            </span>
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.full_name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </div>

          {/* Permissions summary for viewer */}
          {!isDispatcherOrAbove && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', background: '#f9fafb', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', marginBottom: 8, lineHeight: 1.4 }}>
              👁 Read-only access. Contact a dispatcher to create orders or make changes.
            </div>
          )}

          <button
            onClick={logout}
            className="btn-ghost"
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: 12 }}
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  )
}
