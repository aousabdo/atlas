import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAtlas } from '../data/useAtlas'
import type { AtlasDataProvider } from '../data/provider'
import {
  buildIndex,
  groupByKind,
  search,
  type SearchItem,
} from '../lib/search'
import { LoadFailed } from './LoadFailed'
import { useFocusTrap, useSoleModal } from './modal'
import { TABS } from './TabBar'

/**
 * How many rows the list will show.
 *
 * A cap with no statement of what it hid would be a quiet lie, so the footer
 * says "showing 50 of 214" whenever the cap bites.
 */
const MAX_ROWS = 50

/**
 * Cmd+K and Ctrl+K, from anywhere including a text field.
 *
 * Deliberately not useShortcuts: that hook drops any keystroke aimed at an
 * input, which is right for the bare letters it binds and wrong for this one.
 * The palette exists to get a reader out of a per-panel search box, so it has
 * to answer while the caret is sitting in one.
 */
export function useCommandPaletteKey(onOpen: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      onOpen()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onOpen])
}

/**
 * Scroll to a section anchor once there is one to scroll to.
 *
 * A pushState navigation does not scroll to an anchor the way clicking the
 * reference tab's own section links does, and on a cold jump the section is
 * not mounted yet because its bundles are still in flight. So watch for a
 * second and then give up quietly, rather than scrolling to the wrong thing.
 */
