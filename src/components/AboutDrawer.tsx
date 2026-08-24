import { useEffect, useRef } from 'react'

import { NOTICE_POINTS, NOTICE_SHORT } from '../lib/notice'

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

        {/*
          Last, and on every view rather than only the one that loads files.
          A reader who arrives at a screen full of someone's architecture and
          wonders what this tool is should find the answer in the same place
          they find everything else about it.
        */}
        <section className="mt-6 border-t border-line pt-4">
          <h3 className="text-sm font-medium text-risk-medium-ink">
            Handling controlled information
          </h3>
          <p className="mt-1 text-sm text-ink">{NOTICE_SHORT}</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
            {NOTICE_POINTS.map((point) => (
              <li key={point.slice(0, 32)}>{point}</li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  )
}
