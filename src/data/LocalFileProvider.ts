import { isCalendarDate } from '../curation/dates'
import { matrixIdSet, realizedConfidenceCounts, shortfallSystemIds } from '../lib/coverage'
import { computeLossiness } from '../lib/lossiness'
import type {
  CoverageMatrix, CoverageSite, DecisionRoots, Glossary, Link, LinkSet, LossinessReport,
  Manifest, Mapping, Methodology, Project, Requirement, SiteId, SnapshotMetrics, System,
  SystemId, Topology,
} from '../types/atlas'
import {
  ALWAYS_SOFT, CATEGORY_MAP, HIGH_KEYWORDS, ID_MAP, LINK_NAME_FRAGMENTS,
  LOW_KEYWORDS, MEDIUM_KEYWORDS, NEVER_SOFT, OWNER_RULES, SOFT_GROUPS,
  SOFT_KEYWORDS,
} from './generated/classifierTables'
import {
  assertSafeWorkbook, desiredLinks, extractLinks, LocalFileError, mergeLinks,
  readCrosswalkRows, readMatrixRows, readWorkbook, type Overrides,
} from './localFileParse'
import { AtlasDataError, type AtlasDataProvider } from './provider'

export interface LocalFileInputs {
  matrix: File
  overrides?: File
  glossary?: File
  systemDeviceMap?: File
  topologies?: Record<string, File>
}

interface ParsedState {
  manifest: Manifest
  project: Project
  systems: System[]
  links: LinkSet
  requirements: Requirement[]
  glossary: Glossary
  methodology: Methodology
  coverage: CoverageMatrix
  /** The map file as parsed, for the export to lay the edited sites over. */
  sourceMap: RawSystemDeviceMap | null
  lossiness: LossinessReport
  topologies: Record<SiteId, Topology>
}

export const EMPTY_GLOSSARY: Glossary = {
  confidence_intro: '',
  out_of_scope: [],
  methodology_extras: {
    risk_caveat: '', mapping_confidence_scale: '', soft_ownership_note: '',
  },
  acronyms: [],
}

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

const list = <T>(value: unknown, fallback: readonly T[]): T[] =>
  Array.isArray(value) ? (value as T[]) : [...fallback]

/**
 * Fills whatever a hand-edited glossary left out, rather than refusing it.
 *
 * The glossary is the one input an analyst types by hand, and every key of it
 * is optional to the views that read it: it contributes acronym expansions and
 * prose to the Reference tab, and nothing else reads it at all. Refusing the
 * load over a missing methodology_extras block would cost the analyst their
 * matrix, links, coverage and topologies to protect nothing, and would be
 * stricter than supplying no glossary at all, which `inputs.glossary` has
 * always allowed. load_glossary in ingest/src/atlas_ingest/curation.py fills
 * the same four keys the same way, so the two loaders cannot disagree about
 * which files are acceptable.
 *
 * A key present but written as null is treated as absent: it is the same
 * omission with a different keystroke, and trusting it would put the crash
 * back one line later.
 *
 * What is filled here is not announced here. The Reference tab says which
 * parts of the glossary carry nothing, because that is where a reader would
 * otherwise conclude from a blank panel that their glossary is empty rather
 * than partial.
 */
export function mergeGlossary(raw: unknown): Glossary {
  const source = (raw ?? {}) as Partial<Glossary>
  const extras = (source.methodology_extras ?? {}) as Partial<
    Glossary['methodology_extras']
  >
  const defaults = EMPTY_GLOSSARY.methodology_extras
  return {
    confidence_intro: text(source.confidence_intro, EMPTY_GLOSSARY.confidence_intro),
    out_of_scope: list(source.out_of_scope, EMPTY_GLOSSARY.out_of_scope),
    methodology_extras: {
      risk_caveat: text(extras.risk_caveat, defaults.risk_caveat),
      mapping_confidence_scale: text(
        extras.mapping_confidence_scale, defaults.mapping_confidence_scale,
      ),
      soft_ownership_note: text(extras.soft_ownership_note, defaults.soft_ownership_note),
    },
    acronyms: list(source.acronyms, EMPTY_GLOSSARY.acronyms),
  }
}

