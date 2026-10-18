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
 *   - whether a chain of integrations recorded today already joins the two,
 *     and through which systems. A chain is a path on paper: it says nothing
 *     about whether data passes along it;
 *   - per site, whether both ends have hardware there and how the drawing
 *     joins them, by the same check as the Network tab.
 *
 * A planned link already recorded as current is built, and a link from a
 * system to itself is not an integration. Both are set aside, by the same
 * rules as the integration gap matrix, and counted by setAsideLinks.
 */
import { isShortfall, matrixIdSet } from './coverage'
import { carriedNames } from './requirements'
import { wiringAtSite, type WiringVerdict } from './wiring'
import type {
  CoverageMatrix, Link, LinkSet, Requirement, RiskLevel, SiteId, System, SystemId, Topology,
} from '../types/atlas'

export type PlannedSite =
  | { siteId: SiteId; label: string; reviewed: false }
  /** verdict is null when the site has mappings but the bundle has no drawing for it. */
  | { siteId: SiteId; label: string; reviewed: true; verdict: WiringVerdict | null }

export interface PlannedIntegration {
  /** Position in links.desired: the row's identity, since a pair may repeat. */
  index: number
  link: Link
  /** 0, 1 or 2. */
  confirmedOwners: number
  crossesOrg: boolean
  risk: RiskLevel
  /** Indexes into the requirements: both ends carry it. */
  requirementsJoined: number[]
  /** Indexes into the requirements: at least one end carries it. */
  requirementsTouched: number[]
  /** Links in the shortest chain of today's recorded integrations; null when there is none. */
  hopsToday: number | null
  /** That chain, end to end, as system ids; null when there is none. */
  chainToday: SystemId[] | null
  /** Ends filed as shortfall rows: the system does not exist yet. */
  shortfallEnds: SystemId[]
  sites: PlannedSite[]
}

const RISK_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }

const pairKey = (a: SystemId, b: SystemId) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Planned links that are not planned work: already built, or a system joined to itself. */
export function setAsideLinks(links: LinkSet): { alreadyCurrent: Link[]; selfJoined: Link[] } {
  const current = new Set(links.current.map((l) => pairKey(l.from, l.to)))
  return {
    alreadyCurrent: links.desired.filter(
      (l) => l.from !== l.to && current.has(pairKey(l.from, l.to)),
    ),
    selfJoined: links.desired.filter((l) => l.from === l.to),
  }
}

function chainBetween(links: readonly Link[], from: SystemId, to: SystemId): SystemId[] | null {
  const adj = new Map<SystemId, SystemId[]>()
  for (const { from: a, to: b } of links) {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  const previous = new Map<SystemId, SystemId | null>([[from, null]])
  const queue = [from]
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head]!
    if (at === to) {
      const chain = [at]
      for (let step = previous.get(at); step; step = previous.get(step)) chain.unshift(step)
      return chain
    }
    for (const next of adj.get(at) ?? []) {
      if (previous.has(next)) continue
      previous.set(next, at)
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
    (r) => new Set(carriedNames(r).map((name) => idByName.get(name)).filter(Boolean) as SystemId[]),
  )

  const current = new Set(links.current.map((l) => pairKey(l.from, l.to)))
  const planned = links.desired
    .map((link, index) => ({ link, index }))
    .filter(({ link }) => link.from !== link.to && !current.has(pairKey(link.from, link.to)))
  const plannedLinks = planned.map(({ link }) => link)

  // Every site the bundle knows of: a device map entry, a drawing, or both.
  // A drawing with no device map entry is a site nobody has reviewed, and is
  // named as one rather than left out.
  const siteLabels = new Map<SiteId, string>()
  for (const [siteId, site] of Object.entries(coverage.sites)) siteLabels.set(siteId, site.label)
  for (const [siteId, topology] of Object.entries(topologies)) {
    if (!siteLabels.has(siteId)) siteLabels.set(siteId, topology.meta.label || siteId)
  }

  // One pass per site over every planned link, by the Network tab's check.
  const verdicts = new Map<SiteId, WiringVerdict[]>()
  const reviewed = new Map<SiteId, boolean>()
  for (const siteId of siteLabels.keys()) {
    const site = coverage.sites[siteId]
    const isReviewed =
      !!site &&
      (Object.keys(site.mappings).length > 0 || Object.keys(site.not_deployed_at_site).length > 0)
    reviewed.set(siteId, isReviewed)
    const topology = topologies[siteId]
    if (site && isReviewed && topology) {
      verdicts.set(
        siteId,
        wiringAtSite(plannedLinks, site, topology, matrixIds).map((w) => w.verdict),
      )
    }
  }

  return planned.map(({ link, index }, row) => {
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
    const sites: PlannedSite[] = [...siteLabels].map(([siteId, label]) =>
      reviewed.get(siteId)
        ? { siteId, label, reviewed: true, verdict: verdicts.get(siteId)?.[row] ?? null }
        : { siteId, label, reviewed: false },
    )
    const chain = chainBetween(links.current, link.from, link.to)
    return {
      index,
      link,
      confirmedOwners: Number(!!a?.confirmed) + Number(!!b?.confirmed),
      crossesOrg: !!a && !!b && a.owner_group_id !== b.owner_group_id,
      risk,
      requirementsJoined: joined,
      requirementsTouched: touched,
      hopsToday: chain ? chain.length - 1 : null,
      chainToday: chain,
      shortfallEnds: [a, b].filter((s): s is System => !!s && isShortfall(s)).map((s) => s.id),
      sites,
    }
  })
}
