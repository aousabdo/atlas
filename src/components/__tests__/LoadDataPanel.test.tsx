import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'

import App from '../../App'
import { UNMARKED_NOTICE } from '../../data/ProviderContext'
import { getExportMarking } from '../../export/png'

/**
 * A workbook built here rather than read from anywhere.
 *
 * The reference workbook is controlled material in a read-only repo, so the
 * only honest fixture is one this test writes itself. Every label is invented
 * and describes nothing.
 */
function fixtureMatrix(name = 'fixture-matrix.xlsx'): File {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['Fixture workbook'],
      [],
      [
        'Capability Gap/Requirement', 'Project/System', 'Infrastructure/Technology',
        'Owner Organization', 'Existing Interfaces', 'Risk/Challenge', 'Risk Level',
        'Confirmed',
      ],
      ['Fixture gap one', 'Fixture Widget One', 'Fixture hardware', 'Fixture Org', '', '', 'high', 'yes'],
      ['Fixture gap two', 'Fixture Widget Two', 'Fixture hardware', 'Fixture Org', '', '', 'low', 'no'],
    ]),
    'Matrix',
  )
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['original', 'system', 'current', 'status'],
      ['Fixture original one', 'Fixture Widget One', 'Fixture Widget One', 'Kept'],
    ]),
    'original_to_current_crosswalk',
  )
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([bytes], name)
}

const TOPOLOGY = {
  graph: {
    name: 'Fixture site',
    location: 'Fixture site',
    classification: 'TEST//SYNTHETIC',
    version: '1',
    updated: '2026-01-01',
  },
  zones: { zone_a: { label: 'Zone A' } },
  nodes: [
    { id: 'dev_one', label: 'Device one', zone: 'zone_a', type: 'server', ip: null, subnet: null, description: null },
    { id: 'dev_two', label: 'Device two', zone: 'zone_a', type: 'server', ip: null, subnet: null, description: null },
  ],
  edges: [{ source: 'dev_one', target: 'dev_two', link_type: 'copper', label: null }],
}

function topologyFile(name = 'fixture-site_network.json'): File {
  return new File([JSON.stringify(TOPOLOGY)], name, { type: 'application/json' })
}

/**
 * The shape that breaks a file name guess, invented rather than copied.
 *
 * A real topology carries no site id at all: the site is named inside a long
 * human-written title, and the file is named for the export rather than for
 * the place. So the file name says one thing and the title says another, and
 * only one of them keys the mapping file.
 */
const TITLED_TOPOLOGY = {
  graph: {
    name: 'Fixture Facility Topology - Full Export (Harbor Point)',
    location: 'Harbor Point',
    classification: 'TEST//SYNTHETIC',
    version: '1',
    updated: '2026-01-01',
  },
  zones: TOPOLOGY.zones,
  nodes: TOPOLOGY.nodes,
  edges: TOPOLOGY.edges,
}

function titledTopologyFile(name = 'fixture_network_full.json'): File {
  return new File([JSON.stringify(TITLED_TOPOLOGY)], name, { type: 'application/json' })
}

/** A map keyed by the site id the analyst's other files actually use. */
function deviceMapFile(siteId = 'harbor_point'): File {
  const map = {
    default_site: siteId,
    sites: {
      [siteId]: {
        label: 'Harbor Point',
        scope: 'Fixture scope',
        mappings: {
          fixture_widget_one: {
            devices: ['dev_one'],
            note: 'Fixture mapping',
            confidence: 'high',
          },
        },
        not_deployed_at_site: {},
        unclaimed_devices: { infrastructure: [] },
      },
    },
    pending_review: {},
  }
  return new File([JSON.stringify(map)], 'system_device_map.json', {
    type: 'application/json',
  })
}

function siteIdField(dialog: HTMLElement, fileName: string) {
  return within(dialog).getByLabelText(new RegExp(`site id for ${fileName}`, 'i'))
}

