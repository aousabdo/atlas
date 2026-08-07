#!/usr/bin/env node
/**
 * Fabricate the analyst's own inputs: the Traceability Matrix workbook and the
 * JSON sidecars that go with it.
 *
 * WHY THIS EXISTS
 *
 * LocalFileProvider is the engine behind the upload path, and its contract
 * suite used to run only when $ATLAS_SOURCE_REPO pointed at a checkout of the
 * real controlled data. That made the suite unrunnable on every machine but
 * one, and after the purge renamed the paths it pointed at, unrunnable
 * anywhere. Coverage that depends on controlled data is not coverage.
 *
 * So the suite is fed a fabricated workbook instead, built from the committed
 * sample bundle in fixtures/synthetic. That bundle is emitted by the Python
 * ingest package (atlas_ingest.synthetic), so a workbook built from it and then
 * parsed by the TypeScript reader closes a loop: the two classifiers must agree
 * on the same rows, or the contract suite goes red.
 *
 * WHY NODE AND NOT ingest/tests/fixtures/make_sample_workbook.py
 *
 * That script writes the same workbook and is the right tool for the Python
 * suite, which already runs in a job with Python and openpyxl installed. The
 * unit job runs `npm ci && npm test` with Node only. Shelling out to Python
 * from vitest would make the TypeScript suite unrunnable wherever openpyxl is
 * absent, which is the failure being fixed, not a new one worth introducing.
 *
 * What that costs is named rather than hidden: the workbook here is written by
 * the same SheetJS build that reads it, so this proves classifier agreement,
 * not xlsx interoperability. openpyxl-written bytes are exercised by
 * ingest/tests/test_excel_golden.py against the Python reader.
 *
 * NOTHING IS COMMITTED
 *
 * .gitignore excludes *.xlsx and the data guard fails on a tracked one, because
 * a spreadsheet in this repo is the exact shape of the mistake purged from its
 * history. Output goes to a directory you name, or to a fresh temp directory.
 *
 *   node scripts/make-sample-workbook.mjs [OUTPUT_DIR]
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as XLSX from 'xlsx'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = join(repo, 'fixtures', 'synthetic')

const read = (...parts) => JSON.parse(readFileSync(join(bundle, ...parts), 'utf-8'))

// ---------------------------------------------------------------------------
// The Matrix sheet
// ---------------------------------------------------------------------------

/**
 * Column order and spelling mirror ingest/tests/fixtures/make_sample_workbook.py,
 * which mirrors the real workbook: trailing spaces in two headers, and the
 * "Existing Interfaces" spelling both readers scan for. Do not tidy either up;
 * the header scan is what is under test.
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
  'Total Systems', 'Confirmed', 'Unconfirmed', 'High Risk', 'Med Risk',
  'Low Risk',
]

const CROSSWALK_HEADERS = [
  'Original Capability Gap/Requirement',
  'Original Project/System',
  'Present Record',
  'Status',
  'Notes',
]

const NO_EQUIVALENT = 'No matching system row'

/**
 * Recover the three source columns from the bundle's assembled `detail`.
 *
 * Both readers build detail as "{infrastructure}. Owner: {owner}. Risk: {risk
 * narrative}.", so the split is exact and reversible. It throws rather than
 * degrades: an empty Owner column would leave the owner classifier with nothing
 * to classify and the contract's owner-group assertion would pass vacuously.
 */
function splitDetail(detail, id) {
  const [infrastructure, afterInfra] = split(detail, '. Owner: ', id, 'Owner')
  const [owner, afterOwner] = split(afterInfra, '. Risk: ', id, 'Risk')
  return { infrastructure, owner, risk: afterOwner.replace(/\.$/, '') }
}

function split(text, marker, id, what) {
  const at = text.indexOf(marker)
  if (at === -1) {
    throw new Error(
      `${id}: detail does not carry a '${what}:' clause, so the workbook row ` +
        `would be written with an empty column: ${JSON.stringify(text)}`,
    )
  }
  return [text.slice(0, at), text.slice(at + marker.length)]
}

