import { useMemo } from 'react'

import { EmptyState } from '../../components/EmptyState'
import { ProvenanceChip } from '../../components/ProvenanceChip'
import { RiskPill } from '../../components/SeverityPill'
import type { CoverageMatrix, SiteId, System, SystemId } from '../../types/atlas'

interface SiteIndex {
  /** Site ids where the system has at least one device. */
  mapped: Record<SystemId, SiteId[]>
  /** Site ids where the system was checked and found genuinely absent. */
  absent: Record<SystemId, SiteId[]>
}

function indexSites(coverage: CoverageMatrix): SiteIndex {
  const mapped: Record<SystemId, SiteId[]> = {}
  const absent: Record<SystemId, SiteId[]> = {}
  for (const [siteId, site] of Object.entries(coverage.sites)) {
    for (const [systemId, mapping] of Object.entries(site.mappings)) {
      if (mapping.devices.length > 0) (mapped[systemId] ??= []).push(siteId)
    }
    for (const systemId of Object.keys(site.not_deployed_at_site)) {
      (absent[systemId] ??= []).push(siteId)
    }
  }
  return { mapped, absent }
}

function statusLabel(system: System): string {
  return system.confirmed ? 'confirmed' : 'soft'
}

export function SystemsTable({
  coverage,
  query,
  systems,
}: {
  coverage: CoverageMatrix
  query: string
  systems: System[]
}) {
  const index = useMemo(() => indexSites(coverage), [coverage])
  const needle = query.trim().toLowerCase()

  const rows = useMemo(
    () =>
      systems.filter((system) => {
        if (!needle) return true
        const haystack = [
          system.name,
          system.id,
          system.owner_group,
          system.risk,
          statusLabel(system),
          ...(index.mapped[system.id] ?? []),
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(needle)
      }),
    [systems, needle, index],
  )

  if (systems.length === 0) {
    return (
      <EmptyState
        title="No systems in this bundle"
        detail="The source workbook produced no system rows at all. That is a data problem, not an empty filter."
      />
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No systems match the filter"
        detail={`Nothing in the ${systems.length} matrix systems matches "${query.trim()}". Clear the filter to see them all.`}
      />
    )
  }

  return (
    <>
      <p className="text-xs text-muted-3">
        <span className="tabular">{rows.length}</span> of{' '}
        <span className="tabular">{systems.length}</span> matrix systems. Mapped at lists
        the sites where the curated map gives the system at least one device.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table aria-label="Systems" className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-muted-3">
              <th scope="col" className="py-2 pr-4">
                Name
              </th>
              <th scope="col" className="py-2 pr-4">
                Owner group
              </th>
              <th scope="col" className="py-2 pr-4">
                Risk
              </th>
              <th scope="col" className="py-2 pr-4">
                Status
              </th>
              <th scope="col" className="py-2">
                Mapped at
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((system) => {
              const mapped = index.mapped[system.id] ?? []
              const absent = index.absent[system.id] ?? []
              return (
                <tr key={system.id} className="border-b border-line align-top">
                  <td className="py-2 pr-4">
                    <span className="font-medium text-ink">{system.name}</span>{' '}
                    <code className="text-xs text-muted-3">{system.id}</code>
                  </td>
                  <td className="py-2 pr-4 text-muted">{system.owner_group}</td>
                  <td className="py-2 pr-4">
                    <RiskPill risk={system.risk} />
                    {/* Only derived risk carries a chip; 'read' on all 32 rows would
                        be noise, and the Confidence section states the split. */}
                    {system.risk_source !== 'explicit' && (
                      <ProvenanceChip source={system.risk_source} />
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {system.confirmed ? (
                      <span className="text-muted-3">confirmed</span>
                    ) : (
                      <span
                        title="Owner assignment awaiting sign-off"
                        className="rounded bg-risk-medium/15 px-2 py-px text-xs font-medium text-risk-medium-ink"
                      >
                        soft
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {mapped.length > 0 ? (
                      mapped.map((siteId) => (
                        <code key={siteId} className="mr-2 text-xs text-accent-ink">
                          {siteId}
                        </code>
                      ))
                    ) : absent.length > 0 ? (
                      <span
                        className="text-muted-3"
                        title={`Checked and recorded as not deployed at: ${absent.join(', ')}`}
                      >
                        checked, not deployed
                      </span>
                    ) : (
                      <span
                        className="text-muted-3"
                        title="No mapping recorded either way. Nobody has looked yet."
                      >
                        not mapped
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
