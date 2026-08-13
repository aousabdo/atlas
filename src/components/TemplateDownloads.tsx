/**
 * Sample copies of every file the load panel takes.
 *
 * WHY THIS EXISTS
 *
 * Until now the only complete description of ATLAS's inputs was
 * src/data/localFileParse.ts. Somebody holding their own architecture could
 * read docs/data-inputs.md and still guess wrong about a header, a nesting
 * level or a site key, and a wrong guess is quiet: the workbook parses, the
 * tab renders, and a column is simply missing. A file you can open and edit
 * settles every one of those questions in a way prose cannot.
 *
 * WHERE THE CONTENT COMES FROM
 *
 * The committed synthetic bundle, read back through StaticProvider, which is
 * the same bundle the app itself shows as sample data. Nothing here is
 * invented a second time, and nothing here can ever contain the analyst's own
 * data: this reads the sample bundle, never the active provider. That also
 * means the templates carry no control marking, because the sample carries
 * none.
 *
 * WHY THE SHAPES ARE RESTATED, AND WHAT STOPS THEM DRIFTING
 *
 * scripts/make-sample-workbook.mjs already writes these files for the contract
 * suite. It cannot be imported here: it reads and writes the filesystem at
 * module scope, and a browser has neither. So the inversions below (bundle
 * back to input) are written twice, and
 * src/components/__tests__/TemplateDownloads.test.tsx compares this component's
 * output against that script's, file by file and cell by cell. Edit one
 * without the other and the suite goes red, which is the only form of "do not
 * let these drift" that actually holds.
 *
 * OFFLINE
 *
 * No new dependency, no network. SheetJS is already the read path's parser and
 * writes as well as reads; the download is a Blob and an object URL, both of
 * which work from file:// under the app's CSP. StaticProvider reads the
 * inlined bundle in the single-file build, so nothing is fetched there either.
 */
import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'

import { StaticProvider } from '../data/StaticProvider'
import type { AtlasDataProvider } from '../data/provider'
import { downloadBlob } from '../export/png'
import type {
  CoverageMatrix, LinkSet, Requirement, System, Topology,
} from '../types/atlas'

// ---------------------------------------------------------------------------
// The Matrix sheet
// ---------------------------------------------------------------------------

/**
 * Column order and spelling mirror scripts/make-sample-workbook.mjs, which
 * mirrors a real workbook: trailing spaces in two headers, and the "Existing
 * Interfaces" spelling the parser scans for. Do not tidy either up. A reader
 * comparing their own workbook against this one needs to see what the parser
 * actually matches, which is the literal text with the surrounding space
 * trimmed off.
 */
const HEADERS = [
  'Capability Gap/Requirement',
  'Project/System ',
  'Infrastructure/Technology ',
  'Owner Organization',
  'Confirmed',
  'User Community',
  'Existing Interfaces',
  'Planned Interfaces',
  'Risk/Challenge',
  'Response',
  'Reference Material',
  'Risk Level',
  'Owner Group',
  'Interface Class',
]

const HEADER_ROW = 6 // 1-indexed, as the sheet numbers it
const FIRST_COLUMN = 2 // column B

const SUMMARY_LABELS = [
  'Total Systems', 'Confirmed', 'Unconfirmed', 'High Risk', 'Med Risk', 'Low Risk',
]

const CROSSWALK_HEADERS = [
  'Original Capability Gap/Requirement',
  'Original Project/System',
  'Present Record',
  'Status',
  'Notes',
]

const NO_EQUIVALENT = 'No matching system row'

type Cell = string | number

/**
 * Recover the three source columns from the bundle's assembled `detail`.
 *
 * Both readers build detail as "{infrastructure}. Owner: {owner}. Risk: {risk
 * narrative}.", so the split is exact and reversible. It throws rather than
 * degrades: a template with an empty Owner column would teach the reader that
 * the owner classifier has nothing to classify.
 */
function splitDetail(detail: string, id: string) {
  const [infrastructure, afterInfra] = splitOnce(detail, '. Owner: ', id, 'Owner')
  const [owner, afterOwner] = splitOnce(afterInfra, '. Risk: ', id, 'Risk')
  return { infrastructure, owner, risk: afterOwner.replace(/\.$/, '') }
}

