/**
 * The data loaded and there is genuinely nothing to show.
 *
 * Deliberately a different component from LoadFailed so nobody can render one
 * for the other's situation. Spec section 9: a chart showing 0 because a fetch
 * died is a lie.
 */
export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded border border-line bg-surface p-6 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  )
}
