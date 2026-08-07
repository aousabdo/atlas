import { UNMARKED_NOTICE, useProviderSwitch } from '../data/ProviderContext'

/**
 * Which dataset is on screen, permanently, in the same place on every view.
 *
 * Not a toast and not a badge tucked into a corner. Mistaking the sample for
 * real data produces a wrong answer; mistaking real data for the sample
 * produces a screenshot in the wrong place, which is worse. So the strip is
 * always mounted, states the marking when there is one, and says the files
 * stated none when there is not.
 *
 * It sits outside the panel the exporters capture, which is exactly why the
 * marking is burnt into the PNG, the PDF and the CSV separately: a reader of
 * an exported file never sees this strip.
 */
export function DataSourceBanner() {
  const { source, useSampleData } = useProviderSwitch()

  if (source.kind === 'sample') {
    return (
      <div
        role="status"
        aria-label="Data source"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface-2 px-4 py-1"
      >
        <span className="rounded bg-surface px-2 py-0.5 text-xs font-semibold tracking-wide text-muted-2">
          SAMPLE DATA
        </span>
        <span className="text-xs text-muted">
          Synthetic reference bundle. Nothing here describes a real site.
        </span>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-label="Data source"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-risk-high bg-risk-high/15 px-4 py-1"
    >
      <span className="rounded bg-risk-high px-2 py-0.5 text-xs font-semibold tracking-wide text-white">
        {source.marking ?? UNMARKED_NOTICE}
      </span>
      <span className="text-xs text-ink">
        Local data from <span className="font-medium">{source.label}</span>. Parsed in
        this browser. Nothing was uploaded.
      </span>
      {source.markingSource === 'analyst' && (
        // An analyst can see a marking a file does not carry, so they outrank
        // it. Saying so, and saying what was overridden, is what keeps that
        // from being a silent edit to a control marking.
        <span className="text-xs text-ink">
          {source.declaredMarking
            ? `Marking stated by the analyst. The loaded files declare ${source.declaredMarking}.`
            : 'Marking stated by the analyst. The loaded files state none.'}
        </span>
      )}
      <button
        type="button"
        onClick={useSampleData}
        className="ml-auto rounded border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:text-ink"
      >
        Return to sample data
      </button>
    </div>
  )
}