function splitOnce(
  text: string, marker: string, id: string, what: string,
): [string, string] {
  const at = text.indexOf(marker)
  if (at === -1) {
    throw new Error(
      `${id}: detail does not carry a '${what}:' clause, so the template row ` +
        `would be written with an empty column: ${JSON.stringify(text)}`,
    )
  }
  return [text.slice(0, at), text.slice(at + marker.length)]
}

function matrixSheet(systems: System[]): XLSX.WorkSheet {
  const rows: Cell[][] = []
  const put = (row: number, column: number, value: Cell) => {
    while (rows.length < row) rows.push([])
    rows[row - 1][column - 1] = value
  }

  put(1, 2, 'Sample Traceability Matrix')

  // The hand-written summary block. No reader parses it; it is here because
  // the header row is therefore not row 1, and a reader's own workbook will
  // have something similar above its header.
  put(3, 2, 'Summary')
  const atRisk = (level: string) => systems.filter((s) => s.risk === level).length
  const confirmed = systems.filter((s) => s.confirmed).length
  const summary = [
    systems.length, confirmed, systems.length - confirmed,
    atRisk('high'), atRisk('medium'), atRisk('low'),
  ]
  SUMMARY_LABELS.forEach((label, i) => {
    put(3, 3 + i, label)
    put(4, 3 + i, summary[i])
  })

  HEADERS.forEach((header, i) => put(HEADER_ROW, FIRST_COLUMN + i, header))

  systems.forEach((s, index) => {
    const { infrastructure, owner, risk: riskText } = splitDetail(s.detail, s.id)
    const values: Cell[] = [
      s.category,
      s.name,
      infrastructure,
      owner,
      s.confirmed ? 'Yes' : 'No',
      'User community not recorded for this sample row',
      s.integrations_prose,
      'See the desired-integration overlay',
      riskText,
      'Tracked in the sample architecture review',
      'Sample architecture review materials',
      s.risk.charAt(0).toUpperCase() + s.risk.slice(1),
      '',
      'System',
    ]
    values.forEach((value, i) => put(HEADER_ROW + 1 + index, FIRST_COLUMN + i, value))
  })

  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!merges'] = [XLSX.utils.decode_range('B3:B4')]
  return sheet
}

function crosswalkSheet(requirements: Requirement[]): XLSX.WorkSheet {
  const rows: Cell[][] = [[...CROSSWALK_HEADERS]]
  for (const r of requirements) {
    rows.push([
      r.orig,
      r.sys,
      r.current.length ? r.current.join('; ') : NO_EQUIVALENT,
      r.status,
      'Sample crosswalk note',
    ])
  }
  return XLSX.utils.aoa_to_sheet(rows)
}

function workbookBlob(systems: System[], requirements: Requirement[]): Blob {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, matrixSheet(systems), 'Matrix')
  XLSX.utils.book_append_sheet(
    book, crosswalkSheet(requirements), 'original_to_current_crosswalk',
  )
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ---------------------------------------------------------------------------
// The JSON sidecars
// ---------------------------------------------------------------------------

/**
 * Link pairs a curator mined and then struck out.
 *
 * The one input that cannot be read back out of the bundle, because a
 * suppressed link is an absence: links.json shows what survived, never what
 * was removed. Deriving it as "whatever the miner found that the bundle does
 * not have" would make the template agree with the app by construction and
 * teach the reader nothing about the key. These pairs match SUPPRESS_LINKS in
 * scripts/make-sample-workbook.mjs, and the test compares the two files.
 */
const SUPPRESS_LINKS = [
  ['skyward', 'trackwell'],
  ['scan', 'ingot'],
  ['trackwell', 'homing'],
  ['trackwell', 'tagpoint'],
]

/**
 * What says "sample" inside the overrides file, once it is away from its name.
 *
 * Every other template carries its own evidence: the workbook is titled, the
 * glossary and the map carry `_comment` and `_version` out of the bundle, and
 * a topology states a classification. The overrides file carried none, so its
 * three curation keys were the whole of it and the file name was the only
 * signal. A file name survives one rename or one mail attachment, and after
 * that a reader holding it has nothing to tell them whether these curated
 * links describe their own architecture or a fabricated one.
 *
 * Both keys are ignored by every reader: mergeLinks and desiredLinks read the
 * three curation keys and nothing else, and the ingest's shape normaliser
 * drops what it does not know. Adding them changes no behaviour and settles
 * the question for a human.
 */
