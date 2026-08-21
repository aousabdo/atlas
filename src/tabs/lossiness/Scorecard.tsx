import { ProvenanceChip } from '../../components/ProvenanceChip'
import { SeverityPill } from '../../components/SeverityPill'
import { formatPercent } from '../../lib/coverage'
import type { LossinessDimension, RiskSource } from '../../types/atlas'
import { drillCount } from './DimensionDrawer'

/**
 * Seven cards, one per dimension.
 *
 * Every card carries the figure, the fraction it came from, the band it falls
 * in, how the underlying data was arrived at, and a way through to the
 * entities. A figure with no path to its entities is the thing this tab
 * exists to stop.
 */
export function Scorecard({
  dimensions,
  onOpen,
}: {
  dimensions: LossinessDimension[]
  onOpen: (key: string) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {dimensions.map((dimension) => (
        <DimensionCard key={dimension.key} dimension={dimension} onOpen={onOpen} />
      ))}
    </div>
  )
}

function DimensionCard({
  dimension,
  onOpen,
}: {
  dimension: LossinessDimension
  onOpen: (key: string) => void
}) {
  const count = drillCount(dimension)
  return (
    <article
      aria-label={`${dimension.label} dimension`}
      className="flex flex-col rounded border border-line bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{dimension.label}</h3>
        <SeverityPill severity={dimension.severity} />
      </div>

      <p className="tabular mt-3 text-3xl font-semibold text-ink">
        {displayValue(dimension)}
      </p>

      <p className="mt-1 text-sm text-muted">
        <span className="tabular">
          {dimension.numerator} of {dimension.denominator}
        </span>{' '}
        {TAIL[dimension.key] ?? 'counted'}
        <ProvenanceChip source={PROVENANCE[dimension.key] ?? 'manual'} />
      </p>

      <p className="mt-2 grow text-xs text-muted-2">{BLURB[dimension.key] ?? ''}</p>

      <button
        type="button"
        onClick={() => onOpen(dimension.key)}
        className="mt-3 self-start rounded border border-line px-3 py-1 text-sm text-accent-ink"
      >
        {buttonLabel(dimension.key, count)}
      </button>
    </article>
  )
}

/**
 * Percentages read as percentages; counts read as counts, never as a fake rate.
 *
 * The percent spelling comes from formatPercent in src/lib/coverage.ts, which
 * calls itself the one percentage formatter and means it. This card asks it
 * for a tenth rather than reimplementing one: a card here and a row in
 * Analytics were formatting the same quantity through two functions, which is
 * how one of them can start printing a different figure without anything
 * going red.
 */
export function displayValue(dimension: LossinessDimension): string {
  if (dimension.unit === 'pct' && dimension.value_pct !== null) {
    return formatPercent(dimension.value_pct, 1)
  }
  return String(dimension.numerator)
}

const TAIL: Record<string, string> = {
  requirement_attrition: 'requirements carried forward',
  ownership_ambiguity: 'systems have a stated owner',
  realization_gap: 'systems mapped to hardware at a site',
  integration_gap: 'planned interfaces are missing',
  evidence_gap: 'risk levels read straight from the source',
  orphaned_hardware: 'devices no system claims',
  open_questions: 'logged mapping questions are unresolved',
}

const BLURB: Record<string, string> = {
  requirement_attrition:
    'How much of the March requirement set survives into the current architecture.',
  ownership_ambiguity:
    'Systems whose owning organization is stated rather than assumed by a rule.',
  realization_gap:
    'Systems traced to real hardware, rather than existing only on paper.',
  integration_gap:
    'Integrations the architecture calls for with no current link behind them.',
  evidence_gap:
    'Risk levels read from a cell, not produced by a keyword heuristic.',
  orphaned_hardware:
    'Devices on a site network that no system in the matrix accounts for.',
  open_questions:
    'Mapping questions the team has logged and not yet answered.',
}

/**
 * How the data under each figure was arrived at.
 *
 * Not how the arithmetic was done: every figure here is computed. This says
 * whether the inputs were read, mined from prose, or entered by hand, which is
 * what decides how much weight the figure carries.
 */
const PROVENANCE: Record<string, RiskSource | 'prose' | 'manual'> = {
  requirement_attrition: 'explicit',
  ownership_ambiguity: 'explicit',
  realization_gap: 'manual',
  integration_gap: 'prose',
  evidence_gap: 'explicit',
  orphaned_hardware: 'manual',
  open_questions: 'manual',
}

function buttonLabel(key: string, count: number): string {
  switch (key) {
    case 'requirement_attrition':
      return `Show the ${count} ${plural(count, 'requirement')} not carried forward`
    case 'ownership_ambiguity':
      return `Show the ${count} unconfirmed ${plural(count, 'system')}`
    case 'realization_gap':
      return `Show the ${count} unmapped ${plural(count, 'system')}`
    case 'integration_gap':
      return `Show the ${count} missing ${plural(count, 'integration')}`
    case 'evidence_gap':
      return 'Show where the risk levels came from'
    case 'orphaned_hardware':
      return `Show the ${count} unexplained ${plural(count, 'device')}`
    case 'open_questions':
      return `Show the ${count} open ${plural(count, 'question')}`
    default:
      return 'Show the evidence'
  }
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}
