import { render, screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ProviderContext } from '../../../data/ProviderContext'
import { AtlasDataError, type AtlasDataProvider } from '../../../data/provider'
import { formatPercent } from '../../../lib/coverage'
import { renderWithProvider } from '../../../test/renderWithProvider'
import type { LossinessDimension, SnapshotMetrics } from '../../../types/atlas'
import { LossinessTab } from '../LossinessTab'
import { displayValue } from '../Scorecard'
import { TrendView } from '../TrendView'

/** Open a card's drill-down and hand back the dialog. */
async function drillInto(user: UserEvent, cardName: RegExp) {
  const card = await screen.findByRole('article', { name: cardName })
  await user.click(within(card).getByRole('button', { name: /show/i }))
  return screen.findByRole('dialog')
}

describe('Lossiness', () => {
  it('shows all seven dimension cards', async () => {
    await renderWithProvider(<LossinessTab />)
    const cards = await screen.findAllByRole('article', { name: /dimension/i })
    expect(cards).toHaveLength(7)
  })

  it('labels every card with its dimension name', async () => {
    await renderWithProvider(<LossinessTab />)
    for (const label of [
      'Requirement attrition',
      'Ownership ambiguity',
      'Realization gap',
      'Integration gap',
      'Evidence gap',
      'Orphaned hardware',
      'Open questions',
    ]) {
      expect(await screen.findByText(label)).toBeInTheDocument()
    }
  })

  it('shows requirement attrition as 9 of 11', async () => {
    await renderWithProvider(<LossinessTab />)
    const card = await screen.findByRole('article', { name: /Requirement attrition/i })
    expect(within(card).getByText('81.8%')).toBeInTheDocument()
    expect(within(card).getByText(/9 of 11/)).toBeInTheDocument()
    expect(within(card).getByText('watch')).toBeInTheDocument()
  })

  it('shows the count dimensions as counts, never as a percentage', async () => {
    await renderWithProvider(<LossinessTab />)
    const integration = await screen.findByRole('article', { name: /Integration gap/i })
    expect(within(integration).getByText(/13 of 13/)).toBeInTheDocument()
    expect(within(integration).queryByText(/%/)).not.toBeInTheDocument()

    const hardware = await screen.findByRole('article', { name: /Orphaned hardware/i })
    expect(within(hardware).getByText(/59 of 79/)).toBeInTheDocument()
    expect(within(hardware).getByText('critical')).toBeInTheDocument()

    const questions = await screen.findByRole('article', { name: /Open questions/i })
    expect(within(questions).getByText(/7 of 7/)).toBeInTheDocument()
  })

  it('marks how the data under each figure was arrived at', async () => {
    await renderWithProvider(<LossinessTab />)
    const realization = await screen.findByRole('article', { name: /Realization gap/i })
    expect(within(realization).getByText('31.2%')).toBeInTheDocument()
    expect(within(realization).getByText('manual')).toBeInTheDocument()

    const integration = await screen.findByRole('article', { name: /Integration gap/i })
    expect(within(integration).getByText('mined from prose')).toBeInTheDocument()
  })

  it('drills from a figure to the entities behind it', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    const card = await screen.findByRole('article', { name: /Ownership ambiguity/i })
    await user.click(within(card).getByRole('button', { name: /show the 9/i }))
    const drawer = await screen.findByRole('dialog')
    // The nine unconfirmed systems, by name not by id.
    expect(within(drawer).getByText('Beacon')).toBeInTheDocument()
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(9)
    expect(within(drawer).getByText('cirrus')).toBeInTheDocument()
  })

  it('names the two dropped requirements', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    const card = await screen.findByRole('article', { name: /Requirement attrition/i })
    await user.click(within(card).getByRole('button', { name: /show/i }))
    const drawer = await screen.findByRole('dialog')
    expect(
      within(drawer).getByText(/training pipeline for relay operators/),
    ).toBeInTheDocument()
    expect(
      within(drawer).getByText(/spectrum deconfliction process/),
    ).toBeInTheDocument()
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(2)
  })

  it('lists the 22 unmapped systems and the per-site realization', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    const drawer = await drillInto(user, /Realization gap/i)
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(22)
    expect(within(drawer).getByText('Dwell')).toBeInTheDocument()
    expect(
      within(drawer).getByText('Northgate Sports Campus'),
    ).toBeInTheDocument()
    expect(within(drawer).getByText('10 of 32')).toBeInTheDocument()
    expect(within(drawer).getByText('0 of 32')).toBeInTheDocument()
  })

  it('lists all 13 planned interfaces that nothing satisfies', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    const drawer = await drillInto(user, /Integration gap/i)
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(13)
    expect(within(drawer).getByText('USSS ↔ ICE Relay federation')).toBeInTheDocument()
    expect(within(drawer).getByText('DMS ↔ Relay CoT auto-populate')).toBeInTheDocument()
  })

  it('splits the 59 unexplained devices across the two sites', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    const drawer = await drillInto(user, /Orphaned hardware/i)
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(59)
    expect(within(drawer).getByText('51')).toBeInTheDocument()
    expect(within(drawer).getByText('8')).toBeInTheDocument()
    expect(within(drawer).getByText('wf_gate_sensor')).toBeInTheDocument()
  })

  it('says plainly that no risk level was inferred', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    const drawer = await drillInto(user, /Evidence gap/i)
    expect(within(drawer).getByText(/All 32 risk levels were read/)).toBeInTheDocument()
    expect(within(drawer).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('lists the seven open questions with their subject', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    const drawer = await drillInto(user, /Open questions/i)
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(7)
    expect(
      within(drawer).getByText(/Nothing is mapped at Westfield Proving Ground/),
    ).toBeInTheDocument()
    // 'atak' is deliberately not a matrix system, so it stays as itself.
    expect(within(drawer).getByText('atak')).toBeInTheDocument()
  })

  it('closes the drawer on Escape', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    const drawer = await drillInto(user, /Ownership ambiguity/i)
    await user.type(drawer, '{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the attrition flow with explicit loss nodes', async () => {
    await renderWithProvider(<LossinessTab />)
    const flow = await screen.findByRole('img', { name: /attrition flow/i })
    expect(within(flow).getByText(/not carried forward/i)).toBeInTheDocument()
    expect(within(flow).getByText(/unmapped/i)).toBeInTheDocument()
    expect(within(flow).getByText(/unconfirmed/i)).toBeInTheDocument()
    expect(within(flow).getByText(/unexplained hardware/i)).toBeInTheDocument()
    // Each stage states its own denominator, since they are three populations.
    expect(within(flow).getByText('11 requirements')).toBeInTheDocument()
    expect(within(flow).getByText('79 devices')).toBeInTheDocument()
  })

  it('says there is only one snapshot rather than drawing a flat line', async () => {
    await renderWithProvider(<LossinessTab />)
    // Named, so a reader can tell which build the figures above came from.
    expect(await screen.findByText(/one snapshot so far \(2026-08-05\)/i)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /snapshot/i })).not.toBeInTheDocument()
  })

  it('ranks top gaps by risk, confirmation and mapping', async () => {
    await renderWithProvider(<LossinessTab />)
    const region = await screen.findByRole('region', { name: /top gaps/i })
    const rows = within(region).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(10)
    // Five systems tie on the maximum score of 5, so the id breaks the tie and
    // Beacon leads. Cirrus is one of the five, not the single worst.
    expect(rows[0]).toHaveTextContent(/Beacon/)
    const topFive = rows.slice(0, 5).map((row) => row.textContent ?? '')
    for (const name of ['Beacon', 'Cirrus', 'Dwell', 'Halyard', 'Ingot']) {
      expect(topFive.some((text) => text.includes(name))).toBe(true)
    }
    for (const text of topFive) expect(text).toMatch(/unconfirmed/)
  })

  it('hides the composite index behind an explicit opt-in', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    await screen.findByRole('article', { name: /Requirement attrition/i })
    expect(screen.queryByText(/Lossiness Index/i)).not.toBeInTheDocument()
    await user.click(
      await screen.findByRole('button', { name: /composite indicator/i }),
    )
    expect(await screen.findByText(/Lossiness Index/i)).toBeInTheDocument()
    expect(
      screen.getByText(/management indicator, not a formal metric/i),
    ).toBeInTheDocument()
    // The mean of 81.8, 71.9, 31.2 and 100, and of nothing else: the three
    // count dimensions are deliberately not folded in.
    expect(screen.getByText('71.2')).toBeInTheDocument()
  })

  it('renders a load failure instead of a page of zeroes', async () => {
    const failing = {
      kind: 'static',
      getLossiness: () =>
        Promise.reject(new AtlasDataError('lossiness.json returned 404')),
      getSystems: () => Promise.resolve([]),
      getSnapshots: () => Promise.resolve([]),
      getProject: () => Promise.resolve({ sites: [] }),
    } as unknown as AtlasDataProvider

    render(
      <ProviderContext.Provider value={failing}>
        <LossinessTab />
      </ProviderContext.Provider>,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Could not load the lossiness report/i)
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    expect(screen.queryByRole('img', { name: /attrition flow/i })).not.toBeInTheDocument()
  })
})

