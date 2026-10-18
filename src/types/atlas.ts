export type RiskLevel = 'high' | 'medium' | 'low'
export type RiskSource = 'explicit' | 'inferred' | 'override'
export type Severity = 'ok' | 'watch' | 'critical'
export type Confidence = 'high' | 'medium' | 'low'
export type ExtractionMethod = 'prose' | 'override' | 'manual'

export type SystemId = string
export type SiteId = string
export type DeviceId = string

export interface SiteSummary {
  id: SiteId
  label: string
  classification: string
  device_count: number
  edge_count: number
  updated: string
}

export interface Project {
  slug: string
  name: string
  baseline_date: string
  source_label: string
  default_site: SiteId | null
  sites: SiteSummary[]
}

export interface System {
  id: SystemId
  name: string
  /** Display label; may contain newlines for multi-line node rendering. */
  label: string
  category: string
  owner_group_id: string
  owner_group: string
  color_key: string
  confirmed: boolean
  risk: RiskLevel
  risk_source: RiskSource
  detail: string
  integrations_prose: string
}

export interface Link {
  from: SystemId
  to: SystemId
  label: string
  extraction_method: ExtractionMethod
}

export interface LinkSet {
  current: Link[]
  desired: Link[]
}

export interface Zone {
  label: string
  description?: string
}

export interface Device {
  id: DeviceId
  label: string
  zone: string
  type: string
  /** Opaque. The source mixes bare addresses and CIDR; never parse it. */
  ip: string | null
  subnet: string | null
  description: string | null
}

export interface DeviceEdge {
  source: DeviceId
  target: DeviceId
  link_type: string
  label: string | null
  vlan?: number
  port_source?: string
  port_target?: string
}

export interface TopologyMeta {
  label: string
  name: string
  description: string
  classification: string
  version: string
  updated: string
  /** Northgate only; Westfield omits both. */
  source_images?: number | null
  visio_tabs?: string[]
  device_count: number
  edge_count: number
}

export interface Topology {
  site_id: SiteId
  meta: TopologyMeta
  zones: Record<string, Zone>
  devices: Device[]
  edges: DeviceEdge[]
}

export interface Mapping {
  devices: DeviceId[]
  note: string
  confidence: Confidence
  /** false when the mapping deliberately names something absent from the matrix. */
  matrix_id_exists?: boolean
}

export interface CoverageSite {
  label: string
  scope: string
  mappings: Record<SystemId, Mapping>
  /** Checked and genuinely absent, which is different from not yet looked at. */
  not_deployed_at_site: Record<SystemId, string>
  unclaimed_devices: { infrastructure: DeviceId[]; _comment?: string }
}

export interface CoverageMatrix {
  default_site: SiteId | null
  sites: Record<SiteId, CoverageSite>
  pending_review: Record<string, string>
  confidence_counts: Record<string, number>
}

export type RequirementStatus =
  | 'Split out'
  | 'Renamed / split out'
  | 'Partly carried forward'
  | 'Condensed'
  | "Didn't keep"

export interface Requirement {
  orig: string
  sys: string
  /** Empty when the requirement was not carried forward. */
  current: string[]
  status: RequirementStatus
}

export interface LossinessDimension {
  key: string
  label: string
  numerator: number
  denominator: number
  value_pct: number | null
  unit: 'pct' | 'count'
  severity: Severity
  /** The entities behind the number. Never render a figure without a path here. */
  detail: Record<string, unknown>
}

export interface TopGap {
  id: SystemId
  name: string
  risk: RiskLevel
  unconfirmed: boolean
  unmapped: boolean
  /** A shortfall row: it has no hardware to be mapped or unmapped. */
  shortfall: boolean
  score: number
}

export interface LossinessReport {
  dimensions: LossinessDimension[]
  top_gaps: TopGap[]
}

export interface SnapshotMetrics {
  label: string
  built_at: string
  git_sha: string
  dimensions: Omit<LossinessDimension, 'detail'>[]
}

export interface Acronym {
  acr: string
  meaning: string
}

export interface Glossary {
  confidence_intro: string
  out_of_scope: string[]
  methodology_extras: {
    risk_caveat: string
    mapping_confidence_scale: string
    soft_ownership_note: string
  }
  acronyms: Acronym[]
}

export interface OwnerRule {
  priority: number
  match: string
  group_id: string
  group_label: string
  match_mode: 'substring' | 'word_boundary'
}

export interface Methodology {
  high_keywords: string[]
  low_keywords: string[]
  medium_keywords: string[]
  soft_keywords: string[]
  always_soft: string[]
  never_soft: string[]
  soft_groups: string[]
  owner_rules_count: number
  owner_rules: OwnerRule[]
  category_map: Record<string, { branch: string; label: string }>
  link_fragment_count: number
  id_alias_count: number
}

export interface Manifest {
  bundle_version: number
  tool_version: string
  built_at: string
  git_sha: string
  source_label: string
  baseline_date: string
  /** Snapshot labels available under snapshots/. A static host cannot be
   *  globbed, so the manifest is the index. */
  snapshots: string[]
  counts: Record<string, number>
}
