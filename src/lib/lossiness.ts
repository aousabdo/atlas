/**
 * The seven lossiness dimensions, computed in the browser.
 *
 * A transliteration of ingest/src/atlas_ingest/lossiness.py. StaticProvider
 * serves the Python's output; LocalFileProvider computes it here from the
 * analyst's own file. The contract suite asserts both produce the same shape
 * and the same numbers for the same inputs.
 */
import type {
  CoverageMatrix, LinkSet, LossinessDimension, LossinessReport, Requirement,
  Severity, System, Topology, TopGap,
} from '../types/atlas'
import { matrixIdSet, realizedSystemIds } from './coverage'

export const DIMENSION_LABELS: Record<string, string> = {
  requirement_attrition: 'Requirement attrition',
  ownership_ambiguity: 'Ownership ambiguity',
  realization_gap: 'Realization gap',
  integration_gap: 'Integration gap',
  evidence_gap: 'Evidence gap',
  orphaned_hardware: 'Orphaned hardware',
  open_questions: 'Open questions',
}

const OK_AT = 90
const WATCH_AT = 60

/** Band a percentage where higher is better. */
export function severityFor(pct: number): Severity {
  if (pct >= OK_AT) return 'ok'
  if (pct >= WATCH_AT) return 'watch'
  return 'critical'
}

/** Band a raw count where lower is better. */
export function countSeverity(count: number, watchAt = 1, criticalAt = 10): Severity {
  if (count >= criticalAt) return 'critical'
  if (count >= watchAt) return 'watch'
  return 'ok'
}

function pct(num: number, den: number): number {
  return den ? Math.round((1000 * num) / den) / 10 : 0
}

function dimension(
  key: string,
  numerator: number,
  denominator: number,
  severity: Severity,
  detail: Record<string, unknown>,
  unit: 'pct' | 'count' = 'pct',
): LossinessDimension {
  return {
    key,
    label: DIMENSION_LABELS[key],
    numerator,
    denominator,
    value_pct: unit === 'pct' ? pct(numerator, denominator) : null,
    unit,
    severity,
    detail,
  }
}

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of values) out[v] = (out[v] ?? 0) + 1
  return out
}

const pairKey = (a: string, b: string) => [a, b].sort().join(' ')

export interface LossinessInputs {
  systems: System[]
  links: LinkSet
  requirements: Requirement[]
  coverage: CoverageMatrix
  topologies: Record<string, Topology>
}

