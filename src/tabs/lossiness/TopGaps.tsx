import { EmptyState } from '../../components/EmptyState'
import { RiskPill } from '../../components/SeverityPill'
import type { TopGap } from '../../types/atlas'

/**
 * The systems where the gaps stack up.
 *
 * The score is risk plus one point for an unconfirmed owner and one for no
 * hardware mapping. Ties break on system id rather than on judgement, so the
 * order is reproducible and the table never implies a ranking it did not earn.
 *
 * A shortfall row records a gap, not a system, so it can take no hardware
 * point and its Hardware cell says so instead of reading "mapped".
 */
export function TopGaps({ gaps }: { gaps: TopGap[] }) {
  return (
    <section aria-label="Top gaps" className="mt-8">
      <h2 className="text-base font-semibold text-ink">Top gaps</h2>
      <p className="mt-1 text-sm text-muted">
        High risk scores 3, an unconfirmed owner 1, no hardware mapping 1. A
        shortfall row records a gap rather than a system, so it has no hardware
        to score. Systems scoring 0 are left out. Equal scores are listed by
        system id, not by importance.
      </p>
      {gaps.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No system carries a gap"
            detail="Every system is confirmed, mapped and below high risk. Check the scorecard above before believing it."
          />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted-2">
                <th scope="col" className="px-3 py-2">
                  Rank
                </th>
                <th scope="col" className="px-3 py-2">
                  System
                </th>
                <th scope="col" className="px-3 py-2">
                  Risk
                </th>
                <th scope="col" className="px-3 py-2">
                  Owner
                </th>
                <th scope="col" className="px-3 py-2">
                  Hardware
                </th>
                <th scope="col" className="px-3 py-2">
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((gap, index) => (
                <tr key={gap.id} className="border-b border-line last:border-0">
                  <td className="tabular px-3 py-2 text-muted-2">{index + 1}</td>
                  <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                    {gap.name}
                    <code className="tabular ml-2 text-xs text-muted-2">{gap.id}</code>
                  </th>
                  <td className="px-3 py-2">
                    <RiskPill risk={gap.risk} />
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {gap.unconfirmed ? 'unconfirmed' : 'confirmed'}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {gap.shortfall ? 'shortfall row' : gap.unmapped ? 'unmapped' : 'mapped'}
                  </td>
                  <td className="tabular px-3 py-2 text-ink">{gap.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