function scrollToAnchor(id: string, deadlineMs = 1000): void {
  if (typeof requestAnimationFrame !== 'function') return
  const started = Date.now()
  const tick = () => {
    const target = document.getElementById(id)
    if (target) {
      target.scrollIntoView?.()
      return
    }
    if (Date.now() - started < deadlineMs) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function load(provider: AtlasDataProvider) {
  return (async () => {
    const [systems, glossary, requirements, project] = await Promise.all([
      provider.getSystems(),
      provider.getGlossary(),
      provider.getRequirements(),
      provider.getProject(),
    ])
    // Every site, because "which site was that switch at" is exactly the
    // question the palette is for.
    const topologies = await Promise.all(
      project.sites.map((site) => provider.getTopology(site.id)),
    )
    return buildIndex({
      views: TABS.map((tab) => ({ path: tab.path, label: tab.label })),
      systems,
      glossary,
      requirements,
      project,
      topologies,
    })
  })()
}

/**
 * Search everything the app knows and jump to it.
 *
 * The same overlay shape as the shortcuts dialog, the about drawer and the
 * load panel: a backdrop that closes on click, a role="dialog" card, Escape,
 * and a Close button. The topology view stands its own key handler down
 * whenever a [role="dialog"] is on the page, so being one of these is also
 * what keeps 1, 2, 3, L and F from firing behind this.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const state = useAtlas(load)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const baseId = useId()

  // aria-modal="true" below is a promise about the rest of the page: keep it
  // true for the keyboard as well as for the announcement, and keep this the
  // only dialog making it.
  useFocusTrap(cardRef)
  useSoleModal(onClose)

  // Whoever had focus when this opened gets it back when it closes, which is
  // the difference between a dialog and a trapdoor.
  const opener = useRef<Element | null>(
    typeof document === 'undefined' ? null : document.activeElement,
  )
  useEffect(() => {
    inputRef.current?.focus()
    const previous = opener.current
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const index = state.status === 'ready' ? state.data : null
  const matches = useMemo(
    () => (index ? search(index, query) : []),
    [index, query],
  )
  const rows = useMemo(() => matches.slice(0, MAX_ROWS), [matches])
  const groups = useMemo(() => groupByKind(rows), [rows])
  // Arrow keys walk the rows in the order they are drawn, which is the order
  // the groups put them in, not the raw ranked order.
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups])

  useEffect(() => {
    setActive(0)
  }, [query, index])

  const choose = useCallback(
    (item: SearchItem) => {
      navigate(item.to)
      onClose()
      const hash = item.to.split('#')[1]
      if (hash) scrollToAnchor(hash)
    },
    [navigate, onClose],
  )

  const move = useCallback(
    (delta: number) => {
      setActive((current) => {
        if (ordered.length === 0) return 0
        return (current + delta + ordered.length) % ordered.length
      })
    },
    [ordered.length],
  )

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        return move(1)
      case 'ArrowUp':
        event.preventDefault()
        return move(-1)
      // Home and End are left alone. They belong to the caret in the box, and
      // taking them would make a long query hard to edit.
      case 'Enter': {
        const item = ordered[active]
        if (!item) return
        event.preventDefault()
        return choose(item)
      }
      default:
    }
  }

  // Position, not key: a requirement's key is its whole sentence, and an id
  // attribute is not the place for one.
  const positions = useMemo(
    () => new Map(ordered.map((item, at) => [item.key, at])),
    [ordered],
  )
  const optionId = (item: SearchItem) => `${baseId}-option-${positions.get(item.key)}`
  const activeItem = ordered[active]

  // Keep the active row in view when the arrow keys walk past the fold.
  useEffect(() => {
    if (!activeItem) return
    const element = listRef.current?.querySelector(
      `[data-key="${CSS.escape(activeItem.key)}"]`,
    )
    if (element instanceof HTMLElement) element.scrollIntoView?.({ block: 'nearest' })
  }, [activeItem])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded border border-line bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={state.status === 'ready'}
            aria-controls={`${baseId}-results`}
            aria-activedescendant={activeItem ? optionId(activeItem) : undefined}
            aria-autocomplete="list"
            aria-label="Search sites, systems, devices, zones, acronyms, requirements and views"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search by name, id or address"
            className="w-full bg-transparent px-1 py-1 text-sm text-ink outline-none placeholder:text-muted-3"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="shrink-0 rounded border border-line px-2 py-1 text-xs text-muted hover:text-ink"
          >
            Close
          </button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {state.status === 'loading' && (
            <p role="status" className="px-4 py-6 text-sm text-muted">
              Loading the index.
            </p>
          )}

          {state.status === 'failed' && (
            <div className="p-3">
              <LoadFailed
                resource="the search index"
                message={state.error.message}
                onRetry={state.retry}
              />
            </div>
          )}

          {state.status === 'ready' && (
            <div role="listbox" id={`${baseId}-results`} aria-label="Results">
              {groups.map((group) => (
                <div key={group.kind} role="group" aria-label={group.title}>
                  <div className="sticky top-0 flex items-baseline gap-2 border-b border-line bg-surface-2 px-3 py-1">
                    <span className="text-[10px] font-semibold tracking-widest text-muted-3 uppercase">
                      {group.title}
                    </span>
                    <span className="tabular text-[10px] text-muted-3">
                      {group.items.length}
                    </span>
                  </div>
                  {group.items.map((item) => {
                    const on = item.key === activeItem?.key
                    return (
                      <div
                        key={item.key}
                        id={optionId(item)}
                        data-key={item.key}
                        role="option"
                        aria-selected={on}
                        onClick={() => choose(item)}
                        onMouseMove={() => setActive(positions.get(item.key) ?? 0)}
                        className={[
                          'cursor-pointer px-3 py-1.5',
                          on ? 'bg-surface-2' : '',
                        ].join(' ')}
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-sm text-ink">{item.label}</span>
                          {item.code && item.code !== item.label && (
                            <code className="shrink-0 text-[11px] text-muted-3">
                              {item.code}
                            </code>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted">{item.detail}</div>
                      </div>
                    )
                  })}
                </div>
              ))}

              {query.trim() !== '' && matches.length === 0 && (
                <p className="px-4 py-6 text-sm text-muted">
                  No match for "{query.trim()}" in sites, systems, devices, zones,
                  acronyms, requirements or views.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[11px] text-muted-3">
          <span>Arrows move, Enter opens, Esc closes.</span>
          {matches.length > rows.length && (
            <span className="tabular">
              Showing {rows.length} of {matches.length} matches. Narrow the search to
              see the rest.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
