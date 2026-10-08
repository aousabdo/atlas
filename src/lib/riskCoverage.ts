/**
 * Coverage, split by the risk band of the system it covers.
 *
 * "10 of 32 systems realized (31%)" prices a high-risk system and a low-risk
 * one identically, and that distinction is the whole reason a reviewer opens
 * this tab. The flat figure can sit at 31% while every system carrying real
 * risk is unconfirmed, and nothing on the page would say so.
 *
 * Nothing here re-decides what "realized" means. The predicate lives in
 * src/lib/coverage.ts and this module calls it, because the cost of a second
 * definition was already paid once: three tabs printed three answers to one
 * question. This only regroups the same verdicts by a field the systems
 * already carry.
 *
 * The bands are read off the data. A bundle with no low-risk system yields two
 * bands, and a bundle that invents a fourth grade yields four; neither the
 * band names nor their sizes are written down anywhere in this file.
 */
import type {
  CoverageMatrix, SiteId, System, SystemId,
} from '../types/atlas'
import { isRealizedMapping, isShortfall, matrixIdSet, percentOf } from './coverage'

/**
 * Reading order, not membership. Severity is not alphabetical and not the
 * order the systems happen to arrive in, so the display order is stated; which
 * bands exist is still entirely the data's answer. A band this list has never
 * heard of sorts after the ones it has, rather than being dropped.
 */
const SEVERITY_ORDER = ['high', 'medium', 'low']

function rank(risk: string): number {
  const at = SEVERITY_ORDER.indexOf(risk)
  return at < 0 ? SEVERITY_ORDER.length : at
}

function titleCase(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

const byName = (a: System, b: System) => a.name.localeCompare(b.name)

/**
 * Which sites realize each system.
 *
 * A system absent from the map is realized nowhere. The site list is the
 * evidence behind "confirmed deployed": a count with no site names attached is
 * a claim, and this is what lets the panel show the sites next to the number.
 */
export function realizationSitesBySystem(
  coverage: CoverageMatrix,
  matrixIds: ReadonlySet<SystemId>,
): Map<SystemId, SiteId[]> {
  const sites = new Map<SystemId, SiteId[]>()
  for (const [siteId, site] of Object.entries(coverage.sites)) {
    for (const [id, mapping] of Object.entries(site.mappings)) {
      if (!isRealizedMapping(id, mapping, matrixIds)) continue
      sites.set(id, [...(sites.get(id) ?? []), siteId])
    }
  }
  // Sorted rather than in bundle order, so two runs cannot print two orders.
  for (const list of sites.values()) list.sort()
  return sites
}

/** One realized system and the sites that make it realized. */
export interface RealizedSystem {
  system: System
  sites: SiteId[]
}

export interface RiskBandCoverage {
  /** The band's value as the data spells it, e.g. `high`. */
  risk: string
  /** The same value for display, e.g. `High`. */
  label: string
  total: number
  /** Realized at one site or more. Sorted by name. */
  realized: RealizedSystem[]
  /** Realized nowhere. Sorted by name. Disjoint from `realized`. */
  unrealized: System[]
  /** Share of THIS band, unrounded. Never a share of the whole estate. */
  pct: number
}

export function riskBandCoverage(
  systems: readonly System[],
  coverage: CoverageMatrix,
): RiskBandCoverage[] {
  const sites = realizationSitesBySystem(coverage, matrixIdSet(systems))

  const members = new Map<string, System[]>()
  for (const system of systems) {
    // A shortfall is a gap, not a system that could be deployed anywhere.
    if (isShortfall(system)) continue
    const band = String(system.risk)
    members.set(band, [...(members.get(band) ?? []), system])
  }

  return [...members.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([risk, band]) => {
      const realized = band
        .filter((s) => sites.has(s.id))
        .sort(byName)
        .map((system) => ({ system, sites: sites.get(system.id) as SiteId[] }))
      return {
        risk,
        label: titleCase(risk),
        total: band.length,
        realized,
        unrealized: band.filter((s) => !sites.has(s.id)).sort(byName),
        pct: percentOf(realized.length, band.length),
      }
    })
}

/**
 * The headline, as a sentence.
 *
 * Written here rather than assembled in JSX so the wording is under test and
 * so the panel and any export cannot drift into two phrasings of one figure.
 */
export function bandSentence(band: RiskBandCoverage): string {
  const confirmed = band.realized.length
  const systems = band.total === 1 ? 'system' : 'systems'
  const verb = confirmed === 1 ? 'is' : 'are'
  return `Of ${band.total} ${band.risk}-risk ${systems}, ${confirmed} ${verb} confirmed deployed at any site.`
}