function matrixSheet(systems) {
  const rows = []
  const put = (row, column, value) => {
    while (rows.length < row) rows.push([])
    rows[row - 1][column - 1] = value
  }

  put(1, 2, 'Sample Traceability Matrix')

  // The hand-written summary block. It is decorative: no reader parses it, and
  // it is here because the header row is therefore not row 1 and the scan has
  // to walk past something real.
  put(3, 2, 'Summary')
  const risk = (level) => systems.filter((s) => s.risk === level).length
  const confirmed = systems.filter((s) => s.confirmed).length
  const summary = [
    systems.length, confirmed, systems.length - confirmed,
    risk('high'), risk('medium'), risk('low'),
  ]
  SUMMARY_LABELS.forEach((label, i) => {
    put(3, 3 + i, label)
    put(4, 3 + i, summary[i])
  })

  HEADERS.forEach((header, i) => put(HEADER_ROW, FIRST_COLUMN + i, header))

  systems.forEach((s, index) => {
    const { infrastructure, owner, risk: riskText } = splitDetail(s.detail, s.id)
    const values = [
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
    values.forEach((value, i) => {
      put(HEADER_ROW + 1 + index, FIRST_COLUMN + i, value)
    })
  })

  const sheet = XLSX.utils.aoa_to_sheet(rows)
  // The merged caption the real workbook carries above the header.
  sheet['!merges'] = [XLSX.utils.decode_range('B3:B4')]
  return sheet
}

function crosswalkSheet(requirements) {
  const rows = [CROSSWALK_HEADERS]
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

function writeWorkbook(path, systems, requirements) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, matrixSheet(systems), 'Matrix')
  XLSX.utils.book_append_sheet(
    wb, crosswalkSheet(requirements), 'original_to_current_crosswalk',
  )
  writeFileSync(path, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

// ---------------------------------------------------------------------------
// The JSON sidecars
// ---------------------------------------------------------------------------

/**
 * Link pairs the curator mined and then struck out.
 *
 * This is the one input that cannot be read back out of the bundle, because a
 * suppressed link is an absence: links.json shows what survived, never what was
 * removed. Deriving it as "whatever the TypeScript miner found that the bundle
 * does not have" would make the suite agree with itself by construction and
 * hide the divergence it exists to catch, so the pairs are restated. They match
 * SUPPRESS_LINKS in ingest/src/atlas_ingest/synthetic.py; the contract pins the
 * resulting link count on both providers, so a change on either side goes red.
 */
const SUPPRESS_LINKS = [
  ['skyward', 'trackwell'],
  ['scan', 'ingot'],
  ['trackwell', 'homing'],
  ['trackwell', 'tagpoint'],
]

function overrides(links) {
  const bare = ({ from, to, label }) => ({ from, to, label })
  return {
    cross_links: links.current
      .filter((l) => l.extraction_method === 'override')
      .map(bare),
    suppress_links: SUPPRESS_LINKS,
    desired_links: links.desired.map(bare),
  }
}

/**
 * The curated overlay as the analyst holds it, which is coverage.json minus the
 * counts: confidence_counts is computed by curation.py on the way into the
 * bundle, and both readers recompute it from the mappings.
 */
function systemDeviceMap(coverage) {
  return {
    _version: '0.2-sample',
    default_site: coverage.default_site,
    sites: coverage.sites,
    pending_review: coverage.pending_review,
  }
}

/**
 * The NetworkX-style export the topology readers consume: `graph` rather than
 * `meta`, `nodes` rather than `devices`, and no counts, because both readers
 * derive those from the arrays.
 */
function networkExport(site) {
  const graph = {
    location: site.meta.label,
    name: site.meta.name,
    description: site.meta.description,
    classification: site.meta.classification,
    version: site.meta.version,
    updated: site.meta.updated,
    visio_tabs: site.meta.visio_tabs,
  }
  // Northgate only; Westfield omits it, and a null would not be the same file.
  if (site.meta.source_images !== null) graph.source_images = site.meta.source_images

  return { graph, zones: site.zones, nodes: site.devices, edges: site.edges }
}

const writeJson = (path, payload) => {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

/**
 * Write every input LocalFileProvider takes into `directory`.
 * Returns the directory, so a caller can pass nothing and be told where.
 */
export function writeSampleInputs(directory) {
  const out = directory
    ? (mkdirSync(directory, { recursive: true }), directory)
    : mkdtempSync(join(tmpdir(), 'atlas-sample-inputs-'))
  mkdirSync(join(out, 'sites'), { recursive: true })

  writeWorkbook(join(out, 'matrix.xlsx'), read('systems.json'), read('crosswalk.json'))
  writeJson(join(out, 'overrides.json'), overrides(read('links.json')))
  writeJson(join(out, 'glossary.json'), read('glossary.json'))
  writeJson(join(out, 'system_device_map.json'), systemDeviceMap(read('coverage.json')))
  for (const site of ['northgate', 'westfield']) {
    writeJson(join(out, 'sites', `${site}.json`), networkExport(read('sites', `${site}.json`)))
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`wrote the sample inputs to ${writeSampleInputs(process.argv[2])}`)
}
