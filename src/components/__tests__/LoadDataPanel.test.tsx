import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'

import App from '../../App'
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

function renderApp() {
  const user = userEvent.setup()
  const view = render(
    <MemoryRouter initialEntries={['/reference']}>
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

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
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

    await screen.findByText('TEST//SYNTHETIC')
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
    await screen.findByText('TEST//SYNTHETIC')

    await user.click(screen.getByRole('button', { name: /return to sample/i }))
    expect(banner()).toHaveTextContent(/sample data/i)
    expect(getExportMarking()).toBeNull()
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
    await screen.findByText('TEST//SYNTHETIC')

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
    await screen.findByText(/fixture-matrix\.xlsx/)
    unmount()

    renderApp()
    expect(await screen.findByRole('status', { name: /data source/i })).toHaveTextContent(
      /sample data/i,
    )
  })
})

describe('the marking reaches the exports', () => {
  it('arms the export marking when local data is loaded', async () => {
    const { user } = renderApp()
    const dialog = await openPanel(user)
    await user.upload(within(dialog).getByLabelText(/traceability matrix file/i), fixtureMatrix())
    await user.upload(within(dialog).getByLabelText(/site topology files/i), topologyFile())
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))
    await screen.findByText('TEST//SYNTHETIC')
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
