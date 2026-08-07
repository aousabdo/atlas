import { useEffect, useRef } from 'react'

export interface AboutSection {
  heading: string
  body: string
}

export interface AboutContent {
  title: string
  lead: string
  sections: AboutSection[]
}

/**
 * Per-view help.
 *
 * Deliberately not a port of the old About drawer, which restated the glossary
 * in four places and hardcoded counts that drifted from the data. This answers
 * only the two questions a reader has about the view in front of them: what am
 * I looking at, and where did these numbers come from. Anything definitional
 * belongs in Reference and is linked, not repeated.
 */
export function AboutDrawer({
  content,
  onClose,
}: {
  content: AboutContent
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
        className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink">{content.title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close about"
            className="rounded border border-line px-2 py-1 text-sm text-muted hover:text-ink"
          >
            Close
          </button>
        </div>

        <p className="mt-3 text-sm text-muted">{content.lead}</p>

        {content.sections.map((section) => (
          <section key={section.heading} className="mt-5">
            <h3 className="text-sm font-medium text-ink">{section.heading}</h3>
            <p className="mt-1 text-sm text-muted">{section.body}</p>
          </section>
        ))}
      </aside>
    </div>
  )
}
