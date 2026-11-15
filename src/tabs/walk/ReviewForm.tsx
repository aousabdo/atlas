import { useId, useState, type FormEvent, type ReactNode } from 'react'

import { isCalendarDate } from '../../curation/dates'
import type { Review } from '../../curation/edits'
import type { Standing } from '../../curation/walk'
import { BLANK } from '../../data/LocalFileProvider'
import { confidenceGrade, type ConfidenceGrade } from '../../lib/coverage'
import type { Device, DeviceId, Mapping, System } from '../../types/atlas'

type Grade = 'high' | 'medium' | 'low'
type Status = Review['status']

/** The grade words, the same on the form, the rows and the printout. */
export const GRADE_LABEL: Record<ConfidenceGrade, string> = {
  high: 'High (physically verified)',
  medium: 'Medium (strong inference)',
  low: 'Low (best guess)',
  unspecified: 'Ungraded',
}

const STATUSES: { status: Status; label: string }[] = [
  { status: 'found', label: 'Found on devices' },
  { status: 'no-hardware', label: 'Present, no dedicated hardware' },
  { status: 'absent', label: 'Checked, not here' },
  { status: 'clear', label: 'Not looked at' },
]

const GRADES: readonly Grade[] = ['high', 'medium', 'low']

export const FORM = 'mt-2 flex flex-col gap-3 rounded border border-line bg-surface-2 p-3'
export const LABEL = 'text-xs text-muted-3'
export const INPUT =
  'w-full rounded border border-line bg-surface px-2 py-1 text-sm text-ink placeholder:text-muted-3'
export const BUTTON =
  'rounded border border-line bg-surface px-2 py-1 text-xs text-ink hover:bg-surface-2'
const CHOICE = 'flex items-center gap-2 text-sm text-ink'

/**
 * Blank as both load gates read it (validate.py's _BLANK), which counts more
 * characters as blank than trim() does. The form holds Save back on the same
 * rule, so it cannot write a stamp the file would then be refused for.
 */
const isBlank = (value: string): boolean => BLANK.test(value)

/** Why the stamp cannot be saved yet, or null when it can. */
export function stampMissing(reviewer: string, date: string): string | null {
  if (isBlank(reviewer)) return 'Say who reviewed it.'
  if (!isCalendarDate(date)) return 'Give the date as a calendar day.'
  return null
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className={LABEL}>{label}</label>
      {children(id)}
    </div>
  )
}

/** Who reviewed it and when: kept in the form until Save, so Cancel changes nothing. */
export function StampFields(props: {
  reviewer: string
  date: string
  onReviewer: (value: string) => void
  onDate: (value: string) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Reviewer">
        {(id) => (
          <input
            id={id}
            type="text"
            // The name lives in this tab's memory only; the browser keeps no history of it.
            autoComplete="off"
            value={props.reviewer}
            onChange={(event) => props.onReviewer(event.target.value)}
            className={INPUT}
          />
        )}
      </Field>
      <Field label="Date">
        {(id) => (
          <input
            id={id}
            type="date"
            value={props.date}
            onChange={(event) => props.onDate(event.target.value)}
            className={INPUT}
          />
        )}
      </Field>
    </div>
  )
}

export function NoteField(props: { value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <Field label={props.label ?? 'Note'}>
      {(id) => (
        <textarea
          id={id}
          rows={2}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          className={INPUT}
        />
      )}
    </Field>
  )
}

/** Save, with what is missing said beside it rather than left to a greyed button. */
export function FormButtons({ missing, onCancel }: { missing: string | null; onCancel: () => void }) {
  const hintId = useId()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="submit"
        disabled={missing !== null}
        aria-describedby={missing ? hintId : undefined}
        className="rounded border border-accent bg-surface px-3 py-1 text-xs font-medium text-accent-ink hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
      >
        Save
      </button>
      <button type="button" onClick={onCancel} className={BUTTON}>
        Cancel
      </button>
      {missing && (
        <span id={hintId} className="text-xs text-muted-3">
          {missing}
        </span>
      )}
    </div>
  )
}

export interface PickerZone {
  id: string
  label: string
  devices: Device[]
}

/**
 * The site's devices, one collapsible list per zone, so a site of seventy
 * devices fits a phone. A zone holding a chosen device starts open.
 */
