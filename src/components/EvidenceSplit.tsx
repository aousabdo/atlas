import type { ConfidenceGrade } from '../lib/coverage'

/**
 * Proven vs believed, for a count of realized systems.
 *
 * A realization figure counts every mapping the same, whether it was checked
 * against a drawing or guessed. This says how much of the count rests on what,
 * in the grade definitions the Reference tab gives: high is physically
 * verified, medium a strong inference from role and context, low a best guess
 * pending confirmation. The verified count is the floor and the whole count
 * the ceiling, and a figure that is all verified says it holds at every level.
 */
export function EvidenceSplit({
  counts,
  className = 'mt-1',
}: {
  counts: Record<ConfidenceGrade, number>
  className?: string
}) {
  const { high, medium, low, unspecified } = counts
  const total = high + medium + low + unspecified
  if (total === 0) return null

  if (high === total) {
    return (
      <p className={`${className} text-xs text-muted-2`}>
        All {total} physically verified, so this holds at every evidence level.
      </p>
    )
  }

  const parts = [
    `${high} physically verified`,
    ...(medium > 0 ? [`${medium} by strong inference`] : []),
    ...(low > 0 ? [`${low} ${low === 1 ? 'best guess' : 'best guesses'}`] : []),
    ...(unspecified > 0 ? [`${unspecified} ungraded`] : []),
  ]
  return (
    <p className={`${className} text-xs text-muted-2`}>
      Proven to believed: {high} to {total}. {parts.join(', ')}.
    </p>
  )
}

/** Counts from a detail.by_confidence block, tolerating a bundle that predates it. */
export function evidenceCounts(byConfidence: unknown): Record<ConfidenceGrade, number> | null {
  if (!byConfidence || typeof byConfidence !== 'object') return null
  const block = byConfidence as Record<string, unknown>
  const size = (key: string) => (Array.isArray(block[key]) ? (block[key] as unknown[]).length : 0)
  return { high: size('high'), medium: size('medium'), low: size('low'), unspecified: size('unspecified') }
}