/** The same payload methodology.py emits, from the same generated tables. */
const LOCAL_METHODOLOGY: Methodology = {
  high_keywords: [...HIGH_KEYWORDS],
  low_keywords: [...LOW_KEYWORDS],
  medium_keywords: [...MEDIUM_KEYWORDS],
  soft_keywords: [...SOFT_KEYWORDS],
  always_soft: [...ALWAYS_SOFT].sort(),
  never_soft: [...NEVER_SOFT].sort(),
  soft_groups: [...SOFT_GROUPS].sort(),
  owner_rules_count: OWNER_RULES.length,
  owner_rules: OWNER_RULES.map(([match, groupId, groupLabel], i) => ({
    priority: i,
    match,
    group_id: groupId,
    group_label: groupLabel.replace(/\n/g, ' '),
    match_mode: match.length <= 4 ? 'word_boundary' : 'substring',
  })),
  category_map: Object.fromEntries(
    Object.entries(CATEGORY_MAP).map(([k, v]) => [
      k, { branch: v.branch, label: v.label.replace(/\n/g, ' ') },
    ]),
  ),
  link_fragment_count: Object.keys(LINK_NAME_FRAGMENTS).length,
  id_alias_count: Object.keys(ID_MAP).length,
}

async function readJson<T>(file: File | undefined, fallback: T): Promise<T> {
  if (!file) return fallback
  try {
    return JSON.parse(await file.text()) as T
  } catch (cause) {
    throw new LocalFileError(`${file.name} is not valid JSON`, file.name)
  }
}

/**
 * One site of the system to device map, as the file holds it.
 *
 * Every value is unknown until it has been read: the file is kept by hand, so
 * any key can hold anything, and the review gates exist to name what it holds.
 * Keys a loader does not know are allowed and ignored.
 */
export interface RawSiteBlock {
  label?: unknown
  scope?: unknown
  mappings?: unknown
  not_deployed_at_site?: unknown
  not_deployed_at_northgate?: unknown
  unclaimed_devices?: unknown
  decision_roots?: unknown
  [key: string]: unknown
}

/** The system to device map as the file holds it, in either shape. */
export interface RawSystemDeviceMap {
  default_site?: unknown
  sites?: unknown
  pending_review?: unknown
  /** The legacy flat single-site shape keeps these three at the top level. */
  mappings?: unknown
  not_deployed_at_northgate?: unknown
  unclaimed_devices?: unknown
  [key: string]: unknown
}

/**
 * The parsed map in the multi-site shape every consumer reads.
 *
 * Accepts the legacy flat single-site shape, and a site's absences under the
 * legacy key not_deployed_at_northgate, the same as
 * normalise_system_device_map in ingest/src/atlas_ingest/curation.py. The
 * casts below only name the shape the gates in crossFileFailures then hold the
 * values to; nothing here checks them.
 */
export function normaliseSystemDeviceMap(
  raw: RawSystemDeviceMap | null,
  matrixIds: ReadonlySet<SystemId>,
): CoverageMatrix {
  if (!raw) {
    return { default_site: null, sites: {}, pending_review: {}, confidence_counts: {} }
  }

  // Any sites that is not an object means the flat shape, as the ingest's
  // isinstance(raw.get("sites"), dict) reads it, so both write one file.
  const blocks = (isPlainObject(raw.sites) ? raw.sites : {
    northgate: {
      label: 'Northgate Sports Campus',
      scope: 'Northgate (wrapped from a legacy flat map)',
      mappings: raw.mappings,
      not_deployed_at_site: raw.not_deployed_at_northgate,
      unclaimed_devices: raw.unclaimed_devices,
    },
  }) as Record<string, RawSiteBlock>

  const sites: Record<string, CoverageSite> = {}
  for (const [id, block] of Object.entries(blocks)) {
    // A mapping with no devices key names no hardware, which is how the
    // ingest reads it (entry.get("devices")). Filled in here so no consumer
    // has to guard it and none can crash on it before a gate names the row.
    const mappings = Object.fromEntries(
      Object.entries((block.mappings ?? {}) as Record<string, Partial<Mapping>>).map(
        ([sid, m]) => [sid, { ...m, devices: m.devices ?? [] } as Mapping],
      ),
    )
    sites[id] = {
      label: (block.label ?? id) as string,
      scope: (block.scope ?? '') as string,
      mappings,
      not_deployed_at_site: (block.not_deployed_at_site ??
        block.not_deployed_at_northgate ??
        {}) as CoverageSite['not_deployed_at_site'],
      unclaimed_devices: (block.unclaimed_devices ?? {
        infrastructure: [],
      }) as CoverageSite['unclaimed_devices'],
      // Copied only when declared, as the ingest does: absent means "not decided".
      ...(block.decision_roots !== undefined
        ? { decision_roots: block.decision_roots as DecisionRoots }
        : {}),
    }
  }

  const matrix: CoverageMatrix = {
    default_site: (raw.default_site ?? Object.keys(sites)[0] ?? null) as SiteId | null,
    sites,
    pending_review: (raw.pending_review ?? {}) as Record<string, string>,
    confidence_counts: {},
  }
  // The same predicate the tabs use, so the analyst's own file cannot produce
  // a tally the tabs then disagree with.
  matrix.confidence_counts = realizedConfidenceCounts(matrix, matrixIds)
  return matrix
}

