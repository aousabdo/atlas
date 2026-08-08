import { useEffect, useRef } from 'react'

import { useFocusTrap, useSoleModal } from './modal'

export interface ShortcutRow {
  keys: string[]
  description: string
}

export interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

/**
 * Every shortcut lives in one document now.
 *
 * The tool being replaced put the graph shortcuts inside an iframe, so its
 * help dialog had to tell people to "click into the network graph first to
 * focus it". Nothing here needs that caveat.
 */
export function ShortcutsDialog({
  groups,
  onClose,
}: {
  groups: ShortcutGroup[]
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Same promise as the palette's, kept the same way: aria-modal says the rest
  // of the page is inert, so Tab must not leave this card.
  useFocusTrap(cardRef)

  // ⌘K opens search from anywhere, including from here. This card steps aside
  // for it rather than drawing over it.
  useSoleModal(onClose)

  /**
   * Focused once, when the dialog opens.
   *
   * Not on every change of onClose: that is a fresh arrow function on every
   * render of the shell, so this ran again whenever anything above it changed
   * and pulled focus back to Close. Opening search from here left the caret in
   * this card, and closing it then dropped focus on the body.
   */
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded border border-line bg-surface p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="rounded border border-line px-2 py-1 text-sm text-muted hover:text-ink"
          >
            Close
          </button>
        </div>

        {groups.map((group) => (
          <section key={group.title} className="mt-5">
            <h3 className="text-sm font-medium text-muted">{group.title}</h3>
            <dl className="mt-2 space-y-1">
              {group.rows.map((row) => (
                <div key={row.description} className="flex items-baseline gap-3">
                  <dt className="flex shrink-0 gap-1">
                    {row.keys.map((key) => (
                      <kbd
                        key={key}
                        className="tabular rounded border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink"
                      >
                        {key}
                      </kbd>
                    ))}
                  </dt>
                  <dd className="text-sm text-muted">{row.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <p className="mt-5 text-xs text-muted-3">
          Press ? any time to bring this back. Shortcuts are ignored while you are
          typing in a field, apart from ⌘K, which opens search from anywhere
          including a search box.
        </p>
      </div>
    </div>
  )
}
