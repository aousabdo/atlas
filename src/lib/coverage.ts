/**
 * One definition of "mapped", so no two tabs can print two different answers.
 *
 * A system is REALIZED at a site when a device there names it AND the matrix
 * carries it as a system. Everything else in the mapping file is a real fact
 * with a different meaning, and each gets its own label rather than being
 * folded into coverage:
 *
 *   - a mapping naming no devices is a survey gap. Someone recorded the system
 *     but no hardware has been identified for it yet.
 *   - a mapping the matrix does not carry is not a system at all. It documents
 *     hardware that no matrix row explains.
 *
 * The tabs previously answered "how many systems are mapped here" with the
 * number of mapping rows, the number naming hardware, and the number that were
 * both. Only the last one is coverage; the other two now say what they are.
 */
import type {
  Confidence, CoverageMatrix, CoverageSite, Mapping, System, SystemId,
} from '../types/atlas'

/** The set the predicate tests membership against. */
export function matrixIdSet(systems: readonly System[]): ReadonlySet<SystemId> {
  return new Set(systems.map((s) => s.id))
}

/**
 * Does this mapping name something the matrix carries as a system?
 *
 * Two signals, and both must agree. `matrix_id_exists: false` is the curator's
 * explicit declaration that the id is deliberately absent; membership in the
 * matrix is the fact. The ingest's validator rejects a mapping whose id is
 * absent without the flag, so on a validated bundle the two never disagree.
 * Consulting both means a bundle assembled some other way still fails closed
 * rather than counting a non-system as coverage.
 */
export function namesMatrixSystem(
  systemId: SystemId,
  mapping: Mapping,
  matrixIds: ReadonlySet<SystemId>,
): boolean {
  return mapping.matrix_id_exists !== false && matrixIds.has(systemId)
}

/** The single predicate. Every consumer calls this and nothing else. */
export function isRealizedMapping(
  systemId: SystemId,
  mapping: Mapping,
  matrixIds: ReadonlySet<SystemId>,
): boolean {
  return mapping.devices.length > 0 && namesMatrixSystem(systemId, mapping, matrixIds)
}

/** Realized system ids at one site, sorted so callers can compare lists. */
export function realizedSystemIds(
  site: CoverageSite,
  matrixIds: ReadonlySet<SystemId>,
): SystemId[] {
  return Object.entries(site.mappings)
    .filter(([id, m]) => isRealizedMapping(id, m, matrixIds))
    .map(([id]) => id)
    .sort()
}

/** Realized at one site or another, which is what the realization gap counts. */
export function realizedAnywhere(
  coverage: CoverageMatrix,
  matrixIds: ReadonlySet<SystemId>,
): SystemId[] {
  const out = new Set<SystemId>()
  for (const site of Object.values(coverage.sites)) {
    for (const id of realizedSystemIds(site, matrixIds)) out.add(id)
  }
  return [...out].sort()
}

/**
 * Every recorded mapping, in exactly one bucket.
 *
 * The buckets are disjoint and sum to `recorded`, so a tab can show the
 * difference between the definitions instead of hiding it.
 */
export interface MappingCounts {
  /** Rows in the mapping file for this site. */
  recorded: number
  /** Rows that pass the predicate. This is coverage. */
  realized: number
  /** A matrix system, but no hardware named yet. */
  softwareOnly: number
  /** Hardware named, but not a system the matrix carries. */
  outsideMatrix: number
}

export function countMappings(
  site: CoverageSite,
  matrixIds: ReadonlySet<SystemId>,
): MappingCounts {
  const counts: MappingCounts = {
    recorded: 0, realized: 0, softwareOnly: 0, outsideMatrix: 0,
  }
  for (const [id, mapping] of Object.entries(site.mappings)) {
    counts.recorded += 1
    if (!namesMatrixSystem(id, mapping, matrixIds)) counts.outsideMatrix += 1
    else if (mapping.devices.length === 0) counts.softwareOnly += 1
    else counts.realized += 1
  }
  return counts
}

/**
 * Confidence grades of the realized mappings, across every site.
 *
 * Mirrors atlas_ingest.curation.mapping_confidence_counts, which produces the
 * same tally for the pre-built bundle. Grading a mapping the tabs do not count
 * as coverage would overstate how much of the architecture is verified.
 */
export function realizedConfidenceCounts(
  coverage: CoverageMatrix,
  matrixIds: ReadonlySet<SystemId>,
): Record<string, number> {
  const counts: Record<string, number> = {
    high: 0, medium: 0, low: 0, unspecified: 0, total: 0,
  }
  for (const site of Object.values(coverage.sites)) {
    for (const [id, mapping] of Object.entries(site.mappings)) {
      if (!isRealizedMapping(id, mapping, matrixIds)) continue
      const grade = (mapping.confidence ?? '').toLowerCase()
      counts[grade in counts && grade !== 'total' ? grade : 'unspecified'] += 1
      counts.total += 1
    }
  }
  return counts
}

/** Realized mappings of one confidence grade, with the site they belong to. */
export interface MappingRef {
  system: SystemId
  site: string
  confidence: Confidence
}

export function realizedMappingsAt(
  coverage: CoverageMatrix,
  matrixIds: ReadonlySet<SystemId>,
  level: Confidence,
): MappingRef[] {
  const out: MappingRef[] = []
  for (const [siteId, site] of Object.entries(coverage.sites)) {
    for (const [id, mapping] of Object.entries(site.mappings)) {
      if (!isRealizedMapping(id, mapping, matrixIds)) continue
      if (mapping.confidence !== level) continue
      out.push({ system: id, site: siteId, confidence: level })
    }
  }
  return out.sort((a, b) => a.system.localeCompare(b.system))
}

/** Unrounded, for geometry. An empty denominator is 0, never a division by it. */
export function percentOf(numerator: number, denominator: number): number {
  return denominator ? (100 * numerator) / denominator : 0
}

/**
 * The one percentage formatter.
 *
 * Whole percent, because every ratio here is a ratio of small integers: 10 of
 * 32 systems. A tenth of a point claims a resolution of one part in a thousand
 * when the smallest change the data can express, one system, moves the figure
 * by 3.1 points. The tenth digit is noise, and printing it in one tab while
 * another rounds it away is what made the same quantity read as 31.2% and 31%.
 */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}