interface RawTopology {
  graph?: Record<string, unknown>
  zones?: Topology['zones']
  nodes?: Topology['devices']
  edges?: Topology['edges']
}

function loadTopology(raw: RawTopology | null, siteId: string): Topology {
  if (!raw) throw new LocalFileError(`${siteId}: topology file is empty`, siteId)
  const graph = (raw.graph ?? {}) as Record<string, string | number | string[]>
  const devices = raw.nodes ?? []
  const edges = raw.edges ?? []
  const zones = raw.zones ?? {}

  const zoneIds = new Set(Object.keys(zones))
  for (const d of devices) {
    if (!zoneIds.has(d.zone)) {
      throw new LocalFileError(
        `${siteId}: device '${d.id}' is in zone '${d.zone}', which is not declared in zones`,
        siteId,
      )
    }
  }
  const deviceIds = new Set(devices.map((d) => d.id))
  for (const e of edges) {
    for (const end of [e.source, e.target]) {
      if (!deviceIds.has(end)) {
        throw new LocalFileError(
          `${siteId}: edge ${e.source}->${e.target} references unknown device '${end}'`,
          siteId,
        )
      }
    }
  }

  return {
    site_id: siteId,
    meta: {
      label: (graph.location as string) || (graph.name as string) || siteId,
      name: (graph.name as string) ?? '',
      description: (graph.description as string) ?? '',
      classification: (graph.classification as string) ?? '',
      version: (graph.version as string) ?? '',
      updated: (graph.updated as string) ?? '',
      source_images: (graph.source_images as number) ?? null,
      visio_tabs: (graph.visio_tabs as string[]) ?? [],
      device_count: devices.length,
      edge_count: edges.length,
    },
    zones,
    devices,
    edges,
  }
}

/**
 * Blank as validate.py reads it (_BLANK): trim() and Python's strip() disagree
 * on U+FEFF, U+001C-001F and U+0085, so both engines name the same 30
 * characters.
 */
const BLANK = /^[\s\x1c-\x1f\x85]*$/

/**
 * Cross-file integrity, ported from validate() in
 * ingest/src/atlas_ingest/validate.py.
 *
 * Pure, and returns the failure strings rather than throwing, for the same
 * reason the Python one does: it makes every gate unit-testable without a
 * workbook, and it lets one run tell the analyst everything that needs fixing
 * instead of the first thing. The strings are the Python strings, word for
 * word, so an analyst who runs the CLI gate and then loads the same files in
 * the browser reads the same sentence about the same row.
 *
 * Why this had to exist at all: the browser path ran none of it. It
 * shape-normalised, tallied confidence and threw only on JSON and shape
 * errors, which is backwards. The CLI gate stands between a curator and a
 * bundle that has already been reviewed; this stands between an analyst and
 * their own hand-maintained files, which is where an inconsistency is MORE
 * likely, not less.
 *
 * One gate of validate() is deliberately not ported: the glossary pair
 * ("no acronyms", "no confidence_intro"). See mergeGlossary above, which
 * decided the opposite for the opposite reason - a partial glossary costs no
 * correctness, so refusing a load over it would take the matrix, the links,
 * the coverage and the topologies away to protect nothing. Everything gated
 * here does cost correctness, which is what makes the two decisions the same
 * decision rather than a contradiction.
 */
