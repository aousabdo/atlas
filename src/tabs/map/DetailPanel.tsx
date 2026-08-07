import { Link as RouterLink } from 'react-router-dom'

import { ProvenanceChip } from '../../components/ProvenanceChip'
import { RiskPill } from '../../components/SeverityPill'
import type { CoverageMatrix, LinkSet, System, SystemId } from '../../types/atlas'

export interface DetailPanelProps {
  system: System
  links: LinkSet
  coverage: CoverageMatrix
  names: Record<SystemId, string>
  onClose: () => void
}

interface SiteMapping {
  siteId: string
  label: string
  devices: string[]
  note: string
  confidence: string
}

function mappedSites(coverage: CoverageMatrix, systemId: SystemId): SiteMapping[] {
  const found: SiteMapping[] = []
  for (const [siteId, site] of Object.entries(coverage.sites)) {
    const mapping = site.mappings[systemId]
    // A mapping with no devices records that somebody looked, not that the
    // system is realized in hardware, so it is not a mapping for this purpose.
    if (!mapping || mapping.devices.length === 0) continue
    found.push({
      siteId,
      label: site.label,
      devices: mapping.devices,
      note: mapping.note,
      confidence: mapping.confidence,
    })
  }
  return found.sort((a, b) =>
    a.siteId === coverage.default_site ? -1 : b.siteId === coverage.default_site ? 1 : 0,
  )
}

function checkedAbsentAt(coverage: CoverageMatrix, systemId: SystemId): string[] {
  return Object.values(coverage.sites)
    .filter((site) => systemId in site.not_deployed_at_site)
    .map((site) => site.label)
}

function networkHref(siteId: string, devices: string[]) {
  return `/network?site=${siteId}&focus=${devices.join(',')}`
}

export function DetailPanel({ system, links, coverage, names, onClose }: DetailPanelProps) {
  const counterpart = (from: SystemId, to: SystemId) => {
    const other = from === system.id ? to : from
    return names[other] ?? other
  }

  const current = links.current.filter((l) => l.from === system.id || l.to === system.id)
  const desired = links.desired.filter((l) => l.from === system.id || l.to === system.id)

  const sites = mappedSites(coverage, system.id)
  const [primary, ...others] = sites
  const absent = checkedAbsentAt(coverage, system.id)

  return (
    <aside
      role="complementary"
      aria-label="System detail"
      className="rounded border border-line bg-surface p-4"
    >
      <div className="flex items-start gap-2">
        <h2 className="flex-1 text-base font-semibold text-ink">{system.name}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-line px-2 py-px text-xs text-muted hover:text-ink"
        >
          Close
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="flex items-center">
          <RiskPill risk={system.risk} />
          <ProvenanceChip source={system.risk_source} />
        </span>
        <span className="rounded bg-surface-2 px-2 py-px text-xs text-muted">
          {system.owner_group}
        </span>
        {!system.confirmed && (
          <span className="rounded bg-risk-medium/15 px-2 py-px text-xs text-risk-medium-ink">
            Unconfirmed ownership
          </span>
        )}
      </div>

      {system.detail && <p className="mt-3 text-sm text-muted">{system.detail}</p>}

      <h3 className="mt-4 text-sm font-semibold text-ink">Known Integration Links</h3>
      {current.length === 0 ? (
        <p className="mt-1 text-sm text-muted">No integration links recorded.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm text-muted">
          {current.map((link) => (
            <li key={`${link.from}-${link.to}`} className="flex items-baseline gap-2">
              <span className="text-ink">{counterpart(link.from, link.to)}</span>
              <ProvenanceChip source={link.extraction_method} />
            </li>
          ))}
        </ul>
      )}

      {desired.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold text-ink">Planned Interfaces</h3>
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {desired.map((link) => (
              <li key={`${link.from}-${link.to}`}>{counterpart(link.from, link.to)}</li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-4 text-sm font-semibold text-ink">Site Realization</h3>
      {primary ? (
        <div className="mt-1 text-sm text-muted">
          <p>
            {primary.devices.length} device{primary.devices.length === 1 ? '' : 's'} at{' '}
            {primary.label}, confidence {primary.confidence}.
          </p>
          <p className="mt-1 text-xs text-muted-3">{primary.note}</p>
          <RouterLink
            to={networkHref(primary.siteId, primary.devices)}
            className="mt-2 inline-block text-accent-ink underline"
          >
            View in Network
          </RouterLink>
          {others.map((site) => (
            <RouterLink
              key={site.siteId}
              to={networkHref(site.siteId, site.devices)}
              className="mt-2 ml-3 inline-block text-accent-ink underline"
            >
              View at {site.label}
            </RouterLink>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-sm text-muted">
          <p>Not mapped to any site</p>
          {absent.length > 0 && (
            <p className="mt-1 text-xs text-muted-3">
              Checked and recorded as not deployed at {absent.join(', ')}.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
