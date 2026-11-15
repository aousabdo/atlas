import { useId, type ReactNode } from 'react'

import type { DeviceRow } from '../../curation/walk'
import type { DeviceId, System, SystemId } from '../../types/atlas'
import { BUTTON, GRADE_LABEL, INPUT, LABEL } from './ReviewForm'
import { EditedMark } from './SystemList'

export interface ZoneBlock {
  zoneId: string
  label: string
  rows: DeviceRow[]
}

export interface DeviceActions {
  isEdited: (id: DeviceId) => boolean
  /** A system this tab can review: in the matrix, and not a shortfall row. */
  isReviewable: (id: SystemId) => boolean
  onAssign: (id: DeviceId, systemId?: SystemId) => void
  onCheck: (id: DeviceId) => void
  onClearCheck: (id: DeviceId) => void
  onUndo: (id: DeviceId) => void
  /** Why a row action failed, for the row it failed on. */
  errorFor: (id: DeviceId) => string | null
  /** The open form for this device, if any. */
  form: (row: DeviceRow) => ReactNode
}

function DeviceItem({ row, actions }: { row: DeviceRow; actions: DeviceActions }) {
  const labelId = useId()
  const { device, systems, check } = row
  const named = systems.length > 0
  const error = actions.errorFor(device.id)
  return (
    <li aria-labelledby={labelId} className="py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-medium break-words text-ink">
            {device.label}
          </p>
          {named ? (
            <ul className="mt-1 flex flex-col gap-1">
              {systems.map((entry, index) => {
                const entryId = `${labelId}-${index}`
                return (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    {entry.outside ? (
                      // No matrix row to review it against, so it is shown and left alone.
                      `${entry.id} (outside the matrix)`
                    ) : (
                      <>
                        <span id={entryId} className="break-words">
                          {`${entry.name} · ${GRADE_LABEL[entry.grade]}`}
                        </span>
                        {actions.isReviewable(entry.id) && (
                          <button
                            type="button"
                            aria-describedby={`${entryId} ${labelId}`}
                            onClick={() => actions.onAssign(device.id, entry.id)}
                            className={BUTTON}
                          >
                            Review
                          </button>
                        )}
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : check ? (
            <>
              <p className="mt-1 text-xs break-words text-muted">
                {`Checked by ${check.reviewed_by} on ${check.reviewed_on}: carries no system.`}
              </p>
              {check.note && <p className="mt-0.5 text-xs break-words text-muted-3">{check.note}</p>}
            </>
          ) : (
            <p className="mt-1 text-xs text-muted">No system recorded</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions.isEdited(device.id) && (
            <EditedMark describedBy={labelId} onUndo={() => actions.onUndo(device.id)} />
          )}
          <button
            type="button"
            aria-describedby={labelId}
            onClick={() => actions.onAssign(device.id)}
            className={BUTTON}
          >
            Assign to systems
          </button>
          {!named &&
            (check ? (
              <button
                type="button"
                aria-describedby={labelId}
                onClick={() => actions.onClearCheck(device.id)}
                className={BUTTON}
              >
                Clear check
              </button>
            ) : (
              <button
                type="button"
                aria-describedby={labelId}
                onClick={() => actions.onCheck(device.id)}
                className={BUTTON}
              >
                Checked, carries no system
              </button>
            ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-risk-high-ink">
          {error}
        </p>
      )}
      {actions.form(row)}
    </li>
  )
}

/** The site's devices, one block per zone, in the order the walk takes them. */
export function DeviceList({ zones, actions }: { zones: readonly ZoneBlock[]; actions: DeviceActions }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded border border-line bg-surface p-4">
      <h2 id={headingId} className="text-sm font-semibold tracking-wide text-ink">
        Devices by zone
      </h2>
      <p className="mt-1 text-xs text-muted-3">
        Zones in the checklist order, then zones with nothing left open.
      </p>
      {zones.map((zone) => (
        <div key={zone.zoneId} className="mt-4">
          <h3 className="text-xs font-medium tracking-wide text-muted">{zone.label}</h3>
          <ul className="divide-y divide-line">
            {zone.rows.map((row) => (
              <DeviceItem key={row.device.id} row={row} actions={actions} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/** Picks the system a device is assigned to; the review form follows once one is chosen. */
export function AssignChooser(props: {
  systems: readonly System[]
  value: SystemId | ''
  onChange: (id: SystemId | '') => void
  onCancel: () => void
}) {
  const id = useId()
  return (
    <div className="mt-2 flex flex-col gap-1">
      <label htmlFor={id} className={LABEL}>
        System
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={id}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          className={`${INPUT} sm:w-auto`}
        >
          <option value="">Choose a system</option>
          {props.systems.map((system) => (
            <option key={system.id} value={system.id}>
              {system.name}
            </option>
          ))}
        </select>
        {props.value === '' && (
          <button type="button" onClick={props.onCancel} className={BUTTON}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