/**
 * The five gates on a site's declared decision positions, word for word the
 * ingest's _decision_root_failures. Only the existence check needs the
 * topology; the rest are facts about the block itself.
 */
function decisionRootFailures(
  siteId: string,
  site: CoverageSite,
  deviceIds: ReadonlySet<string> | null,
): string[] {
  const raw: unknown = site.decision_roots
  if (raw === undefined || raw === null) return []
  const where = `system_device_map.sites.${siteId}.decision_roots`
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return [`${where}: must be an object with devices, assumed and note`]
  }
  const roots = raw as { devices?: unknown; assumed?: unknown; note?: unknown }
  const idList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((v) => typeof v === 'string')
  const fails: string[] = []
  let devices: string[] | null = null
  if (roots.devices !== undefined && roots.devices !== null && !idList(roots.devices)) {
    fails.push(`${where}: devices must be a list of device ids`)
  } else {
    devices = (roots.devices as string[] | undefined | null) ?? []
    if (devices.length === 0) {
      fails.push(`${where}: devices is empty; omit decision_roots to measure from the drawing's entry points`)
    }
    if (deviceIds) {
      for (const device of devices) {
        if (!deviceIds.has(device)) fails.push(`${where}: device '${device}' is not in the ${siteId} topology`)
      }
    }
    const seen = new Set<string>()
    for (const device of devices) {
      if (seen.has(device)) fails.push(`${where}: device '${device}' is listed twice`)
      seen.add(device)
    }
  }
  if (roots.assumed !== undefined && roots.assumed !== null && !idList(roots.assumed)) {
    fails.push(`${where}.assumed: must be a list of device ids`)
  } else {
    const seenAssumed = new Set<string>()
    for (const device of (roots.assumed as string[] | undefined | null) ?? []) {
      if (seenAssumed.has(device)) fails.push(`${where}.assumed: '${device}' is listed twice`)
      else if (devices !== null && !devices.includes(device)) {
        fails.push(`${where}.assumed: '${device}' is not one of its devices`)
      }
      seenAssumed.add(device)
    }
  }
  if (typeof roots.note !== 'string' || BLANK.test(roots.note)) {
    fails.push(`${where}: no note; say who chose these positions and why`)
  }
  return fails
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Written, in the sense the ingest's `is not None` means: null is absent. */
const given = (value: unknown): boolean => value !== undefined && value !== null

/**
 * The checks on one review stamp, wherever it is written, word for word the
 * ingest's _stamp_failures. `at` is the entry's path.
 */
function stampFailures(at: string, entry: Record<string, unknown>): string[] {
  const by = entry.reviewed_by
  const on = entry.reviewed_on
  if (!given(by) && !given(on)) return []
  if (!given(by) || !given(on)) {
    return [`${at}: reviewed_by and reviewed_on go together; give both or neither`]
  }
  if (typeof by !== 'string' || typeof on !== 'string') {
    return [`${at}: reviewed_by and reviewed_on must be text`]
  }
  const fails: string[] = []
  if (BLANK.test(by)) fails.push(`${at}: reviewed_by is blank; say who reviewed it`)
  if (!isCalendarDate(on)) {
    fails.push(`${at}: reviewed_on '${on}' is not a date; write it as YYYY-MM-DD`)
  }
  return fails
}

/**
 * The gates on a site's review fields, word for word the ingest's
 * _review_failures: the stamps on mappings and on checked absences, the
 * absence's own shape, and unclaimed_devices.checked, the devices someone
 * checked and found to carry no system. Mappings first, then absences, then
 * checked devices, each in file order. Only the drawing check needs the
 * topology.
 */
