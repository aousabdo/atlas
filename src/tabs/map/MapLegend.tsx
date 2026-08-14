import { useState } from 'react'

import type { RiskLevel } from '../../types/atlas'
import type { Position } from '../../viz/radial'
import { LINK_LEGEND } from './CrossLinks'
import { MAP_KEY_HINTS } from './shortcuts'
import { nodeTone, RISK_FILL, RISK_STROKE } from './TreeNode'

export interface LegendGroup {
  colorKey: string
  label: string
}

/**
 * One row per colour actually on the canvas, named by the node that owns it.
 *
 * Read off the drawn positions rather than off a hand-written table, for the
 * same reason the topology legend reads its rows off the site: a group added to
 * the bundle would otherwise be drawn in a colour nothing explains, and a group
 * removed would leave a row describing something that is not there.
 *
 * The shallowest node wins the label, which is always a branch or a group and
 * never a single system: a leaf only ever carries its parent's colour key, so
 * the parent is on screen whenever the leaf is.
 */
export function legendGroups(positions: Record<string, Position>): LegendGroup[] {
  const best = new Map<string, { label: string; level: number; order: number }>()
  let order = 0
  for (const position of Object.values(positions)) {
    order += 1
    const key = position.node.colorKey
    const existing = best.get(key)
    if (existing && existing.level <= position.level) continue
    best.set(key, {
      label: position.node.label.replace(/\n/g, ' '),
      level: position.level,
      order: existing?.order ?? order,
    })
  }
  return [...best]
    .sort((a, b) => a[1].level - b[1].level || a[1].order - b[1].order)
    .map(([colorKey, entry]) => ({ colorKey, label: entry.label }))
}

const RISK_ROWS: Array<{ risk: RiskLevel; label: string }> = [
  { risk: 'high', label: 'High risk' },
  { risk: 'medium', label: 'Medium risk' },
  { risk: 'low', label: 'Low risk' },
]

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1 text-[10px] font-semibold tracking-widest text-muted-3 uppercase">
      {children}
    </h3>
  )
}

/** A node box in miniature: leaf tone inside, branch tone as the border. */
function Swatch({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <svg width={22} height={12} aria-hidden="true" className="shrink-0">
      <rect
        x={1} y={1} width={20} height={10} rx={3}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
      />
    </svg>
  )
}

function LinkSwatch({ stroke, dash }: { stroke: string; dash: string }) {
  return (
    <svg width={22} height={12} aria-hidden="true" className="shrink-0">
      <line
        x1={0} y1={6} x2={22} y2={6}
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray={dash}
      />
    </svg>
  )
}

/** Pointer gestures, which used to be a floating line the legend now overlapped. */
const GESTURES: Array<{ key: string; what: string }> = [
  { key: 'scroll', what: 'zoom' },
  { key: 'drag', what: 'pan' },
  { key: 'drag node', what: 'move it' },
]

/** How the canvas is driven, spelled out where the encoding is explained. */
function Keys() {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line pt-2 text-[11px] text-muted-3">
      {[...GESTURES, ...MAP_KEY_HINTS].map((hint, index) => (
        <span key={hint.key} className="flex items-center gap-1.5">
          {index > 0 && <span aria-hidden="true">·</span>}
          <kbd className="rounded border border-line bg-surface-2 px-1 py-px text-[10px] text-muted">
            {hint.key}
          </kbd>
          {hint.what}
        </span>
      ))}
    </p>
  )
}

/**
 * What the colours on the map mean.
 *
 * The map had no legend at all, which left the two things colour encodes,
 * owner group by default and risk under Risk View, to be guessed at. Both are
 * named here, and both are named with the same tokens the canvas paints with.
 */
