import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useWSStore } from '../stores/wsStore'
import { Truck, Eye, EyeOff, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('Admin123!')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuthStore()
  const { connect } = useWSStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      connect()
      navigate('/')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const DEMO_ACCOUNTS = [
    { username: 'admin', password: 'Admin123!', role: 'Admin' },
    { username: 'ops_manager', password: 'Ops123!', role: 'Ops Manager' },
    { username: 'dispatcher', password: 'Dispatch123!', role: 'Dispatcher' },
    { username: 'viewer', password: 'Viewer123!', role: 'Viewer' },
  ]

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #f0f4fa 0%, #e8f0fd 100%)', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 24, fontWeight: 800, color: 'white',
          }}>
            <Truck size={26} />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            FleetOps India
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Autonomous Logistics Command Centre
          </p>
        </div>

        {/* Form */}
        <div className="card" style={{ padding: 28 }}>
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
                padding: '10px 12px', borderRadius: 6,
                background: '#ef444420', border: '1px solid #ef444440',
                color: '#ef4444', fontSize: 13,
              }}>
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, letterSpacing: '0.04em' }}>
                USERNAME
              </label>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 6,
                  background: '#f8faff', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', fontSize: 14, outline: 'none',
                }}
                placeholder="Enter username"
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, letterSpacing: '0.04em' }}>
                PASSWORD
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  style={{
                    width: '100%', padding: '10px 40px 10px 12px', borderRadius: 6,
                    background: 'var(--bg-base)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontSize: 14, outline: 'none',
                  }}
                  placeholder="Enter password"
                />
                <button type="button" onClick={() => setShowPass(!showPass)} style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                  display: 'flex', alignItems: 'center',
                }}>
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ width: '100%', padding: '11px', fontSize: 14, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Demo accounts */}
        <div style={{ marginTop: 20 }}>
          <div className="section-title" style={{ textAlign: 'center', marginBottom: 12 }}>
            Demo Accounts
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {DEMO_ACCOUNTS.map(acc => (
              <button
                key={acc.username}
                onClick={() => { setUsername(acc.username); setPassword(acc.password) }}
                style={{
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                  background: '#ffffff', border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(15,28,63,0.06)',
                  color: 'var(--text-secondary)', fontSize: 12, transition: 'all 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-blue)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{acc.role}</div>
                <div style={{ color: 'var(--text-muted)' }}>{acc.username}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
