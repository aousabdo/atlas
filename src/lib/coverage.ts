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
import { CATEGORY_MAP } from '../data/generated/classifierTables'
import type {
  Confidence, CoverageMatrix, CoverageSite, Mapping, System, SystemId,
} from '../types/atlas'

/** The category-map branch the matrix files its gap rows under. */
const SHORTFALL_BRANCH = 'gaps'

/**
 * A row the matrix files as a shortfall ('Workflow shortfall', 'Exchange
 * shortfall'): it records that something is missing, not a system anyone could
 * field. Realization leaves these out of its denominator; it can be neither
 * realized nor unmapped. Mirrors curation.is_shortfall in the ingest, which
 * lossiness and validate both use, and both read the same generated category
 * map.
 */
export function isShortfall(system: Pick<System, 'category'>): boolean {
  return CATEGORY_MAP[system.category]?.branch === SHORTFALL_BRANCH
}

/**
 * The matrix ids realization counts over: every system except the shortfall
 * rows. The realization gap, the per-site coverage panel and the Reference
 * confidence section all divide by this set, and each counts ids rather than
 * rows, so a count and a share printed side by side cannot disagree.
 */
export function fieldableSystemIds(systems: readonly System[]): ReadonlySet<SystemId> {
  const shortfalls = new Set(shortfallSystemIds(systems))
  return new Set(systems.map((s) => s.id).filter((id) => !shortfalls.has(id)))
}

/** The shortfall row ids, each once, sorted. Mirrors detail.shortfalls. */
export function shortfallSystemIds(systems: readonly System[]): SystemId[] {
  return [...new Set(systems.filter(isShortfall).map((s) => s.id))].sort()
}

/** The set the predicate tests membership against. */
export function matrixIdSet(systems: readonly System[]): ReadonlySet<SystemId> {
  return new Set(systems.map((s) => s.id))
}

/**
 * Does this mapping name something the matrix carries as a system?
 *
 * Two signals, and both must agree. `matrix_id_exists: false` is the curator's
 * explicit declaration that the id is deliberately absent; membership in the
 * matrix is the fact.
 *
 * atlas_ingest.validate rejects a bundle where the two disagree in EITHER
 * direction: an id the matrix lacks carrying no flag, and the flag set on an
 * id the matrix does carry. Only the first was gated until
 * ingest/tests/test_validate.py::test_matrix_id_exists_false_on_a_matrix_system_fails,
 * and in that gap one bundle could pass validation and then be counted three
 * different ways - the realization gap tested membership and counted it, the
 * confidence tally tested the flag and dropped it, and this function required
 * both. Two of those figures render in one card in ConfidenceSection.
 *
 * Consulting both signals here means a bundle assembled some other way, an
 * upload that never went through the ingest, still fails closed rather than
 * counting a non-system as coverage.
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
 * Mirrors atlas_ingest.curation.mapping_confidence_counts, which writes the
 * tally into the pre-built bundle. Both apply the one predicate above.
 * Grading a mapping the tabs do not count as coverage would overstate how
 * much of the architecture is verified.
 *
 * No test runs the two implementations over one input and diffs the tallies;
 * the provider contract asserts neither. What is guaranteed is narrower and
 * worth stating plainly: both call the same predicate, and the one input on
 * which the Python's reading could differ from this one - a flag disagreeing
 * with matrix membership - is gated by atlas_ingest.validate in both
 * directions.
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
 * Whole percent by default, because most ratios here are ratios of small
 * integers: 10 of 32 systems. A tenth of a point claims a resolution of one
 * part in a thousand when the smallest change the data can express, one
 * system, moves the figure by 3.1 points. The tenth digit is noise, and
 * printing it in one tab while another rounds it away is what made the same
 * quantity read as 31.2% and 31%.
 *
 * `maxDecimals` is for the one place that has earned the extra digit: the
 * Lossiness scorecard, whose cards sit beside a trend table quoting deltas in
 * tenths of a point, so rounding the card to a whole percent would leave a
 * "+9.1 pts" with no figure it could have moved. It is a precision argument to
 * this function rather than a second formatter, because a second formatter is
 * exactly how the two spellings drifted apart in the first place. A value that
 * lands on a whole number still prints without a decimal, so 100 is "100%" at
 * any precision.
 *
 * Ties break to even, the same rule computeLossiness rounds report figures by.
 * It matters as soon as a caller asks for a tenth: percentOf(10, 32) is 31.25
 * exactly, and Math.round would have spelled it 31.3 here while the Lossiness
 * report spells the identical fraction 31.2.
 */
export function formatPercent(value: number, maxDecimals = 0): string {
  const scale = 10 ** maxDecimals
  return `${roundHalfToEven(value * scale) / scale}%`
}

/**
 * Nearest integer, breaking an exact tie to even.
 *
 * The display half of the rounding rule stated at roundRatio in
 * src/lib/lossiness.ts. That one decides the tie on integers, because it has
 * to give bit-identical answers to a Python transliteration of itself. This
 * one is handed a float that a caller already divided, so it decides the tie
 * where it can, and the two must never disagree about which way a tie falls.
 */
function roundHalfToEven(value: number): number {
  const whole = Math.floor(value)
  const fraction = value - whole
  if (fraction > 0.5) return whole + 1
  if (fraction < 0.5) return whole
  return whole % 2 === 0 ? whole : whole + 1
}
