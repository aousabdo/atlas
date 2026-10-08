import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProvider } from '../../../test/renderWithProvider'
import { AnalyticsTab } from '../AnalyticsTab'

/**
 * jsdom lays nothing out, so every measured component reports a zero-width
 * container and the sankey correctly refuses to draw. Give it a box.
 */
const REAL_RECT = Element.prototype.getBoundingClientRect

function giveEverythingALayout(width = 900, height = 420) {
  Element.prototype.getBoundingClientRect = function fakeRect() {
    return {
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect
  }
}

afterEach(() => {
  Element.prototype.getBoundingClientRect = REAL_RECT
})

describe('Analytics', () => {
  it('renders the risk heatmap with 6 groups and 3 severities', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    expect(within(table).getAllByRole('row')).toHaveLength(8) // header + 6 groups + total
    for (const h of ['High', 'Medium', 'Low', 'Total']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument()
    }
  })

  it('puts the verified counts in the right cells', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    const otherDhs = within(table).getByRole('row', { name: /^Other DHS/ })
    // Verified 2026-08-05: Other DHS is 4 high, 9 medium, 1 low, 14 total.
    expect(within(otherDhs).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      'Other DHS',
      '4',
      '9',
      '1',
      '14',
    ])
  })

  it('renders a real zero rather than hiding an empty cell', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    // Verified: DHS S&T is 0 high, 2 medium, 0 low; DoD is 1 high and nothing else.
    expect(
      within(table)
        .getByRole('row', { name: /^DHS S&T/ })
        .textContent,
    ).toBe('DHS S&T020' + '2')
    expect(
      within(table)
        .getByRole('row', { name: /^DoD/ })
        .textContent,
    ).toBe('DoD100' + '1')
  })

  it('totals to 32 systems', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    const total = within(table).getByRole('row', { name: /^Total/ })
    expect(within(total).getAllByRole('cell').at(-1)).toHaveTextContent('32')
  })

  it('names the systems behind a heatmap cell on hover', async () => {
    const { user } = await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    const dod = within(table).getByRole('row', { name: /^DoD/ })
    await user.hover(within(dod).getAllByRole('cell')[1])
    expect(await screen.findByText(/DoD, high risk: Halyard/)).toBeInTheDocument()
  })

  it('pops a tooltip naming exactly the systems a heatmap cell counts', async () => {
    const { user } = await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    const cbp = within(table).getByRole('row', { name: /^CBP/ })
    await user.hover(within(cbp).getAllByRole('cell')[2])

    // Verified: CBP holds four medium-risk systems and no others.
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent(
      'CBP Relay, CBP Sentinel, GANTRY (Ground Antenna Towers), Recon Systems',
    )
    expect(tip).not.toHaveTextContent('Halyard')
  })

  it('moves the tooltip with the cursor', async () => {
    const { user } = await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    const row = within(table).getByRole('row', { name: /^DHS S&T/ })
    const cell = within(row).getAllByRole('cell')[2]

    await user.hover(cell)
    const tip = await screen.findByRole('tooltip')

    fireEvent.mouseMove(cell, { clientX: 300, clientY: 210 })
    // Offsets carried from the tool being replaced: +14 across, -10 up.
    expect(tip).toHaveStyle({ left: '314px', top: '200px' })

    fireEvent.mouseMove(cell, { clientX: 120, clientY: 60 })
    expect(tip).toHaveStyle({ left: '134px', top: '50px' })
  })

  it('leaves an empty cell without a tooltip', async () => {
    const { user } = await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    // Verified: DoD has nothing at medium risk.
    const dod = within(table).getByRole('row', { name: /^DoD/ })
    await user.hover(within(dod).getAllByRole('cell')[2])
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('reaches every heatmap cell by keyboard and describes the focused one', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })

    // 6 groups plus the totals row, three severities each.
    const reachable = within(table)
      .getAllByRole('cell')
      .filter((c) => c.getAttribute('tabindex') === '0')
    expect(reachable).toHaveLength(21)

    const dod = within(table).getByRole('row', { name: /^DoD/ })
    const cell = within(dod).getAllByRole('cell')[1]
    fireEvent.focus(cell)

    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Halyard')
    expect(cell).toHaveAttribute('aria-describedby', tip.id)

    fireEvent.blur(cell)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders ownership bars for every group', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const region = await screen.findByRole('region', { name: /ownership confirmation/i })
    expect(within(region).getAllByRole('listitem')).toHaveLength(6)
    expect(within(region).getByText(/DHS HQ\/OCIO/)).toBeInTheDocument()
    // Verified: DHS HQ/OCIO is 1 confirmed, 3 unconfirmed. Scoped to the row
    // because External is also 3 pending, so the string is not unique.
    const row = within(region).getByText('DHS HQ/OCIO').closest('li')!
    expect(within(row).getByText('1 confirmed')).toBeInTheDocument()
    expect(within(row).getByText('3 pending')).toBeInTheDocument()
    expect(within(region).getByText('23 confirmed')).toBeInTheDocument()
    expect(within(region).getByText('9 pending')).toBeInTheDocument()
  })

  it('reveals the confirmed share of a bar on hover and on focus', async () => {
    const { user } = await renderWithProvider(<AnalyticsTab />)
    const region = await screen.findByRole('region', { name: /ownership confirmation/i })
    const row = within(region).getByText('DHS HQ/OCIO').closest('li')!
    expect(row).toHaveAttribute('tabindex', '0')
    expect(row).toHaveAttribute('data-active', 'false')

    // Verified: DHS HQ/OCIO is 1 of 4 confirmed.
    await user.hover(row)
    expect(row).toHaveAttribute('data-active', 'true')
    expect(within(row).getByText('25% confirmed')).not.toHaveAttribute('aria-hidden')

    await user.unhover(row)
    expect(row).toHaveAttribute('data-active', 'false')

    fireEvent.focus(row)
    expect(row).toHaveAttribute('data-active', 'true')
  })

  it('shows the requirements sankey legend with all five statuses', async () => {
    await renderWithProvider(<AnalyticsTab />)
    for (const s of [
      'Split out',
      'Renamed / split out',
      'Partly carried forward',
      'Condensed',
      "Didn't keep",
    ]) {
      expect(await screen.findByText(s)).toBeInTheDocument()
    }
  })

  it('names a coverage chip on hover and reaches it by keyboard', async () => {
    const { user } = await renderWithProvider(<AnalyticsTab />)
    await screen.findByRole('region', { name: /coverage/i })
    // Verified: ucop is mapped at Northgate and nowhere else.
    const chip = document.querySelector('[data-chip="ucop"]') as HTMLElement
    expect(chip).toHaveAttribute('tabindex', '0')

    await user.hover(chip)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('UAS Common Picture')

    fireEvent.blur(chip)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows per-site coverage with the real mapped fraction', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const region = await screen.findByRole('region', { name: /coverage/i })
    expect(within(region).getByText(/Northgate Sports Campus/)).toBeInTheDocument()
    expect(within(region).getByText(/Westfield Proving Ground/)).toBeInTheDocument()
    // 10 systems name hardware at Northgate and exist in the matrix, out of the
    // 30 that could be fielded: the same rule and the same denominator the
    // ingest uses for the realization gap.
    expect(within(region).getByText('10 / 30')).toBeInTheDocument()
    expect(within(region).getByText('33%')).toBeInTheDocument()
  })

  it('says Westfield has no mappings instead of rendering 0%', async () => {
    await renderWithProvider(<AnalyticsTab />)
    expect(await screen.findByText(/No mappings yet/i)).toBeInTheDocument()
    const westfield = document.querySelector('[data-site="westfield"]')!
    expect(within(westfield as HTMLElement).queryByText('0%')).not.toBeInTheDocument()
  })

  it('lists the 7 pending review questions', async () => {
    await renderWithProvider(<AnalyticsTab />)
    expect(await screen.findByText(/Pending review questions \(7\)/)).toBeInTheDocument()
    const questions = screen.getByText(/Pending review questions \(7\)/).closest('details')!
    expect(within(questions).getAllByRole('listitem')).toHaveLength(7)
  })

  describe('the requirements sankey', () => {
    const node = (name: string) =>
      document.querySelector(`[data-node="${name}"]`) as SVGGElement
    const highlighted = () =>
      [...document.querySelectorAll('[data-node][data-highlighted="true"]')]
        .map((el) => el.getAttribute('data-node'))
        .sort()

    /**
     * The diagram draws on the second pass: it mounts, measures its box, then
     * lays out. 11 baseline requirements, 10 carrying systems, 1 loss sink.
     */
    async function drawn() {
      giveEverythingALayout()
      const rendered = await renderWithProvider(<AnalyticsTab />)
      await waitFor(() =>
        expect(document.querySelectorAll('[data-node]')).toHaveLength(22),
      )
      return rendered
    }

    it('draws a node per requirement and per carrying system', async () => {
      await drawn()
      expect(highlighted()).toEqual([])
      expect(node('Not carried forward')).toHaveAttribute('data-side', 'loss')
    })

    it('lights the systems a requirement feeds, and dims the rest', async () => {
      await drawn()

      const source = node('No common track identifier across air surveillance systems')
      fireEvent.mouseEnter(source)

      // Verified: this requirement is carried by exactly these three systems.
      expect(highlighted()).toEqual([
        'Beacon',
        'CBP Sentinel',
        'No common track identifier across air surveillance systems',
        'ORBIT',
      ])
      expect(node('CROSSLINK')).toHaveAttribute('data-dimmed', 'true')
      expect(source).toHaveAttribute('data-dimmed', 'false')

      fireEvent.mouseLeave(source)
      expect(highlighted()).toEqual([])
      expect(node('CROSSLINK')).toHaveAttribute('data-dimmed', 'false')
    })

    it('lights the requirements feeding a system, and dims the rest', async () => {
      await drawn()

      fireEvent.mouseEnter(node('USCG Relay'))

      // Verified: one baseline requirement reaches USCG Relay.
      expect(highlighted()).toEqual([
        'No store-and-forward cache for relay clients during an outage',
        'USCG Relay',
      ])
      expect(node('ORBIT')).toHaveAttribute('data-dimmed', 'true')

      fireEvent.mouseLeave(node('USCG Relay'))
      expect(highlighted()).toEqual([])
    })

    it('names the loss sink from the requirements that fell into it', async () => {
      await drawn()

      fireEvent.mouseEnter(node('Not carried forward'))
      // Verified: two baseline requirements were not kept.
      expect(highlighted()).toHaveLength(3)
      expect(highlighted()).toContain('No standing training pipeline for relay operators')
    })

    it('brightens only the paths of the hovered node', async () => {
      await drawn()

      fireEvent.mouseEnter(node('No common track identifier across air surveillance systems'))
      const lit = document.querySelectorAll('[data-link][data-highlighted="true"]')
      expect(lit).toHaveLength(3)
      for (const path of lit) {
        expect(path).toHaveAttribute('stroke-opacity', '0.9')
      }
      const rest = [...document.querySelectorAll('[data-link]')].filter(
        (p) => p.getAttribute('data-highlighted') === 'false',
      )
      expect(rest.length).toBeGreaterThan(0)
      for (const path of rest) {
        expect(path).toHaveAttribute('stroke-opacity', '0.05')
      }
    })

    it('reaches nodes by keyboard and highlights on focus', async () => {
      await drawn()

      for (const el of document.querySelectorAll('[data-node]')) {
        expect(el).toHaveAttribute('tabindex', '0')
      }

      const target = node('ORBIT')
      expect(target).toHaveAttribute(
        'aria-label',
        expect.stringContaining('No common track identifier across air surveillance systems'),
      )

      fireEvent.focus(target)
      expect(highlighted()).toEqual(['No common track identifier across air surveillance systems', 'ORBIT'])

      fireEvent.keyDown(target, { key: 'Escape' })
      expect(highlighted()).toEqual([])
    })
  })

  it('filters every card at once', async () => {
    const { user } = await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    expect(table).toHaveAttribute('data-filtered', 'false')

    await user.type(screen.getByRole('searchbox', { name: /filter/i }), 'high')

    expect(table).toHaveAttribute('data-filtered', 'true')
    for (const card of document.querySelectorAll('[data-filtered]')) {
      expect(card).toHaveAttribute('data-filtered', 'true')
    }
    expect(document.querySelectorAll('[data-filtered]')).toHaveLength(5) // 4 cards + the table
  })

  it('dims what the filter does not match', async () => {
    const { user } = await renderWithProvider(<AnalyticsTab />)
    await screen.findByRole('table', { name: /risk heatmap/i })
    await user.type(screen.getByRole('searchbox', { name: /filter/i }), 'high')

    // Verified: DHS S&T holds no high-risk system, and Westfield maps none.
    expect(document.querySelector('[data-group="dhs-st"]')).toHaveAttribute(
      'data-dimmed',
      'true',
    )
    expect(document.querySelector('[data-group="dod"]')).toHaveAttribute(
      'data-dimmed',
      'false',
    )
    expect(document.querySelector('[data-site="westfield"]')).toHaveAttribute(
      'data-dimmed',
      'true',
    )
    expect(document.querySelector('[data-site="northgate"]')).toHaveAttribute(
      'data-dimmed',
      'false',
    )
  })
})
