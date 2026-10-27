import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Truck, MapPin, Boxes, BrainCircuit } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

const HIGHLIGHTS = [
  { icon: MapPin, title: 'Live fleet map', desc: '78 vehicles across Mumbai MMR & Delhi NCR, routed on real roads.' },
  { icon: Boxes, title: 'Smart dispatch', desc: 'Constraint-aware order assignment, measured against a naive baseline.' },
  { icon: BrainCircuit, title: 'ML predictions', desc: 'ETA, demand forecast and telemetry anomaly detection.' },
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
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* ── Showcase panel ─────────────────────────────────────────── */}
      <aside className="relative hidden overflow-hidden bg-ink p-10 text-white lg:flex lg:flex-col lg:justify-between">
        {/* subtle brand-tinted depth, no loud colour */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/10 via-transparent to-transparent" />
        <div aria-hidden className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full bg-brand/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

        <div className="relative">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/20 text-white ring-1 ring-brand/40 backdrop-blur">
            <Truck size={22} />
          </span>
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight">FleetOps India</h1>
          <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-white/80">
            Fleet dispatch &amp; operations console for Mumbai MMR and Delhi NCR — live telemetry,
            smart dispatch and predictive analytics.
          </p>
        </div>

        <ul className="relative my-10 space-y-5">
          {HIGHLIGHTS.map(({ icon: Icon, title, desc }) => (
            <li key={title} className="flex items-start gap-3.5">
              <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white/90 ring-1 ring-white/10">
                <Icon size={17} />
              </span>
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-white/70">{desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="relative flex items-center gap-6 border-t border-white/15 pt-6 text-white/80">
          <div>
            <p className="text-2xl font-bold text-white">78</p>
            <p className="text-[11px] uppercase tracking-wider">Vehicles</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-white">2</p>
            <p className="text-[11px] uppercase tracking-wider">Regions</p>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-white/80">
            <span className="flex h-2 w-2 rounded-full bg-ok pulse-live" />
            Live simulation
          </div>
        </div>
      </aside>

      {/* ── Form panel ─────────────────────────────────────────────── */}
      <main className="flex items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-sm">
          {/* compact brand header for small screens */}
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white">
              <Truck size={22} />
            </span>
            <div>
              <h1 className="text-lg font-extrabold leading-tight tracking-tight">FleetOps India</h1>
              <p className="text-[12px] text-ink-3">Dispatch &amp; operations console</p>
            </div>
          </div>

          <div className="mb-6 hidden lg:block">
            <h2 className="text-xl font-extrabold tracking-tight">Welcome back</h2>
            <p className="mt-1 text-[13px] text-ink-3">Sign in to the operations console.</p>
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
        </div>
      </main>
    </div>
  )
}
