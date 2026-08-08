import { useState } from 'react'

import { UNMARKED_NOTICE, useProviderSwitch } from '../data/ProviderContext'

/**
 * Placeholder only, never a default.
 *
 * A real control marking hardcoded here would be the app asserting a marking
 * it has no basis for, and the data guard rejects one on sight. This is the
 * sample bundle's own marking, which is the one string this repo may carry.
 */
const EXAMPLE_MARKING = 'UNCLASSIFIED//SAMPLE'

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
  const { source, useSampleData, stateMarking } = useProviderSwitch()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

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

      {/*
        Settable from here, not only from the load panel.
        A reader learns the files declared nothing by reading this strip, and by
        then the panel is closed and re-opening it means picking every file
        again. Somebody looking at unmarked controlled data should be one click
        from stating the marking, not one reload.
      */}
      {editing ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            stateMarking(draft)
            setEditing(false)
          }}
        >
          <input
            autoFocus
            type="text"
            value={draft}
            aria-label="Control marking"
            placeholder={source.declaredMarking ?? EXAMPLE_MARKING}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false)
            }}
            className="w-56 rounded border border-line bg-surface px-2 py-0.5 text-xs text-ink"
          />
          <button
            type="submit"
            className="rounded border border-line bg-surface px-2 py-0.5 text-xs text-ink"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded px-1 py-0.5 text-xs text-muted hover:text-ink"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(source.markingSource === 'analyst' ? (source.marking ?? '') : '')
            setEditing(true)
          }}
          title="Applies to every PNG, PDF and CSV you export from here"
          className="rounded border border-line bg-surface px-2 py-0.5 text-xs text-ink hover:bg-surface-2"
        >
          {source.marking ? 'Change marking' : 'State the marking'}
        </button>
      )}
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
