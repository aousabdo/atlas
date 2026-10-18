import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { StaticProvider } from '../../../data/StaticProvider'
import type { CoverageMatrix, System } from '../../../types/atlas'
import { RiskWeightedCoverage } from '../RiskWeightedCoverage'

interface Options {
  filterActive?: boolean
  matchedIds?: ReadonlySet<string>
}

/** Against the committed sample bundle, so every figure here is auditable. */
async function panel(options: Options = {}) {
  const provider = new StaticProvider('/data')
  const systems: System[] = await provider.getSystems()
  const coverage: CoverageMatrix = await provider.getCoverage()
  const user = userEvent.setup()
  const result = render(
    <RiskWeightedCoverage
      systems={systems}
      coverage={coverage}
      filterActive={options.filterActive ?? false}
      matchedIds={options.matchedIds ?? new Set(systems.map((s) => s.id))}
    />,
  )
  const region = await screen.findByRole('region', { name: /realization by risk band/i })
  return { ...result, user, region, systems, coverage }
}

const bandRows = (region: HTMLElement) => [
  ...region.querySelectorAll<HTMLElement>('[data-band]'),
]
const band = (region: HTMLElement, risk: string) =>
  region.querySelector<HTMLElement>(`[data-band="${risk}"]`) as HTMLElement
const chips = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLElement>('[data-system]'),
]

describe('RiskWeightedCoverage', () => {
  it('renders one row per band the data declares, worst first', async () => {
    const { region } = await panel()
    expect(bandRows(region).map((r) => r.dataset.band)).toEqual([
      'high',
      'medium',
      'low',
    ])
  })

  it('states the high-risk headline as a sentence', async () => {
    const { region } = await panel()
    // Verified 2026-08-07 against public/data.
    expect(
      within(region).getByText(
        'Of 9 high-risk systems, 2 are confirmed deployed at any site.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the share of each band, not of the whole estate', async () => {
    const { region } = await panel()
    // 2/9, 8/19 and 0/2. The flat headline for this same bundle is 33%, which
    // is the figure this panel exists to break apart.
    expect(band(region, 'high')).toHaveTextContent('22%')
    expect(band(region, 'medium')).toHaveTextContent('42%')
    expect(band(region, 'low')).toHaveTextContent('0%')
    expect(within(region).queryByText('33%')).not.toBeInTheDocument()
  })

  it('shows the entities behind both numbers in every band', async () => {
    const { region, systems } = await panel()
    // Verified: bastion and fpsrel are the only high-risk systems realized.
    expect(
      chips(band(region, 'high'))
        .filter((c) => c.dataset.realized === 'true')
        .map((c) => c.dataset.system),
    ).toEqual(['bastion', 'fpsrel'])

    // Nothing is silently dropped: every system that could be fielded appears
    // exactly once, and the two shortfall rows are named as not counted.
    const listed = chips(region).map((c) => c.dataset.system as string)
    expect(listed).toHaveLength(systems.length - 2)
    expect(new Set(listed).size).toBe(systems.length - 2)
    expect(listed).not.toContain('dispatch')
    expect(within(region).getByText(/Not counted: 2 shortfall/)).toHaveTextContent(
      /Dispatch Management System.*Partner Agency Data Sharing/,
    )
  })

  it('names the sites behind a realized system on hover', async () => {
    const { region, user } = await panel()
    const chip = within(region).getByRole('listitem', { name: /^bastion/ })
    await user.hover(chip)
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Bastion Effector')
    expect(tip).toHaveTextContent('northgate')
  })

  it('says why an unrealized system counts as unrealized', async () => {
    const { region } = await panel()
    const chip = within(region).getByRole('listitem', { name: /^orbit/ })
    fireEvent.focus(chip)
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('ORBIT')
    expect(tip).toHaveTextContent(/no site/i)
    expect(chip).toHaveAttribute('aria-describedby', tip.id)

    fireEvent.blur(chip)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('reaches every system chip by keyboard and labels it for a screen reader', async () => {
    const { region } = await panel()
    const all = chips(region)
    expect(all).toHaveLength(30)
    for (const chip of all) {
      expect(chip).toHaveAttribute('tabindex', '0')
      expect(chip.getAttribute('aria-label')).toMatch(/^\S+, .+/)
    }
  })

  it('dims the systems and bands the filter does not match', async () => {
    // Filtering to the high band: its row stays lit, the low band goes dim.
    const all = await new StaticProvider('/data').getSystems()
    const { region } = await panel({
      filterActive: true,
      matchedIds: new Set(all.filter((s) => s.risk === 'high').map((s) => s.id)),
    })
    expect(band(region, 'high')).toHaveAttribute('data-dimmed', 'false')
    expect(band(region, 'low')).toHaveAttribute('data-dimmed', 'true')
    expect(region.querySelector('[data-system="orbit"]')).toHaveAttribute(
      'data-dimmed',
      'false',
    )
    expect(region.querySelector('[data-system="homing"]')).toHaveAttribute(
      'data-dimmed',
      'true',
    )
  })

  it('renders a band with nothing realized without dividing by it', async () => {
    const provider = new StaticProvider('/data')
    const systems = await provider.getSystems()
    render(
      <RiskWeightedCoverage
        systems={systems}
        coverage={{
          default_site: null,
          sites: {},
          pending_review: {},
          confidence_counts: {},
        }}
        filterActive={false}
        matchedIds={new Set()}
      />,
    )
    const region = await screen.findByRole('region', { name: /realization by risk band/i })
    expect(
      within(region).getByText(
        'Of 9 high-risk systems, 0 are confirmed deployed at any site.',
      ),
    ).toBeInTheDocument()
    expect(within(region).getAllByText('0%')).toHaveLength(3)
  })
})
