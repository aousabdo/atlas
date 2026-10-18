/**
 * The rows realization leaves out, named wherever a count leaves them out.
 *
 * Shortfall rows record a gap in the architecture, not a system that could be
 * fielded, so every realization count is over the other rows. A denominator
 * that silently differs from the matrix size reads as an arithmetic slip, so
 * each place that prints one names what it left out, in the same words.
 */
export function ShortfallNote({
  names,
  lead = 'Not counted:',
  after,
  className = 'mt-3',
}: {
  names: readonly string[]
  /** Says which count left the rows out, where more than one sits nearby. */
  lead?: string
  after?: string
  className?: string
}) {
  if (names.length === 0) return null
  const one = names.length === 1
  return (
    <p className={`${className} text-xs text-muted-3`}>
      {lead} {names.length} shortfall{' '}
      {one ? 'row, which records' : 'rows, which record'} a gap in the architecture
      rather than a system: {names.join(', ')}.{after ? ` ${after}` : ''}
    </p>
  )
}
