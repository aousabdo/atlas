import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithProvider } from '../../../test/renderWithProvider'
import { AnalyticsTab } from '../AnalyticsTab'

async function panel() {
  const rendered = await renderWithProvider(<AnalyticsTab />)
  const region = await screen.findByRole('region', { name: /What to build next/ })
  const table = within(region).getByRole('table', { name: /planned integrations/i })
  return { ...rendered, region, table }
}

const bodyRows = (table: HTMLElement) =>
  within(table).getAllByRole('row').filter((row) => row.dataset.link !== undefined)

describe('What to build next', () => {
  it('states the facts about the wish list in plain counts', async () => {
    const { region } = await panel()
    const summary = within(region).getByText(/^13 planned integrations\./)
    expect(summary).toHaveTextContent('8 have both owners confirmed and 1 has neither.')
    expect(summary).toHaveTextContent('4 cross from one owner group to another.')
    expect(summary).toHaveTextContent(
      '1 would join two systems a requirement was split across, and 5 touch no requirement at either end.',
    )
    expect(summary).toHaveTextContent(
      "12 would join systems with no path between them through today's integrations.",
    )
    expect(
      within(region).getByText(/None can be checked against a site drawing yet/),
    ).toHaveTextContent(
      'at Northgate Sports Campus every one has an end checked absent, and Westfield Proving Ground has not been reviewed.',
    )
  })

  it('lists every planned integration once, with no score or rank', async () => {
    const { table } = await panel()
    expect(bodyRows(table)).toHaveLength(13)
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.join(' ')).not.toMatch(/score|rank/i)
  })

  it('sorts by one fact at a time', async () => {
    const { user, table } = await panel()
    await user.click(within(table).getByRole('button', { name: /^Requirements/ }))
    expect(bodyRows(table)[0]).toHaveAttribute('data-link', 'beacon|orbit')
    expect(within(table).getByRole('columnheader', { name: /Requirements/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    await user.click(within(table).getByRole('button', { name: /^Owners/ }))
    // Neither owner confirmed sorts last.
    expect(bodyRows(table).at(-1)).toHaveAttribute('data-link', 'ingot|jetty')
  })

  it('says when an end of a planned integration is a shortfall row', async () => {
    const { table } = await panel()
    const row = bodyRows(table).find((r) => r.dataset.link === 'dispatch|eventrel')!
    expect(row).toHaveTextContent(/Dispatch Management System \(DMS\/CAD\) is a shortfall row/)
  })

  it('sorts the Today column one way: no path first, then farther apart', async () => {
    const { user, table } = await panel()
    await user.click(within(table).getByRole('button', { name: /^Today/ }))
    // dispatch-eventrel is the only pair joined today; it sorts last.
    expect(bodyRows(table).at(-1)).toHaveAttribute('data-link', 'dispatch|eventrel')
  })

  it('says a chain of recorded integrations joins two systems, not that data reaches', async () => {
    const { user, table } = await panel()
    const row = bodyRows(table).find((r) => r.dataset.link === 'dispatch|eventrel')!
    expect(row).toHaveTextContent('4 links apart')
    await user.click(within(table).getByRole('button', { name: /^Dispatch Management System/ }))
    const detail = within(table).getByRole('row', { name: /Dispatch .* in detail/ })
    expect(detail).toHaveTextContent(/a chain of 4 recorded integrations joins them today, via /)
    expect(detail).toHaveTextContent(/says nothing about whether data passes along it/)
    expect(detail).not.toHaveTextContent(/reachable/)
  })

  it('dims an open detail row with its row when the filter misses both ends', async () => {
    const { user, table } = await panel()
    await user.click(within(table).getByRole('button', { name: /^Beacon – ORBIT/ }))
    await user.type(screen.getByRole('searchbox', { name: /filter/i }), 'bastion')
    const detail = within(table).getByRole('row', { name: /Beacon – ORBIT in detail/ })
    expect(detail).toHaveAttribute('data-dimmed', 'true')
  })

  it('opens a row onto the requirements and sites behind its facts', async () => {
    const { user, table } = await panel()
    await user.click(within(table).getByRole('button', { name: /^Beacon – ORBIT/ }))
    const detail = within(table).getByRole('row', { name: /Beacon – ORBIT in detail/ })
    expect(detail).toHaveTextContent('Joins: No common track identifier across air surveillance systems')
    expect(detail).toHaveTextContent(/Northgate Sports Campus: Beacon is checked absent here and ORBIT is checked absent here/)
    expect(detail).toHaveTextContent(/Westfield Proving Ground: not reviewed/)
    // The short form names the same reason, not a softer one.
    const row = bodyRows(table).find((r) => r.dataset.link === 'beacon|orbit')!
    expect(row).toHaveTextContent('Northgate Sports Campus: an end checked absent')
  })
})
