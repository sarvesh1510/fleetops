import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { incidentsApi } from '../../services/api'
import { Modal, Field, toast } from '../ui'
import type { Incident } from '../../types'

const MAX_NOTES = 500

export function ResolveIncidentModal({
  incident,
  open,
  onClose,
}: {
  incident: Incident
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: () => incidentsApi.resolve(incident.incident_id, notes.trim() || undefined),
    onSuccess: () => {
      toast.success('Incident resolved')
      qc.invalidateQueries({ queryKey: ['incidents'] })
      qc.invalidateQueries({ queryKey: ['incident-stats'] })
      setNotes('')
      onClose()
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Could not resolve the incident')
    },
  })

  const close = () => {
    if (mutation.isPending) return
    setNotes('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Resolve incident"
      width={480}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={mutation.isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Resolving…' : 'Resolve incident'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-ink-2">
          Resolving closes the incident record for <span className="font-semibold text-ink">{incident.title}</span>.
          It does not repair a vehicle or clear traffic — the simulation handles recovery on its own. Use this once the
          situation is understood and no further tracking is needed.
        </p>
        <Field label="Resolution notes (optional)" hint={`${notes.length}/${MAX_NOTES}`}>
          <textarea
            className="input min-h-[90px] resize-y"
            value={notes}
            maxLength={MAX_NOTES}
            onChange={e => setNotes(e.target.value)}
            placeholder="What was confirmed or done before closing this record?"
            aria-label="Resolution notes"
          />
        </Field>
      </div>
    </Modal>
  )
}
