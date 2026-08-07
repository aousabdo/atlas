import { useState } from 'react'

import { elementToPdf } from '../export/pdf'
import { downloadBlob, elementToPngBlob, exportFilename } from '../export/png'

type Busy = null | 'png' | 'pdf'

/**
 * Exports whatever is inside the panel element.
 *
 * The background has to be passed in because html2canvas paints only the node
 * it is given, and the page background lives on body. Reading it from the
 * computed style keeps PNG and PDF matching the active theme instead of
 * hardcoding two hex values that drift from the tokens.
 */
function panelBackground(): string {
  const value = getComputedStyle(document.body).backgroundColor
  return value && value !== 'rgba(0, 0, 0, 0)' ? value : '#0b1f3a'
}

export function ExportMenu({
  targetRef,
  view,
}: {
  targetRef: React.RefObject<HTMLElement | null>
  view: string
}) {
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: Exclude<Busy, null>) {
    const element = targetRef.current
    if (!element) {
      setError('Nothing to export yet.')
      return
    }
    setBusy(kind)
    setError(null)
    try {
      const options = {
        background: panelBackground(),
        // The buttons themselves must not appear in their own output.
        omitSelector: '[data-export-omit]',
      }
      if (kind === 'png') {
        const blob = await elementToPngBlob(element, options)
        downloadBlob(exportFilename(view, 'png'), blob)
      } else {
        await elementToPdf(element, exportFilename(view, 'pdf'), options)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-export-omit className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => run('png')}
        disabled={busy !== null}
        title="Save this view as a PNG (E)"
        className="rounded border border-line px-2 py-1 text-sm text-muted hover:text-ink disabled:opacity-50"
      >
        {busy === 'png' ? 'Saving…' : 'PNG'}
      </button>
      <button
        type="button"
        onClick={() => run('pdf')}
        disabled={busy !== null}
        title="Save this view as a PDF"
        className="rounded border border-line px-2 py-1 text-sm text-muted hover:text-ink disabled:opacity-50"
      >
        {busy === 'pdf' ? 'Rendering…' : 'PDF'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-risk-high-ink">
          Export failed: {error}
        </span>
      )}
    </div>
  )
}