export const OVERRIDES_MARKERS = {
  _comment:
    'Sample curation overrides, written from the ATLAS synthetic bundle. Every ' +
    'id and label below is invented and describes no real site, system or ' +
    'organisation. Replace the contents; the three curation keys are the whole ' +
    'file, and every one of them is optional. See docs/data-inputs.md.',
  _version: '0.1-sample',
}

function overridesOf(links: LinkSet) {
  const bare = ({ from, to, label }: { from: string; to: string; label: string }) => ({
    from, to, label,
  })
  return {
    ...OVERRIDES_MARKERS,
    cross_links: links.current.filter((l) => l.extraction_method === 'override').map(bare),
    suppress_links: SUPPRESS_LINKS,
    desired_links: links.desired.map(bare),
  }
}

/**
 * The curated overlay as an analyst holds it, which is coverage.json minus the
 * counts: confidence_counts is derived on the way in, and every reader of it
 * recomputes it from the mappings.
 */
function systemDeviceMapOf(coverage: CoverageMatrix) {
  return {
    _version: '0.2-sample',
    default_site: coverage.default_site,
    sites: coverage.sites,
    pending_review: coverage.pending_review,
  }
}

/**
 * The NetworkX-style export the topology reader consumes: `graph` rather than
 * `meta`, `nodes` rather than `devices`, and no counts, because those are
 * derived from the arrays.
 *
 * `site_id` is stated, which a real export usually does not do. It is the join
 * key into the system to device map, and a template that leaves the loader
 * guessing at it would be teaching the one mistake that fails silently.
 */
function networkExportOf(topology: Topology, siteId: string) {
  const graph: Record<string, unknown> = {
    location: topology.meta.label,
    name: topology.meta.name,
    description: topology.meta.description,
    classification: topology.meta.classification,
    version: topology.meta.version,
    updated: topology.meta.updated,
    visio_tabs: topology.meta.visio_tabs,
  }
  // Omitted rather than nulled where the site records none: a null would be a
  // different file, and this one has to be exactly what the reader would get.
  if (topology.meta.source_images !== null && topology.meta.source_images !== undefined) {
    graph.source_images = topology.meta.source_images
  }
  return {
    site_id: siteId,
    graph,
    zones: topology.zones,
    nodes: topology.devices,
    edges: topology.edges,
  }
}

function jsonBlob(payload: unknown): Blob {
  return new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json',
  })
}

// ---------------------------------------------------------------------------
// The templates
// ---------------------------------------------------------------------------

export type TemplateSlot =
  | 'matrix' | 'overrides' | 'glossary' | 'systemDeviceMap' | 'topologies'

export interface SampleTemplate {
  /** The load panel slot this file fills. */
  slot: TemplateSlot
  /** The name the download lands under. */
  name: string
  /** What the file is, in the load panel's words. */
  label: string
  /** For a topology, the site id it keys to. */
  siteId?: string
  build: () => Promise<Blob>
}

/**
 * Every template, built on demand.
 *
 * Only the site index is read up front, because the list of topology files is
 * the one thing the component cannot know without asking. Everything else is
 * fetched when a reader actually clicks, so opening the panel costs one small
 * request rather than the whole bundle.
 */
