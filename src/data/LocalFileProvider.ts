import { matrixIdSet, realizedConfidenceCounts } from '../lib/coverage'
import { computeLossiness } from '../lib/lossiness'
import type {
  CoverageMatrix, CoverageSite, Glossary, LinkSet, LossinessReport, Manifest,
  Methodology, Project, Requirement, SiteId, SnapshotMetrics, System, SystemId,
  Topology,
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

interface RawSiteBlock {
  label?: string
  scope?: string
  mappings?: CoverageSite['mappings']
  not_deployed_at_site?: Record<string, string>
  not_deployed_at_northgate?: Record<string, string>
  unclaimed_devices?: { infrastructure: string[] }
}

interface RawSystemDeviceMap {
  default_site?: string
  sites?: Record<string, RawSiteBlock>
  pending_review?: Record<string, string>
  mappings?: CoverageSite['mappings']
  not_deployed_at_northgate?: Record<string, string>
  unclaimed_devices?: { infrastructure: string[] }
}

/** Accepts the legacy flat single-site shape, same as curation.py. */
function normaliseSystemDeviceMap(
  raw: RawSystemDeviceMap | null,
  matrixIds: ReadonlySet<SystemId>,
): CoverageMatrix {
  if (!raw) {
    return { default_site: null, sites: {}, pending_review: {}, confidence_counts: {} }
  }

  const blocks: Record<string, RawSiteBlock> = raw.sites ?? {
    northgate: {
      label: 'Northgate Sports Campus',
      scope: 'Northgate (wrapped from a legacy flat map)',
      mappings: raw.mappings,
      not_deployed_at_site: raw.not_deployed_at_northgate,
      unclaimed_devices: raw.unclaimed_devices,
    },
  }

  const sites: Record<string, CoverageSite> = {}
  for (const [id, block] of Object.entries(blocks)) {
    sites[id] = {
      label: block.label ?? id,
      scope: block.scope ?? '',
      mappings: block.mappings ?? {},
      not_deployed_at_site:
        block.not_deployed_at_site ?? block.not_deployed_at_northgate ?? {},
      unclaimed_devices: block.unclaimed_devices ?? { infrastructure: [] },
    }
  }

  const matrix: CoverageMatrix = {
    default_site: raw.default_site ?? Object.keys(sites)[0] ?? null,
    sites,
    pending_review: raw.pending_review ?? {},
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
        `${siteId}: device '${d.id}' is in zone '${d.zone}', which is not declared`,
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
    const coverage = normaliseSystemDeviceMap(
      await readJson<RawSystemDeviceMap | null>(inputs.systemDeviceMap, null),
      matrixIdSet(systems),
    )

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

    const builtAt = new Date().toISOString().replace(/\.\d+Z$/, '')
    this.state = {
      systems, links, requirements, glossary, coverage, lossiness, topologies,
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