function reviewFailures(
  siteId: string,
  site: CoverageSite,
  deviceIds: ReadonlySet<string> | null,
): string[] {
  const fails: string[] = []
  for (const [systemId, mapping] of Object.entries(site.mappings)) {
    const mappingAt = `system_device_map.sites.${siteId}.mappings.${systemId}`
    fails.push(...stampFailures(mappingAt, mapping as unknown as Record<string, unknown>))
  }

  const absences: Record<string, unknown> = site.not_deployed_at_site
  for (const [systemId, value] of Object.entries(absences)) {
    const absenceAt = `system_device_map.sites.${siteId}.not_deployed_at_site.${systemId}`
    if (typeof value === 'string') continue
    if (!isPlainObject(value)) {
      fails.push(
        `${absenceAt}: must be a reason, or an object with reason, reviewed_by ` +
          `and reviewed_on`,
      )
      continue
    }
    fails.push(...stampFailures(absenceAt, value))
    if (typeof value.reason !== 'string' || BLANK.test(value.reason)) {
      fails.push(`${absenceAt}: no reason; say what was checked`)
    }
  }

  const checked: unknown = site.unclaimed_devices?.checked
  if (!given(checked)) return fails
  const checkedAt = `system_device_map.sites.${siteId}.unclaimed_devices.checked`
  if (!isPlainObject(checked)) {
    fails.push(`${checkedAt}: must map device ids to reviews`)
    return fails
  }
  for (const [device, entry] of Object.entries(checked)) {
    const deviceAt = `system_device_map.sites.${siteId}.unclaimed_devices.checked.${device}`
    if (!isPlainObject(entry) || !given(entry.reviewed_by) || !given(entry.reviewed_on)) {
      fails.push(`${deviceAt}: must be an object with reviewed_by and reviewed_on`)
    } else {
      fails.push(...stampFailures(deviceAt, entry))
    }
    // A check says the device carries no system, so a mapping naming it
    // contradicts the check. Both are kept and both are named.
    for (const [systemId, mapping] of Object.entries(site.mappings)) {
      const devices: unknown = mapping.devices
      if (Array.isArray(devices) && devices.includes(device)) {
        fails.push(
          `${deviceAt}: mappings.${systemId} lists this device; a device checked ` +
            `as carrying no system takes no mapping`,
        )
      }
    }
    if (deviceIds && !deviceIds.has(device)) {
      fails.push(`${checkedAt}: device '${device}' is not in the ${siteId} topology`)
    }
  }
  return fails
}

