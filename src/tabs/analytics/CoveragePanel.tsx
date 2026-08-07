import { useId } from 'react'

import {
  countMappings,
  formatPercent,
  isRealizedMapping,
  matrixIdSet,
  percentOf,
  realizedSystemIds,
} from '../../lib/coverage'
import type {
  Confidence,
  CoverageMatrix,
  SiteSummary,
  System,
} from '../../types/atlas'
import { CursorTooltip, useCursorTooltip } from './CursorTooltip'

const DONUT_SIZE = 88
const DONUT_STROKE = 12

const CONFIDENCE_TONE: Record<Confidence, string> = {
  high: 'bg-risk-low/15 text-risk-low-ink',
  medium: 'bg-risk-medium/15 text-risk-medium-ink',
  low: 'bg-risk-high/15 text-risk-high-ink',
}

const band = (pct: number) =>
  pct >= 60
    ? 'var(--color-risk-low)'
    : pct >= 30
      ? 'var(--color-risk-medium)'
      : 'var(--color-risk-high)'

function Donut({ pct }: { pct: number }) {
  const radius = (DONUT_SIZE - DONUT_STROKE) / 2
  const centre = DONUT_SIZE / 2
  const circumference = 2 * Math.PI * radius
  return (
    <svg
      width={DONUT_SIZE}
      height={DONUT_SIZE}
      viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
      aria-hidden="true"
    >
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        stroke="var(--color-surface-2)"
        strokeWidth={DONUT_STROKE}
      />
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        stroke={band(pct)}
        strokeWidth={DONUT_STROKE}
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
        transform={`rotate(-90 ${centre} ${centre})`}
      />
    </svg>
  )
}

interface SiteCoverage {
  id: string
  label: string
  summary: SiteSummary | undefined
  /** Named hardware and a matrix system id: see src/lib/coverage.ts. */
  mapped: string[]
  pct: number
  recorded: number
  softwareOnly: number
  outsideMatrix: number
  unclaimed: number
  confidence: Record<Confidence, number>
}

function readSites(
  coverage: CoverageMatrix,
  systems: System[],
  sites: SiteSummary[],
): SiteCoverage[] {
  const matrixIds = matrixIdSet(systems)
  return Object.entries(coverage.sites).map(([id, site]) => {
    const mapped = realizedSystemIds(site, matrixIds)
    const counts = countMappings(site, matrixIds)
    const confidence: Record<Confidence, number> = { high: 0, medium: 0, low: 0 }
    for (const [sid, m] of Object.entries(site.mappings)) {
      if (isRealizedMapping(sid, m, matrixIds)) confidence[m.confidence] += 1
    }
    return {
      id,
      label: site.label,
      summary: sites.find((s) => s.id === id),
      mapped,
      pct: percentOf(mapped.length, systems.length),
      recorded: counts.recorded,
      softwareOnly: counts.softwareOnly,
      outsideMatrix: counts.outsideMatrix,
      unclaimed: site.unclaimed_devices.infrastructure.length,
      confidence,
    }
  })
}

export interface CoveragePanelProps {
  coverage: CoverageMatrix
  systems: System[]
  sites: SiteSummary[]
  filterActive: boolean
  matchedIds: ReadonlySet<string>
  query: string
}

/**
 * Where the architecture is actually realized, site by site.
 *
 * A site nobody has reviewed yet reports that it has not been reviewed. It
 * never reports 0%, which would read as "we looked and found nothing".
 */
