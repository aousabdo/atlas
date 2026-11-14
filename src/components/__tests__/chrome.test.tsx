import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import App, { Shell } from '../../App'
import { useCuration, type Curation } from '../../curation/CurationContext'
import { SAMPLE_WALK } from '../../curation/__tests__/sampleWalk'
import { AtlasProvider } from '../../data/ProviderContext'
import * as png from '../../export/png'
import { ABOUT } from '../aboutContent'
import { EditsBanner } from '../EditsBanner'

function at(path: string) {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  return { user }
}

describe('shortcuts dialog', () => {
  it('opens from the toolbar button', async () => {
    const { user } = at('/reference')
    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }))
    expect(await screen.findByRole('dialog', { name: /keyboard shortcuts/i })).toBeInTheDocument()
  })

  it('opens on ?', async () => {
    const { user } = at('/reference')
    await user.keyboard('?')
    expect(await screen.findByRole('dialog', { name: /keyboard shortcuts/i })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const { user } = at('/reference')
    await user.keyboard('?')
    await screen.findByRole('dialog', { name: /keyboard shortcuts/i })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).not.toBeInTheDocument()
  })

  it('says shortcuts are ignored while typing, which is what the hook does', async () => {
    const { user } = at('/reference')
    await user.keyboard('?')
    const dialog = await screen.findByRole('dialog', { name: /keyboard shortcuts/i })
    expect(within(dialog).getByText(/ignored while you are typing/i)).toBeInTheDocument()
  })

  it('does not claim the network shortcuts need focus first', async () => {
    // The tool being replaced had to say "click into the network graph first".
    // One document means that caveat is gone, and it must not be reintroduced.
    const { user } = at('/reference')
    await user.keyboard('?')
    const dialog = await screen.findByRole('dialog', { name: /keyboard shortcuts/i })
    expect(within(dialog).queryByText(/click into/i)).not.toBeInTheDocument()
  })
})

describe('number keys jump between views', () => {
  // Asserted on the active tab rather than the rendered view: this is a test
  // of the shortcut, and waiting for the map to build a few hundred SVG
  // elements would make it slow and flaky for no extra coverage. The routes
  // suite already proves each view renders.
  it.each([
    ['1', 'Reference & Methodology'],
    ['2', 'Analytics'],
    ['3', 'Lossiness'],
    ['4', 'Network Topology'],
    ['5', 'Orientation Map'],
  ])('%s selects its tab', async (key, label) => {
    const { user } = at('/analytics')
    await user.keyboard(key)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-current', 'page')
    })
  })
})

describe('about drawer', () => {
  it('opens for the current view and names it', async () => {
    const { user } = at('/lossiness')
    await user.click(await screen.findByRole('button', { name: 'About' }))
    expect(
      await screen.findByRole('dialog', { name: /About Lossiness/i }),
    ).toBeInTheDocument()
  })

  it('opens on A and closes on Escape', async () => {
    const { user } = at('/analytics')
    await user.keyboard('a')
    await screen.findByRole('dialog', { name: /About Analytics/i })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /About Analytics/i })).not.toBeInTheDocument()
  })

  it('has content for every view', () => {
    expect(Object.keys(ABOUT).sort()).toEqual([
      'analytics', 'lossiness', 'map', 'network', 'reference',
    ])
  })

  it('hardcodes no counts, because prose cannot follow the data', () => {
    // The old drawer said "71 devices" and "49 of them" and went stale.
    for (const [view, content] of Object.entries(ABOUT)) {
      const prose = [content.lead, ...content.sections.map((s) => s.body)].join(' ')
      expect(prose, `${view} states a bare count`).not.toMatch(/\b\d{2,}\b/)
    }
  })
})

describe('export menu', () => {
  it('offers PNG and PDF', async () => {
    at('/reference')
    expect(await screen.findByRole('button', { name: 'PNG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PDF' })).toBeInTheDocument()
  })

  it('reports a failure instead of silently doing nothing', async () => {
    // html2canvas cannot run in jsdom. The point is that the failure surfaces.
    const { user } = at('/reference')
    await user.click(await screen.findByRole('button', { name: 'PNG' }))
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      /Export failed/i,
    )
  })

  it('marks its own controls so they stay out of the capture', async () => {
    at('/reference')
    const png = await screen.findByRole('button', { name: 'PNG' })
    expect(png.closest('[data-export-omit]')).not.toBeNull()
  })
})

describe('the E key', () => {
  it('saves the view as a PNG, not the reviews, while the reviews banner is showing', async () => {
    // The reviews banner carries an Export button of its own, and it is
    // chrome too. E must reach the export menu's PNG button whatever else
    // the page holds and in whatever order, so a second banner is mounted
    // ahead of the whole shell, where the old selector found it first.
    const capture = vi.spyOn(png, 'elementToPngBlob').mockResolvedValue(new Blob(['png']))
    const download = vi.spyOn(png, 'downloadBlob').mockImplementation(() => {})
    let curation: Curation | null = null
    function Probe() {
      curation = useCuration()
      return null
    }
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/reference']}>
        <AtlasProvider>
          <EditsBanner />
          <Shell />
          <Probe />
        </AtlasProvider>
      </MemoryRouter>,
    )
    act(() => (curation as unknown as Curation).apply(SAMPLE_WALK[0]))
    for (const banner of screen.getAllByRole('status', { name: /reviews/i })) {
      expect(banner).toHaveTextContent(/1 unsaved review/)
    }

    try {
      await user.keyboard('e')
      await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
      expect(capture).toHaveBeenCalledTimes(1)
      expect(download.mock.calls[0][0]).toMatch(/^atlas-reference-\d{4}-\d{2}-\d{2}\.png$/)
      expect((curation as unknown as Curation).unsaved).toBe(1)
    } finally {
      vi.restoreAllMocks()
      png.setExportEditsNote(null)
    }
  })
})

describe('export filename', () => {
  it('names the view and the date', async () => {
    const { exportFilename } = await import('../../export/png')
    expect(exportFilename('lossiness', 'png', new Date('2026-08-05T12:00:00Z'))).toBe(
      'atlas-lossiness-2026-08-05.png',
    )
  })
})

describe('a dialog does not break the app', () => {
  it('keeps the view rendered underneath', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user } = at('/lossiness')
    await screen.findByRole('heading', { name: /Lossiness/i }, { timeout: 5000 })
    await user.keyboard('?')
    await screen.findByRole('dialog', { name: /keyboard shortcuts/i })
    expect(screen.getByRole('heading', { name: /Lossiness/i })).toBeInTheDocument()
  })
})
