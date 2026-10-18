/**
 * What to build next: the planned integrations, each described by facts a
 * reader can check by hand.
 *
 * There is deliberately no score and no build order. Ranking the wish list
 * means weighing a confirmed owner against a requirement joined against a
 * wire already in place, and any weights would be a guess presented as a
 * finding. So each planned link gets the plain facts, and the table lets a
 * reader sort by one of them at a time.
 *
 * The facts:
 *   - how many of its two owners are confirmed, and whether it crosses from
 *     one owner group to another;
 *   - the higher risk of its two ends;
 *   - the requirements it would join (both ends carry the requirement, so the
 *     link closes a seam a split left open) and the ones it only touches;
 *   - whether the two systems can already reach each other through the
 *     integrations recorded today, and in how many hops;
 *   - per site, whether both ends have hardware there and how the drawing
 *     joins them, by the same check as the Network tab.
 */
import { isShortfall, matrixIdSet } from './coverage'
import { wiringAtSite, type WiringVerdict } from './wiring'
import type {
  CoverageMatrix, Link, LinkSet, Requirement, RiskLevel, SiteId, System, SystemId, Topology,
} from '../types/atlas'

export type PlannedSite =
  | { siteId: SiteId; label: string; reviewed: false }
  /** verdict is null when the site has mappings but no drawing was loaded. */
  | { siteId: SiteId; label: string; reviewed: true; verdict: WiringVerdict | null }

export interface PlannedIntegration {
  link: Link
  /** 0, 1 or 2. */
  confirmedOwners: number
  crossesOrg: boolean
  risk: RiskLevel
  /** Indexes into the requirements: both ends carry it. */
  requirementsJoined: number[]
  /** Indexes into the requirements: at least one end carries it. */
  requirementsTouched: number[]
  /** Shortest path through today's recorded integrations; null when there is none. */
  hopsToday: number | null
  /** Ends filed as shortfall rows: the system does not exist yet. */
  shortfallEnds: SystemId[]
  sites: PlannedSite[]
}

const RISK_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }

function hopsBetween(links: readonly Link[], from: SystemId, to: SystemId): number | null {
  const adj = new Map<SystemId, SystemId[]>()
  for (const { from: a, to: b } of links) {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  const depth = new Map<SystemId, number>([[from, 0]])
  const queue = [from]
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head]!
    if (at === to) return depth.get(at)!
    for (const next of adj.get(at) ?? []) {
      if (depth.has(next)) continue
      depth.set(next, depth.get(at)! + 1)
      queue.push(next)
    }
  }
  return null
}

export function plannedIntegrations({
  systems,
  links,
  requirements,
  coverage,
  topologies,
}: {
  systems: readonly System[]
  links: LinkSet
  requirements: readonly Requirement[]
  coverage: CoverageMatrix
  topologies: Readonly<Record<SiteId, Topology>>
}): PlannedIntegration[] {
  const byId = new Map(systems.map((s) => [s.id, s]))
  const idByName = new Map(systems.map((s) => [s.name, s.id]))
  const matrixIds = matrixIdSet(systems)
  const carriers = requirements.map(
    (r) => new Set(r.current.map((name) => idByName.get(name)).filter(Boolean) as SystemId[]),
  )

  // One pass per site over every planned link, by the Network tab's check.
  const verdicts = new Map<SiteId, WiringVerdict[]>()
  const reviewed = new Map<SiteId, boolean>()
  for (const [siteId, site] of Object.entries(coverage.sites)) {
    const isReviewed =
      Object.keys(site.mappings).length > 0 || Object.keys(site.not_deployed_at_site).length > 0
    reviewed.set(siteId, isReviewed)
    const topology = topologies[siteId]
    if (isReviewed && topology) {
      verdicts.set(
        siteId,
        wiringAtSite(links.desired, site, topology, matrixIds).map((w) => w.verdict),
      )
    }
  }

  return links.desired.map((link, index) => {
    const a = byId.get(link.from)
    const b = byId.get(link.to)
    const risks = [a?.risk, b?.risk].filter(Boolean) as RiskLevel[]
    const risk = risks.sort((x, y) => (RISK_RANK[y] ?? 0) - (RISK_RANK[x] ?? 0))[0] ?? 'low'
    const joined: number[] = []
    const touched: number[] = []
    carriers.forEach((ids, i) => {
      const hasFrom = ids.has(link.from)
      const hasTo = ids.has(link.to)
      if (hasFrom && hasTo) joined.push(i)
      if (hasFrom || hasTo) touched.push(i)
    })
    const sites: PlannedSite[] = Object.entries(coverage.sites).map(([siteId, site]) =>
      reviewed.get(siteId)
        ? { siteId, label: site.label, reviewed: true, verdict: verdicts.get(siteId)?.[index] ?? null }
        : { siteId, label: site.label, reviewed: false },
    )
    return {
      link,
      confirmedOwners: Number(!!a?.confirmed) + Number(!!b?.confirmed),
      crossesOrg: !!a && !!b && a.owner_group_id !== b.owner_group_id,
      risk,
      requirementsJoined: joined,
      requirementsTouched: touched,
      hopsToday: hopsBetween(links.current, link.from, link.to),
      shortfallEnds: [a, b].filter((s): s is System => !!s && isShortfall(s)).map((s) => s.id),
      sites,
    }
  })
}
