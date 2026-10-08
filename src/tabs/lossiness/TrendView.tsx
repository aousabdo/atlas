import { EmptyState } from '../../components/EmptyState'
import { formatPercent } from '../../lib/coverage'
import type { SnapshotMetrics } from '../../types/atlas'

/**
 * Movement between builds.
 *
 * One snapshot is not a trend. A single-point chart reads as a flat line,
 * which is a claim about stability nobody has evidence for, so the honest
 * render is an empty state that says how many snapshots exist.
 *
 * What this component is allowed to assume, and who guarantees it. Every
 * snapshot the manifest indexes either loaded or the whole tab failed:
 * StaticProvider.getSnapshots throws an AtlasDataError naming the labels that
 * would not load, and LossinessTab renders LoadFailed instead of this. So the
 * list arriving here is complete, and the two claims below - "this bundle
 * carries none" and a first-to-last change across the columns shown - are
 * about the data rather than about the network.
 *
 * That was not true before. The provider swallowed a failed snapshot fetch and
 * filtered it out, so three 404s and a dead network both arrived here as an
 * empty array and were stated as "This bundle carries none". A partial loss
 * was worse: the table rendered the survivors and computed a change from the
 * first to the last across a hole nothing on screen disclosed.
 *
 * Nothing here re-checks that, because a component handed a list has no way
 * to. If the invariant is ever weakened, it has to be weakened at the provider
 * and this comment has to go with it.
 *
 * What this component does check is whose the snapshots are, because it can:
 * each one names its project, and `project` is the bundle's own slug. A
 * snapshot whose project is anything else, or nothing, is refused, and so is
 * the comparison it would have been part of. The ingest applies the same rule
 * when it writes the manifest, so a bundle it builds never reaches the refusal.
 * One written before snapshots had an identity, or assembled by hand, can: the
 * documented workflow seeds public/data with the sample and then ingests real
 * data into the same directory, and the old ingest indexed both, so the
 * first-to-last change below was the gap between two projects.
 *
 * The refusal stays inside this section rather than failing the tab. The
 * scorecard above is the bundle's own report and is right either way; only the
 * history is in question.
 */
export function TrendView({
  snapshots,
  project,
}: {
  snapshots: SnapshotMetrics[]
  project: string
}) {
  return (
    <section aria-labelledby="trend-heading" className="mt-8">
      <h2 id="trend-heading" className="text-base font-semibold text-ink">
        Trend
      </h2>
      <div className="mt-3">
        <TrendBody snapshots={snapshots} project={project} />
      </div>
    </section>
  )
}

function TrendBody({
  snapshots,
  project,
}: {
  snapshots: SnapshotMetrics[]
  project: string
}) {
  // Absent, null and "" are all "no identity", as they are to the ingest, and
  // no identity matches nothing: not even a bundle that names no project.
  const foreign = snapshots.filter(
    (snapshot) => !snapshot.project || snapshot.project !== project,
  )
  if (foreign.length > 0) {
    return <NotCompared project={project} foreign={foreign} />
  }

  if (snapshots.length === 0) {
    return (
      <EmptyState
        title="No snapshots yet"
        detail="Every build commits an immutable snapshot of the seven dimensions. This bundle carries none, so there is nothing to compare."
      />
    )
  }

  if (snapshots.length === 1) {
    return (
      // The snapshot label is a date that changes on every ingest run, so the
      // visual suite masks it. See BuildSection for the convention.
      <div data-volatile>
        <EmptyState
          title={`One snapshot so far (${labelOf(snapshots[0])})`}
          detail="Every build commits an immutable snapshot of the seven dimensions. Movement appears here once a second build is committed."
        />
      </div>
    )
  }

  const ordered = [...snapshots].sort((a, b) => labelOf(a).localeCompare(labelOf(b)))
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  const keys = last.dimensions.map((d) => d.key)

  return (
    <div className="overflow-x-auto rounded border border-line bg-surface">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Each dimension at every committed snapshot, with the change from the
          first to the most recent
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted-2">
            <th scope="col" className="px-3 py-2">
              Dimension
            </th>
            {ordered.map((snapshot) => (
              <th key={labelOf(snapshot)} scope="col" className="px-3 py-2">
                {labelOf(snapshot)}
              </th>
            ))}
            <th scope="col" className="px-3 py-2">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const latest = find(last, key)
            const earliest = find(first, key)
            return (
              <tr key={key} className="border-b border-line last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                  {latest?.label ?? key}
                </th>
                {ordered.map((snapshot) => (
                  <td key={labelOf(snapshot)} className="tabular px-3 py-2 text-ink">
                    {format(find(snapshot, key))}
                  </td>
                ))}
                <td className="px-3 py-2">
                  <Change from={earliest} to={latest} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Why the history is not drawn, and which snapshots are the reason. */
function NotCompared({
  project,
  foreign,
}: {
  project: string
  foreign: SnapshotMetrics[]
}) {
  return (
    // Labels are dates that change on every ingest run; see BuildSection.
    <div data-volatile className="rounded border border-line bg-surface p-6">
      <p className="font-medium text-ink">
        Not compared: these snapshots are not all from this project
      </p>
      <p className="mt-1 text-sm text-muted">
        This bundle is <span className="font-mono">{project}</span>. Comparing
        it with another project&rsquo;s snapshot, or with one that does not
        say whose it is, would show the difference between two projects as
        movement in this one.
      </p>
      <ul className="mt-3 list-disc pl-5 text-sm text-ink">
        {foreign.map((snapshot) => (
          <li key={labelOf(snapshot)}>
            <span className="tabular">{labelOf(snapshot)}</span>
            {': '}
            {!snapshot.project ? (
              'carries no project identity'
            ) : (
              <>
                belongs to <span className="font-mono">{snapshot.project}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-2">
        Rebuild the bundle with the current ingest, which indexes only this
        project&rsquo;s snapshots and names any other file it finds.
      </p>
    </div>
  )
}

type Metric = SnapshotMetrics['dimensions'][number]

function Change({ from, to }: { from?: Metric; to?: Metric }) {
  if (!from || !to) {
    return <span className="text-xs text-muted-2">not in both snapshots</span>
  }
  const delta = value(to) - value(from)
  if (delta === 0) return <span className="text-xs text-muted">no change</span>

  // Percentages count what survived, so up is better; counts count what is
  // wrong, so down is better. One arrow direction cannot mean both.
  const better = to.unit === 'pct' ? delta > 0 : delta < 0
  const rounded = to.unit === 'pct' ? round(delta) : delta
  return (
    <span
      className={`tabular text-sm ${better ? 'text-sev-ok' : 'text-sev-critical'}`}
    >
      {delta > 0 ? '+' : ''}
      {rounded}
      {to.unit === 'pct' ? ' pts' : ''}
    </span>
  )
}

function find(snapshot: SnapshotMetrics, key: string): Metric | undefined {
  return snapshot.dimensions.find((d) => d.key === key)
}

function value(metric: Metric): number {
  return metric.unit === 'pct' ? (metric.value_pct ?? 0) : metric.numerator
}

function format(metric?: Metric): string {
  if (!metric) return 'not measured'
  if (metric.unit === 'pct' && metric.value_pct !== null) {
    return formatPercent(metric.value_pct, 1)
  }
  return String(metric.numerator)
}

function labelOf(snapshot: SnapshotMetrics): string {
  return snapshot.label || snapshot.built_at.split('T')[0]
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
