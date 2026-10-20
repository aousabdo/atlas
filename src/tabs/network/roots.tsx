import type { RootChoiceOption, RootSet } from '../../lib/dependency'
import type { DeviceId } from '../../types/atlas'
import { nodeStyle } from './NetworkLegend'

/**
 * How a root set is spelled on screen, in one place.
 *
 * Every claim about what a device strands is measured from a root set, and
 * the set has to be printed wherever the claim is made. One spelling means
 * the panel, the banner, the tooltip and the legend can never name two
 * different sets for one answer.
 */

/**
 * A device type as prose. The raw `type` key is the handle everywhere the value
 * is used, and the legend's word for it is what the reader has already learnt,
 * so the key stays in the select values and the word goes in the sentences.
 */
export function kindWord(type: string, count = 1): string {
  const word = nodeStyle(type).label.toLowerCase()
  return count === 1 ? word : `${word}s`
}

export type RootBadge = 'DECLARED' | 'DECLARED · ASSUMPTIONS OUT' | 'DERIVED' | 'BY DEVICE TYPE'

export function rootBadge(roots: RootSet): RootBadge {
  switch (roots.choice.source) {
    case 'declared':
      return 'DECLARED'
    case 'declared-without-assumed':
      return 'DECLARED · ASSUMPTIONS OUT'
    case 'derived':
      return 'DERIVED'
    case 'type':
      return 'BY DEVICE TYPE'
  }
}

/** "the 7 declared decision positions", "the drawing's entry point, Internet", "the 10 endpoints". */
export function rootPhrase(roots: RootSet, labelOf: (id: DeviceId) => string): string {
  const n = roots.deviceIds.length
  switch (roots.choice.source) {
    case 'declared':
      return `the ${n} declared decision ${n === 1 ? 'position' : 'positions'}`
    case 'declared-without-assumed':
      return `the ${n} declared decision ${n === 1 ? 'position' : 'positions'} not marked as assumptions`
    case 'derived':
      if (n === 0) return 'nothing, because the drawing has no entry point'
      return n === 1
        ? `the drawing's entry point, ${labelOf(roots.deviceIds[0]!)}`
        : `the drawing's ${n} entry points`
    case 'type':
      return n === 0
        ? 'nothing, because no device matches that choice'
        : `the ${n} ${kindWord(roots.choice.deviceType, n)}`
  }
}

/** The option text a reader picks a root set by. */
export function rootOptionLabel(option: RootChoiceOption, assumedCount: number): string {
  switch (option.choice.source) {
    case 'declared':
      return `Declared decision positions (${option.count})`
    case 'declared-without-assumed':
      return `Declared, without the ${assumedCount} marked as assumptions (${option.count})`
    case 'derived':
      return 'Entry points in the drawing'
    case 'type':
      return `any ${kindWord(option.choice.deviceType)} (${option.count})`
  }
}

/**
 * The one root selector. Rendered wherever a reader asks a reachability
 * question, always bound to the same state, so the page shows one root set.
 */
export function RootSelect({
  options,
  assumedCount,
  value,
  onChange,
}: {
  options: readonly RootChoiceOption[]
  assumedCount: number
  value: string
  onChange: (key: string) => void
}) {
  return (
    <label className="mt-1 flex items-center gap-2 text-xs">
      <span className="shrink-0 text-muted-3">Reachable from</span>
      <select
        aria-label="Reachable from"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 rounded border border-line bg-bg px-1 py-0.5 text-xs text-ink"
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {rootOptionLabel(option, assumedCount)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The badge itself: small caps, the colour of a hypothetical when it is not declared. */
export function RootBadgeChip({ roots }: { roots: RootSet }) {
  const badge = rootBadge(roots)
  const declared = badge.startsWith('DECLARED')
  return (
    <span
      className={[
        'rounded border px-1 text-[10px] font-semibold tracking-widest',
        declared ? 'border-accent text-accent-ink' : 'border-risk-medium text-risk-medium-ink',
      ].join(' ')}
    >
      {badge}
    </span>
  )
}
