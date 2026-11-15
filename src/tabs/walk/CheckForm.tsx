import { useState, type FormEvent } from 'react'

import type { CheckedDevice, Device } from '../../types/atlas'
import { FORM, FormButtons, NoteField, StampFields, stampMissing } from './ReviewForm'

export interface CheckFormProps {
  device: Device
  /** The session's reviewer, to start from. */
  reviewer: string
  today: string
  /** Writes the check. Returns why it could not, or null once it has. */
  onSave: (check: CheckedDevice) => string | null
  onCancel: () => void
}

/**
 * A device checked and found to carry no system. It settles the device on the
 * walk and changes no figure: the device is still unclaimed hardware.
 */
export function CheckForm({ device, today, onSave, onCancel, ...props }: CheckFormProps) {
  const [reviewer, setReviewer] = useState(props.reviewer)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const missing = stampMissing(reviewer, date)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (missing) return
    const kept = note.trim()
    setError(
      onSave({ reviewed_by: reviewer.trim(), reviewed_on: date, ...(kept ? { note: kept } : {}) }),
    )
  }

  return (
    <form aria-label={`Check ${device.label}`} onSubmit={submit} className={FORM}>
      <p className="text-xs text-muted">
        {`Records that ${device.label} was checked and carries no system.`}
      </p>
      <StampFields reviewer={reviewer} date={date} onReviewer={setReviewer} onDate={setDate} />
      <NoteField value={note} onChange={setNote} />
      {error && (
        <p role="alert" className="text-xs text-risk-high-ink">
          {error}
        </p>
      )}
      <FormButtons missing={missing} onCancel={onCancel} />
    </form>
  )
}
