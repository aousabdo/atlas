import { Fragment, useId, useMemo, useState } from 'react'

import { RiskPill } from '../../components/SeverityPill'
import { plannedIntegrations, type PlannedIntegration, type PlannedSite } from '../../lib/planning'
import { UNCHECKED_REASON_TEXT, type WiringVerdict } from '../../lib/wiring'
import type {
  CoverageMatrix, LinkSet, Requirement, SiteId, System, Topology,
} from '../../types/atlas'

type SortKey = 'owners' | 'groups' | 'risk' | 'requirements' | 'today' | 'sites'

const RISK_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }

/** True when a site's drawing can say something about the link. */
const checkable = (site: PlannedSite) =>
  site.reviewed && site.verdict !== null && site.verdict.kind !== 'unchecked'

/**
 * One fact per key, larger first. Ties keep the order the file gives, so a
 * sort never invents a ranking between rows the chosen fact does not separate.
 */
const SORT: Record<SortKey, (row: PlannedIntegration) => number> = {
  owners: (row) => row.confirmedOwners,
  groups: (row) => Number(row.crossesOrg),
  risk: (row) => RISK_RANK[row.risk] ?? 0,
  requirements: (row) => row.requirementsJoined.length * 1000 + row.requirementsTouched.length,
  // No path today first: those are the links that would join separate groups.
  today: (row) => (row.hopsToday === null ? Number.MAX_SAFE_INTEGER : -row.hopsToday),
  sites: (row) => row.sites.filter(checkable).length,
}

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'owners', label: 'Owners' },
  { key: 'groups', label: 'Owner groups' },
  { key: 'risk', label: 'Risk' },
  { key: 'requirements', label: 'Requirements' },
  { key: 'today', label: 'Today' },
  { key: 'sites', label: 'Sites' },
]

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** Whole clauses, which read better with a comma before the last. */
function clauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

export interface PlannedIntegrationsProps {
  systems: System[]
  links: LinkSet
  requirements: Requirement[]
  coverage: CoverageMatrix
  topologies: Record<SiteId, Topology>
  filterActive: boolean
  matchedIds: ReadonlySet<string>
}

/**
 * What to build next, as facts rather than a ranking.
 *
 * Every planned integration, with the facts that bear on building it: owners
 * confirmed, owner groups crossed, risk, requirements joined or touched,
 * whether the two can already reach each other, and what each site's drawing
 * says. There is no score and no build order. Weighing those facts against
 * each other is a judgement for the people deciding, and a weighted total
 * would present a guess as a finding. The table sorts by one fact at a time.
 */
