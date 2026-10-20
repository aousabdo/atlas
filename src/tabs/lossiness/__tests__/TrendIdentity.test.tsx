import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ProviderContext } from '../../../data/ProviderContext'
import type { AtlasDataProvider } from '../../../data/provider'
import { StaticProvider } from '../../../data/StaticProvider'
import type { SnapshotMetrics } from '../../../types/atlas'
import { LossinessTab } from '../LossinessTab'
import { TrendView } from '../TrendView'

/**
 * The Trend view compares snapshots of one project, or none.
 *
 * scripts/seed-data.mjs puts the sample bundle, snapshot included, in
 * public/data, and README "Regenerating the data" then runs the real ingest
 * into the same directory. (npm test used to run the seed itself; it no longer
 * does, and the seed now refuses to empty a public/data that is not the
 * sample.) The ingest used to index every snapshot file it found there, and
 * a snapshot said nothing about whose it was, so the sample's snapshot and the
 * real one arrived here side by side. This view compares the first with the
 * last, and it reported the gap between a fabricated sample and a real
 * architecture as that architecture's movement.
 *
 * The ingest now indexes only its own project's snapshots. This is the other
 * half: a bundle written before that, or assembled by hand, still reaches the
 * browser, and the view has to refuse it rather than draw it. The rule is the
 * ingest's rule, stated against the same field: a snapshot belongs to this
 * bundle when its `project` is project.json's `slug`.
 */

const dimensions = (attrition: number): SnapshotMetrics['dimensions'] => [
  {
    key: 'requirement_attrition',
    label: 'Requirement attrition',
    numerator: 9,
    denominator: 11,
    value_pct: attrition,
    unit: 'pct',
    severity: 'watch',
  },
]

const snapshot = (
  label: string,
  project: string | undefined,
  attrition = 81.8,
): SnapshotMetrics => ({
  ...(project === undefined ? {} : { project }),
  label,
  built_at: `${label}T12:00:00`,
  git_sha: 'abc1234',
  dimensions: dimensions(attrition),
})

const trend = () => screen.getByRole('region', { name: 'Trend' })

describe('TrendView refuses snapshots that are not this project’s', () => {
  it('does not compare a sample snapshot with a real one', () => {
    render(
      <TrendView
        project="harbor-cuas"
        snapshots={[
          snapshot('2026-08-05', 'reference-cuas', 90.9),
          snapshot('2026-10-08', 'harbor-cuas', 81.8),
        ]}
      />,
    )

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(within(trend()).queryByText(/pts/)).not.toBeInTheDocument()
    expect(within(trend()).getByText(/not compared/i)).toBeInTheDocument()
    expect(trend()).toHaveTextContent(/2026-08-05/)
    expect(trend()).toHaveTextContent(/reference-cuas/)
    expect(trend()).toHaveTextContent(/harbor-cuas/)
  })

  it('does not compare a snapshot that does not say whose it is', () => {
    render(
      <TrendView
        project="harbor-cuas"
        snapshots={[
          snapshot('2026-07-01', undefined),
          snapshot('2026-10-08', 'harbor-cuas'),
        ]}
      />,
    )

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(trend()).toHaveTextContent(/2026-07-01/)
    expect(trend()).toHaveTextContent(/no project identity/i)
  })

  it('reads a null or empty identity as no identity, as the ingest does', () => {
    const blank = (label: string, project: null | '') =>
      ({ ...snapshot(label, 'x'), project }) as unknown as SnapshotMetrics
    render(
      <TrendView
        project="harbor-cuas"
        snapshots={[blank('2026-07-01', null), blank('2026-07-02', '')]}
      />,
    )

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(within(trend()).getAllByText(/no project identity/i)).toHaveLength(2)
  })

  it('compares nothing when the bundle itself names no project', () => {
    render(
      <TrendView
        project={undefined as unknown as string}
        snapshots={[snapshot('2026-07-01', undefined), snapshot('2026-07-02', undefined)]}
      />,
    )

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(within(trend()).getByText(/not compared/i)).toBeInTheDocument()
  })

  it('does not draw another project’s history, even a consistent one', () => {
    render(
      <TrendView
        project="harbor-cuas"
        snapshots={[
          snapshot('2026-08-05', 'reference-cuas', 81.8),
          snapshot('2026-09-02', 'reference-cuas', 90.9),
        ]}
      />,
    )

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(within(trend()).getByText(/not compared/i)).toBeInTheDocument()
  })

  it('does not call another project’s snapshot this one’s first', () => {
    render(
      <TrendView
        project="harbor-cuas"
        snapshots={[snapshot('2026-08-05', 'reference-cuas')]}
      />,
    )

    expect(screen.queryByText(/one snapshot so far/i)).not.toBeInTheDocument()
    expect(within(trend()).getByText(/not compared/i)).toBeInTheDocument()
  })

  it('still compares a project’s own snapshots', () => {
    render(
      <TrendView
        project="harbor-cuas"
        snapshots={[
          snapshot('2026-09-02', 'harbor-cuas', 81.8),
          snapshot('2026-10-08', 'harbor-cuas', 90.9),
        ]}
      />,
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByText(/not compared/i)).not.toBeInTheDocument()
  })
})

/** The real provider for everything except the one answer under test. */
function providerWith(
  getSnapshots: AtlasDataProvider['getSnapshots'],
): AtlasDataProvider {
  const real = new StaticProvider('/data')
  return Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
    getSnapshots,
  }) as AtlasDataProvider
}

function renderTab(provider: AtlasDataProvider) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ProviderContext.Provider value={provider}>
        <LossinessTab />
      </ProviderContext.Provider>
    </MemoryRouter>,
  )
}

describe('the ingest and the browser agree on whose snapshot it is', () => {
  it('reads the identity the Python ingest wrote into the sample bundle', async () => {
    const provider = new StaticProvider('/data')
    const [project, snapshots] = await Promise.all([
      provider.getProject(),
      provider.getSnapshots(),
    ])

    expect(snapshots.length).toBeGreaterThan(0)
    for (const s of snapshots) expect(s.project).toBe(project.slug)
  })

  it('shows the sample bundle’s own snapshot, not a refusal', async () => {
    renderTab(new StaticProvider('/data'))

    expect(await screen.findByText(/one snapshot so far/i)).toBeInTheDocument()
    expect(screen.queryByText(/not compared/i)).not.toBeInTheDocument()
  })

  it('refuses inside the Trend section and leaves the rest of the tab standing', async () => {
    const sample = await new StaticProvider('/data').getSnapshots()
    renderTab(
      providerWith(async () => [
        ...sample,
        { ...sample[0], project: 'harbor-cuas', label: '2026-10-08' },
      ]),
    )

    const region = await screen.findByRole('region', { name: 'Trend' })
    expect(await within(region).findByText(/not compared/i)).toBeInTheDocument()
    // TopGaps renders a table of its own, so the absence is checked in the
    // Trend section rather than across the tab.
    expect(within(region).queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getAllByRole('article', { name: /dimension/i })).toHaveLength(7)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
