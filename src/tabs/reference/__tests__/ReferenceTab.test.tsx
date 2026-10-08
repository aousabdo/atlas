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

  it('names the shortfall rows beside the per-site 10 of 30', async () => {
    await renderWithProvider(<ReferenceTab />)
    await screen.findByText('10 of 30')
    const notes = screen.getAllByText(/Not counted: 2 shortfall rows/)
    expect(notes.length).toBeGreaterThan(0)
    expect(notes[0]).toHaveTextContent(/Dispatch Management System.*Partner Agency Data Sharing/)
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

  it('says nothing about a partial glossary when the glossary is whole', async () => {
    await renderWithProvider(<ReferenceTab />)
    await systemsTable()
    expect(
      screen.queryByRole('region', { name: /partial glossary/i }),
    ).not.toBeInTheDocument()
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

/**
 * A glossary is hand-edited, so it arrives incomplete sooner or later.
 *
 * Every key of it is optional to the views that read it: it contributes
 * acronym expansions and prose, and nothing else on this tab or any other
 * depends on it. So a missing key must cost the reader that key and nothing
 * more, and the tab has to say which key it lost rather than draw an empty
 * box a reader would take for a reviewed emptiness.
 *
 * Content below is invented for these tests.
 */
describe('Reference & Methodology with a partial glossary', () => {
  const WHOLE = {
    confidence_intro: 'Sample intro sentence supplied by this test.',
    out_of_scope: ['Sample exclusion one', 'Sample exclusion two'],
    methodology_extras: {
      risk_caveat: 'Sample risk caveat.',
      mapping_confidence_scale: 'Sample mapping scale note.',
      soft_ownership_note: 'Sample soft ownership note.',
    },
    acronyms: [
      { acr: 'AAA', meaning: 'Sample expansion one' },
      { acr: 'BBB', meaning: 'Sample expansion two' },
    ],
  }

  /** Serves a hand-edited glossary and leaves every other bundle to the stub in
   *  src/test/setup.ts, so this exercises the real StaticProvider path. */
  function serveGlossary(body: Record<string, unknown>) {
    const bundles = globalThis.fetch
    return vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('glossary.json')) {
          return Promise.resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          )
        }
        return bundles(input, init)
      })
  }

  function without(...keys: string[]) {
    const body: Record<string, unknown> = { ...WHOLE }
    for (const key of keys) delete body[key]
    return body
  }

  /** Renders the tab over `body` and returns the partial-glossary panel, having
   *  first proved the tab rendered at all. */
  async function renderWith(body: Record<string, unknown>) {
    const spy = serveGlossary(body)
    try {
      await renderWithProvider(<ReferenceTab />)
      // Every section the glossary does not feed is still here.
      expect(await systemsTable()).toBeInTheDocument()
      expect(
        screen.getByRole('table', { name: /owner classification rules/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: 'Architecture & build' }),
      ).toBeInTheDocument()
      return screen.getByRole('region', { name: /partial glossary/i })
    } finally {
      spy.mockRestore()
    }
  }

  it('renders the tab and names the intro when confidence_intro is missing', async () => {
    const panel = await renderWith(without('confidence_intro'))
    expect(within(panel).getByText('Confidence intro')).toBeInTheDocument()
    expect(within(panel).getAllByRole('listitem')).toHaveLength(1)
    // The keys that were supplied still show their content.
    expect(screen.getByText('Sample risk caveat.')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /acronyms/i })).toBeInTheDocument()
  })

  it('renders the tab and names the exclusions when out_of_scope is missing', async () => {
    const panel = await renderWith(without('out_of_scope'))
    expect(within(panel).getByText('Out of scope declarations')).toBeInTheDocument()
    expect(within(panel).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Sample intro sentence supplied by this test.'))
      .toBeInTheDocument()
  })

  it('renders the tab and names all three caveats when methodology_extras is missing',
    async () => {
      const panel = await renderWith(without('methodology_extras'))
      const named = within(panel)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
      expect(named).toEqual([
        'Risk caveat',
        'Mapping confidence scale',
        'Soft ownership note',
      ])
    })

  it('names only the caveat that is missing from a partial extras block', async () => {
    const panel = await renderWith({
      ...WHOLE,
      methodology_extras: { risk_caveat: 'Sample risk caveat.' },
    })
    const named = within(panel)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(named).toEqual(['Mapping confidence scale', 'Soft ownership note'])
    expect(screen.getByText('Sample risk caveat.')).toBeInTheDocument()
  })

  it('renders the tab and names the acronyms when acronyms is missing', async () => {
    const panel = await renderWith(without('acronyms'))
    expect(within(panel).getByText('Acronyms')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /acronyms/i })).not.toBeInTheDocument()
    expect(screen.getByText('No acronyms in this bundle')).toBeInTheDocument()
  })

  it('names every key a glossary missing several of them left out', async () => {
    const panel = await renderWith(without('confidence_intro', 'methodology_extras'))
    const named = within(panel)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(named).toEqual([
      'Confidence intro',
      'Risk caveat',
      'Mapping confidence scale',
      'Soft ownership note',
    ])
  })

  it('renders the tab over a glossary with no keys at all', async () => {
    const panel = await renderWith({})
    const named = within(panel)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    // Named in the order the glossary declares them, so a reader can scan their
    // own file top to bottom against this list.
    expect(named).toEqual([
      'Confidence intro',
      'Out of scope declarations',
      'Risk caveat',
      'Mapping confidence scale',
      'Soft ownership note',
      'Acronyms',
    ])
    // Said once, in words, rather than left as blank boxes to be read as reviewed.
    expect(panel).toHaveTextContent(/supplied no content/i)
  })

  it('treats a key present but null as absent rather than crashing on it', async () => {
    const panel = await renderWith({
      ...WHOLE,
      acronyms: null,
      out_of_scope: null,
    })
    const named = within(panel)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(named).toEqual(['Out of scope declarations', 'Acronyms'])
  })
})
