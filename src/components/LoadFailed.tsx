/** The data did NOT load. Never render a zero here. */
export function LoadFailed({
  resource,
  message,
  onRetry,
}: {
  resource: string
  message: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="rounded border border-risk-high bg-surface p-6">
      <p className="font-medium text-risk-high-ink">Could not load {resource}</p>
      <p className="mt-1 text-sm text-muted">
        This is a loading failure, not an empty result. No figure below it is
        trustworthy.
      </p>
      <pre className="mt-3 overflow-x-auto text-xs text-muted-2">{message}</pre>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded border border-line px-3 py-1 text-sm text-ink"
        >
          Retry
        </button>
      )}
    </div>
  )
}
