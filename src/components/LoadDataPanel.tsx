import { useEffect, useMemo, useRef, useState } from 'react'

import { LocalFileProvider, type LocalFileInputs } from '../data/LocalFileProvider'
import { readMarking, UNMARKED_NOTICE, useProviderSwitch } from '../data/ProviderContext'
import {
  classifyInput, inspectFile, isJsonName, isWorkbookName, SLOT_LABEL,
  type Classification, type FileShape, type SlotKind,
} from '../lib/classifyInput'
import {
  declaredSiteIds, resolveSiteId, SITE_ID_SOURCE_LABEL, slugify,
  type ResolvedSiteId,
} from '../lib/siteId'
import { TemplateDownloads } from './TemplateDownloads'

/** The four single-file slots. A topology is many files, so it is not one. */
type SlotId = Exclude<SlotKind, 'topology'>

const SLOT_IDS: SlotId[] = ['matrix', 'overrides', 'glossary', 'systemDeviceMap']

/** Every slot a sorted file can be put in, in the order the select lists them. */
const SLOT_KINDS: SlotKind[] = [...SLOT_IDS, 'topology']

interface Slot {
  id: SlotId
  /** Shown as the group's legend, which is what the eye reads. */
  title: string
  /** The input's own name, which is what a screen reader reads. */
  inputLabel: string
  accept: string
  hint: string
}

const SLOTS: Slot[] = [
  {
    id: 'matrix',
    title: 'Traceability Matrix (required)',
    inputLabel: 'Traceability Matrix file',
    accept: '.xlsx',
    hint: 'The workbook. Needs a Matrix sheet and a crosswalk sheet.',
  },
  {
    id: 'overrides',
    title: 'Curation overrides',
    inputLabel: 'Curation overrides file',
    accept: '.json,application/json',
    hint: 'Cross links, suppressions, risk and confirmation overrides.',
  },
  {
    id: 'glossary',
    title: 'Glossary',
    inputLabel: 'Glossary file',
    accept: '.json,application/json',
    hint: 'Acronyms, scope notes and the confidence wording.',
  },
  {
    id: 'systemDeviceMap',
    title: 'System to device map',
    inputLabel: 'System to device map file',
    accept: '.json,application/json',
    hint: 'Which devices realize which systems, per site.',
  },
]

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * A file the classifier looked at, and where it decided the file goes.
 *
 * The parsed shape is kept so that changing the slot on screen needs no second
 * read, and so a topology promoted by hand goes through exactly the same site
 * id resolution as one the classifier placed itself.
 */
interface SortedFile {
  /** Identity for React, the DOM id and every edit callback. See TopologyPick. */
  key: string
  file: File
  shape: FileShape
  /** What the classifier said, kept verbatim so the panel can show its working. */
  found: Classification
  /** Where it will actually load. Starts at found.kind and is editable. */
  kind: SlotKind | null
}

/** A topology file waiting to be keyed, from either way of picking one. */
interface PickedTopology {
  key: string
  file: File
  /** Already-parsed contents, or null when the file would not parse. */
  json: unknown
  /** Which control it came from, because the two are shown in different places. */
  origin: 'sorted' | 'manual'
}

/**
 * A topology file, with the site id it will load as.
 *
 * The id is resolved here rather than inside the provider because it has to be
 * on screen and editable before the load commits. See src/lib/siteId.ts for
 * why that ordering is the whole point.
 */
interface TopologyPick {
  /**
   * Identity for React, the DOM id and the edit callback.
   *
   * Not file.name. Two sites each exported as site_network.json from different
   * folders collided on all three: editing one row edited both, so they could
   * never be given distinct ids, and the duplicate guard then refused the load
   * outright. Two inputs also shared a DOM id and an accessible name.
   */
  key: string
  file: File
  origin: 'sorted' | 'manual'
  /** What the file itself suggested, kept so the panel can show its working. */
  resolved: ResolvedSiteId
  /** What will actually key the map. Starts at resolved.id and is editable. */
  id: string
  /** The classification the file declares, if any. */
  declared: string | null
}

