import { normaliseSystemDeviceMap } from '../data/LocalFileProvider'
import type { CoverageMatrix } from '../types/atlas'

/** The sample downloads under the template's own name. */
export const SAMPLE_EXPORT_NAME = 'atlas-sample-system-device-map.json'
export const LOCAL_EXPORT_NAME = 'system_device_map.json'

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** An object as Python's isinstance(value, dict) reads parsed JSON. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * JSON.stringify(value, null, 2) with every object's keys in sorted order.
 *
 * Written out by hand because JSON.stringify cannot be handed an order: it
 * always writes integer-like keys first and numerically ("9" before "10"),
 * whatever order they were added in, and json.dumps(sort_keys=True) sorts them
 * as text. Everything else, escaping included, is JSON.stringify's own. As in
 * JSON.stringify, a key whose value is undefined is left out.
 */
function write(value: unknown, indent: string): string {
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((item) => inner + write(item, inner)).join(',\n')}\n${indent}]`
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort(byCodeUnit)
    if (keys.length === 0) return '{}'
    const lines = keys.map((key) => `${inner}${JSON.stringify(key)}: ${write(value[key], inner)}`)
    return `{\n${lines.join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Keys sorted at every level, two-space indent, and a trailing newline. For
 * every value ATLAS's own fields can hold, these are the bytes Python's
 * json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
 * writes, non-ASCII text included.
 *
 * Not for every value JSON can hold, so an analyst's own keys carried through
 * an export can differ:
 * - Keys are ordered by UTF-16 code unit and Python orders them by code point,
 *   so sibling keys that mix astral characters with ones from U+E000 to U+FFFF
 *   come out in opposite orders.
 * - Numbers are printed as JavaScript prints them: 2.0 as 2, 1e-7 as 1e-7
 *   (Python writes 1e-07), -0.0 as 0, and an integer above 2^53 as the double
 *   it was rounded to when it was parsed.
 * - A lone surrogate is written as an escape here, and raw by Python.
 */
export function canonicalJson(value: unknown): string {
  return `${write(value, '')}\n`
}

/** Keys the canonical map writes itself, so the file's own copies are not kept. */
const MAP_KEYS = ['default_site', 'sites', 'pending_review', 'confidence_counts']
/** The legacy flat map keeps one site at the top level; wrapped, they move into it. */
const FLAT_KEYS = ['mappings', 'not_deployed_at_northgate', 'unclaimed_devices']
const SITE_KEYS = [
  'label', 'scope', 'mappings', 'not_deployed_at_site', 'not_deployed_at_northgate',
  'unclaimed_devices', 'decision_roots', 'confidence_counts',
]

const without = (source: Record<string, unknown>, dropped: readonly string[]) =>
  Object.fromEntries(Object.entries(source).filter(([key]) => !dropped.includes(key)))

/**
 * The map as it is written: the edited sites laid over the file that was
 * loaded, so every key the loaders do not know survives, at the top level and
 * on each site. What ATLAS reads (label, scope, mappings, absences, unclaimed
 * devices and decision_roots) comes from `coverage`, so the edits are what gets
 * written. confidence_counts is never written: every reader
 * recomputes it.
 *
 * `raw` is null for the sample, which has no file of its own; its default site
 * and open questions then come from `coverage`. canonical_map_json in
 * ingest/src/atlas_ingest/curation.py builds the same object.
 */
export function canonicalMapObject(
  raw: Record<string, unknown> | null,
  coverage: CoverageMatrix,
): Record<string, unknown> {
  const rawSites = isPlainObject(raw?.sites) ? raw.sites : null
  const own = raw ? without(raw, rawSites ? MAP_KEYS : [...MAP_KEYS, ...FLAT_KEYS]) : {}

  const sites = Object.fromEntries(
    Object.entries(coverage.sites).map(([id, site]) => {
      const block = rawSites && isPlainObject(rawSites[id]) ? rawSites[id] : {}
      return [id, {
        ...without(block, SITE_KEYS),
        label: site.label,
        scope: site.scope,
        mappings: site.mappings,
        not_deployed_at_site: site.not_deployed_at_site,
        unclaimed_devices: site.unclaimed_devices,
        ...(site.decision_roots !== undefined ? { decision_roots: site.decision_roots } : {}),
      }]
    }),
  )

  return {
    ...own,
    default_site: (raw ? raw.default_site : coverage.default_site) ?? Object.keys(sites)[0] ?? null,
    sites,
    pending_review: (raw ? raw.pending_review : coverage.pending_review) ?? {},
  }
}

/**
 * A map file written back the canonical way, unedited. The matrix ids only feed
 * confidence_counts, which is never written, so none are needed.
 */
export function canonicalMapJson(raw: Record<string, unknown>): string {
  return canonicalJson(canonicalMapObject(raw, normaliseSystemDeviceMap(raw, new Set())))
}

/**
 * The file a reviewer downloads. Nothing is written or sent here; the caller
 * downloads the text.
 *
 * The sample is stamped as synthetic, with the day it was edited, because the
 * file outlives its name. Only the sample: local data loaded without a map
 * file has no raw map either, and is the analyst's own.
 */
export function exportSystemDeviceMap(args: {
  raw: Record<string, unknown> | null
  coverage: CoverageMatrix
  source: 'sample' | 'local'
  today: string
}): { fileName: string; text: string } {
  const { raw, coverage, source, today } = args
  const map = canonicalMapObject(raw, coverage)
  const stamped = raw === null && source === 'sample'
    ? {
        _comment:
          `Synthetic ATLAS sample data, edited in ATLAS on ${today}. It describes no real site.`,
        _version: '0.2-sample',
        ...map,
      }
    : map
  return {
    fileName: source === 'sample' ? SAMPLE_EXPORT_NAME : LOCAL_EXPORT_NAME,
    text: canonicalJson(stamped),
  }
}
