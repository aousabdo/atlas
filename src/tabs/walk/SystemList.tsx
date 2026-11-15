import { useId, type ReactNode } from 'react'

import { RiskPill } from '../../components/SeverityPill'
import type { Standing } from '../../curation/walk'
import { confidenceGrade, isReviewed } from '../../lib/coverage'
import type { DeviceId, ReviewStamp, System, SystemId } from '../../types/atlas'
import { BUTTON, GRADE_LABEL } from './ReviewForm'

export interface SystemItem {
  system: System
  standing: Standing
}

function standingWords(standing: Standing, labelOf: (id: DeviceId) => string): string {
  switch (standing.kind) {
    case 'realized':
      return (
        `Found on ${[...new Set(standing.mapping.devices)].map(labelOf).join(', ')} · ` +
        GRADE_LABEL[confidenceGrade(standing.mapping)]
      )
    case 'no-hardware':
      return standing.reviewed
        ? `Present, no dedicated hardware · ${GRADE_LABEL[confidenceGrade(standing.mapping)]}`
        : 'Recorded with no hardware, not yet reviewed'
    case 'absent':
      return `Checked, not here: ${standing.reason}`
    case 'none':
      return 'Not looked at'
  }
}

function stampOf(standing: Standing): ReviewStamp | null {
  if (standing.kind === 'absent') return standing.stamp
  if (standing.kind === 'none' || !isReviewed(standing.mapping)) return null
  return {
    reviewed_by: standing.mapping.reviewed_by as string,
    reviewed_on: standing.mapping.reviewed_on as string,
  }
}

export function EditedMark({ describedBy, onUndo }: { describedBy: string; onUndo: () => void }) {
  return (
    <>
      <span className="rounded bg-risk-medium/15 px-1.5 py-px text-xs text-risk-medium-ink">
        Edited
      </span>
      <button type="button" aria-describedby={describedBy} onClick={onUndo} className={BUTTON}>
        Undo
      </button>
    </>
  )
}

function SystemRow(props: {
  item: SystemItem
  labelOf: (id: DeviceId) => string
  edited: boolean
  open: boolean
  onReview: () => void
  onUndo: () => void
  form: ReactNode
}) {
  const { item, labelOf, edited, open, onReview, onUndo, form } = props
  const nameId = useId()
  const stamp = stampOf(item.standing)
  return (
    <li aria-labelledby={nameId} className="py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span id={nameId} className="text-sm font-medium break-words text-ink">
              {item.system.name}
            </span>
            <RiskPill risk={item.system.risk} />
          </p>
          <p className="mt-1 text-xs break-words text-muted">{standingWords(item.standing, labelOf)}</p>
          {stamp && (
            <p className="mt-0.5 text-xs break-words text-muted-3">
              {`Reviewed by ${stamp.reviewed_by} on ${stamp.reviewed_on}`}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {edited && <EditedMark describedBy={nameId} onUndo={onUndo} />}
          <button
            type="button"
            aria-describedby={nameId}
            aria-expanded={open}
            onClick={onReview}
            className={BUTTON}
          >
            Review
          </button>
        </div>
      </div>
      {open && form}
    </li>
  )
}

/** Every system that could be fielded at the site, with where it stands. */
export function SystemList(props: {
  items: readonly SystemItem[]
  labelOf: (id: DeviceId) => string
  isEdited: (id: SystemId) => boolean
  openId: SystemId | null
  onReview: (id: SystemId) => void
  onUndo: (id: SystemId) => void
  form: (item: SystemItem) => ReactNode
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded border border-line bg-surface p-4">
      <h2 id={headingId} className="text-sm font-semibold tracking-wide text-ink">
        Systems
      </h2>
      <p className="mt-1 text-xs text-muted-3">Highest risk first, then by name.</p>
      <ul className="mt-2 divide-y divide-line">
        {props.items.map((item) => {
          const { id } = item.system
          const open = props.openId === id
          return (
            <SystemRow
              key={id}
              item={item}
              labelOf={props.labelOf}
              edited={props.isEdited(id)}
              open={open}
              onReview={() => props.onReview(id)}
              onUndo={() => props.onUndo(id)}
              form={open ? props.form(item) : null}
            />
          )
        })}
      </ul>
    </section>
  )
}
