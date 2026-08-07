import { useId, useState } from 'react'

import type { System } from '../../types/atlas'

interface OwnerGroupSlice {
  id: string
  label: string
  systems: System[]
}

/** Carried from the tool being replaced: teal for settled, amber for open. */
const CONFIRMED_FILL =
  'linear-gradient(90deg, var(--color-risk-low), var(--color-accent))'

export interface OwnershipBarsProps {
  groups: OwnerGroupSlice[]
  filterActive: boolean
  matchedGroups: ReadonlySet<string>
}

/**
 * Confirmed versus pending ownership, per owner group.
 *
 * The bars share one scale, so a long bar means a large group and a long teal
 * run means a settled one. The exact counts stay in text beside them: a reader
 * should never have to measure a rectangle to get a number.
 */
export function OwnershipBars({
  groups,
  filterActive,
  matchedGroups,
}: OwnershipBarsProps) {
  const headingId = useId()
  const [active, setActive] = useState<string | null>(null)

  const total = groups.reduce((n, g) => n + g.systems.length, 0)
  const confirmed = groups.reduce(
    (n, g) => n + g.systems.filter((s) => s.confirmed).length,
    0,
  )
  const widest = Math.max(1, ...groups.map((g) => g.systems.length))
  const share = (n: number) => `${(n / widest) * 100}%`

  return (
    <section
      aria-labelledby={headingId}
      className="rounded border border-line bg-surface p-4"
      data-filtered={filterActive ? 'true' : 'false'}
    >
      <h2 id={headingId} className="text-sm font-semibold tracking-wide text-ink">
        Ownership Confirmation by Group
      </h2>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="tabular rounded bg-surface-2 px-2 py-1 text-ink">
          {total} systems
        </span>
        <span className="tabular rounded bg-risk-low/15 px-2 py-1 text-risk-low-ink">
          {confirmed} confirmed
        </span>
        <span className="tabular rounded bg-risk-medium/15 px-2 py-1 text-risk-medium-ink">
          {total - confirmed} pending
        </span>
      </div>

      <ul className="mt-4 space-y-1">
        {groups.map((g) => {
          const yes = g.systems.filter((s) => s.confirmed).length
          const no = g.systems.length - yes
          const pct = g.systems.length
            ? Math.round((yes / g.systems.length) * 100)
            : 0
          const dimmed = filterActive && !matchedGroups.has(g.id)
          const lit = active === g.id
          return (
            <li
              key={g.id}
              tabIndex={0}
              data-group={g.id}
              data-dimmed={dimmed ? 'true' : 'false'}
              data-active={lit ? 'true' : 'false'}
              onMouseEnter={() => setActive(g.id)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(g.id)}
              onBlur={() => setActive(null)}
              className={`rounded-lg px-2 py-2 transition-colors ${
                lit ? 'bg-surface-2' : ''
              } ${dimmed ? 'opacity-20' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-medium text-ink">{g.label}</span>
                <span className="flex items-baseline gap-3">
                  <span
                    aria-hidden={lit ? undefined : 'true'}
                    className={`tabular text-[10px] text-muted-3 transition-opacity ${
                      lit ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    {pct}% confirmed
                  </span>
                  <span className="tabular text-risk-low-ink">{yes} confirmed</span>
                  <span className="tabular text-risk-medium-ink">{no} pending</span>
                </span>
              </div>

              {/* The bar restates the two counts beside it, so it is decorative. */}
              <div
                aria-hidden="true"
                className="mt-1.5 flex h-3.5 w-full overflow-hidden rounded-full bg-bg ring-1 ring-inset ring-line"
              >
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: share(yes), background: CONFIRMED_FILL }}
                />
                <div
                  className="h-full rounded-full bg-risk-medium/70 transition-[width] duration-700 ease-out"
                  style={{ width: share(no) }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