export function CoveragePanel({
  coverage,
  systems,
  sites,
  filterActive,
  matchedIds,
  query,
}: CoveragePanelProps) {
  const headingId = useId()
  const tooltip = useCursorTooltip()
  const rows = readSites(coverage, systems, sites)
  const pending = Object.entries(coverage.pending_review)
  const nameOf = (id: string) => systems.find((s) => s.id === id)?.name ?? id

  const siteDimmed = (row: SiteCoverage) =>
    filterActive &&
    !row.label.toLowerCase().includes(query) &&
    !row.mapped.some((id) => matchedIds.has(id))

  return (
    <div className="rounded border border-line bg-surface p-4">
      <section aria-labelledby={headingId} data-filtered={filterActive ? 'true' : 'false'}>
        <h2 id={headingId} className="text-sm font-semibold tracking-wide text-ink">
          Multi-Site Coverage — Where Are We Really?
        </h2>

        <ul className="mt-3 divide-y divide-line">
          {rows.map((row) => (
            <li
              key={row.id}
              data-site={row.id}
              data-dimmed={siteDimmed(row) ? 'true' : 'false'}
              className={`flex flex-wrap items-center gap-6 py-4 ${
                siteDimmed(row) ? 'opacity-20' : ''
              }`}
            >
              <div className="w-56 shrink-0">
                <h3 className="text-sm font-medium text-ink">{row.label}</h3>
                {row.summary && (
                  <p className="mt-1 text-xs text-muted-3">
                    <span className="tabular">{row.summary.device_count}</span> devices,{' '}
                    <span className="tabular">{row.summary.edge_count}</span> links,
                    updated <span className="tabular">{row.summary.updated}</span>
                  </p>
                )}
              </div>

              {row.mapped.length === 0 ? (
                <p className="min-w-56 flex-1 rounded bg-surface-2 px-3 py-2 text-xs text-muted">
                  No mappings yet. Nobody has reviewed which systems are deployed
                  here, which is not the same as none being deployed.
                </p>
              ) : (
                <>
                  <div className="relative">
                    <Donut pct={row.pct} />
                    <span className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="tabular text-sm text-ink">
                        {formatPercent(row.pct)}
                      </span>
                      <span className="text-[10px] text-muted-3">mapped</span>
                    </span>
                  </div>
                  <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-xs lg:grid-cols-4">
                    <div>
                      <dd className="tabular text-sm text-ink">
                        {row.mapped.length} / {systems.length}
                      </dd>
                      <dt className="text-muted-3">Systems mapped</dt>
                    </div>
                    <div>
                      <dd className="tabular text-sm text-ink">{row.unclaimed}</dd>
                      <dt className="text-muted-3">Infrastructure, unclaimed</dt>
                    </div>
                    <div>
                      <dd className="flex gap-1">
                        {(['high', 'medium', 'low'] as Confidence[])
                          .filter((c) => row.confidence[c] > 0)
                          .map((c) => (
                            <span
                              key={c}
                              className={`tabular rounded px-1.5 py-px ${CONFIDENCE_TONE[c]}`}
                            >
                              {row.confidence[c]} {c}
                            </span>
                          ))}
                      </dd>
                      <dt className="text-muted-3">Mapping confidence</dt>
                    </div>
                    <div>
                      <dd className="tabular text-sm text-ink">
                        {row.softwareOnly + row.outsideMatrix}
                      </dd>
                      <dt className="text-muted-3">
                        Uncounted mappings
                        <span className="block text-[10px]">
                          of {row.recorded} recorded: {row.softwareOnly} software
                          only, {row.outsideMatrix} outside the matrix
                        </span>
                      </dt>
                    </div>
                  </dl>
                </>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-xs font-medium tracking-wide text-muted">
            Cross-site coverage diff
          </h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {rows.map((row) => {
              const elsewhere = new Set(
                rows.filter((o) => o.id !== row.id).flatMap((o) => o.mapped),
              )
              const only = row.mapped.filter((id) => !elsewhere.has(id))
              return (
                <div
                  key={row.id}
                  className="rounded border border-line bg-surface-2 p-3 text-xs"
                >
                  <p className="text-muted">
                    Mapped at <code className="text-accent-ink">{row.id}</code> only{' '}
                    <span className="tabular">({only.length})</span>
                  </p>
                  <p className="mt-2 flex flex-wrap gap-1">
                    {only.length === 0 ? (
                      <span className="text-muted-3">
                        Nothing unique to compare yet.
                      </span>
                    ) : (
                      only.map((id) => {
                        const owner = `${row.id}:${id}`
                        const detail = nameOf(id)
                        return (
                          <span
                            key={id}
                            tabIndex={0}
                            aria-describedby={tooltip.describedBy(owner)}
                            data-chip={id}
                            data-dimmed={
                              filterActive && !matchedIds.has(id) ? 'true' : 'false'
                            }
                            onMouseEnter={(event) =>
                              tooltip.showAtPointer(owner, detail, event)
                            }
                            onMouseMove={tooltip.follow}
                            onMouseLeave={() => tooltip.hide(owner)}
                            onFocus={(event) =>
                              tooltip.showAtElement(owner, detail, event.currentTarget)
                            }
                            onBlur={() => tooltip.hide(owner)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') tooltip.hide(owner)
                            }}
                            className={`rounded bg-surface px-1.5 py-px text-accent-ink transition-colors hover:bg-accent/15 focus-visible:bg-accent/15 ${
                              filterActive && !matchedIds.has(id) ? 'opacity-20' : ''
                            }`}
                          >
                            {id}
                          </span>
                        )
                      })
                    )}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Outside the per-site region above: the backlog is a question list that
          spans sites, not a figure about any one of them. */}
      <details className="mt-4 border-t border-line pt-4">
        <summary className="cursor-pointer text-xs font-medium tracking-wide text-muted">
          Pending review questions ({pending.length})
        </summary>
        <ul className="mt-2 space-y-2">
          {pending.map(([subject, question]) => (
            <li key={subject} className="text-xs text-muted">
              <code className="mr-2 rounded bg-surface-2 px-1.5 py-px text-accent-ink">
                {subject}
              </code>
              {question}
            </li>
          ))}
        </ul>
      </details>

      <CursorTooltip {...tooltip} />
    </div>
  )
}