export function MapLegend({
  groups,
  riskMode,
  showLinks,
  showDesired,
}: {
  groups: LegendGroup[]
  /** Risk recolours systems only, so the ramp appears only while it is on. */
  riskMode: boolean
  showLinks: boolean
  showDesired: boolean
}) {
  return (
    <section aria-label="Map legend" className="text-[11px] text-muted">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <div className="min-w-0">
          <Heading>Groups</Heading>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {groups.map((group) => (
              <li
                key={group.colorKey}
                data-swatch-fill={nodeTone(group.colorKey, true)}
                data-swatch-stroke={nodeTone(group.colorKey, false)}
                className="flex items-center gap-1.5"
              >
                <Swatch
                  fill={nodeTone(group.colorKey, true)}
                  stroke={nodeTone(group.colorKey, false)}
                />
                <span className="truncate">{group.label}</span>
              </li>
            ))}
          </ul>
        </div>

        {riskMode && (
          <div>
            <Heading>Risk view</Heading>
            <ul className="flex flex-col gap-0.5">
              {RISK_ROWS.map((row) => (
                <li
                  key={row.risk}
                  data-swatch-fill={RISK_FILL[row.risk]}
                  data-swatch-stroke={RISK_STROKE[row.risk]}
                  className="flex items-center gap-1.5"
                >
                  <Swatch fill={RISK_FILL[row.risk]} stroke={RISK_STROKE[row.risk]} />
                  {row.label}
                </li>
              ))}
              <li className="text-muted-3">Systems only; groups keep their colour.</li>
            </ul>
          </div>
        )}

        <div>
          <Heading>Marks</Heading>
          <ul className="flex flex-col gap-0.5">
            {showLinks && (
              <li className="flex items-center gap-1.5">
                <LinkSwatch
                  stroke={LINK_LEGEND.current.stroke}
                  dash={LINK_LEGEND.current.dash}
                />
                {LINK_LEGEND.current.text}
              </li>
            )}
            {showDesired && (
              <li className="flex items-center gap-1.5">
                <LinkSwatch
                  stroke={LINK_LEGEND.desired.stroke}
                  dash={LINK_LEGEND.desired.dash}
                />
                {LINK_LEGEND.desired.text}
              </li>
            )}
            <li className="flex items-center gap-1.5">
              <svg width={22} height={12} aria-hidden="true" className="shrink-0">
                <rect
                  x={1} y={1} width={20} height={10} rx={3}
                  fill="none"
                  stroke="var(--color-risk-medium)"
                  strokeWidth={1.5}
                  strokeDasharray="5,3"
                />
              </svg>
              Unconfirmed ownership
            </li>
          </ul>
        </div>
      </div>

      <Keys />
    </section>
  )
}

/**
 * The legend, floated over the canvas without eating any of it.
 *
 * Two rules, because the legend broke the map in two different ways.
 *
 * It took the pointer. Selecting a system insets this whole chrome layer by the
 * width of the record, which slid the legend from x=25 to x=345, on top of a
 * tree that does not move: hit-testable nodes fell from 20 of 22 to 11 of 22 at
 * 1280x720, from 22 to 14 at 1366x768, from 22 to 18 at 1440x900, and the
 * blockers were this card, its headings and its rows. With Expand All and four
 * marks on it is 422x305 and covers 9 of 45. So the card and everything in it
 * is transparent to the pointer, and only the button that opens and closes it
 * is not: a node under the legend is still clickable, still draggable, and the
 * canvas under it still pans.
 *
 * It also covered them visually, which no amount of pointer routing fixes. So
 * it collapses to its own header. Open by default, because a legend nobody
 * finds explains nothing, and the colours are not guessable.
 */
export function MapLegendCard(props: {
  groups: LegendGroup[]
  riskMode: boolean
  showLinks: boolean
  showDesired: boolean
}) {
  const [open, setOpen] = useState(true)

  return (
    <div
      data-testid="map-legend-card"
      className="pointer-events-none max-w-md rounded border border-line bg-surface/90 px-3 py-2 backdrop-blur"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className="pointer-events-auto -mx-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] font-semibold tracking-widest text-muted-3 uppercase hover:text-ink"
      >
        <span aria-hidden="true">{open ? '−' : '+'}</span>
        Legend
      </button>
      {open && <MapLegend {...props} />}
    </div>
  )
}
