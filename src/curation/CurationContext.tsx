import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'

import { ProviderContext, type DataSource } from '../data/ProviderContext'
import type { AtlasDataProvider } from '../data/provider'
import { downloadBlob, setExportEditsNote } from '../export/png'
import { CuratedProvider } from './CuratedProvider'
import { localDate } from './dates'
import { editKey, upsertEdit, type Edit } from './edits'
import { exportSystemDeviceMap, LOCAL_EXPORT_NAME, SAMPLE_EXPORT_NAME } from './serialise'

/** The reviews made in this tab, and what can be done with them. */
export interface Curation {
  /** The loaded provider, without the edits. */
  base: AtlasDataProvider
  source: DataSource
  edits: readonly Edit[]
  /** Edits made since the last export, or since the first edit if none. */
  unsaved: number
  /** Remembered in memory for the session only, never stored. */
  reviewer: string
  setReviewer(name: string): void
  apply(edit: Edit): void
  /** Drops the edit whose editKey is `key`. */
  revert(key: string): void
  /** Drops every edit, without asking. */
  discard(): void
  /** Asks before dropping unsaved edits. True when they are gone. */
  confirmDiscard(): boolean
  exportMap(): Promise<void>
  exportFileName: string
}

const CurationContext = createContext<Curation | null>(null)

export function useCuration(): Curation {
  const value = useContext(CurationContext)
  if (!value) throw new Error('useCuration must be used inside a CurationProvider')
  return value
}

interface State {
  base: AtlasDataProvider
  edits: readonly Edit[]
  /** The edit objects the last export wrote. An edit replaced since is unsaved. */
  exported: ReadonlySet<Edit>
}

const fresh = (base: AtlasDataProvider): State => ({ base, edits: [], exported: new Set() })

const unsavedIn = (state: State): number =>
  state.edits.filter((edit) => !state.exported.has(edit)).length

const reviews = (n: number): string => `${n} unsaved review${n === 1 ? '' : 's'}`

/** With no edits there is nothing to lay over the base, so the tabs read it as before. */
const effectiveProvider = (base: AtlasDataProvider, edits: readonly Edit[]): AtlasDataProvider =>
  edits.length ? new CuratedProvider(base, edits) : base

/**
 * Holds the reviews made in this tab and serves the provider with them laid
 * over the loaded one, so every tab reads them as they are made.
 *
 * Nothing is written to storage. Closing the tab discards the edits; the
 * leave-page prompt and the band on every export are what keep that from
 * happening unnoticed.
 */
export function CurationProvider(props: {
  base: AtlasDataProvider
  source: DataSource
  children: ReactNode
}) {
  const { base, source, children } = props
  const [stored, setStored] = useState<State>(() => fresh(base))
  const [reviewer, setReviewer] = useState('')

  // Edits describe the data they were made on, so new data starts with none.
  // Reset while rendering, React's adjust-state-on-prop-change pattern: an
  // effect would commit one frame of the old edits over the new data first.
  let state = stored
  if (stored.base !== base) {
    state = fresh(base)
    setStored(state)
  }

  // What the handlers and the leave-page listener read, so two edits made in
  // one event both land and the listener never holds a stale count. The
  // handlers move it themselves; this catches the reset above.
  const latest = useRef(state)
  useLayoutEffect(() => {
    latest.current = state
  })

  // The band is armed in the same turn as the change, as armMarking arms the
  // marking: from an effect there would be a commit in which the screen showed
  // an unsaved review and an export fired from it went out without the note.
  const commit = useCallback((next: State) => {
    latest.current = next
    const n = unsavedIn(next)
    setExportEditsNote(n ? `Includes ${reviews(n)}, not yet exported to a file` : null)
    setStored(next)
  }, [])

  const apply = useCallback((edit: Edit) => {
    const current = latest.current
    commit({ ...current, edits: upsertEdit(current.edits, edit) })
  }, [commit])

  const revert = useCallback((key: string) => {
    const current = latest.current
    commit({ ...current, edits: current.edits.filter((edit) => editKey(edit) !== key) })
  }, [commit])

  const discard = useCallback(() => {
    const current = latest.current
    if (current.edits.length) commit(fresh(current.base))
  }, [commit])

  const confirmDiscard = useCallback(() => {
    const n = unsavedIn(latest.current)
    if (n && !window.confirm(`Discard ${reviews(n)}?`)) return false
    discard()
    return true
  }, [discard])

  const kind = source.kind
  const exportMap = useCallback(async () => {
    const current = latest.current
    const [raw, coverage] = await Promise.all([
      current.base.getSourceSystemDeviceMap?.() ?? null,
      effectiveProvider(current.base, current.edits).getCoverage(),
    ])
    const { fileName, text } = exportSystemDeviceMap({
      raw, coverage, source: kind, today: localDate(new Date()),
    })
    downloadBlob(fileName, new Blob([text], { type: 'application/json' }))
    // Only what was written counts as saved. An edit made while the file was
    // being built is still unsaved, and new data has no edits to mark.
    const now = latest.current
    if (now.base === current.base) commit({ ...now, exported: new Set(current.edits) })
  }, [commit, kind])

  useEffect(() => {
    const hold = (event: BeforeUnloadEvent) => {
      if (!unsavedIn(latest.current)) return
      event.preventDefault()
      // Chromium before 119 raises the prompt only for a returnValue.
      event.returnValue = true
    }
    window.addEventListener('beforeunload', hold)
    return () => window.removeEventListener('beforeunload', hold)
  }, [])

  // A new object per edit, so useAtlas refetches in every mounted tab.
  const provider = useMemo(
    () => effectiveProvider(state.base, state.edits), [state.base, state.edits],
  )

  const unsaved = unsavedIn(state)
  const value = useMemo<Curation>(
    () => ({
      base: state.base,
      source,
      edits: state.edits,
      unsaved,
      reviewer,
      setReviewer,
      apply,
      revert,
      discard,
      confirmDiscard,
      exportMap,
      exportFileName: kind === 'sample' ? SAMPLE_EXPORT_NAME : LOCAL_EXPORT_NAME,
    }),
    [state.base, source, state.edits, unsaved, reviewer, apply, revert, discard, confirmDiscard,
      exportMap, kind],
  )

  return (
    <CurationContext.Provider value={value}>
      <ProviderContext.Provider value={provider}>{children}</ProviderContext.Provider>
    </CurationContext.Provider>
  )
}