export function computeLossiness(inputs: LossinessInputs): LossinessReport {
  const { systems, links, requirements, coverage, topologies } = inputs

  const dropped = requirements.filter((r) => r.status === "Didn't keep").map((r) => r.orig)
  const carried = requirements.length - dropped.length
  const requirementAttrition = dimension(
    'requirement_attrition', carried, requirements.length,
    severityFor(pct(carried, requirements.length)),
    { dropped, by_status: tally(requirements.map((r) => r.status)) },
  )

  const unconfirmed = systems.filter((s) => !s.confirmed).map((s) => s.id).sort()
  const ownershipAmbiguity = dimension(
    'ownership_ambiguity', systems.length - unconfirmed.length, systems.length,
    severityFor(pct(systems.length - unconfirmed.length, systems.length)),
    { unconfirmed },
  )

  // isRealizedMapping is the shared definition; see src/lib/coverage.ts for
  // why a device-less or non-matrix mapping is a different fact from coverage.
  const matrixIds = matrixIdSet(systems)
  const perSite: Record<string, unknown> = {}
  const mappedAnywhere = new Set<string>()
  for (const [siteId, site] of Object.entries(coverage.sites)) {
    const mapped = realizedSystemIds(site, matrixIds)
    mapped.forEach((m) => mappedAnywhere.add(m))
    perSite[siteId] = {
      label: site.label,
      mapped: mapped.length,
      total: systems.length,
      pct: pct(mapped.length, systems.length),
      mapped_ids: mapped,
      checked_absent: Object.keys(site.not_deployed_at_site).sort(),
    }
  }
  const unmapped = [...matrixIds].filter((id) => !mappedAnywhere.has(id)).sort()
  const realizationGap = dimension(
    'realization_gap', mappedAnywhere.size, systems.length,
    severityFor(pct(mappedAnywhere.size, systems.length)),
    { per_site: perSite, unmapped },
  )

  const currentPairs = new Set(links.current.map((l) => pairKey(l.from, l.to)))
  const missing = links.desired.filter((d) => !currentPairs.has(pairKey(d.from, d.to)))
  const integrationGap = dimension(
    'integration_gap', missing.length, links.desired.length,
    countSeverity(missing.length, 1, 10),
    {
      missing_pairs: missing.map((m) => [m.from, m.to]),
      missing: missing.map((m) => ({ from: m.from, to: m.to, label: m.label })),
      current_pairs: [...currentPairs].sort().map((p) => p.split(' ')),
    },
    'count',
  )

  const inferred = systems.filter((s) => s.risk_source === 'inferred').map((s) => s.id).sort()
  const override = systems.filter((s) => s.risk_source === 'override').map((s) => s.id).sort()
  const explicit = systems.filter((s) => s.risk_source === 'explicit').length
  const evidenceGap = dimension(
    'evidence_gap', explicit, systems.length,
    severityFor(pct(explicit, systems.length)),
    { inferred, override },
  )

  const bySite: Record<string, number> = {}
  const deviceIds: Record<string, string[]> = {}
  for (const [siteId, site] of Object.entries(coverage.sites)) {
    const unclaimed = site.unclaimed_devices?.infrastructure ?? []
    bySite[siteId] = unclaimed.length
    deviceIds[siteId] = [...unclaimed]
  }
  const totalUnclaimed = Object.values(bySite).reduce((a, b) => a + b, 0)
  const totalDevices = Object.values(topologies).reduce(
    (a, t) => a + t.meta.device_count, 0,
  )
  const orphanedHardware = dimension(
    'orphaned_hardware', totalUnclaimed, totalDevices,
    countSeverity(totalUnclaimed, 1, 25),
    { by_site: bySite, device_ids: deviceIds },
    'count',
  )

  const pending = Object.entries(coverage.pending_review)
  const openQuestions = dimension(
    'open_questions', pending.length, pending.length,
    countSeverity(pending.length, 1, 10),
    { questions: pending.map(([subject, question]) => ({ subject, question })) },
    'count',
  )

  const dimensions = [
    requirementAttrition, ownershipAmbiguity, realizationGap,
    integrationGap, evidenceGap, orphanedHardware, openQuestions,
  ]

  return { dimensions, top_gaps: topGaps(dimensions, systems) }
}

/**
 * Opt-in management indicator, never a formal metric.
 *
 * Averages the percentage dimensions only. Count dimensions have no
 * denominator that makes a percentage honest, so folding them in would
 * manufacture precision. Callers must label the result as an indicator.
 */
export function compositeIndex(report: LossinessReport): number {
  const pcts = report.dimensions
    .filter((d) => d.unit === 'pct' && d.value_pct !== null)
    .map((d) => d.value_pct as number)
  return pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : 0
}

function topGaps(dimensions: LossinessDimension[], systems: System[], limit = 10): TopGap[] {
  const find = (key: string) => dimensions.find((d) => d.key === key)!
  const unconfirmed = new Set(
    (find('ownership_ambiguity').detail.unconfirmed as string[]) ?? [],
  )
  const unmapped = new Set((find('realization_gap').detail.unmapped as string[]) ?? [])

  return systems
    .map((s) => ({
      id: s.id,
      name: s.name,
      risk: s.risk,
      unconfirmed: unconfirmed.has(s.id),
      unmapped: unmapped.has(s.id),
      score:
        (s.risk === 'high' ? 3 : 0) +
        (unconfirmed.has(s.id) ? 1 : 0) +
        (unmapped.has(s.id) ? 1 : 0),
    }))
    .filter((g) => g.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
}