function renderApp(route = '/reference') {
  const user = userEvent.setup()
  const view = render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  )
  return { user, ...view }
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /load data/i }))
  return screen.findByRole('dialog', { name: /load your own data/i })
}

function banner() {
  return screen.getByRole('status', { name: /data source/i })
}

/** jsdom has none, and the topology tab mounts a graph that constructs one. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // The afterEach below unstubs every global, including the ones the shared
  // setup file installs once per file, so anything a later test needs has to
  // be armed per test rather than assumed.
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the load control', () => {
  it('is in the header', async () => {
    renderApp()
    expect(await screen.findByRole('button', { name: /load data/i })).toBeInTheDocument()
  })

  it('opens a panel naming every file it accepts', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    expect(within(dialog).getByLabelText(/traceability matrix file/i)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/overrides file/i)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/glossary file/i)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/system to device map file/i)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/site topology files/i)).toBeInTheDocument()
  })

  it('gives every file a real file input, not only a drop zone', async () => {
    // A drop zone is unreachable by keyboard and invisible to a screen reader.
    const { user } = renderApp()
    const dialog = await openPanel(user)
    const matrix = within(dialog).getByLabelText(/traceability matrix file/i)
    expect(matrix).toHaveAttribute('type', 'file')
  })

  it('closes on Escape', async () => {
    const { user } = renderApp()
    await openPanel(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /load your own data/i })).toBeNull()
  })
})

describe('loading a file', () => {
  it('asks for a matrix rather than loading nothing', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /traceability matrix/i,
    )
  })

  it('surfaces the parser message verbatim instead of a generic failure', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(
      within(dialog).getByLabelText(/traceability matrix file/i),
      new File(['not a spreadsheet'], 'broken.xlsx'),
    )
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(/not a valid xlsx/i)
    expect(alert).toHaveTextContent(/broken\.xlsx/)
  })

  it('leaves the app on the sample when a load fails', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(
      within(dialog).getByLabelText(/traceability matrix file/i),
      new File(['not a spreadsheet'], 'broken.xlsx'),
    )
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))
    await within(dialog).findByRole('alert')
    expect(banner()).toHaveTextContent(/sample data/i)
    expect(getExportMarking()).toBeNull()
  })

  it('swaps the app onto the loaded file and marks it', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))

    await within(
      await screen.findByRole('status', { name: /data source/i }),
    ).findByText('TEST//SYNTHETIC')
    expect(banner()).toHaveTextContent('fixture-matrix.xlsx')
    expect(screen.queryByRole('dialog', { name: /load your own data/i })).toBeNull()
  })

  it('takes a file dropped on the matrix field', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    const zone = within(dialog).getByRole('group', { name: /traceability matrix/i })
    const file = fixtureMatrix('dropped.xlsx')
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(await within(dialog).findByText('dropped.xlsx')).toBeInTheDocument()
  })

  it('goes back to the sample on request', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))
    await within(
      await screen.findByRole('status', { name: /data source/i }),
    ).findByText('TEST//SYNTHETIC')

    await user.click(screen.getByRole('button', { name: /return to sample/i }))
    expect(banner()).toHaveTextContent(/sample data/i)
    expect(getExportMarking()).toBeNull()
  })
})

describe('the site id a topology loads as', () => {
  it('shows the resolved id per file, before the load commits', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(
      within(dialog).getByLabelText(/site topology files/i),
      titledTopologyFile(),
    )
    const field = await within(dialog).findByLabelText(/site id for fixture_network_full/i)
    expect(field).toHaveValue('harbor_point')
  })

  it('reads the site out of the title rather than off the file name', async () => {
    // The defect: a file named for the export, not for the place. The file
    // name yields fixture_network_full, which keys nothing.
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(
      within(dialog).getByLabelText(/site topology files/i),
      titledTopologyFile(),
    )
    await within(dialog).findByLabelText(/site id for fixture_network_full/i)
    expect(within(dialog).getByText(/read from the title/i)).toBeInTheDocument()
    expect(within(dialog).queryByDisplayValue('fixture_network_full')).toBeNull()
  })

  it('says when the id was only guessed from the file name', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())
    await within(dialog).findByLabelText(/site id for fixture-site_network/i)
    expect(within(dialog).getByText(/guessed from the file name/i)).toBeInTheDocument()
  })

  it('keys the loaded site by the id the files agree on, not by the file name', async () => {
    // The consequence the panel exists to prevent: a wrong id does not error,
    // it loads the site with its devices and no coverage at all, which reads
    // as a finding rather than as a naming mismatch.
    const { user } = renderApp('/network')
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(
      within(dialog).getByLabelText(/system to device map file/i),
      deviceMapFile(),
    )
    await user.upload(
      within(dialog).getByLabelText(/site topology files/i),
      titledTopologyFile(),
    )
    await within(dialog).findByLabelText(/site id for fixture_network_full/i)
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))

    await within(
      await screen.findByRole('status', { name: /data source/i }),
    ).findByText('TEST//SYNTHETIC')
    expect(await screen.findByText(/1 systems realized/)).toBeInTheDocument()
    expect(screen.queryByText(/no systems are mapped to this site yet/i)).toBeNull()
  })

  it('lets the analyst correct an id no heuristic could have got right', async () => {
    const { user } = renderApp('/network')
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(
      within(dialog).getByLabelText(/system to device map file/i),
      deviceMapFile(),
    )
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())

    const field = await within(dialog).findByLabelText(/site id for fixture-site_network/i)
    await user.clear(field)
    await user.type(field, 'harbor_point')
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))

    await within(
      await screen.findByRole('status', { name: /data source/i }),
    ).findByText('TEST//SYNTHETIC')
    expect(await screen.findByText(/1 systems realized/)).toBeInTheDocument()
  })

  it('warns, and names the expected ids, when a topology keys nothing', async () => {
    // The whole value of the cross-check: the mismatch is stated before the
    // load rather than discovered as an empty site afterwards.
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(
      within(dialog).getByLabelText(/system to device map file/i),
      deviceMapFile(),
    )
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())

    const warning = await within(dialog).findByRole('alert')
    expect(warning).toHaveTextContent(/fixture_site/)
    expect(warning).toHaveTextContent(/harbor_point/)
    expect(warning).toHaveTextContent(/no coverage/i)
  })

  it('offers the expected ids as choices rather than only complaining', async () => {
    // The map declares an id that NO candidate can reach: the file is named for
    // the export and the title names a different place, so neither the file
    // name nor the title slugs to it. That is the only case left where the
    // analyst has to intervene, now that a candidate matching a declared key
    // wins automatically.
    const { user } = renderApp('/network')
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(
      within(dialog).getByLabelText(/system to device map file/i),
      deviceMapFile(),
    )
    await user.upload(
      within(dialog).getByLabelText(/site topology files/i),
      new File(
        [
          JSON.stringify({
            ...TITLED_TOPOLOGY,
            graph: {
              ...TITLED_TOPOLOGY.graph,
              // Names a different place from the one the map declares, so
              // neither the title nor the file name can reach harbor_point.
              name: 'Fixture Facility Topology - Full Export (Old Wharf)',
            },
          }),
        ],
        'export-042_network.json',
        { type: 'application/json' },
      ),
    )

    await within(dialog).findByRole('alert')
    await user.click(within(dialog).getByRole('button', { name: /use harbor_point/i }))
    expect(siteIdField(dialog, 'export-042_network')).toHaveValue('harbor_point')
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('refuses an empty id rather than keying a site by nothing', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())
    await user.clear(await within(dialog).findByLabelText(/site id for fixture-site_network/i))
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/no site id/i)
    expect(banner()).toHaveTextContent(/sample data/i)
  })

  it('refuses two topologies under one id rather than dropping one', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(within(dialog).getByLabelText(/site topology files/i), [
      topologyFile('one_network.json'),
      topologyFile('two_network.json'),
    ])
    await user.clear(await within(dialog).findByLabelText(/site id for two_network/i))
    await user.type(siteIdField(dialog, 'two_network'), 'one')
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/share the site id/i)
    expect(banner()).toHaveTextContent(/sample data/i)
  })

  it('stays quiet when the map declares the id the topology resolved to', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(
      within(dialog).getByLabelText(/system to device map file/i),
      deviceMapFile(),
    )
    await user.upload(
      within(dialog).getByLabelText(/site topology files/i),
      titledTopologyFile(),
    )
    await within(dialog).findByLabelText(/site id for fixture_network_full/i)
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })
})

describe('nothing is persisted', () => {
  it('writes no browser storage and opens no database', async () => {
    // The rule most likely to be broken later by someone adding a convenience:
    // parsed controlled data must not outlive the tab.
    const open = vi.fn()
    vi.stubGlobal('indexedDB', { open, deleteDatabase: vi.fn(), databases: vi.fn() })
    const caches = { open: vi.fn(), keys: vi.fn() }
    vi.stubGlobal('caches', caches)
    const register = vi.fn()
    vi.stubGlobal('navigator', {
      ...window.navigator,
      serviceWorker: { register },
    })

    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())

    // Snapshotted after mount, so the theme preference the app legitimately
    // keeps is part of the baseline and the loading is the only variable.
    const localBefore = JSON.stringify({ ...localStorage })
    const sessionBefore = JSON.stringify({ ...sessionStorage })

    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))
    await within(
      await screen.findByRole('status', { name: /data source/i }),
    ).findByText('TEST//SYNTHETIC')

    expect(JSON.stringify({ ...localStorage })).toBe(localBefore)
    expect(JSON.stringify({ ...sessionStorage })).toBe(sessionBefore)
    // Nothing from the file, under any key, however it was spelled.
    const stored = JSON.stringify({ ...localStorage, ...sessionStorage })
    expect(stored).not.toMatch(/TEST\/\/SYNTHETIC/)
    expect(stored).not.toMatch(/Fixture Widget/)
    expect(stored).not.toMatch(/fixture-matrix/)
    expect(open).not.toHaveBeenCalled()
    expect(caches.open).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  })

  it('comes back up on the sample, because a reload has nothing to restore', async () => {
    const { user, unmount } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))
    await within(
      await screen.findByRole('status', { name: /data source/i }),
    ).findByText(/fixture-matrix\.xlsx/)
    unmount()

    renderApp()
    expect(await screen.findByRole('status', { name: /data source/i })).toHaveTextContent(
      /sample data/i,
    )
  })
})

describe('the analyst can state a marking the files omit', () => {
  it('keeps the explicit notice when nothing declares one and nothing is typed', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))
    // The banner's own badge, not the file name, which the panel is already
    // showing and which would therefore match before the load commits.
    await screen.findByText(UNMARKED_NOTICE)
    expect(banner()).toHaveTextContent(UNMARKED_NOTICE)
    expect(getExportMarking()).toBe(UNMARKED_NOTICE)
  })

  it('carries a typed marking into the banner and the exports', async () => {
    // The case the marking exists for: controlled data whose files carry no
    // classification field at all, which otherwise exports unmarked.
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.type(within(dialog).getByLabelText(/control marking/i), 'TEST//STATED')
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))

    await screen.findByText('TEST//STATED')
    expect(getExportMarking()).toBe('TEST//STATED')
    expect(banner()).not.toHaveTextContent(UNMARKED_NOTICE)
  })

  it('says what the files declare, so the field is not a blank guess', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())
    expect(
      await within(dialog).findByText(/the loaded files declare TEST\/\/SYNTHETIC/i),
    ).toBeInTheDocument()
  })

  it('lets the analyst outrank the files, and shows both so it is never silent', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())
    await user.type(within(dialog).getByLabelText(/control marking/i), 'TEST//STATED')
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))

    await screen.findByText('TEST//STATED')
    expect(getExportMarking()).toBe('TEST//STATED')
    // The overridden value is still on screen, named as the files' own.
    expect(banner()).toHaveTextContent(/files declare TEST\/\/SYNTHETIC/i)
  })

  it('leaves the files in charge when the analyst types nothing', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))

    await within(
      await screen.findByRole('status', { name: /data source/i }),
    ).findByText('TEST//SYNTHETIC')
    expect(getExportMarking()).toBe('TEST//SYNTHETIC')
    expect(banner()).not.toHaveTextContent(/stated by the analyst/i)
  })
})

describe('the marking reaches the exports', () => {
  it('arms the export marking when local data is loaded', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))
    // Scoped to the banner on purpose. The panel also prints the marking, as
    // what the files declared, so an unscoped query matches twice for as long
    // as the dialog is still mounted and the test races its unmount.
    const banner = await screen.findByRole('status', { name: /data source/i })
    await within(banner).findByText('TEST//SYNTHETIC')
    expect(getExportMarking()).toBe('TEST//SYNTHETIC')
  })

  it('burns a band above and below a PNG capture', async () => {
    const { stampMarking } = await import('../../export/png')
    const calls: string[] = []
    const context = {
      fillStyle: '', font: '', textAlign: '', textBaseline: '',
      fillRect: () => calls.push('fillRect'),
      fillText: (text: string) => calls.push(`fillText:${text}`),
      drawImage: (_img: unknown, x: number, y: number) => calls.push(`drawImage:${x},${y}`),
    }
    const capture = { width: 400, height: 300, getContext: () => context }
    const blank = (width: number, height: number) => ({
      width, height, getContext: () => context,
    })

    const stamped = stampMarking(capture, 'TEST//SYNTHETIC', '#000', blank)

    expect(stamped.width).toBe(400)
    expect(stamped.height).toBeGreaterThan(300)
    const band = (stamped.height - 300) / 2
    expect(calls).toContain(`drawImage:0,${band}`)
    expect(calls.filter((c) => c === 'fillText:TEST//SYNTHETIC')).toHaveLength(2)
  })

  it('leaves a capture untouched when there is no marking', async () => {
    const { stampMarking } = await import('../../export/png')
    const capture = { width: 10, height: 10, getContext: () => null }
    expect(stampMarking(capture, null, '#000', () => capture)).toBe(capture)
  })

  it('stamps every PDF page top and bottom', async () => {
    const { stampPdfMarking } = await import('../../export/pdf')
    const text = vi.fn()
    const doc = {
      setFontSize: vi.fn(),
      setTextColor: vi.fn(),
      text,
      internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
    }
    stampPdfMarking(doc, 'TEST//SYNTHETIC')
    expect(text).toHaveBeenCalledTimes(2)
    const ys = text.mock.calls.map((call) => call[2] as number)
    expect(Math.min(...ys)).toBeLessThan(36)
    expect(Math.max(...ys)).toBeGreaterThan(756)
    for (const call of text.mock.calls) expect(call[0]).toBe('TEST//SYNTHETIC')
  })

  it('opens and closes a marked CSV with the marking', async () => {
    const { toCsv } = await import('../../export/csv')
    const csv = toCsv([{ id: 'a' }], ['id'], { marking: 'TEST//SYNTHETIC' })
    const lines = csv.split('\n')
    expect(lines[0]).toBe('"TEST//SYNTHETIC"')
    expect(lines[1]).toBe('id')
    expect(lines[lines.length - 1]).toBe('"TEST//SYNTHETIC"')
  })

  it('marks a CSV from the armed marking when the caller passes none', async () => {
    const { toCsv, markedCsv } = await import('../../export/csv')
    const { setExportMarking } = await import('../../export/png')
    setExportMarking('TEST//SYNTHETIC')
    try {
      expect(markedCsv([{ id: 'a' }], ['id']).split('\n')[0]).toBe('"TEST//SYNTHETIC"')
      // The unmarked helper stays literal, so the existing callers do not move.
      expect(toCsv([{ id: 'a' }], ['id']).split('\n')[0]).toBe('id')
    } finally {
      setExportMarking(null)
    }
  })
})
