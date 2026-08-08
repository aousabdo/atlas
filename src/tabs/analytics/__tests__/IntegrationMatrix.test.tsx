import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StaticProvider } from '../../../data/StaticProvider'
import type { LinkSet } from '../../../types/atlas'
import { ownerGroups } from '../AnalyticsTab'
import { IntegrationMatrix } from '../IntegrationMatrix'

/**
 * Owner organization first, then risk inside it, then name. Verified
 * 2026-08-07 against public/data: this is the order the axes must read in, and
 * it is what puts each organization's own integrations on the diagonal so the
 * cross-organization holes fall outside it.
 */
const AXIS = [
  'crosslink', 'ucop',
  'orbit', 'scan', 'cbprel', 'cbpsen', 'gantry', 'recon',
  'bastion', 'dispatch', 'fpsrel', 'partner', 'eventrel', 'icerel', 'jetty',
  'kite', 'tagpoint', 'trackwell', 'uscgrel', 'ussrel', 'winrel', 'homing',
  'beacon', 'ember', 'fathom', 'enterprise',
  'halyard',
  'cirrus', 'dwell', 'ingot', 'civair', 'skyward',
]

interface Options {
  links?: LinkSet
  filterActive?: boolean
  matchedIds?: ReadonlySet<string>
}

async function matrix(options: Options = {}) {
  const provider = new StaticProvider('/data')
  const systems = await provider.getSystems()
  const links = options.links ?? (await provider.getLinks())
  const result = render(
    <IntegrationMatrix
      groups={ownerGroups(systems)}
      links={links}
      filterActive={options.filterActive ?? false}
      matchedIds={options.matchedIds ?? new Set(systems.map((s) => s.id))}
    />,
  )
  const table = await screen.findByRole('table', { name: /integration gap matrix/i })
  return { ...result, table, systems, links }
}

const cell = (table: HTMLElement, row: string, col: string) =>
  table.querySelector<HTMLElement>(
    `td[data-row="${row}"][data-col="${col}"]`,
  ) as HTMLElement

const stateCount = (table: HTMLElement, state: string) =>
  table.querySelectorAll(`td[data-state="${state}"]`).length

/** Every cell that carries a state, which is every cell the reader is shown. */
const drawn = (table: HTMLElement) => [
  ...table.querySelectorAll<HTMLElement>('td[data-state]'),
]

/** 32 axis entries, one cell per unordered pair. */
const PAIRS = (32 * 31) / 2

/** The notes wrap their figure in a span, so match on the whole paragraph. */
const note = (pattern: RegExp) => (_: string, el: Element | null) =>
  el?.tagName === 'P' && pattern.test(el.textContent ?? '')