/** Best effort. A file that will not parse fails loudly later, in the parser. */
async function readJsonQuietly(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text()) as unknown
  } catch {
    return null
  }
}

function declaredClassification(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const graph = (raw as { graph?: unknown }).graph
  const value = graph && typeof graph === 'object'
    ? (graph as { classification?: unknown }).classification
    : undefined
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * The marking the picked files declare between them.
 *
 * The same rule readMarking applies after the parse: distinct values are all
 * shown rather than one of them being picked, because a reader is entitled to
 * know the loaded set is mixed.
 */
function declaredMarkingOf(picks: TopologyPick[]): string | null {
  const markings = new Set(picks.map((p) => p.declared).filter((m): m is string => !!m))
  return markings.size ? [...markings].sort().join(' / ') : null
}

function list(names: readonly string[]): string {
  return names.join(', ')
}

/** As near to file identity as a browser will state. See pickTopologies. */
function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

/**
 * Loads the analyst's own files, in this browser.
 *
 * Everything here is a File handed to SheetJS and JSON.parse. There is no
 * request, no worker cache and no storage write anywhere in this path, which
 * is the property the whole architecture exists to provide, and a reload
 * therefore lands back on the sample.
 */
export function LoadDataPanel() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Load your own Traceability Matrix"
        className="rounded border border-line px-2 py-1 text-sm text-muted hover:text-ink"
      >
        Load data
      </button>
      {open && <LoadDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function LoadDialog({ onClose }: { onClose: () => void }) {
  const { adopt } = useProviderSwitch()
  /** Files placed by hand, in the four explicit slots below. */
  const [manualFiles, setManualFiles] = useState<Partial<Record<SlotId, File>>>({})
  /** Files dropped on the one zone and sorted by inspection. */
  const [sorted, setSorted] = useState<SortedFile[]>([])
  /** Names of dropped files that are neither a workbook nor JSON. */
  const [skipped, setSkipped] = useState<string[]>([])
  /** Topologies placed by hand, in the explicit topology slot. */
  const [manualPicks, setManualPicks] = useState<PickedTopology[]>([])
  /**
   * Site ids the analyst typed, by pick key.
   *
   * Held apart from the picks so that a re-resolution, which happens whenever
   * a map arrives and changes what ids are declared, can never overwrite what
   * somebody typed.
   */
  const [siteIds, setSiteIds] = useState<Record<string, string>>({})
  const [manualDeclaredIds, setManualDeclaredIds] = useState<string[]>([])
  const [marking, setMarking] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  /** Monotonic, so two files of the same name from two pickers never collide. */
  const nextSeq = useRef(0)

  useEffect(() => {
    closeRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // --- what each slot ends up holding -------------------------------------

  /**
   * Who claims each slot, in the order the claims arrived.
   *
   * A slot claimed twice is a conflict rather than a race. Letting the second
   * file win silently is the failure this whole panel exists to prevent: the
   * app would load, look right, and be reading the wrong workbook.
   */
  const claims = useMemo(() => {
    const out = new Map<SlotId, { name: string; file: File }[]>()
    const add = (slot: SlotId, file: File) => {
      const current = out.get(slot) ?? []
      current.push({ name: file.name, file })
      out.set(slot, current)
    }
    for (const row of sorted) {
      if (row.kind && row.kind !== 'topology') add(row.kind, row.file)
    }
    for (const slot of SLOT_IDS) {
      const file = manualFiles[slot]
      if (file) add(slot, file)
    }
    return out
  }, [sorted, manualFiles])

  const files = useMemo(() => {
    const out: Partial<Record<SlotId, File>> = {}
    for (const [slot, claimants] of claims) out[slot] = claimants[0].file
    return out
  }, [claims])

  const contestedSlots = useMemo(
    () => new Set([...claims].filter(([, c]) => c.length > 1).map(([slot]) => slot)),
    [claims],
  )

  const conflictMessage = useMemo(() => {
    const contested = [...claims].filter(([, c]) => c.length > 1)
    if (!contested.length) return null
    const each = contested.map(
      ([slot, claimants]) =>
        `More than one file claims the ${SLOT_LABEL[slot]} slot: ` +
        `${list(claimants.map((c) => c.name))}.`,
    )
    return `${each.join(' ')} Set all but one of them to something else, ` +
      'or the wrong file loads and nothing says so.'
  }, [claims])

  // --- site ids -----------------------------------------------------------

  /**
   * The site ids the analyst's other files key by.
   *
   * Read before the load, because this is the only moment at which a topology
   * that keys nothing can still be corrected. Afterwards it is a site with
   * devices and no coverage, which reads as a finding.
   *
   * Sorted files contribute synchronously, from the parse the classifier
   * already did. That matters: when the whole set arrives in one drop, the
   * topologies have to be resolved against the map that came with them, and a
   * second asynchronous read would resolve them first and correct them after.
   */
  const sortedDeclaredIds = useMemo(() => {
    const ids = new Set<string>()
    for (const row of sorted) {
      if (row.kind === 'systemDeviceMap' || row.kind === 'overrides') {
        for (const id of declaredSiteIds(row.shape.json)) ids.add(id)
      }
    }
    return [...ids]
  }, [sorted])

  /** The hand-placed map and overrides, which have not been parsed anywhere yet. */
  const manualMap = manualFiles.systemDeviceMap
  const manualOverrides = manualFiles.overrides
  useEffect(() => {
    const sources = [manualMap, manualOverrides].filter((f): f is File => !!f)
    if (!sources.length) {
      setManualDeclaredIds([])
      return
    }
    let cancelled = false
    void Promise.all(sources.map(readJsonQuietly)).then((raws) => {
      if (cancelled) return
      setManualDeclaredIds([...new Set(raws.flatMap((raw) => declaredSiteIds(raw)))])
    })
    return () => {
      cancelled = true
    }
  }, [manualMap, manualOverrides])

  const expectedIds = useMemo(
    () => [...new Set([...sortedDeclaredIds, ...manualDeclaredIds])].sort(),
    [sortedDeclaredIds, manualDeclaredIds],
  )

  const picked = useMemo<PickedTopology[]>(
    () => [
      ...sorted
        .filter((row) => row.kind === 'topology')
        .map((row) => ({
          key: row.key,
          file: row.file,
          json: row.shape.json ?? null,
          origin: 'sorted' as const,
        })),
      ...manualPicks,
    ],
    [sorted, manualPicks],
  )

  const topologies = useMemo<TopologyPick[]>(
    () =>
      picked.map((pick) => {
        const resolved = resolveSiteId(pick.json, pick.file.name, expectedIds)
        return {
          key: pick.key,
          file: pick.file,
          origin: pick.origin,
          resolved,
          id: siteIds[pick.key] ?? resolved.id,
          declared: declaredClassification(pick.json),
        }
      }),
    [picked, expectedIds, siteIds],
  )

  // --- picking ------------------------------------------------------------

  /**
   * Inspect everything at once and put each file where its shape says.
   *
   * Files that are neither a workbook nor JSON are not inspected, and are
   * counted and named on screen rather than dropped quietly. A folder pick
   * hands over everything in the directory, so without that filter the table
   * would be mostly noise; without the count, the analyst could not tell a
   * skipped file from one that was never picked.
   */
  async function sortFiles(dropped: File[]) {
    const readable = dropped.filter((f) => isWorkbookName(f.name) || isJsonName(f.name))
    const ignored = dropped.filter((f) => !isWorkbookName(f.name) && !isJsonName(f.name))
    const base = nextSeq.current
    nextSeq.current += readable.length
    const rows = await Promise.all(
      readable.map(async (file, index) => {
        const shape = await inspectFile(file)
        const found = classifyInput(shape)
        return { key: `${base + index}:${file.name}`, file, shape, found, kind: found.kind }
      }),
    )
    setSorted((current) => [...current, ...rows])
    setSkipped((current) => [...current, ...ignored.map((f) => f.name)])
  }

  function setKind(key: string, kind: SlotKind | null) {
    setSorted((current) => current.map((row) => (row.key === key ? { ...row, kind } : row)))
  }

  function clearSorted() {
    setSorted([])
    setSkipped([])
  }

  /**
   * Adds to what is already chosen rather than replacing it.
   *
   * A file input reports only the files chosen in that one visit to the
   * dialog, so an analyst picking their sites two at a time, or dragging a
   * second site onto the slot, used to silently lose everything chosen before:
   * the rows vanished, the load ran, and the missing site read afterwards as a
   * site nobody had exported. Appending is the only behaviour that matches
   * what the control looks like it does.
   *
   * Choosing the same file again is not a second site, so it is skipped rather
   * than appended: re-picking a set that overlaps the last one is ordinary use
   * of a file picker, and a duplicate would block the load on a site id clash
   * the analyst did not create. Same name, size and modification time is as
   * close to file identity as a browser will say.
   */
  async function pickTopologies(chosen: File[]) {
    const base = nextSeq.current
    nextSeq.current += chosen.length
    const picks = await Promise.all(
      chosen.map(async (file, index) => ({
        key: `${base + index}:${file.name}`,
        file,
        json: await readJsonQuietly(file),
        origin: 'manual' as const,
      })),
    )
    setManualPicks((current) => {
      const seen = new Set(current.map((pick) => fileIdentity(pick.file)))
      const added = picks.filter((pick) => !seen.has(fileIdentity(pick.file)))
      return added.length ? [...current, ...added] : current
    })
  }

  function clearManualPicks() {
    setManualPicks([])
  }

  /**
   * Held exactly as typed. Slugging happens at the boundary, in siteKey below.
   *
   * Slugging here instead looked right and was not: slugify strips a trailing
   * separator, so "harbor_" became "harbor" mid-word and the next keystroke
   * produced "harborp". A field that rewrites what you are still typing is
   * unusable.
   */
  function setSiteId(key: string, id: string) {
    setSiteIds((current) => ({ ...current, [key]: id }))
  }

  /**
   * The slug a pick actually loads under.
   *
   * The resolver slugs every id it produces, so a hand-typed one has to be
   * slugged by the same rule or the two disagree. "Harbor Point" used to be
   * accepted verbatim and key a site by a string no map contains, and with no
   * map loaded nothing cross-checks it: the silent wrong answer this whole
   * field exists to prevent.
   */
  const siteKey = (pick: TopologyPick) => slugify(pick.id)

  const declared = useMemo(() => declaredMarkingOf(topologies), [topologies])

  /** Two files under one id would silently drop one of them. */
  const duplicateIds = useMemo(() => {
    const seen = new Map<string, number>()
    for (const pick of topologies) {
      const key = siteKey(pick)
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id)
  }, [topologies])

  const unrecognised = sorted.filter((row) => row.kind === null)

  async function load() {
    // A contested slot is already stated on screen, in the same region this
    // would write to. Saying it twice, or replacing it with a shorter version
    // of itself, would be worse than leaving the standing complaint up.
    if (conflictMessage) return
    const matrix = files.matrix
    if (!matrix) {
      setError('Choose a Traceability Matrix first. Everything else is optional.')
      return
    }
    const unnamed = topologies.find((pick) => !siteKey(pick))
    if (unnamed) {
      setError(`${unnamed.file.name} has no site id. A site has to be keyed by something.`)
      return
    }
    if (duplicateIds.length) {
      setError(
        `Two topology files share the site id ${duplicateIds.join(', ')}. ` +
          'Give each site its own id, or one of them is dropped.',
      )
      return
    }
    setBusy(true)
    setError(null)

    // A provider is only adopted once it has parsed. A failed parse leaves the
    // app on whatever it was already reading rather than on a half-built one.
    const provider = new LocalFileProvider()
    const inputs: LocalFileInputs = {
      matrix,
      overrides: files.overrides,
      glossary: files.glossary,
      systemDeviceMap: files.systemDeviceMap,
      topologies: Object.fromEntries(topologies.map((pick) => [siteKey(pick), pick.file])),
    }
    try {
      await provider.load(inputs)
      // What the files themselves say, read after the parse so it is the
      // parsed value rather than the panel's preview of it.
      const fromFiles = await readMarking(provider)
      const typed = marking.trim() || null
      adopt(provider, {
        kind: 'local',
        label: matrix.name,
        // The analyst outranks the files: they can see a marking the file does
        // not carry. Both are kept so the banner can show the override.
        marking: typed ?? fromFiles,
        markingSource: typed ? 'analyst' : 'files',
        declaredMarking: fromFiles,
      })
      onClose()
    } catch (cause) {
      // The parser says which file failed and why. Repeating it is the whole
      // value; a generic "could not load" would send the analyst hunting.
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const sortedTopologies = topologies.filter((pick) => pick.origin === 'sorted')
  const manualTopologies = topologies.filter((pick) => pick.origin === 'manual')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Load your own data"
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded border border-line bg-surface p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink">Load your own data</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close the load panel"
            className="rounded border border-line px-2 py-1 text-sm text-muted hover:text-ink"
          >
            Close
          </button>
        </div>

        <p className="mt-2 text-sm text-muted">
          Files are parsed here, in this tab. Nothing is uploaded and nothing is
          stored, so closing or reloading this page returns to the sample.
        </p>

        <div className="mt-4 space-y-3">
          <SortZone onFiles={sortFiles} />

          {/*
            Above the decision table rather than below the fold: somebody
            opening this panel with nothing to load has to be able to see that
            a working file is one click away. A finished control nothing
            renders is the same as no control at all.
          */}
          <TemplateDownloads />

          {sorted.length > 0 && (
            <DecisionTable
              rows={sorted}
              contested={contestedSlots}
              onKind={setKind}
              onClear={clearSorted}
            />
          )}

          {unrecognised.length > 0 && (
            <p className="text-xs text-risk-high-ink">
              {`${unrecognised.length} ${unrecognised.length === 1 ? 'file was' : 'files were'} ` +
                'not recognised and will not load: ' +
                `${list(unrecognised.map((row) => row.file.name))}. ` +
                'Set a slot yourself if one of them belongs somewhere.'}
            </p>
          )}

          {skipped.length > 0 && (
            <p className="text-xs text-muted">
              {`${skipped.length} ${skipped.length === 1 ? 'file was' : 'files were'} ` +
                `not read: ${list(skipped)}. Only .xlsx and .json files are inspected.`}
            </p>
          )}

          {sortedTopologies.length > 0 && (
            <SiteIdList picks={sortedTopologies} expectedIds={expectedIds} onSiteId={setSiteId} />
          )}

          <MarkingSlot declared={declared} value={marking} onChange={setMarking} />

          <details className="rounded border border-line bg-surface-2/30 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-ink">
              Place each file yourself
            </summary>
            <p className="mt-1 text-xs text-muted">
              The sorting above is a convenience and never the only way in. Anything
              you put here outranks nothing: it simply claims the slot, and a slot
              claimed twice is reported rather than silently taken.
            </p>
            <div className="mt-2 space-y-3">
              {SLOTS.map((slot) => (
                <FileSlot
                  key={slot.id}
                  slot={slot}
                  file={manualFiles[slot.id]}
                  onPick={(file) => setManualFiles((c) => ({ ...c, [slot.id]: file }))}
                  onClear={() =>
                    setManualFiles((current) => {
                      const next = { ...current }
                      delete next[slot.id]
                      return next
                    })
                  }
                />
              ))}

              <TopologySlot
                picks={manualTopologies}
                expectedIds={expectedIds}
                onPick={pickTopologies}
                onClear={clearManualPicks}
                onSiteId={setSiteId}
              />
            </div>
          </details>
        </div>

        {(conflictMessage ?? error) && (
          <p
            role="alert"
            className="mt-4 rounded border border-risk-high bg-surface-2 p-3 text-sm text-risk-high-ink"
          >
            {conflictMessage ?? error}
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="rounded border border-accent px-3 py-1 text-sm text-accent-ink disabled:opacity-50"
          >
            {busy ? 'Parsing…' : 'Load'}
          </button>
          <span className="text-xs text-muted-3">
            Anything you leave empty is simply absent from the views that need it.
          </span>
        </div>
      </div>
    </div>
  )
}

/** Shared drop behaviour. A drop zone alone would be unusable by keyboard. */
function dropProps(onFiles: (files: File[]) => void) {
  return {
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      const dropped = Array.from(event.dataTransfer?.files ?? [])
      if (dropped.length) onFiles(dropped)
    },
  }
}

const SLOT_CLASS =
  'rounded border border-dashed border-line bg-surface-2/40 px-3 py-2'

/**
 * One zone for the whole set.
 *
 * Two inputs rather than one, because a directory picker and a file picker are
 * different browser controls and neither covers the other: the folder one is
 * how the analyst's files already sit on disk, the file one is how they arrive
 * out of a mail attachment or a download.
 */
function SortZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const folderRef = useRef<HTMLInputElement>(null)

  /**
   * webkitdirectory is set here rather than as a JSX prop because it is absent
   * from React's InputHTMLAttributes, so writing it inline fails the build.
   * Casting the props object to any would silence that at the cost of silencing
   * every other typo on the same element, and setting it on the ref keeps the
   * escape hatch to exactly the one attribute that needs it.
   */
  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  return (
    <fieldset className={SLOT_CLASS} {...dropProps(onFiles)}>
      <legend className="px-1 text-xs font-medium text-ink">Drop everything here</legend>
      <p className="text-xs text-muted">
        The workbook, the JSON files and every site topology, together. Each file
        is opened and sorted by what is actually in it, and every decision is
        listed below for you to correct before anything loads.
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <input
          type="file"
          multiple
          accept=".xlsx,.json,application/json"
          aria-label="Files to sort"
          onChange={(event) => onFiles(Array.from(event.target.files ?? []))}
          className="text-xs text-muted"
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          aria-label="Folder to sort"
          onChange={(event) => onFiles(Array.from(event.target.files ?? []))}
          className="text-xs text-muted"
        />
      </div>
    </fieldset>
  )
}

/**
 * What the classifier decided, with its reasoning, every row correctable.
 *
 * The reason is shown rather than a bare verdict because the analyst is the one
 * who knows which file is which, and "has an acronyms array" is checkable in a
 * way that "Glossary" is not.
 */
function DecisionTable({
  rows,
  contested,
  onKind,
  onClear,
}: {
  rows: SortedFile[]
  contested: ReadonlySet<SlotId>
  onKind: (key: string, kind: SlotKind | null) => void
  onClear: () => void
}) {
  return (
    <div className={SLOT_CLASS}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-ink">What each file was sorted as</h3>
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-line px-1.5 text-xs text-muted hover:text-ink"
        >
          Clear the list
        </button>
      </div>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-3">
              <th scope="col" className="pr-2 font-normal">File</th>
              <th scope="col" className="pr-2 font-normal">Loads as</th>
              <th scope="col" className="font-normal">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const clash = row.kind !== null && row.kind !== 'topology'
                && contested.has(row.kind)
              return (
                <tr key={row.key} className="align-top">
                  <td className="py-1 pr-2 text-ink">{row.file.name}</td>
                  <td className="py-1 pr-2">
                    <select
                      value={row.kind ?? ''}
                      aria-label={`Slot for ${row.file.name} (${row.key.split(':')[0]})`}
                      onChange={(event) =>
                        onKind(row.key, (event.target.value || null) as SlotKind | null)
                      }
                      className="rounded border border-line bg-surface px-1 py-0.5 text-xs text-ink"
                    >
                      <option value="">Not used</option>
                      {SLOT_KINDS.map((kind) => (
                        <option key={kind} value={kind}>{SLOT_LABEL[kind]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 text-muted">
                    <span>{row.found.reason}</span>
                    {row.found.confidence !== 'certain' && row.kind !== null && (
                      <span className="ml-1 text-risk-high-ink">check this one</span>
                    )}
                    {clash && (
                      <span className="ml-1 text-risk-high-ink">
                        contested, so nothing loads yet
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * One of the four slots that hold exactly one file.
 *
 * A drop of several files here can only keep one of them, and which one is an
 * accident of the order the browser hands them over. Saying so is the whole of
 * the fix: dropping the whole set on a slot meant for one file is what an
 * analyst does when they have not spotted the zone above, and the panel used
 * to take the first, discard the rest and look exactly as if it had taken
 * everything.
 */
function FileSlot({
  slot,
  file,
  onPick,
  onClear,
}: {
  slot: Slot
  file: File | undefined
  onPick: (file: File) => void
  onClear: () => void
}) {
  const [ignored, setIgnored] = useState<string[]>([])

  return (
    <fieldset
      className={SLOT_CLASS}
      {...dropProps((dropped) => {
        onPick(dropped[0])
        setIgnored(dropped.slice(1).map((f) => f.name))
      })}
    >
      <legend className="px-1 text-xs font-medium text-ink">{slot.title}</legend>
      <p className="text-xs text-muted">{slot.hint} Drag one here, or choose it.</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept={slot.accept}
          aria-label={slot.inputLabel}
          onChange={(event) => {
            const picked = event.target.files?.[0]
            if (picked) {
              onPick(picked)
              setIgnored([])
            }
          }}
          className="text-xs text-muted"
        />
        {file && (
          <>
            <span className="text-xs text-ink">{file.name}</span>
            <button
              type="button"
              onClick={() => {
                onClear()
                setIgnored([])
              }}
              aria-label={`Clear ${slot.title}`}
              className="rounded border border-line px-1.5 text-xs text-muted hover:text-ink"
            >
              Clear
            </button>
          </>
        )}
      </div>
      {ignored.length > 0 && (
        <p role="status" className="mt-1 text-xs text-risk-high-ink">
          {`${SLOT_LABEL[slot.id]} takes one file, so only ${file?.name ?? 'the first'} ` +
            `was kept. Not used: ${list(ignored)}. Drop the whole set on the zone ` +
            'above to have every file placed.'}
        </p>
      )}
    </fieldset>
  )
}

function TopologySlot({
  picks,
  expectedIds,
  onPick,
  onClear,
  onSiteId,
}: {
  picks: TopologyPick[]
  expectedIds: string[]
  onPick: (files: File[]) => void
  onClear: () => void
  onSiteId: (key: string, id: string) => void
}) {
  return (
    <fieldset className={SLOT_CLASS} {...dropProps((dropped) => onPick(dropped))}>
      <legend className="px-1 text-xs font-medium text-ink">
        Site topology, one file per site
      </legend>
      <p className="text-xs text-muted">
        Each file loads under a site id, which is what keys it to the map and the
        overrides. Where a file does not state one it has to be inferred, so check
        every id below before loading. Drag them here, or choose them. Choosing
        again adds to the list rather than replacing it.
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".json,application/json"
          multiple
          aria-label="Site topology files"
          onChange={(event) => onPick(Array.from(event.target.files ?? []))}
          className="text-xs text-muted"
        />
        {/* The way back out, now that a second pick adds rather than replaces. */}
        {picks.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-line px-1.5 text-xs text-muted hover:text-ink"
          >
            Clear the chosen topologies
          </button>
        )}
      </div>
      {picks.length > 0 && (
        <SiteIdList picks={picks} expectedIds={expectedIds} onSiteId={onSiteId} />
      )}
    </fieldset>
  )
}

/**
 * The site id rows, wherever the files came from.
 *
 * Sorted topologies get this list next to the decision table rather than inside
 * the collapsed fallback, because an id that keys nothing has to be visible to
 * be corrected, and a warning inside a closed disclosure is not visible.
 */
function SiteIdList({
  picks,
  expectedIds,
  onSiteId,
}: {
  picks: TopologyPick[]
  expectedIds: string[]
  onSiteId: (key: string, id: string) => void
}) {
  return (
    <ul className="mt-2 space-y-2">
      {picks.map((pick) => (
        <SiteIdRow
          key={pick.key}
          pick={pick}
          expectedIds={expectedIds}
          onSiteId={onSiteId}
        />
      ))}
    </ul>
  )
}

/**
 * One topology, with the id it will load as, editable.
 *
 * No heuristic can reliably turn a human-written title into the slug somebody
 * else chose as a mapping key, so the guess is shown with where it came from
 * and the analyst can overrule it. That, rather than the heuristic, is what
 * stops a silently uncovered site.
 */
function SiteIdRow({
  pick,
  expectedIds,
  onSiteId,
}: {
  pick: TopologyPick
  expectedIds: string[]
  onSiteId: (key: string, id: string) => void
}) {
  // Keyed by pick.key, not the file name: two files can share a name.
  const inputId = `site-id-${slugify(pick.key)}`
  const loadsAs = slugify(pick.id)
  const unexpected = expectedIds.length > 0 && !expectedIds.includes(loadsAs)

  return (
    <li className="text-xs text-ink">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{pick.file.name}</span>
        <label htmlFor={inputId} className="text-muted-3">
          loads as
        </label>
        <input
          id={inputId}
          type="text"
          value={pick.id}
          aria-label={`Site id for ${pick.file.name} (${pick.key.split(":")[0]})`}
          onChange={(event) => onSiteId(pick.key, event.target.value)}
          className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-xs text-ink"
        />
        <span className="text-muted-3">{SITE_ID_SOURCE_LABEL[pick.resolved.source]}</span>
      </div>
      {unexpected && (
        <div
          role="alert"
          className="mt-1 rounded border border-risk-high bg-surface-2 p-2 text-xs text-risk-high-ink"
        >
          <p>
            {`No file you loaded declares the site id ${pick.id}. Declared: ` +
              `${expectedIds.join(', ')}. Loading it as ${pick.id} gives this site ` +
              'its devices and no coverage at all, which reads as a finding rather ' +
              'than as a naming mismatch.'}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {expectedIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onSiteId(pick.key, id)}
                className="rounded border border-line px-1.5 py-0.5 text-xs text-ink"
              >
                Use {id}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * The control marking, when the files carry none.
 *
 * The workbook declares no marking and only the topology JSONs carry a
 * classification, so an analyst working from controlled data whose files omit
 * it would otherwise export unmarked. Typing here outranks the files, because
 * the analyst can see a marking the file does not carry.
 *
 * The field is deliberately not pre-filled with what the files declare. A
 * pre-filled value the analyst never touched would be indistinguishable from
 * one they typed, and the banner would then credit them with a marking they
 * did not state. Leaving it empty keeps the files in charge.
 */
function MarkingSlot({
  declared,
  value,
  onChange,
}: {
  declared: string | null
  value: string
  onChange: (value: string) => void
}) {
  return (
    <fieldset className={SLOT_CLASS}>
      <legend className="px-1 text-xs font-medium text-ink">Control marking</legend>
      <p className="text-xs text-muted">
        {declared
          ? `The loaded files declare ${declared}. Leave this empty to keep it, or ` +
            'type a marking to state a different one.'
          : `The loaded files declare no marking, so exports would carry ` +
            `"${UNMARKED_NOTICE}". Type one if you know it.`}
      </p>
      <input
        type="text"
        value={value}
        aria-label="Control marking"
        placeholder={declared ?? UNMARKED_NOTICE}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-xs text-ink"
      />
      <p className="mt-1 text-xs text-muted-3">
        Whatever is showing here is burnt into every PNG, PDF and CSV you export.
      </p>
    </fieldset>
  )
}