export function PlannedIntegrations({
  systems,
  links,
  requirements,
  coverage,
  topologies,
  filterActive,
  matchedIds,
}: PlannedIntegrationsProps) {
  const headingId = useId()
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const rows = useMemo(
    () => plannedIntegrations({ systems, links, requirements, coverage, topologies }),
    [systems, links, requirements, coverage, topologies],
  )
  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const key = SORT[sortKey]
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => key(b.row) - key(a.row) || a.index - b.index)
      .map(({ row }) => row)
  }, [rows, sortKey])

  const names = useMemo(() => new Map(systems.map((s) => [s.id, s])), [systems])
  const nameOf = (id: string) => names.get(id)?.name ?? id
  const groupOf = (id: string) => names.get(id)?.owner_group ?? 'unknown group'
  const deviceLabel = (siteId: SiteId, id: string) =>
    topologies[siteId]?.devices.find((d) => d.id === id)?.label ?? id
  const keyOf = (row: PlannedIntegration) => `${row.link.from}|${row.link.to}`
  const pair = (row: PlannedIntegration) => `${nameOf(row.link.from)} – ${nameOf(row.link.to)}`

  if (rows.length === 0) {
    return (
      <section aria-labelledby={headingId} className="rounded border border-line bg-surface p-4">
        <h2 id={headingId} className="text-sm font-semibold tracking-wide text-ink">
          What to build next
        </h2>
        <p className="mt-2 text-xs text-muted">
          The bundle records no planned integrations, so there is nothing to compare.
        </p>
      </section>
    )
  }

  // The summary: plain counts, each checkable by sorting the column it names.
  const n = rows.length
  const both = rows.filter((r) => r.confirmedOwners === 2).length
  const neither = rows.filter((r) => r.confirmedOwners === 0).length
  const crosses = rows.filter((r) => r.crossesOrg).length
  const joins = rows.filter((r) => r.requirementsJoined.length > 0).length
  const untouched = rows.filter((r) => r.requirementsTouched.length === 0).length
  const separate = rows.filter((r) => r.hopsToday === null).length
  const facts = [
    `${n} planned ${plural(n, 'integration', 'integrations')}.`,
    `${both} ${plural(both, 'has', 'have')} both owners confirmed${
      neither ? ` and ${neither} ${plural(neither, 'has', 'have')} neither` : ''
    }.`,
    `${crosses} ${plural(crosses, 'crosses', 'cross')} from one owner group to another.`,
    `${joins} would join two systems a requirement was split across, and ${untouched} ${plural(
      untouched, 'touches', 'touch',
    )} no requirement at either end.`,
    `${separate} would join systems with no path between them through today's integrations.`,
  ]

  const siteIds = Object.keys(coverage.sites)
  const anyCheckable = rows.some((r) => r.sites.some(checkable))
  const siteClauses = siteIds.map((siteId) => {
    const label = coverage.sites[siteId]!.label
    const at = rows.map((r) => r.sites.find((s) => s.siteId === siteId)!)
    if (at.every((s) => !s.reviewed)) return `${label} has not been reviewed`
    if (at.some((s) => s.reviewed && s.verdict === null)) {
      return `the drawing for ${label} did not load`
    }
    const absent = at.filter(
      (s) =>
        s.reviewed &&
        s.verdict?.kind === 'unchecked' &&
        s.verdict.reasons.some((reason) => reason.reason === 'checked-absent'),
    ).length
    if (absent === n) return `at ${label} every one has an end checked absent`
    const counts = new Map<string, number>()
    for (const s of at) {
      if (!s.reviewed || !s.verdict) continue
      counts.set(s.verdict.kind, (counts.get(s.verdict.kind) ?? 0) + 1)
    }
    const words: Record<string, string> = {
      wired: 'wired',
      'co-hosted': 'on a shared device',
      'logical-only': 'joined only by VLAN',
      'no-path': 'with no path drawn',
      unchecked: 'not checkable there',
    }
    return `at ${label} ${listOf([...counts].map(([kind, count]) => `${count} ${words[kind]}`))}`
  })

  const verdictShort = (site: PlannedSite): string => {
    if (!site.reviewed) return 'not reviewed'
    if (!site.verdict) return 'drawing not loaded'
    switch (site.verdict.kind) {
      case 'wired':
        return 'wired'
      case 'co-hosted':
        return 'shared device'
      case 'logical-only':
        return 'VLAN only'
      case 'no-path':
        return 'no path drawn'
      case 'unchecked': {
        // The strongest reason, so the short form never softens a checked
        // absence into a missing record.
        const reasons = site.verdict.reasons.map((r) => r.reason)
        if (reasons.includes('checked-absent')) return 'an end checked absent'
        if (reasons.includes('software-only')) return 'an end software only'
        if (reasons.includes('not-in-drawing')) return 'an end not on the drawing'
        return 'an end not recorded'
      }
    }
  }

  const verdictLong = (siteId: SiteId, verdict: WiringVerdict): string => {
    switch (verdict.kind) {
      case 'wired': {
        const span = `${verdict.hops} ${plural(verdict.hops, 'hop', 'hops')}`
        return verdict.cutDeviceIds.length
          ? `wired, ${span}, breaks if any one of ${verdict.cutDeviceIds.length} ${plural(verdict.cutDeviceIds.length, 'device fails', 'devices fails')}`
          : verdict.singleCable
            ? `wired, ${span}, a single cable with no second way round`
            : `wired, ${span}, with a second way round`
      }
      case 'co-hosted':
        return `both run on ${listOf(verdict.sharedDeviceIds.map((id) => deviceLabel(siteId, id)))}`
      case 'logical-only':
        return 'joined only by VLAN, no cable or radio path drawn'
      case 'no-path':
        return 'nothing on the drawing joins their hardware'
      case 'unchecked':
        return listOf(
          verdict.reasons.map((r) => `${nameOf(r.systemId)} ${UNCHECKED_REASON_TEXT[r.reason]}`),
        )
    }
  }

  const requirementText = (i: number) => requirements[i]?.orig ?? `requirement ${i + 1}`

  return (
    <section
      aria-labelledby={headingId}
      data-filtered={filterActive ? 'true' : 'false'}
      className="rounded border border-line bg-surface p-4"
    >
      <h2 id={headingId} className="text-sm font-semibold tracking-wide text-ink">
        What to build next
      </h2>
      <p className="mt-1 text-xs text-muted">
        The planned integrations, with the facts that bear on building each one. There
        is no score and no build order: weighing these facts is a judgement for the
        people deciding. Sort by one fact at a time, and open a row for what is behind
        it.
      </p>
      <p className="mt-2 text-sm text-ink">{facts.join(' ')}</p>
      {!anyCheckable && (
        <p className="mt-1 text-xs text-muted">
          None can be checked against a site drawing yet: {clauses(siteClauses)}.
        </p>
      )}
      {anyCheckable && (
        <p className="mt-1 text-xs text-muted">Against the drawings: {clauses(siteClauses)}.</p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Planned integrations, one row each, with the facts behind each
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted-2">
              <th scope="col" className="px-2 py-2">
                {sortKey ? (
                  <button
                    type="button"
                    onClick={() => setSortKey(null)}
                    className="rounded uppercase hover:text-ink"
                  >
                    Integration (as listed)
                  </button>
                ) : (
                  'Integration'
                )}
              </th>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sortKey === column.key ? 'descending' : 'none'}
                  className="px-2 py-2"
                >
                  <button
                    type="button"
                    onClick={() => setSortKey(sortKey === column.key ? null : column.key)}
                    className={`rounded uppercase hover:text-ink ${sortKey === column.key ? 'text-ink' : ''}`}
                  >
                    {column.label}
                    {sortKey === column.key ? ' ↓' : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const key = keyOf(row)
              const open = openKey === key
              const dimmed =
                filterActive && !matchedIds.has(row.link.from) && !matchedIds.has(row.link.to)
              const joined = row.requirementsJoined.length
              const touched = row.requirementsTouched.length
              const touchedOnly = row.requirementsTouched.filter(
                (i) => !row.requirementsJoined.includes(i),
              )
              return (
                <Fragment key={key}>
                  <tr
                    data-link={key}
                    data-dimmed={dimmed ? 'true' : 'false'}
                    className={`border-b border-line align-top ${dimmed ? 'opacity-20' : ''}`}
                  >
                    <th scope="row" className="px-2 py-2 text-left font-normal">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenKey(open ? null : key)}
                        className="rounded text-left text-ink hover:text-accent-ink"
                      >
                        {pair(row)}
                      </button>
                      {row.shortfallEnds.map((id) => (
                        <span key={id} className="block text-xs text-risk-medium-ink">
                          {nameOf(id)} is a shortfall row, not a system yet.
                        </span>
                      ))}
                    </th>
                    <td className="tabular px-2 py-2 text-muted">{row.confirmedOwners} of 2 confirmed</td>
                    <td className="px-2 py-2 text-muted">
                      {row.crossesOrg
                        ? `${groupOf(row.link.from)} → ${groupOf(row.link.to)}`
                        : groupOf(row.link.from)}
                    </td>
                    <td className="px-2 py-2">
                      <RiskPill risk={row.risk} />
                    </td>
                    <td className="px-2 py-2 text-muted">
                      {joined
                        ? `joins ${joined}${touched > joined ? `, touches ${touched - joined}` : ''}`
                        : touched
                          ? `touches ${touched}`
                          : 'none'}
                    </td>
                    <td className="px-2 py-2 text-muted">
                      {row.hopsToday === null ? 'no path today' : `${row.hopsToday} hops away`}
                    </td>
                    <td className="px-2 py-2 text-muted">
                      {row.sites.map((site) => `${site.label}: ${verdictShort(site)}`).join('; ')}
                    </td>
                  </tr>
                  {open && (
                    <tr aria-label={`${pair(row)} in detail`} className="border-b border-line bg-surface-2">
                      <td colSpan={COLUMNS.length + 1} className="px-3 py-2 text-xs text-muted">
                        {joined > 0 && (
                          <p>Joins: {row.requirementsJoined.map(requirementText).join('; ')}</p>
                        )}
                        {touchedOnly.length > 0 && (
                          <p>Touches: {touchedOnly.map(requirementText).join('; ')}</p>
                        )}
                        {touched === 0 && <p>No requirement names either end.</p>}
                        <p className="mt-1">
                          Today:{' '}
                          {row.hopsToday === null
                            ? 'no path between them through the integrations recorded today.'
                            : `already reachable in ${row.hopsToday} hops through the integrations recorded today.`}
                        </p>
                        {row.sites.map((site) => (
                          <p key={site.siteId} className="mt-1">
                            {site.label}:{' '}
                            {!site.reviewed
                              ? 'not reviewed'
                              : !site.verdict
                                ? 'mapped, but its drawing did not load'
                                : verdictLong(site.siteId, site.verdict)}
                          </p>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
