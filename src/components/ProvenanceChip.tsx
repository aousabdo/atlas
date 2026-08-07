import type { RiskSource } from '../types/atlas'

const LABELS: Record<string, string> = {
  explicit: 'read',
  inferred: 'inferred',
  override: 'override',
  prose: 'mined from prose',
  manual: 'manual',
}

const EXPLANATIONS: Record<string, string> = {
  explicit: 'Read directly from a cell in the source workbook.',
  inferred: 'Derived by a classifier rule, not stated in the source.',
  override: 'Set by hand in the curation overlay, outranking the source.',
  prose: 'Extracted by matching system names in free-text integration prose.',
  manual: 'Entered by a person.',
}

/**
 * Marks how a figure was arrived at.
 *
 * The distinction between read and inferred is the most differentiated thing
 * about this tool, and it only helps if it is visible next to the number
 * rather than buried in a methodology page.
 */
export function ProvenanceChip({
  source,
  className = '',
}: {
  source: RiskSource | 'prose' | 'manual'
  className?: string
}) {
  const inferred = source === 'inferred'
  return (
    <span
      title={EXPLANATIONS[source] ?? source}
      className={[
        'ml-1 rounded px-1 py-px align-middle text-[10px] uppercase tracking-wide',
        inferred
          ? 'bg-risk-medium/20 text-risk-medium-ink'
          : 'bg-surface-2 text-muted-2',
        className,
      ].join(' ')}
    >
      {LABELS[source] ?? source}
    </span>
  )
}