export async function sampleTemplates(
  provider: AtlasDataProvider,
): Promise<SampleTemplate[]> {
  const project = await provider.getProject()

  const templates: SampleTemplate[] = [
    {
      slot: 'matrix',
      name: 'atlas-sample-matrix.xlsx',
      label: 'Traceability Matrix workbook',
      build: async () => {
        const [systems, requirements] = await Promise.all([
          provider.getSystems(), provider.getRequirements(),
        ])
        return workbookBlob(systems, requirements)
      },
    },
    {
      slot: 'overrides',
      name: 'atlas-sample-overrides.json',
      label: 'Curation overrides',
      build: async () => jsonBlob(overridesOf(await provider.getLinks())),
    },
    {
      slot: 'glossary',
      name: 'atlas-sample-glossary.json',
      label: 'Glossary',
      build: async () => jsonBlob(await provider.getGlossary()),
    },
    {
      slot: 'systemDeviceMap',
      name: 'atlas-sample-system-device-map.json',
      label: 'System to device map',
      build: async () => jsonBlob(systemDeviceMapOf(await provider.getCoverage())),
    },
  ]

  for (const site of project.sites) {
    templates.push({
      slot: 'topologies',
      name: `atlas-sample-site-${site.id}.json`,
      label: `Site topology, ${site.label}`,
      siteId: site.id,
      build: async () =>
        jsonBlob(networkExportOf(await provider.getTopology(site.id), site.id)),
    })
  }
  return templates
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * The download control, for the load panel.
 *
 * Deliberately reads the sample bundle rather than the active provider, so
 * that a reader who has already loaded their own file cannot download it back
 * out of here under a name that says "sample".
 */
export function TemplateDownloads({ provider }: { provider?: AtlasDataProvider }) {
  const sample = useMemo(() => provider ?? new StaticProvider(), [provider])
  const [templates, setTemplates] = useState<SampleTemplate[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /**
   * Two failures, kept apart, because they are not equally urgent.
   *
   * Listing failed on its own, in the background, while the reader was most
   * likely picking their own files: their load is unaffected and nothing they
   * did caused it, so it is a status. A download failed in direct answer to a
   * click, and a click that appears to do nothing is the one thing a reader
   * cannot diagnose, so that one is an alert.
   *
   * This is not only an accessibility nicety. The load panel already owns one
   * alert region, for the failures that stop a load; a second alert inside it
   * complaining about the sample bundle would compete with the message that
   * actually explains why the reader's own files did not load.
   */
  const [listError, setListError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void sampleTemplates(sample).then(
      (list) => {
        if (!cancelled) setTemplates(list)
      },
      (cause: unknown) => {
        if (!cancelled) setListError(messageOf(cause))
      },
    )
    return () => {
      cancelled = true
    }
  }, [sample])

  async function save(template: SampleTemplate) {
    setBusy(template.name)
    setSaveError(null)
    try {
      downloadBlob(template.name, await template.build())
    } catch (cause) {
      // Naming the file and repeating the underlying message, because a
      // download that quietly does nothing is indistinguishable from a browser
      // that swallowed it.
      setSaveError(`${template.name}: ${messageOf(cause)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <fieldset className="rounded border border-dashed border-line bg-surface-2/40 px-3 py-2">
      <legend className="px-1 text-xs font-medium text-ink">
        Sample files to start from
      </legend>
      <p className="text-xs text-muted">
        These are the synthetic sample, not your data. Nothing in them describes a
        real site. Download one to see the exact shape ATLAS reads, then edit it
        into your own. Every field is described in docs/data-inputs.md.
      </p>
      {!templates && !listError && (
        <p role="status" className="mt-1 text-xs text-muted-3">
          Reading the sample bundle.
        </p>
      )}
      {listError && (
        <p role="status" className="mt-1 text-xs text-risk-high-ink">
          {`The sample bundle could not be read, so there is nothing to hand ` +
            `you: ${listError}. Loading your own files is unaffected.`}
        </p>
      )}
      {templates && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {templates.map((template) => (
            <li key={template.name}>
              <button
                type="button"
                onClick={() => void save(template)}
                disabled={busy === template.name}
                title={template.label}
                className="rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:text-ink disabled:opacity-50"
              >
                {template.label} ({template.name})
              </button>
            </li>
          ))}
        </ul>
      )}
      {saveError && (
        // role="status", not "alert". The load panel already owns two alert
        // regions, for a mismatched site id and for a failed load, and those
        // are about the analyst's own data. A sample download that did not
        // save is a lesser thing competing for the same channel, and three
        // alerts in one dialog is a queue nobody reads.
        <p role="status" className="mt-1 text-xs text-risk-high-ink">
          {saveError}
        </p>
      )}
    </fieldset>
  )
}
