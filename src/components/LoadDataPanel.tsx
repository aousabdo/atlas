import { useEffect, useRef, useState } from 'react'

import { LocalFileProvider, type LocalFileInputs } from '../data/LocalFileProvider'
import { readMarking, useProviderSwitch } from '../data/ProviderContext'

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

/**
 * The site id a topology file describes.
 *
 * Taken from the file name because the site id has to key the map before the
 * file is parsed, and the alternative is asking the analyst to type an id they
 * would have to get exactly right for the map to line up.
 */
export function siteIdFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-](network|topology|graph)$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
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
  const [topologies, setTopologies] = useState<File[]>([])
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

  async function load() {
    const matrix = files.matrix
    if (!matrix) {
      setError('Choose a Traceability Matrix first. Everything else is optional.')
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
      topologies: Object.fromEntries(
        topologies.map((file) => [siteIdFromFileName(file.name), file]),
      ),
    }
    try {
      await provider.load(inputs)
      const marking = await readMarking(provider)
      adopt(provider, { kind: 'local', label: matrix.name, marking })
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

          <TopologySlot files={topologies} onPick={setTopologies} />
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
  files,
  onPick,
}: {
  files: File[]
  onPick: (files: File[]) => void
}) {
  return (
    <fieldset className={SLOT_CLASS} {...dropProps((dropped) => onPick(dropped))}>
      <legend className="px-1 text-xs font-medium text-ink">
        Site topology, one file per site
      </legend>
      <p className="text-xs text-muted">
        The site id comes from the file name, so northgate_network.json loads as
        northgate. Drag them here, or choose them.
      </p>
      <input
        type="file"
        accept=".json,application/json"
        multiple
        aria-label="Site topology files"
        onChange={(event) => onPick(Array.from(event.target.files ?? []))}
        className="mt-1 text-xs text-muted"
      />
      {files.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {files.map((file) => (
            <li key={file.name} className="text-xs text-ink">
              {file.name}{' '}
              <span className="text-muted-3">as {siteIdFromFileName(file.name)}</span>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
