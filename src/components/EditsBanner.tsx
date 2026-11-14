import { useState } from 'react'

import { useCuration } from '../curation/CurationContext'

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * The reviews made in this tab, under the data-source strip on every view.
 *
 * Shown only while edits exist. Nothing keeps them but this tab, so the strip
 * says how many are not yet in a file and offers the export that keeps them.
 * Every export says so as well, because a reader of an exported file never
 * sees this strip.
 */
export function EditsBanner() {
  const { edits, unsaved, source, exportFileName, exportMap, discard, confirmDiscard } =
    useCuration()
  const [error, setError] = useState<string | null>(null)

  if (edits.length === 0) {
    // A failed export belongs to the edits it failed on, not to the next ones.
    if (error) setError(null)
    return null
  }

  const exportNow = () => {
    setError(null)
    exportMap().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  return (
    <div
      role="status"
      aria-label="Reviews"
      data-export-omit
      className={
        'flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1 ' +
        (unsaved
          ? 'border-b-2 border-risk-medium bg-risk-medium/15'
          : 'border-b border-line bg-surface-2')
      }
    >
      <span className="text-xs text-ink">
        {unsaved
          ? `${plural(unsaved, 'unsaved review')}. Export ${exportFileName} to keep ` +
            `${unsaved === 1 ? 'it' : 'them'}. Closing this tab discards ` +
            `${unsaved === 1 ? 'it' : 'them'}.`
          : `${plural(edits.length, 'review')} exported to ${exportFileName}. ` +
            `${edits.length === 1 ? 'It stays' : 'They stay'} on screen until you close ` +
            'this tab; load the file to work from it.'}
      </span>
      {source.kind === 'sample' && (
        <span className="text-xs text-muted">
          Sample only: these edits describe no real site.
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-risk-high-ink">
          Export failed: {error}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={exportNow}
          className="rounded border border-line bg-surface px-2 py-0.5 text-xs text-ink hover:bg-surface-2"
        >
          Export
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirmDiscard()) discard()
          }}
          className="rounded border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:text-ink"
        >
          Discard
        </button>
      </span>
    </div>
  )
}