function DevicePicker(props: {
  zones: readonly PickerZone[]
  chosen: readonly DeviceId[]
  onChange: (chosen: DeviceId[]) => void
}) {
  const { zones, chosen, onChange } = props
  const id = useId()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(zones.filter((z) => z.devices.some((d) => chosen.includes(d.id))).map((z) => z.id)),
  )
  const toggleZone = (zoneId: string) =>
    setExpanded((now) => {
      const next = new Set(now)
      if (!next.delete(zoneId)) next.add(zoneId)
      return next
    })
  const toggleDevice = (deviceId: DeviceId) =>
    onChange(chosen.includes(deviceId) ? chosen.filter((d) => d !== deviceId) : [...chosen, deviceId])

  return (
    <fieldset className="min-w-0">
      <legend className={LABEL}>Devices</legend>
      <div className="mt-1 divide-y divide-line rounded border border-line bg-surface">
        {zones.map((zone, index) => {
          const open = expanded.has(zone.id)
          const listId = `${id}-zone-${index}`
          const count = zone.devices.filter((d) => chosen.includes(d.id)).length
          return (
            <div key={zone.id}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggleZone(zone.id)}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm text-ink hover:bg-surface-2"
              >
                <span className="flex min-w-0 items-baseline gap-1.5 break-words">
                  <span aria-hidden="true" className="text-muted-3">{open ? '▾' : '▸'}</span>
                  {zone.label}
                </span>
                <span className="tabular shrink-0 text-xs text-muted-3">
                  {count} of {zone.devices.length}
                </span>
              </button>
              <div id={listId} hidden={!open} className="grid gap-1 px-2 pb-2 sm:grid-cols-2">
                {zone.devices.map((device) => (
                  <label key={device.id} className={`${CHOICE} min-w-0 break-words`}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(device.id)}
                      onChange={() => toggleDevice(device.id)}
                    />
                    {device.label}
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}

interface Draft {
  status: Status
  devices: DeviceId[]
  grade: Grade
  note: string
  reason: string
}

/**
 * Where nothing gives a grade, the form starts at Low (best guess). A grade
 * has to be shown selected, and the weakest is the only one that cannot
 * overstate what the reviewer saw.
 */
function gradeOf(mapping: Mapping): Grade {
  const grade = confidenceGrade(mapping)
  return grade === 'unspecified' ? 'low' : grade
}

/**
 * The form opens on what is recorded for the system, so a review changes what
 * the reviewer changes and keeps the rest: the devices, grade and note of a
 * mapping, the reason of an absence. The stamp is always the reviewer's own.
 */
function draftFrom(standing: Standing, preselect: DeviceId | undefined): Draft {
  const draft: Draft = { status: 'found', devices: [], grade: 'low', note: '', reason: '' }
  if (standing.kind === 'realized' || standing.kind === 'no-hardware') {
    draft.status = standing.kind === 'realized' ? 'found' : 'no-hardware'
    draft.devices = [...new Set(standing.mapping.devices)]
    draft.grade = gradeOf(standing.mapping)
    draft.note = typeof standing.mapping.note === 'string' ? standing.mapping.note : ''
  } else if (standing.kind === 'absent') {
    draft.status = 'absent'
    draft.reason = standing.reason
  }
  if (preselect !== undefined) {
    draft.status = 'found'
    if (!draft.devices.includes(preselect)) draft.devices.push(preselect)
  }
  return draft
}

export interface ReviewFormProps {
  system: System
  standing: Standing
  zones: readonly PickerZone[]
  /** Added to the devices picked, for a form opened from a device. */
  preselect?: DeviceId
  /** The session's reviewer, to start from. */
  reviewer: string
  today: string
  /** Writes the review. Returns why it could not, or null once it has. */
  onSave: (review: Review) => string | null
  onCancel: () => void
}

/** One review of one system at one site. Save writes one edit. */
export function ReviewForm(props: ReviewFormProps) {
  const { system, standing, zones, preselect, today, onSave, onCancel } = props
  const id = useId()
  const [draft, setDraft] = useState(() => draftFrom(standing, preselect))
  const [reviewer, setReviewer] = useState(props.reviewer)
  const [date, setDate] = useState(today)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Draft>) => setDraft((now) => ({ ...now, ...patch }))

  const { status } = draft
  const graded = status === 'found' || status === 'no-hardware'
  const missing =
    status === 'clear'
      ? null
      : status === 'found' && draft.devices.length === 0
        ? 'Pick at least one device.'
        : status === 'absent' && isBlank(draft.reason)
          ? 'Say what was checked.'
          : stampMissing(reviewer, date)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (missing) return
    const stamp = { reviewed_by: reviewer.trim(), reviewed_on: date }
    const note = draft.note.trim()
    const review: Review =
      status === 'found'
        ? { status, devices: draft.devices, confidence: draft.grade, note, ...stamp }
        : status === 'no-hardware'
          ? { status, confidence: draft.grade, note, ...stamp }
          : status === 'absent'
            ? { status, reason: draft.reason.trim(), ...stamp }
            : { status: 'clear' }
    setError(onSave(review))
  }

  return (
    <form aria-label={`Review ${system.name}`} onSubmit={submit} className={FORM}>
      <fieldset>
        <legend className={LABEL}>Status</legend>
        <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-4">
          {STATUSES.map((choice) => (
            <label key={choice.status} className={CHOICE}>
              <input
                type="radio"
                name={`${id}-status`}
                checked={status === choice.status}
                onChange={() => set({ status: choice.status })}
              />
              {choice.label}
            </label>
          ))}
        </div>
      </fieldset>

      {status === 'found' && (
        <DevicePicker zones={zones} chosen={draft.devices} onChange={(devices) => set({ devices })} />
      )}

      {graded && (
        <fieldset>
          <legend className={LABEL}>Grade</legend>
          <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-4">
            {GRADES.map((grade) => (
              <label key={grade} className={CHOICE}>
                <input
                  type="radio"
                  name={`${id}-grade`}
                  checked={draft.grade === grade}
                  onChange={() => set({ grade })}
                />
                {GRADE_LABEL[grade]}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {status === 'absent' && (
        <NoteField label="Reason" value={draft.reason} onChange={(reason) => set({ reason })} />
      )}

      {status === 'clear' ? (
        <p className="text-xs text-muted">
          {`Removes this site's record of ${system.name}. Nothing else is written.`}
        </p>
      ) : (
        <StampFields reviewer={reviewer} date={date} onReviewer={setReviewer} onDate={setDate} />
      )}

      {graded && <NoteField value={draft.note} onChange={(note) => set({ note })} />}

      {error && (
        <p role="alert" className="text-xs text-risk-high-ink">
          {error}
        </p>
      )}

      <FormButtons missing={missing} onCancel={onCancel} />
    </form>
  )
}
