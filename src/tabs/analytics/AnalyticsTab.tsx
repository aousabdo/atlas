import { useMemo, useState } from 'react'

import { EmptyState } from '../../components/EmptyState'
import { LoadFailed } from '../../components/LoadFailed'
import type { AtlasDataProvider } from '../../data/provider'
import { useAtlas } from '../../data/useAtlas'
import type {
  CoverageMatrix, LinkSet, Project, Requirement, System,
} from '../../types/atlas'
import { CoveragePanel } from './CoveragePanel'
import { IntegrationMatrix } from './IntegrationMatrix'
import { OwnershipBars } from './OwnershipBars'
import { RequirementsSankey } from './RequirementsSankey'
import { RiskHeatmap } from './RiskHeatmap'
import { RiskWeightedCoverage } from './RiskWeightedCoverage'

/**
 * Owner group display order, carried from the tool being replaced so the rows
 * of the heatmap land where a reader of the old deck expects them. A group the
 * ingest invents later still renders; it sorts to the end rather than vanishing.
 */
const GROUP_ORDER = ['dhs-st', 'cbp', 'otherdhs', 'dhshq', 'dod', 'ext']

interface AnalyticsData {
  systems: System[]
  requirements: Requirement[]
  coverage: CoverageMatrix
  project: Project
  links: LinkSet
}

function load(provider: AtlasDataProvider): Promise<AnalyticsData> {
  return Promise.all([
    provider.getSystems(),
    provider.getRequirements(),
    provider.getCoverage(),
    provider.getProject(),
    provider.getLinks(),
  ]).then(([systems, requirements, coverage, project, links]) => ({
    systems,
    requirements,
    coverage,
    project,
    links,
  }))
}

export interface OwnerGroupSlice {
  id: string
  label: string
  systems: System[]
}

/** Exported so the integration matrix orders its axes the same way this tab
 *  orders its rows, from one definition rather than two. */
export function ownerGroups(systems: System[]): OwnerGroupSlice[] {
  const byId = new Map<string, OwnerGroupSlice>()
  for (const system of systems) {
    const slice = byId.get(system.owner_group_id) ?? {
      id: system.owner_group_id,
      label: system.owner_group,
      systems: [],
    }
    slice.systems.push(system)
    byId.set(slice.id, slice)
  }
  const rank = (id: string) => {
    const at = GROUP_ORDER.indexOf(id)
    return at < 0 ? GROUP_ORDER.length : at
  }
  return [...byId.values()].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label),
  )
}

const FIELDS = (s: System) => [s.name, s.id, s.owner_group, s.risk, s.category]

/** Stable identity while loading, so the memos below do not thrash. */
const NO_SYSTEMS: System[] = []

export function AnalyticsTab() {
  const state = useAtlas(load)
  const [query, setQuery] = useState('')

  const needle = query.trim().toLowerCase()
  const filterActive = needle.length > 0
  const systems = state.status === 'ready' ? state.data.systems : NO_SYSTEMS

  const groups = useMemo(() => ownerGroups(systems), [systems])
  const matchedIds = useMemo(
    () =>
      new Set(
        systems
          .filter(
            (s) =>
              !filterActive ||
              FIELDS(s).some((v) => v.toLowerCase().includes(needle)),
          )
          .map((s) => s.id),
      ),
    [systems, filterActive, needle],
  )
  const matchedGroups = useMemo(
    () =>
      new Set(
        groups
          .filter(
            (g) =>
              !filterActive ||
              g.label.toLowerCase().includes(needle) ||
              g.systems.some((s) => matchedIds.has(s.id)),
          )
          .map((g) => g.id),
      ),
    [groups, filterActive, needle, matchedIds],
  )

  return (
    <section>
      <h1 className="text-xl font-semibold text-ink">Analytics</h1>
      {state.status === 'ready' && (
        <p className="mt-1 text-sm text-muted">
          <span className="tabular">{state.data.systems.length}</span> systems across{' '}
          <span className="tabular">{groups.length}</span> owner organizations, from{' '}
          {state.data.project.source_label}.
        </p>
      )}

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Filter systems, groups and risk levels"
        placeholder="Filter by system, owner group, or risk level"
        className="mt-4 w-full max-w-md rounded border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted-3"
      />

      {state.status === 'loading' && (
        <p className="mt-6 text-sm text-muted">Loading analytics…</p>
      )}

      {state.status === 'failed' && (
        <div className="mt-6">
          <LoadFailed
            resource="the analytics bundles"
            message={state.error.message}
            onRetry={state.retry}
          />
        </div>
      )}

      {state.status === 'ready' && state.data.systems.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="No systems in this bundle"
            detail="The bundle loaded and contains no systems, so there is nothing to chart."
          />
        </div>
      )}

      {state.status === 'ready' && state.data.systems.length > 0 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {/* First, because it is the headline the rest of the page qualifies. */}
          <div className="min-w-0 lg:col-span-2">
            <RiskWeightedCoverage
              systems={state.data.systems}
              coverage={state.data.coverage}
              filterActive={filterActive}
              matchedIds={matchedIds}
            />
          </div>
          <RiskHeatmap
            groups={groups}
            filterActive={filterActive}
            matchedIds={matchedIds}
            matchedGroups={matchedGroups}
          />
          <OwnershipBars
            groups={groups}
            filterActive={filterActive}
            matchedGroups={matchedGroups}
          />
          <div className="lg:col-span-2">
            <RequirementsSankey
              requirements={state.data.requirements}
              filterActive={filterActive}
              query={needle}
            />
          </div>
          <div className="lg:col-span-2">
            <CoveragePanel
              coverage={state.data.coverage}
              systems={state.data.systems}
              sites={state.data.project.sites}
              filterActive={filterActive}
              matchedIds={matchedIds}
              query={needle}
            />
          </div>
          {/* Last, and min-w-0 so the widest card cannot stretch the grid
              column and take the page sideways with it. */}
          <div className="min-w-0 lg:col-span-2">
            <IntegrationMatrix
              groups={groups}
              links={state.data.links}
              filterActive={filterActive}
              matchedIds={matchedIds}
            />
          </div>
        </div>
      )}
    </section>
  )
}