describe('IntegrationMatrix', () => {
  it('puts the same 32 systems on both axes, grouped by owner then risk', async () => {
    const { table } = await matrix()
    const rows = [...table.querySelectorAll('th[data-row]')].map(
      (th) => (th as HTMLElement).dataset.row,
    )
    const cols = [...table.querySelectorAll('th[data-col]')].map(
      (th) => (th as HTMLElement).dataset.col,
    )
    expect(rows).toEqual(AXIS)
    expect(cols).toEqual(AXIS)
    // Half the square, so the columns still line up under their headers while
    // each pair is drawn once. 496 drawn and 528 held open is the whole 1024.
    expect(drawn(table)).toHaveLength(PAIRS)
    expect(table.querySelectorAll('td[data-half="undrawn"]')).toHaveLength(1024 - PAIRS)
  })

  it('draws each pair once, below the diagonal, and never its mirror', async () => {
    const { table } = await matrix()
    const at = (id: string) => AXIS.indexOf(id)
    // The defect this pins: with both halves drawn, 13 gaps became 26 marks
    // and the sentence above the grid disagreed with the picture.
    for (const cell of drawn(table)) {
      const { row, col } = cell.dataset
      expect(at(row!)).toBeGreaterThan(at(col!))
    }
    const seen = drawn(table).map((cell) => [cell.dataset.row, cell.dataset.col].sort().join(' '))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('shows exactly as many gaps as the sentence above the grid claims', async () => {
    const { table } = await matrix()
    // Read back from the rendered text rather than from the fixture, so the
    // headline and the marks cannot drift apart without this failing.
    const headline = screen.getByText(
      (_, el) =>
        el?.tagName === 'P' && /desired\s+integrations have no recorded link/.test(el.textContent ?? ''),
    )
    const claimed = Number(/^(\d+) of/.exec(headline.textContent ?? '')![1])
    expect(claimed).toBeGreaterThan(0)
    expect(stateCount(table, 'missing')).toBe(claimed)
  })

  it('gives every state it draws a legend entry, and draws no state it omits', async () => {
    const { table } = await matrix()
    const states = new Set(drawn(table).map((cell) => cell.dataset.state))
    // The diagonal used to be a fourth state with no entry here and no
    // contrast against the third.
    expect(states).toEqual(new Set(['current', 'missing', 'none']))
    const legend = screen.getByRole('list', { name: /what each cell means/i })
    expect(within(legend).getAllByRole('listitem')).toHaveLength(states.size)
  })

  it('names both axes for a screen reader rather than only abbreviating them', async () => {
    const { table } = await matrix()
    expect(
      within(table).getByRole('columnheader', { name: 'Recon Systems' }),
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('rowheader', { name: 'Recon Systems' }),
    ).toBeInTheDocument()
  })

  it('labels each owner block so the chosen grouping is readable', async () => {
    const { table } = await matrix()
    const blocks = [...table.querySelectorAll('th[data-owner-group]')].map(
      (th) => (th as HTMLElement).dataset.ownerGroup,
    )
    expect(blocks).toEqual(['dhs-st', 'cbp', 'otherdhs', 'dhshq', 'dod', 'ext'])
  })

  it('marks a recorded link on the one cell that pair has', async () => {
    const { table } = await matrix()
    // Verified: Trackwell Sensor AI feeds the Jetty engine today. Trackwell is
    // below Jetty on the axis, so the pair lives on the Trackwell row.
    expect(cell(table, 'trackwell', 'jetty')).toHaveAttribute('data-state', 'current')
    expect(cell(table, 'jetty', 'trackwell')).not.toHaveAttribute('data-state')
    expect(cell(table, 'jetty', 'trackwell')).toHaveAttribute('data-half', 'undrawn')
  })

  it('marks a link the architecture calls for and does not have as a gap', async () => {
    const { table } = await matrix()
    // Verified: CBP Relay to ORBIT is on the desired list and nowhere in current.
    expect(cell(table, 'cbprel', 'orbit')).toHaveAttribute('data-state', 'missing')
    expect(cell(table, 'orbit', 'cbprel')).not.toHaveAttribute('data-state')
    expect(cell(table, 'halyard', 'orbit')).toHaveAttribute('data-state', 'none')
  })

  it('draws no diagonal, because a system does not integrate with itself', async () => {
    const { table } = await matrix()
    expect(cell(table, 'orbit', 'orbit')).toHaveAttribute('data-half', 'undrawn')
    expect(cell(table, 'orbit', 'orbit')).not.toHaveAttribute('data-state')
    expect(stateCount(table, 'self')).toBe(0)
    // The edge of the drawn half is a border rather than a fill, because two
    // adjacent surface tones are not a difference a reader can see.
    expect(cell(table, 'orbit', 'orbit').className).toMatch(/border-line/)
  })

  it('agrees with the integration gap dimension on what is missing', async () => {
    const { table } = await matrix()
    const bundled = await new StaticProvider('/data').getLossiness()
    const gap = bundled.dimensions.find((d) => d.key === 'integration_gap')!

    // One cell per unordered pair: 14 current and 13 desired-but-absent, which
    // is the dimension's own numerator, not twice it.
    expect(stateCount(table, 'missing')).toBe(gap.numerator)
    expect(stateCount(table, 'current')).toBe(14)
    expect(stateCount(table, 'none')).toBe(PAIRS - 14 - gap.numerator)
  })

  it('lists every missing link in words, with the label the data gives it', async () => {
    const { table } = await matrix()
    const gaps = screen.getByRole('list', {
      name: /desired integrations that do not exist/i,
    })
    expect(within(gaps).getAllByRole('listitem')).toHaveLength(13)
    // Verified: three of the thirteen name the CBP relay.
    expect(
      within(gaps)
        .getAllByRole('listitem')
        .filter((li) => /CBP Relay/.test(li.textContent ?? '')),
    ).toHaveLength(3)
    expect(within(gaps).getByText(/DMS ↔ Relay CoT auto-populate/)).toBeInTheDocument()
    expect(table).toBeInTheDocument()
  })

  it('reaches a marked cell by keyboard and names the pair it stands for', async () => {
    const { table } = await matrix()
    const gap = cell(table, 'cbprel', 'orbit')
    expect(gap).toHaveAttribute('tabindex', '0')
    expect(gap.getAttribute('aria-label')).toMatch(/CBP Relay/)
    expect(gap.getAttribute('aria-label')).toMatch(/ORBIT/)
    expect(gap.getAttribute('aria-label')).toMatch(/desired/i)

    fireEvent.focus(gap)
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('CBP Relay ↔ ORBIT')
    expect(gap).toHaveAttribute('aria-describedby', tip.id)

    fireEvent.blur(gap)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('keeps the empty cells out of the tab order, and each pair on one stop', async () => {
    const { table } = await matrix()
    const reachable = [...table.querySelectorAll('td[tabindex="0"]')]
    // 27 marks, 27 stops. It was 54: every pair was reached twice, the second
    // time with the two systems named in the other order.
    expect(reachable).toHaveLength(14 + 13)
    expect(cell(table, 'halyard', 'orbit')).not.toHaveAttribute('tabindex')
  })

  it('distinguishes the two marks by more than colour', async () => {
    const { table } = await matrix()
    // A recorded link is a solid fill; a gap is hatched, so the difference
    // survives a monochrome print and a colour vision deficiency.
    expect(cell(table, 'cbprel', 'orbit').style.backgroundImage).toMatch(
      /repeating-linear-gradient/,
    )
    expect(cell(table, 'jetty', 'trackwell').style.backgroundImage).toBe('')
  })

  it('gives the wide grid its own scroller so the page never scrolls sideways', async () => {
    const { table } = await matrix()
    const scroller = table.closest('[data-scroll="x"]') as HTMLElement
    expect(scroller).toBeTruthy()
    expect(scroller.className).toMatch(/overflow-x-auto/)
    expect(scroller.className).toMatch(/max-w-full/)
    // Not cosmetic: the rotated column headers escape a static scroll
    // container and take the window scrollbar with them. jsdom lays nothing
    // out, so this is the only place the requirement can be pinned.
    expect(scroller.className).toMatch(/\brelative\b/)
  })

  it('dims the rows and columns the filter does not match', async () => {
    const { table } = await matrix({
      filterActive: true,
      matchedIds: new Set(['orbit', 'cbprel']),
    })
    expect(
      table.querySelector('th[data-row="orbit"]'),
    ).toHaveAttribute('data-dimmed', 'false')
    expect(
      table.querySelector('th[data-row="halyard"]'),
    ).toHaveAttribute('data-dimmed', 'true')
    expect(cell(table, 'cbprel', 'orbit')).toHaveAttribute('data-dimmed', 'false')
    expect(cell(table, 'trackwell', 'jetty')).toHaveAttribute('data-dimmed', 'true')
  })

  it('says so when a link names a system the matrix does not carry', async () => {
    const links: LinkSet = {
      current: [
        { from: 'ghost', to: 'orbit', label: 'Ghost to ORBIT', extraction_method: 'prose' },
      ],
      desired: [
        { from: 'orbit', to: 'cbprel', label: 'ORBIT to CBP Relay', extraction_method: 'prose' },
      ],
    }
    const { table } = await matrix({ links })
    expect(stateCount(table, 'current')).toBe(0)
    expect(stateCount(table, 'missing')).toBe(1)
    expect(
      screen.getByText(note(/1 recorded link names a system the matrix does not carry/i)),
    ).toBeInTheDocument()
  })

  it('says so when a link joins a system to itself, which has no cell', async () => {
    const links: LinkSet = {
      current: [
        { from: 'orbit', to: 'orbit', label: 'ORBIT internal', extraction_method: 'prose' },
      ],
      desired: [],
    }
    const { table } = await matrix({ links })
    expect(cell(table, 'orbit', 'orbit')).toHaveAttribute('data-half', 'undrawn')
    expect(
      screen.getByText(note(/1 recorded link joins a system to itself/i)),
    ).toBeInTheDocument()
  })

  it('draws a desired link that already exists as current, not as a gap', async () => {
    const links: LinkSet = {
      current: [
        { from: 'orbit', to: 'cbprel', label: 'ORBIT to CBP Relay', extraction_method: 'prose' },
      ],
      desired: [
        { from: 'cbprel', to: 'orbit', label: 'CBP Relay ↔ ORBIT', extraction_method: 'override' },
      ],
    }
    const { table } = await matrix({ links })
    expect(stateCount(table, 'current')).toBe(1)
    expect(stateCount(table, 'missing')).toBe(0)
    expect(
      screen.getByText(/Every desired integration is recorded as current/i),
    ).toBeInTheDocument()
  })
})