describe('TrendView', () => {
  const snapshot = (
    label: string,
    attrition: number,
    orphaned: number,
  ): SnapshotMetrics => ({
    label,
    built_at: `${label}T12:00:00`,
    git_sha: 'abc1234',
    dimensions: [
      {
        key: 'requirement_attrition',
        label: 'Requirement attrition',
        numerator: 9,
        denominator: 11,
        value_pct: attrition,
        unit: 'pct',
        severity: 'watch',
      },
      {
        key: 'orphaned_hardware',
        label: 'Orphaned hardware',
        numerator: orphaned,
        denominator: 79,
        value_pct: null,
        unit: 'count',
        severity: 'critical',
      },
    ],
  })

  it('compares the dimensions once a second snapshot exists', () => {
    render(
      <TrendView
        snapshots={[snapshot('2026-08-05', 81.8, 59), snapshot('2026-09-02', 90.9, 44)]}
      />,
    )
    expect(screen.queryByText(/one snapshot so far/i)).not.toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByText('81.8%')).toBeInTheDocument()
    expect(within(table).getByText('90.9%')).toBeInTheDocument()
    // Up is better for a percentage of what survived, down for a count of
    // what is wrong. Both of these are improvements.
    expect(within(table).getByText(/\+9\.1 pts/)).toBeInTheDocument()
    expect(within(table).getByText('-15')).toBeInTheDocument()
  })

  it('spells a tie the way the report and the scorecard spell it', () => {
    // percentOf(10, 32) is 31.25 exactly. The canonical formatter breaks the
    // tie to even and says 31.2, which is what the lossiness report and the
    // scorecard card both print. A local toFixed(1) rounds half up and says
    // 31.3, so the same fraction reads two ways on one tab.
    render(
      <TrendView
        snapshots={[snapshot('2026-08-05', 31.25, 59), snapshot('2026-09-02', 40, 44)]}
      />,
    )
    const table = screen.getByRole('table')
    expect(within(table).getByText('31.2%')).toBeInTheDocument()
    expect(within(table).queryByText('31.3%')).not.toBeInTheDocument()
  })

  it('does not pretend an empty history is a measurement', () => {
    render(<TrendView snapshots={[]} />)
    expect(screen.getByText(/no snapshots yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

/**
 * The card's figure and the rest of the app's figures come from one function.
 *
 * This card carried its own percent formatter while src/lib/coverage.ts
 * declared itself the one percentage formatter, so the same quantity had two
 * spellings and a change to either could pass unnoticed. displayValue now asks
 * the canonical formatter for a tenth.
 */
describe('the scorecard figure', () => {
  const pctDimension = (value: number | null) =>
    ({
      key: 'realization_gap',
      label: 'Realization gap',
      numerator: 10,
      denominator: 32,
      value_pct: value,
      unit: 'pct',
      severity: 'critical',
      detail: {},
    }) as LossinessDimension

  it.each([100, 81.8, 71.9, 31.2, 6.2, 0])(
    'spells %f the way the canonical formatter does',
    (value) => {
      expect(displayValue(pctDimension(value))).toBe(formatPercent(value, 1))
    },
  )

  it('never prints more than the one decimal the report carries', () => {
    expect(displayValue(pctDimension(31.25))).toBe('31.2%')
    expect(displayValue(pctDimension(100))).toBe('100%')
  })

  it('prints a count dimension as a bare count, never as a rate', () => {
    expect(
      displayValue({
        key: 'integration_gap',
        label: 'Integration gap',
        numerator: 13,
        denominator: 13,
        value_pct: null,
        unit: 'count',
        severity: 'critical',
        detail: {},
      } as LossinessDimension),
    ).toBe('13')
  })
})