export function crossFileFailures(parsed: {
  systems: readonly System[]
  /** The merged current links. Same input validate() is handed. */
  links: readonly Link[]
  /** The planned links, gated the same way. Same input validate() is handed as `desired`. */
  desired?: readonly Link[]
  coverage: CoverageMatrix
  topologies: Readonly<Record<SiteId, Topology>>
  requirements: readonly Requirement[]
}): string[] {
  const fails: string[] = []
  const matrixIds = matrixIdSet(parsed.systems)
  const systemNames = new Set(parsed.systems.map((s) => s.name))
  const shortfallIds = new Set(shortfallSystemIds(parsed.systems))

  for (const [siteId, site] of Object.entries(parsed.coverage.sites)) {
    // No topology for this site means nothing to check the devices against.
    // Inventing a failure there would block a legitimate partial load, which
    // is the common shape here: the panel takes topologies one file at a time.
    const topology = parsed.topologies[siteId]
    const deviceIds = topology
      ? new Set(topology.devices.map((device) => device.id))
      : null

    for (const [systemId, mapping] of Object.entries(site.mappings)) {
      // matrix_id_exists: false is a documented negative fact, not a loophole:
      // it records that someone checked and the system is deliberately absent
      // from the matrix. Both directions are gated, because the flag and
      // matrix membership are two readings of one fact and different consumers
      // read different ones.
      if (!matrixIds.has(systemId) && mapping.matrix_id_exists !== false) {
        fails.push(
          `system_device_map.sites.${siteId}.mappings.${systemId}: not a matrix ` +
            `system id; add it to the workbook or set matrix_id_exists:false`,
        )
      }
      if (matrixIds.has(systemId) && mapping.matrix_id_exists === false) {
        fails.push(
          `system_device_map.sites.${siteId}.mappings.${systemId}: ` +
            `matrix_id_exists:false, but the matrix does carry that system ` +
            `id; drop the flag or rename the mapping`,
        )
      }
      // A shortfall row records that no system exists, so it takes no
      // mapping. With devices, realization leaves it out while the confidence
      // tally counts it. With none, it reads as a survey gap, a system whose
      // hardware nobody has found yet, which is just as false. A checked
      // absence belongs under not_deployed_at_site. Same gate as validate().
      if (shortfallIds.has(systemId)) {
        fails.push(
          `system_device_map.sites.${siteId}.mappings.${systemId}: the ` +
            `matrix files ${systemId} as a shortfall, not a system, so it ` +
            `takes no mapping; record a check under not_deployed_at_site`,
        )
      }
      if (deviceIds) {
        for (const device of mapping.devices ?? []) {
          if (!deviceIds.has(device)) {
            fails.push(
              `system_device_map.sites.${siteId}.mappings.${systemId}: ` +
                `device '${device}' is not in the ${siteId} topology`,
            )
          }
        }
      }
    }

    fails.push(...decisionRootFailures(siteId, site, deviceIds))

    for (const systemId of Object.keys(site.not_deployed_at_site)) {
      if (!matrixIds.has(systemId)) {
        fails.push(
          `system_device_map.sites.${siteId}.not_deployed_at_site.${systemId}: ` +
            `not a matrix system id`,
        )
      }
    }

    if (deviceIds) {
      for (const device of site.unclaimed_devices?.infrastructure ?? []) {
        if (!deviceIds.has(device)) {
          fails.push(
            `system_device_map.sites.${siteId}.unclaimed_devices: ` +
              `device '${device}' is not in the ${siteId} topology`,
          )
        }
      }
    }

    fails.push(...reviewFailures(siteId, site, deviceIds))
  }

  for (const link of parsed.links) {
    for (const end of ['from', 'to'] as const) {
      if (!matrixIds.has(link[end])) {
        fails.push(
          `link ${link.from}->${link.to}: '${link[end]}' is not a matrix system id`,
        )
      }
    }
  }

  // Planned links are curation, so a typo in one is as likely as in a current
  // link, and it used to reach the planning view as a link to nothing.
  for (const link of parsed.desired ?? []) {
    for (const end of ['from', 'to'] as const) {
      if (!matrixIds.has(link[end])) {
        fails.push(
          `desired link ${link.from}->${link.to}: '${link[end]}' is not a matrix system id`,
        )
      }
    }
  }

  for (const row of parsed.requirements) {
    for (const name of row.current) {
      if (!systemNames.has(name)) {
        fails.push(
          `crosswalk '${row.orig.slice(0, 40)}...': current system '${name}' ` +
            `does not match any Project/System name in the matrix`,
        )
      }
    }
  }

  return fails
}

/**
 * One message carrying every failure, in validate()'s shape.
 *
 * No fileName: a cross-file failure is a disagreement BETWEEN files, and
 * naming one of them would point the analyst at whichever half was innocent.
 * Each line names the file, the site and the row instead.
 */
function integrityError(fails: readonly string[]): LocalFileError {
  return new LocalFileError(
    `${fails.length} cross-file integrity failure(s). Nothing was loaded, and ` +
      `whatever was already on screen is unchanged.\n` +
      fails.map((fail) => `  - ${fail}`).join('\n'),
  )
}

/**
 * Parses the analyst's own files, entirely in the browser.
 *
 * Nothing is uploaded. This is strictly safer than the hosted path for
 * sensitive data, which is why it exists rather than a server-side import.
 */
export class LocalFileProvider implements AtlasDataProvider {
  readonly kind = 'local-file' as const
  private state: ParsedState | null = null

