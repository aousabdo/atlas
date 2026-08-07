import { useId, useState } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react'

import type { RiskLevel, System } from '../../types/atlas'
import { CursorTooltip, useCursorTooltip } from './CursorTooltip'

interface OwnerGroupSlice {
  id: string
  label: string
  systems: System[]
}

const RISK_COLUMNS: { key: RiskLevel; label: string }[] = [
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
]

/**
 * Fill weight falls with severity, so a column of high-risk blocks reads
 * hotter than a column of low-risk ones at a glance and before you read a
 * single number. The alphas are the ones the tool being replaced used.
 */
const TONE: Record<RiskLevel, string> = {
  high: 'bg-risk-high/30 text-risk-high-ink ring-risk-high/40',
  medium: 'bg-risk-medium/30 text-risk-medium-ink ring-risk-medium/35',
  low: 'bg-risk-low/25 text-risk-low-ink ring-risk-low/30',
}

const BLOCK =
  'rounded-lg px-3 py-4 text-center align-middle ring-1 ring-inset transition-transform duration-150 hover:scale-105 focus-visible:scale-105'

const names = (systems: System[]) =>
  systems
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b))
    .join(', ')

export interface RiskHeatmapProps {
  groups: OwnerGroupSlice[]
  filterActive: boolean
  matchedIds: ReadonlySet<string>
  matchedGroups: ReadonlySet<string>
}

/**
 * Owner group by severity, as a grid of filled blocks.
 *
 * Every value is a count of named systems, so the honest presentation is the
 * one you can read a number out of and then ask which systems produced it.
 * A cell holding nothing keeps its zero: an em dash would read as "not
 * measured" when what we mean is "measured, and it is none".
 */
export function RiskHeatmap({
  groups,
  filterActive,
  matchedIds,
  matchedGroups,
}: RiskHeatmapProps) {
  const headingId = useId()
  const [hovered, setHovered] = useState<string | null>(null)
  const tooltip = useCursorTooltip()

  const all = groups.flatMap((g) => g.systems)
  const cellOf = (systems: System[], risk: RiskLevel) =>
    systems.filter((s) => s.risk === risk)
  const dimmed = (systems: System[]) =>
    filterActive && !systems.some((s) => matchedIds.has(s.id))

  const cellProps = (label: string, systems: System[]) => {
    const listed = names(systems)
    return {
      tabIndex: 0,
      'data-systems': listed,
      'data-dimmed': dimmed(systems) ? 'true' : 'false',
      'aria-describedby': tooltip.describedBy(label),
      onMouseEnter: (event: MouseEvent<HTMLTableCellElement>) => {
        setHovered(listed ? `${label}: ${listed}` : null)
        tooltip.showAtPointer(label, listed, event)
      },
      onMouseMove: tooltip.follow,
      onMouseLeave: () => {
        setHovered(null)
        tooltip.hide(label)
      },
      onFocus: (event: FocusEvent<HTMLTableCellElement>) => {
        setHovered(listed ? `${label}: ${listed}` : null)
        tooltip.showAtElement(label, listed, event.currentTarget)
      },
      onBlur: () => {
        setHovered(null)
        tooltip.hide(label)
      },
      onKeyDown: (event: KeyboardEvent<HTMLTableCellElement>) => {
        if (event.key === 'Escape') {
          setHovered(null)
          tooltip.hide(label)
        }
      },
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      data-filtered={filterActive ? 'true' : 'false'}
      className="rounded border border-line bg-surface p-4"
    >
      <h2 id={headingId} className="text-sm font-semibold tracking-wide text-ink">
        Risk Heatmap — Owner Group × Severity
      </h2>

      <table
        aria-labelledby={headingId}
        data-filtered={filterActive ? 'true' : 'false'}
        className="mt-3 w-full border-separate border-spacing-1 text-sm"
      >
        <thead>
          <tr>
            <th scope="col" className="w-2/5 p-1 text-left">
              <span className="sr-only">Owner group</span>
            </th>
            {RISK_COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="p-1 text-xs font-semibold tracking-wide text-muted"
              >
                {c.label}
              </th>
            ))}
            <th
              scope="col"
              className="p-1 text-xs font-semibold tracking-wide text-accent-ink"
            >
              Total
            </th>
          </tr>
        </thead>

        <tbody>
          {groups.map((g) => (
            <tr key={g.id}>
              <td
                data-dimmed={
                  filterActive && !matchedGroups.has(g.id) ? 'true' : 'false'
                }
                className={`p-1 pr-3 text-right text-xs font-medium whitespace-nowrap text-ink transition-opacity ${
                  filterActive && !matchedGroups.has(g.id) ? 'opacity-20' : ''
                }`}
              >
                {g.label}
              </td>
              {RISK_COLUMNS.map((c) => {
                const cell = cellOf(g.systems, c.key)
                return (
                  <td
                    key={c.key}
                    {...cellProps(`${g.label}, ${c.label.toLowerCase()} risk`, cell)}
                    className={`relative ${BLOCK} ${
                      cell.length
                        ? TONE[c.key]
                        : 'bg-surface-2 text-muted-3 ring-line'
                    } ${dimmed(cell) ? 'opacity-20' : ''}`}
                  >
                    <span
                      className={`tabular ${cell.length ? 'text-xl font-bold' : 'text-sm'}`}
                    >
                      {cell.length}
                    </span>
                  </td>
                )
              })}
              <td
                data-dimmed={
                  filterActive && !matchedGroups.has(g.id) ? 'true' : 'false'
                }
                className={`rounded-lg bg-surface-2 px-3 py-4 text-center align-middle text-ink ring-1 ring-inset ring-line ${
                  filterActive && !matchedGroups.has(g.id) ? 'opacity-20' : ''
                }`}
              >
                <span className="tabular text-base font-semibold">
                  {g.systems.length}
                </span>
              </td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <td className="p-1 pr-3 text-right text-xs font-semibold whitespace-nowrap text-accent-ink">
              Total
            </td>
            {RISK_COLUMNS.map((c) => {
              const cell = cellOf(all, c.key)
              return (
                <td
                  key={c.key}
                  {...cellProps(`All groups, ${c.label.toLowerCase()} risk`, cell)}
                  className={`relative ${BLOCK} ${TONE[c.key]} ${
                    dimmed(cell) ? 'opacity-20' : ''
                  }`}
                >
                  <span className="tabular text-xl font-bold">{cell.length}</span>
                </td>
              )
            })}
            <td className="rounded-lg bg-accent/10 px-3 py-4 text-center align-middle text-accent-ink ring-1 ring-inset ring-accent/25">
              <span className="tabular text-xl font-bold">{all.length}</span>
            </td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-2 min-h-8 text-xs text-muted-3" aria-live="polite">
        {hovered ?? 'Hover or tab to a cell to list the systems it counts.'}
      </p>

      <CursorTooltip {...tooltip} />
    </section>
  )
}
