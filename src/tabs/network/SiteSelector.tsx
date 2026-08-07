import type { SiteId, SiteSummary } from '../../types/atlas'

export interface SiteSelectorProps {
  sites: SiteSummary[]
  activeId: SiteId
  onSelect: (siteId: SiteId) => void
}

/**
 * Counts come from the project index, which is the same file the site bundles
 * are written from, so the button cannot advertise a size the topology does
 * not have.
 */
export function SiteSelector({ sites, activeId, onSelect }: SiteSelectorProps) {
  return (
    <div role="group" aria-label="Site" className="flex flex-wrap gap-2">
      {sites.map((site) => {
        const active = site.id === activeId
        return (
          <button
            key={site.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(site.id)}
            className={[
              'rounded border px-3 py-2 text-left',
              active
                ? 'border-accent bg-surface-2 text-ink'
                : 'border-line bg-surface text-muted hover:text-ink',
            ].join(' ')}
          >
            <span className="block text-sm font-medium">{site.label}</span>
            <span className="tabular block text-xs text-muted-3">
              {site.device_count} nodes · {site.edge_count} edges
            </span>
          </button>
        )
      })}
    </div>
  )
}
