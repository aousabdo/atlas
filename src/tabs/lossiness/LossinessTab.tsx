import { useState, type ReactNode } from 'react'

import { EmptyState } from '../../components/EmptyState'
import { LoadFailed } from '../../components/LoadFailed'
import { ProvenanceChip } from '../../components/ProvenanceChip'
import { useAtlas } from '../../data/useAtlas'
import { compositeIndex } from '../../lib/lossiness'
import type {
  LossinessReport,
  Project,
  SnapshotMetrics,
  System,
} from '../../types/atlas'
import { AttritionFlow } from './AttritionFlow'
import { DimensionDrawer } from './DimensionDrawer'
import { Scorecard } from './Scorecard'
import { TopGaps } from './TopGaps'
import { TrendView } from './TrendView'

interface LossinessData {
  report: LossinessReport
  systems: System[]
  snapshots: SnapshotMetrics[]
  project: Project
}

/**
 * What the architecture loses between the requirement, the system and the
 * hardware. New in this rebuild, and the reason the tool is worth rebuilding:
 * the old one could show what is known but had nowhere to say what is missing.
 */
export function LossinessTab() {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [showComposite, setShowComposite] = useState(false)

  const state = useAtlas<LossinessData>(async (provider) => {
    const [report, systems, snapshots, project] = await Promise.all([
      provider.getLossiness(),
      provider.getSystems(),
      provider.getSnapshots(),
      provider.getProject(),
    ])
    return { report, systems, snapshots, project }
  })

  if (state.status === 'loading') {
    return (
      <Shell>
        <p className="mt-6 text-sm text-muted">Loading the lossiness report.</p>
      </Shell>
    )
  }

  if (state.status === 'failed') {
    return (
      <Shell>
        <div className="mt-6">
          <LoadFailed
            resource="the lossiness report"
            message={state.error.message}
            onRetry={state.retry}
          />
        </div>
      </Shell>
    )
  }

  const { report, systems, snapshots, project } = state.data
  const names = new Map(systems.map((system) => [system.id, system.name]))
  const sites = new Map(project.sites.map((site) => [site.id, site.label]))
  const systemName = (id: string) => names.get(id) ?? id
  const siteLabel = (id: string) => sites.get(id) ?? id
  const open = report.dimensions.find((d) => d.key === openKey)

  if (report.dimensions.length === 0) {
    return (
      <Shell>
        <div className="mt-6">
          <EmptyState
            title="No dimensions in this report"
            detail="The bundle loaded and carries an empty lossiness report. That is a build problem, not a clean bill of health."
          />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="mt-6">
        <Scorecard dimensions={report.dimensions} onOpen={setOpenKey} />
      </div>

      <section aria-label="Composite indicator" className="mt-4">
        <button
          type="button"
          onClick={() => setShowComposite((shown) => !shown)}
          className="rounded border border-line px-3 py-1 text-sm text-muted"
        >
          {showComposite ? 'Hide composite indicator' : 'Show composite indicator'}
        </button>
        {showComposite && (
          <div className="mt-3 rounded border border-line bg-surface p-4">
            <h3 className="text-sm font-semibold text-ink">Lossiness Index</h3>
            <p className="tabular mt-2 text-3xl font-semibold text-ink">
              {compositeIndex(report)}
              <ProvenanceChip source="inferred" />
            </p>
            <p className="mt-2 text-sm text-ink">
              A management indicator, not a formal metric.
            </p>
            <p className="mt-1 text-xs text-muted-2">
              It averages the four percentage dimensions and ignores the three
              counts, which have no denominator that would make a percentage
              honest. It is hidden by default because one number invites exactly
              the false precision this tab exists to prevent. Act on the cards
              above, not on this.
            </p>
          </div>
        )}
      </section>

      <AttritionFlow
        dimensions={report.dimensions}
        systemName={(id) => names.get(id) ?? id}
      />
      <TrendView snapshots={snapshots} />
      <TopGaps gaps={report.top_gaps} />

      {open && (
        <DimensionDrawer
          dimension={open}
          systemName={systemName}
          siteLabel={siteLabel}
          onClose={() => setOpenKey(null)}
        />
      )}
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <section>
      <h1 className="text-xl font-semibold text-ink">Lossiness</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Seven measures of what falls out between the requirement, the system and
        the hardware. Every figure here opens onto the entities behind it,
        because a gap you cannot name is a gap nobody can close.
      </p>
      {children}
    </section>
  )
}