  /**
   * Parse everything up front so a partial failure never leaves the UI reading
   * a half-built state. On any throw the previous state stays intact.
   *
   * The integrity gates run last, over the fully parsed set, because they are
   * the only checks that need more than one file to answer. They refuse the
   * load rather than loading with the problem stated, and the reason is not
   * strictness for its own sake: there is nowhere in Phase 1 to put a warning
   * beside the number it taints. Every id gated below is read downstream as a
   * fact - the confidence tally, the realization gap, the attrition flow and
   * the network graph all key off them - so a load that proceeded would print
   * figures derived from rows that do not resolve, with no mark on them. A
   * warning nobody renders is the same defect as the one this closes.
   *
   * Refusing costs the analyst nothing they had: the load is atomic, the
   * previous data stays on screen, and every failing row is named so the fix
   * is one edit and one reload. That is also what the CLI gate does, and the
   * two paths now refuse the same files for the same stated reasons.
   */
  async load(inputs: LocalFileInputs): Promise<void> {
    const buffer = await assertSafeWorkbook(inputs.matrix)
    const workbook = readWorkbook(buffer)

    const systems = readMatrixRows(workbook, inputs.matrix.name)
    const requirements = readCrosswalkRows(workbook, inputs.matrix.name)
    const overrides = await readJson<Overrides>(inputs.overrides, {})
    const glossary = mergeGlossary(
      await readJson<Partial<Glossary> | null>(inputs.glossary, null),
    )
    const sourceMap = await readJson<RawSystemDeviceMap | null>(inputs.systemDeviceMap, null)
    const coverage = normaliseSystemDeviceMap(sourceMap, matrixIdSet(systems))

    const topologies: Record<SiteId, Topology> = {}
    for (const [siteId, file] of Object.entries(inputs.topologies ?? {})) {
      topologies[siteId] = loadTopology(
        await readJson<RawTopology | null>(file, null), siteId,
      )
    }

    const links: LinkSet = {
      current: mergeLinks(extractLinks(systems), overrides),
      desired: desiredLinks(overrides),
    }
    const lossiness = computeLossiness({
      systems, links, requirements, coverage, topologies,
    })

    const fails = crossFileFailures({
      systems, links: links.current, desired: links.desired, coverage, topologies, requirements,
    })
    if (fails.length > 0) throw integrityError(fails)

    const builtAt = new Date().toISOString().replace(/\.\d+Z$/, '')
    this.state = {
      systems, links, requirements, glossary, coverage, sourceMap, lossiness, topologies,
      methodology: LOCAL_METHODOLOGY,
      manifest: {
        bundle_version: 1,
        tool_version: 'ATLAS Phase 1 (local file)',
        built_at: builtAt,
        git_sha: 'n/a',
        source_label: inputs.matrix.name,
        baseline_date: '',
        // A locally loaded file has no build history.
        snapshots: [],
        counts: {
          systems: systems.length,
          confirmed: systems.filter((s) => s.confirmed).length,
          unconfirmed: systems.filter((s) => !s.confirmed).length,
          links: links.current.length,
          desired_links: links.desired.length,
          requirements: requirements.length,
          acronyms: glossary.acronyms.length,
          sites: Object.keys(topologies).length,
          devices: Object.values(topologies).reduce((a, t) => a + t.meta.device_count, 0),
        },
      },
      project: {
        slug: 'local',
        name: inputs.matrix.name,
        baseline_date: '',
        source_label: inputs.matrix.name,
        default_site: coverage.default_site,
        sites: Object.entries(topologies)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, t]) => ({
            id,
            label: t.meta.label,
            classification: t.meta.classification,
            device_count: t.meta.device_count,
            edge_count: t.meta.edge_count,
            updated: t.meta.updated,
          })),
      },
    }
  }

  private require(): ParsedState {
    if (!this.state) {
      throw new AtlasDataError('No file loaded. Choose a Traceability Matrix first.')
    }
    return this.state
  }

  async getManifest() {
    return this.require().manifest
  }
  async getProject() {
    return this.require().project
  }
  async getSystems() {
    return this.require().systems
  }
  async getLinks() {
    return this.require().links
  }
  async getRequirements() {
    return this.require().requirements
  }
  async getGlossary() {
    return this.require().glossary
  }
  async getMethodology() {
    return this.require().methodology
  }
  async getCoverage() {
    return this.require().coverage
  }
  async getLossiness() {
    return this.require().lossiness
  }
  async getSourceSystemDeviceMap() {
    return this.require().sourceMap
  }

  async getTopology(siteId: SiteId): Promise<Topology> {
    const { topologies } = this.require()
    const topology = topologies[siteId]
    if (!topology) {
      throw new AtlasDataError(
        `Unknown site '${siteId}'. Loaded sites: ` +
          `${Object.keys(topologies).join(', ') || 'none'}`,
        undefined,
        siteId,
      )
    }
    return topology
  }

  /** Empty is the honest answer: a locally loaded file has no build history. */
  async getSnapshots(): Promise<SnapshotMetrics[]> {
    return []
  }
}
