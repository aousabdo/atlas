import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProvider } from '../../../test/renderWithProvider'
import { ReferenceTab } from '../ReferenceTab'

/** The tab is ready once the Systems table exists; every other assertion in a
 *  test can then be synchronous. */
async function systemsTable() {
  return screen.findByRole('table', { name: /systems/i })
}

describe('Reference & Methodology', () => {
  it('lists all 48 acronyms', async () => {
    await renderWithProvider(<ReferenceTab />)
    const table = await screen.findByRole('table', { name: /acronyms/i })
    expect(within(table).getAllByRole('row')).toHaveLength(49) // 48 + header
    expect(
      within(table).getByRole('columnheader', { name: 'Acronym' }),
    ).toBeInTheDocument()
    expect(within(table).getByText('UNCLASSIFIED//SAMPLE')).toBeInTheDocument()
  })

  it('lists all 32 systems with owner group, risk and status', async () => {
    await renderWithProvider(<ReferenceTab />)
    const table = await systemsTable()
    expect(within(table).getAllByRole('row')).toHaveLength(33) // 32 + header
    expect(
      within(table).getByRole('columnheader', { name: 'Owner group' }),
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('columnheader', { name: 'Mapped at' }),
    ).toBeInTheDocument()
    // 23 confirmed / 9 soft, the golden split.
    expect(within(table).getAllByText('confirmed')).toHaveLength(23)
    expect(within(table).getAllByText('soft')).toHaveLength(9)
  })

  it('distinguishes mapped, checked-absent and never-looked-at systems', async () => {
    await renderWithProvider(<ReferenceTab />)
    const rows = within(await systemsTable()).getAllByRole('row')
    const rowFor = (name: string) =>
      rows.find((row) => within(row).queryByText(name)) as HTMLElement

    expect(within(rowFor('CROSSLINK')).getByText('northgate')).toBeInTheDocument()
    expect(
      within(rowFor('Trackwell Sensor AI')).getByText('checked, not deployed'),
    ).toBeInTheDocument()
    expect(within(rowFor('KITE Relay Plugin')).getByText('not mapped')).toBeInTheDocument()
  })

  it('renders the risk keyword lists from the live classifier config', async () => {
    await renderWithProvider(<ReferenceTab />)
    const high = await screen.findByRole('list', { name: /high risk keywords/i })
    const low = screen.getByRole('list', { name: /low risk keywords/i })
    const medium = screen.getByRole('list', { name: /medium risk keywords/i })

    // Straight from methodology.json. If the Python table changes, this display
    // changes with it, which is the whole point of generating it.
    expect(within(high).getAllByRole('listitem')).toHaveLength(19)
    expect(within(low).getAllByRole('listitem')).toHaveLength(3)
    expect(within(medium).getAllByRole('listitem')).toHaveLength(9)
    expect(within(high).getByText('single point of failure')).toBeInTheDocument()
    expect(within(low).getByText('cosmetic label mismatch')).toBeInTheDocument()
  })

  it('shows the owner rules with their priority and match mode', async () => {
    await renderWithProvider(<ReferenceTab />)
    const table = await screen.findByRole('table', {
      name: /owner classification rules/i,
    })
    expect(within(table).getAllByRole('row')).toHaveLength(24) // 23 + header
    expect(within(table).getAllByText('word_boundary').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('substring').length).toBeGreaterThan(0)

    // Order is load-bearing: CBP AMO must be tested before the bare CBP rule.
    const matches = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1].textContent)
    expect(matches.indexOf('CBP AMO')).toBeLessThan(matches.indexOf('CBP'))
  })

  it('displays the build provenance the old tool hid', async () => {
    const { provider } = await renderWithProvider(<ReferenceTab />)
    const manifest = await provider.getManifest()

    expect(await screen.findByText('Commit')).toBeInTheDocument()
    expect(screen.getByText(manifest.git_sha)).toBeInTheDocument()
    expect(screen.getByText('Built at')).toBeInTheDocument()
    expect(screen.getByText(manifest.built_at)).toBeInTheDocument()
    expect(screen.getByText(manifest.tool_version)).toBeInTheDocument()
    expect(screen.getByText(manifest.source_label)).toBeInTheDocument()

    const counts = await screen.findByRole('table', { name: /bundle counts/i })
    expect(within(counts).getByText('Systems')).toBeInTheDocument()
    expect(
      within(counts).getByText(String(manifest.counts.systems)),
    ).toBeInTheDocument()
  })

  it('surfaces the site classification marking', async () => {
    const { provider } = await renderWithProvider(<ReferenceTab />)
    const project = await provider.getProject()
    const marked = await screen.findAllByText('UNCLASSIFIED//SAMPLE')
    // One badge per site, plus the acronym entry that expands it.
    expect(marked.length).toBeGreaterThanOrEqual(project.sites.length)
  })

  it('states the out-of-scope declarations', async () => {
    await renderWithProvider(<ReferenceTab />)
    const scope = await screen.findByRole('region', { name: /out of scope/i })
    expect(within(scope).getAllByRole('listitem')).toHaveLength(5)
  })

  it('filters both tables together', async () => {
    const { user } = await renderWithProvider(<ReferenceTab />)
    await systemsTable()

    await user.type(screen.getByRole('searchbox', { name: /filter/i }), 'trackwell')

    const systems = screen.getByRole('table', { name: /systems/i })
    expect(within(systems).getAllByRole('row')).toHaveLength(2) // header + Trackwell
    // No acronym mentions Trackwell, so the table is replaced by a statement of
    // that rather than by an empty table someone could read as missing data.
    expect(screen.queryByRole('table', { name: /acronyms/i })).not.toBeInTheDocument()
    expect(screen.getByText('No acronyms match the filter')).toBeInTheDocument()
  })

  it('anchors the five sections at the ids the old tool used', async () => {
    await renderWithProvider(<ReferenceTab />)
    await systemsTable()

    const anchors: [string, string][] = [
      ['confidence', 'Confidence & caveats'],
      ['methodology', 'Methodology'],
      ['systems', 'Systems'],
      ['acronyms', 'Acronyms'],
      ['build', 'Architecture & build'],
    ]
    for (const [id, title] of anchors) {
      expect(screen.getByRole('heading', { name: title, level: 2 })).toHaveAttribute(
        'id',
        id,
      )
    }
  })

  it('reports a failed load instead of an empty table', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network is down'))
    try {
      await renderWithProvider(<ReferenceTab />)
      expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i)
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(screen.queryByText('0')).not.toBeInTheDocument()
    } finally {
      // Restores the bundle-serving stub from src/test/setup.ts, not the real fetch.
      fetchSpy.mockRestore()
    }
  })
})
