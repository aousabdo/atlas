import { useEffect, useMemo, useRef, useState } from 'react'

import { LocalFileProvider, type LocalFileInputs } from '../data/LocalFileProvider'
import { readMarking, UNMARKED_NOTICE, useProviderSwitch } from '../data/ProviderContext'
import {
  declaredSiteIds, resolveSiteId, SITE_ID_SOURCE_LABEL, slugify,
  type ResolvedSiteId,
} from '../lib/siteId'

type SlotId = 'matrix' | 'overrides' | 'glossary' | 'systemDeviceMap'

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
  const [files, setFiles] = useState<Partial<Record<SlotId, File>>>({})
  const [topologies, setTopologies] = useState<TopologyPick[]>([])
  const [expectedIds, setExpectedIds] = useState<string[]>([])
  const [marking, setMarking] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  /**
   * The site ids the analyst's other files key by.
   *
   * Read here, before the load, because this is the only moment at which a
   * topology that keys nothing can still be corrected. Afterwards it is a site
   * with devices and no coverage, which reads as a finding.
   */
  const mapFile = files.systemDeviceMap
  const overridesFile = files.overrides
  useEffect(() => {
    const sources = [mapFile, overridesFile].filter((f): f is File => !!f)
    if (!sources.length) {
      setExpectedIds([])
      return
    }
    let cancelled = false
    void Promise.all(sources.map(readJsonQuietly)).then((raws) => {
      if (cancelled) return
      const ids = new Set(raws.flatMap((raw) => declaredSiteIds(raw)))
      setExpectedIds([...ids].sort())
    })
    return () => {
      cancelled = true
    }
  }, [mapFile, overridesFile])

  async function pickTopologies(picked: File[]) {
    const picks = await Promise.all(
      picked.map(async (file, index) => {
        const raw = await readJsonQuietly(file)
        const resolved = resolveSiteId(raw, file.name, expectedIds)
        return {
          key: `${index}:${file.name}`,
          file,
          resolved,
          id: resolved.id,
          declared: declaredClassification(raw),
        }
      }),
    )
    setTopologies(picks)
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
    setTopologies((current) =>
      current.map((pick) => (pick.key === key ? { ...pick, id } : pick)),
    )
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

  async function load() {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Load your own data"
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded border border-line bg-surface p-6"
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
          {SLOTS.map((slot) => (
            <FileSlot
              key={slot.id}
              slot={slot}
              file={files[slot.id]}
              onPick={(file) => setFiles((current) => ({ ...current, [slot.id]: file }))}
              onClear={() =>
                setFiles((current) => {
                  const next = { ...current }
                  delete next[slot.id]
                  return next
                })
              }
            />
          ))}

          <TopologySlot
            picks={topologies}
            expectedIds={expectedIds}
            onPick={pickTopologies}
            onSiteId={setSiteId}
          />

          <MarkingSlot declared={declared} value={marking} onChange={setMarking} />
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded border border-risk-high bg-surface-2 p-3 text-sm text-risk-high-ink"
          >
            {error}
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
  return (
    <fieldset className={SLOT_CLASS} {...dropProps((files) => onPick(files[0]))}>
      <legend className="px-1 text-xs font-medium text-ink">{slot.title}</legend>
      <p className="text-xs text-muted">{slot.hint} Drag one here, or choose it.</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept={slot.accept}
          aria-label={slot.inputLabel}
          onChange={(event) => {
            const picked = event.target.files?.[0]
            if (picked) onPick(picked)
          }}
          className="text-xs text-muted"
        />
        {file && (
          <>
            <span className="text-xs text-ink">{file.name}</span>
            <button
              type="button"
              onClick={onClear}
              aria-label={`Clear ${slot.title}`}
              className="rounded border border-line px-1.5 text-xs text-muted hover:text-ink"
            >
              Clear
            </button>
          </>
        )}
      </div>
    </fieldset>
  )
}

function TopologySlot({
  picks,
  expectedIds,
  onPick,
  onSiteId,
}: {
  picks: TopologyPick[]
  expectedIds: string[]
  onPick: (files: File[]) => void
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
        every id below before loading. Drag them here, or choose them.
      </p>
      <input
        type="file"
        accept=".json,application/json"
        multiple
        aria-label="Site topology files"
        onChange={(event) => onPick(Array.from(event.target.files ?? []))}
        className="mt-1 text-xs text-muted"
      />
      {picks.length > 0 && (
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
      )}
    </fieldset>
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
