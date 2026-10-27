import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Modal, Field, toast } from '../ui'
import { authApi, ApiError } from '../../services/api'

/** Lets the signed-in user change their own password. */
export default function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setCurrent(''); setNext(''); setConfirm(''); setShow(false); setError(''); setSaving(false)
  }

  const close = () => { reset(); onClose() }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (next.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    if (next !== confirm) {
      setError('New password and confirmation do not match.')
      return
    }
    if (next === current) {
      setError('New password must be different from the current password.')
      return
    }

    setSaving(true)
    try {
      await authApi.changePassword(current, next)
      toast.success('Password updated')
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not change password')
      setSaving(false)
    }
  }

  const toggle = (
    <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide passwords' : 'Show passwords'}
      className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink">
      {show ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  )

  return (
    <Modal
      open={open}
      onClose={close}
      title="Change password"
      width={440}
      footer={
        <>
          <button type="button" className="btn btn-ghost h-9" onClick={close} disabled={saving}>Cancel</button>
          <button type="submit" form="change-password-form" className="btn btn-primary h-9" disabled={saving || !current || !next || !confirm}>
            {saving ? 'Saving…' : 'Update password'}
          </button>
        </>
      }
    >
      <form id="change-password-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">
            {error}
          </div>
        )}
        <Field label="Current password">
          <span className="relative block">
            <input className="input h-9 pr-9" type={show ? 'text' : 'password'} value={current}
              onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required />
            {toggle}
          </span>
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <input className="input h-9" type={show ? 'text' : 'password'} value={next}
            onChange={e => setNext(e.target.value)} autoComplete="new-password" required />
        </Field>
        <Field label="Confirm new password">
          <input className="input h-9" type={show ? 'text' : 'password'} value={confirm}
            onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required />
        </Field>
      </form>
    </Modal>
  )
}
