import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Truck } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'Admin123!', role: 'Admin', note: 'Full access' },
  { username: 'ops_manager', password: 'Ops123!', role: 'Ops Manager', note: 'Sim controls' },
  { username: 'dispatcher', password: 'Dispatch123!', role: 'Dispatcher', note: 'Orders & incidents' },
  { username: 'viewer', password: 'Viewer123!', role: 'Viewer', note: 'Read-only' },
]

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, isAuthenticated } = useAuthStore()

  if (isAuthenticated) return <Navigate to="/" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-cyan text-white">
            <Truck size={22} />
          </span>
          <h1 className="text-xl font-extrabold tracking-tight">FleetOps</h1>
          <p className="mt-1 text-[13px] text-ink-3">Fleet dispatch &amp; operations for Mumbai MMR and Delhi NCR</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">
              <AlertCircle size={15} className="mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}
          <label className="block">
            <span className="label">Username</span>
            <input className="input h-9" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus required />
          </label>
          <label className="block">
            <span className="label">Password</span>
            <span className="relative block">
              <input className="input h-9 pr-9" type={showPass ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
              <button type="button" onClick={() => setShowPass(s => !s)} aria-label={showPass ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink">
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>
          <button type="submit" disabled={loading || !username || !password} className="btn btn-primary h-9 w-full">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6">
          <div className="mb-2 text-center text-[11px] font-semibold uppercase tracking-widest text-ink-3">Demo accounts</div>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map(a => (
              <button key={a.username} type="button" onClick={() => { setUsername(a.username); setPassword(a.password); setError('') }}
                className="card px-3 py-2 text-left transition-colors hover:border-brand">
                <div className="text-[13px] font-semibold text-ink">{a.role}</div>
                <div className="text-xs text-ink-3">{a.note}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-ink-3">Click one to fill the form, then sign in.</p>
        </div>
      </div>
    </div>
  )
}
