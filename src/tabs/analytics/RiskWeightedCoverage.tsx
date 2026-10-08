import { useId } from 'react'

import { formatPercent, isShortfall } from '../../lib/coverage'
import {
  bandSentence,
  riskBandCoverage,
  type RiskBandCoverage,
} from '../../lib/riskCoverage'
import type { CoverageMatrix, System } from '../../types/atlas'
import { CursorTooltip, useCursorTooltip } from './CursorTooltip'

/**
 * Tone per band, matching the heatmap above it so a reader carries one colour
 * intuition down the page. Keyed by the value in the data, with a neutral
 * fallback for a band this palette has never been told about.
 */
const TONE: Record<string, { bar: string; chip: string }> = {
  high: { bar: 'bg-risk-high', chip: 'bg-risk-high/15 text-risk-high-ink' },
  medium: { bar: 'bg-risk-medium', chip: 'bg-risk-medium/15 text-risk-medium-ink' },
  low: { bar: 'bg-risk-low', chip: 'bg-risk-low/15 text-risk-low-ink' },
}
const NEUTRAL = { bar: 'bg-accent', chip: 'bg-surface-2 text-ink' }

const toneOf = (risk: string) => TONE[risk] ?? NEUTRAL

export interface RiskWeightedCoverageProps {
  systems: System[]
  coverage: CoverageMatrix
  filterActive: boolean
  matchedIds: ReadonlySet<string>
}

/**
 * Coverage broken out by the risk of what is covered.
 *
 * The flat headline, 10 of 32 realized, is the average of three very different
 * answers, and averaging is exactly what loses the finding: the band carrying
 * the most risk is the band with the least confirmation. Both lists are on the
 * page rather than behind a control, because the reader who doubts the number
 * is the reader who most needs to see the systems it was counted from.
 */
export function RiskWeightedCoverage({
  systems,
  coverage,
  filterActive,
  matchedIds,
}: RiskWeightedCoverageProps) {
  const headingId = useId()
  const tooltip = useCursorTooltip()
  const bands = riskBandCoverage(systems, coverage)
  // Out of every band, as out of the realization gap, and named so the band
  // totals still add up to the matrix by hand.
  const shortfalls = systems.filter(isShortfall)

  const bandDimmed = (band: RiskBandCoverage) =>
    filterActive &&
    !band.realized.some((r) => matchedIds.has(r.system.id)) &&
    !band.unrealized.some((s) => matchedIds.has(s.id))

  return (
    <section
      aria-labelledby={headingId}
      className="rounded border border-line bg-surface p-4"
    >
      <h2 id={headingId} className="text-sm font-semibold tracking-wide text-ink">
        Realization by Risk Band
      </h2>
      <p className="mt-1 text-xs text-muted">
        One percentage over every system prices a high-risk system and a low-risk
        one the same. These do not. Realized means the shared rule the whole tool
        uses: a site names hardware for it and the matrix carries it.
      </p>

      <ul className="mt-3 divide-y divide-line">
        {bands.map((band) => {
          const tone = toneOf(band.risk)
          const dim = bandDimmed(band)
          return (
            <li
              key={band.risk}
              data-band={band.risk}
              data-dimmed={dim ? 'true' : 'false'}
              className={`py-4 ${dim ? 'opacity-20' : ''}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="tabular text-2xl font-bold text-ink">
                  {formatPercent(band.pct)}
                </span>
                <p className="text-sm text-ink">{bandSentence(band)}</p>
              </div>

              {/* Restates the two counts printed beside it, so it is decorative. */}
              <div
                aria-hidden="true"
                className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-bg ring-1 ring-inset ring-line"
              >
                <div
                  className={`h-full ${tone.bar}`}
                  style={{ width: `${band.pct}%` }}
                />
              </div>

              <ChipRow
                label={`Confirmed deployed (${band.realized.length})`}
                empty="None. No site names hardware for any system in this band."
                tone={tone.chip}
                tooltip={tooltip}
                filterActive={filterActive}
                matchedIds={matchedIds}
                entries={band.realized.map((r) => ({
                  id: r.system.id,
                  realized: true,
                  detail: `${r.system.name}. Realized at ${r.sites.join(', ')}.`,
                }))}
              />
              <ChipRow
                label={`Not confirmed anywhere (${band.unrealized.length})`}
                empty="None. Every system in this band is confirmed somewhere."
                tone="bg-surface-2 text-muted"
                tooltip={tooltip}
                filterActive={filterActive}
                matchedIds={matchedIds}
                entries={band.unrealized.map((s) => ({
                  id: s.id,
                  realized: false,
                  detail: `${s.name}. No site records hardware for it, which is not the same as checked and absent.`,
                }))}
              />
            </li>
          )
        })}
      </ul>

      {shortfalls.length > 0 && (
        <p className="mt-3 text-xs text-muted-3">
          Not counted: {shortfalls.length} shortfall{' '}
          {shortfalls.length === 1 ? 'row, which records' : 'rows, which record'} a gap in the
          architecture rather than a system: {shortfalls.map((s) => s.name).join(', ')}.
        </p>
      )}

      <CursorTooltip {...tooltip} />
    </section>
  )
}

interface ChipEntry {
  id: string
  realized: boolean
  detail: string
}

interface ChipRowProps {
  label: string
  empty: string
  tone: string
  tooltip: ReturnType<typeof useCursorTooltip>
  filterActive: boolean
  matchedIds: ReadonlySet<string>
  entries: ChipEntry[]
}

/**
 * The drill-through. Chips carry the short id, which is what fits, and the
 * accessible label carries the name and the evidence, so a screen reader gets
 * the same facts a pointer user gets from the tooltip.
 */
function ChipRow({
  label,
  empty,
  tone,
  tooltip,
  filterActive,
  matchedIds,
  entries,
}: ChipRowProps) {
  const labelId = useId()
  return (
    <div className="mt-3">
      <p id={labelId} className="text-[11px] font-medium tracking-wide text-muted">
        {label}
      </p>
      {entries.length === 0 ? (
        <p className="mt-1 text-xs text-muted-3">{empty}</p>
      ) : (
        <ul aria-labelledby={labelId} className="mt-1 flex flex-wrap gap-1">
          {entries.map((entry) => {
            const owner = `${label}:${entry.id}`
            const dim = filterActive && !matchedIds.has(entry.id)
            return (
              <li
                key={entry.id}
                tabIndex={0}
                data-system={entry.id}
                data-realized={entry.realized ? 'true' : 'false'}
                data-dimmed={dim ? 'true' : 'false'}
                aria-label={`${entry.id}, ${entry.detail}`}
                aria-describedby={tooltip.describedBy(owner)}
                onMouseEnter={(event) =>
                  tooltip.showAtPointer(owner, entry.detail, event)
                }
                onMouseMove={tooltip.follow}
                onMouseLeave={() => tooltip.hide(owner)}
                onFocus={(event) =>
                  tooltip.showAtElement(owner, entry.detail, event.currentTarget)
                }
                onBlur={() => tooltip.hide(owner)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') tooltip.hide(owner)
                }}
                className={`tabular rounded px-1.5 py-px text-xs transition-colors hover:bg-accent/15 focus-visible:bg-accent/15 ${tone} ${
                  dim ? 'opacity-20' : ''
                }`}
              >
                {entry.id}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
