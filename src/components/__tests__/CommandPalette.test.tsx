import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import App from '../../App'
import { ProviderContext } from '../../data/ProviderContext'
import { AtlasDataError, type AtlasDataProvider } from '../../data/provider'
import { StaticProvider } from '../../data/StaticProvider'
import type { Glossary, Project, System, Topology } from '../../types/atlas'
import { CommandPalette } from '../CommandPalette'

/** Reports the URL the palette navigated to, without mounting a whole tab. */
function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="url">{`${location.pathname}${location.search}${location.hash}`}</div>
  )
}

function renderPalette(provider?: AtlasDataProvider) {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/reference']}>
      <ProviderContext.Provider value={provider ?? new StaticProvider('/data')}>
        <CommandPalette onClose={onClose} />
        <LocationProbe />
      </ProviderContext.Provider>
    </MemoryRouter>,
  )
  return { user, onClose }
}

const box = () => screen.getByRole('combobox')
const options = () => screen.queryAllByRole('option')
const url = () => screen.getByTestId('url').textContent

async function type(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(box(), text)
  // The first keystroke arrives while the bundles are still in flight.
  await waitFor(() => expect(options().length).toBeGreaterThan(0))
}

// --- a provider that is not the sample bundle -------------------------------

const LOCAL_SYSTEM: System = {
  id: 'harbourwatch',
  name: 'Harbour Watch',
  label: 'Harbour Watch',
  category: 'Deployed asset record',
  owner_group_id: 'ops',
  owner_group: 'Harbour Operations',
  color_key: 'ops',
  confirmed: true,
  risk: 'low',
  risk_source: 'explicit',
  detail: '',
  integrations_prose: '',
}

const LOCAL_PROJECT: Project = {
  slug: 'loaded',
  name: 'Loaded Workbook',
  baseline_date: '2026-01-01',
  source_label: 'Analyst Workbook',
  default_site: 'quarry',
  sites: [
    {
      id: 'quarry',
      label: 'Quarry Range',
      classification: 'UNCLASSIFIED//SAMPLE',
      device_count: 1,
      edge_count: 0,
      updated: '2026-01-01',
    },
  ],
}

const LOCAL_TOPOLOGY: Topology = {
  site_id: 'quarry',
  meta: {
    label: 'Quarry Range',
    name: 'quarry',
    description: '',
    classification: 'UNCLASSIFIED//SAMPLE',
    version: '1',
    updated: '2026-01-01',
    device_count: 1,
    edge_count: 0,
  },
  zones: { yard: { label: 'Yard' } },
  devices: [
    {
      id: 'yard_relay',
      label: 'Yard Relay',
      zone: 'yard',
      type: 'server',
      ip: null,
      subnet: null,
      description: null,
    },
  ],
  edges: [],
}

const LOCAL_GLOSSARY: Glossary = {
  confidence_intro: '',
  out_of_scope: [],
  methodology_extras: {
    risk_caveat: '',
    mapping_confidence_scale: '',
    soft_ownership_note: '',
  },
  acronyms: [],
}

function localProvider(over: Partial<AtlasDataProvider> = {}): AtlasDataProvider {
  const unused = () => Promise.reject(new AtlasDataError('not read by the palette'))
  return {
    kind: 'local-file',
    getManifest: unused,
    getProject: () => Promise.resolve(LOCAL_PROJECT),
    getSystems: () => Promise.resolve([LOCAL_SYSTEM]),
    getLinks: unused,
    getRequirements: () => Promise.resolve([]),
    getGlossary: () => Promise.resolve(LOCAL_GLOSSARY),
    getMethodology: unused,
    getCoverage: unused,
    getLossiness: unused,
    getTopology: () => Promise.resolve(LOCAL_TOPOLOGY),
    getSnapshots: () => Promise.resolve([]),
    ...over,
  }
}

// --- the palette itself -----------------------------------------------------

describe('command palette', () => {
  it('is a dialog, like every other overlay in the app', async () => {
    renderPalette()
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('opens with the box focused, so you can type straight away', async () => {
    renderPalette()
    await waitFor(() => expect(box()).toHaveFocus())
  })

  it('offers the five views before anything is typed', async () => {
    renderPalette()
    await waitFor(() => expect(options()).toHaveLength(5))
    expect(options().map((option) => option.textContent)).toEqual([
      expect.stringContaining('Reference & Methodology'),
      expect.stringContaining('Analytics'),
      expect.stringContaining('Lossiness'),
      expect.stringContaining('Network Topology'),
      expect.stringContaining('Orientation Map'),
    ])
  })

  it('names the kind of every group, because a name can be two things', async () => {
    const { user } = renderPalette()
    await type(user, 'core')
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label')))
      .toEqual(['Zones', 'Devices'])
  })

  it('says which site a device is at when two sites share a name', async () => {
    const { user } = renderPalette()
    await type(user, 'northwind')
    const rows = within(screen.getByRole('group', { name: 'Devices' })).getAllByRole(
      'option',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Northgate Sports Campus')
    expect(rows[1]).toHaveTextContent('Westfield Proving Ground')
  })

  it('finds a site by name, and everything standing at it', async () => {
    const { user } = renderPalette()
    // The defect: a site named Westfield Proving Ground, its name printed on
    // all eight of its device rows, and typing it returned nothing at all.
    await type(user, 'westfield')
    const sites = within(screen.getByRole('group', { name: 'Sites' })).getAllByRole(
      'option',
    )
    expect(sites).toHaveLength(1)
    expect(sites[0]).toHaveTextContent('Westfield Proving Ground')
    expect(
      within(screen.getByRole('group', { name: 'Devices' })).getAllByRole('option'),
    ).toHaveLength(8)
  })

  it('jumps to a whole site, which the topology reads as ?site=', async () => {
    const { user } = renderPalette()
    await type(user, 'westfield')
    await user.keyboard('{Enter}')
    expect(url()).toBe('/network?site=westfield')
  })

  it('jumps to a system on the map, selecting it', async () => {
    const { user, onClose } = renderPalette()
    await type(user, 'trackwell')
    await user.keyboard('{Enter}')
    expect(url()).toBe('/map?focus=trackwell')
    expect(onClose).toHaveBeenCalled()
  })

  it('jumps to a device at its own site, selecting it', async () => {
    const { user } = renderPalette()
    await type(user, 'core_firewall')
    await user.keyboard('{Enter}')
    expect(url()).toBe('/network?site=northgate&focus=core_firewall')
  })

  it('jumps to the section of the reference tab that holds an acronym', async () => {
    const { user } = renderPalette()
    await type(user, 'CUAS')
    await user.keyboard('{Enter}')
    expect(url()).toBe('/reference#acronyms')
  })

  it('moves the active row with the arrow keys and chooses that one', async () => {
    const { user } = renderPalette()
    // Ranked: Core Router, Core Switch, Core Firewall, ... (shortest label wins
    // a tie, then alphabetical), so one press down lands on Core Switch.
    await type(user, 'core_')
    await user.keyboard('{ArrowDown}')
    const active = screen.getByRole('option', { selected: true })
    expect(active).toHaveTextContent('Core Switch')
    expect(box()).toHaveAttribute('aria-activedescendant', active.id)
    await user.keyboard('{Enter}')
    expect(url()).toBe('/network?site=northgate&focus=core_switch')
  })

  it('walks back up with the arrow keys', async () => {
    const { user } = renderPalette()
    await type(user, 'core_')
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Core Switch')
  })

  it('closes on Escape without navigating', async () => {
    const { user, onClose } = renderPalette()
    await type(user, 'trackwell')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(url()).toBe('/reference')
  })

  it('says so when nothing matches instead of showing a stale list', async () => {
    const { user } = renderPalette()
    await user.type(box(), 'zzzznothing')
    await waitFor(() => expect(options()).toHaveLength(0))
    expect(screen.getByText(/no match/i)).toBeInTheDocument()
  })

  it('states how many matches it is showing when it cannot show them all', async () => {
    const { user } = renderPalette()
    await type(user, 'e')
    expect(screen.getByText(/showing 50 of \d+/i)).toBeInTheDocument()
  })

  it('reads through the provider, so a loaded workbook is searchable too', async () => {
    const { user } = renderPalette(localProvider())
    await type(user, 'harbour')
    expect(screen.getByRole('option', { name: /Harbour Watch/ })).toBeInTheDocument()
  })

  it('searches the sites the loaded project lists, not the sample ones', async () => {
    const { user } = renderPalette(localProvider())
    await type(user, 'yard relay')
    await user.keyboard('{Enter}')
    expect(url()).toBe('/network?site=quarry&focus=yard_relay')
  })

  it('reports a failed load rather than an empty result list', async () => {
    const { user } = renderPalette(
      localProvider({
        getSystems: () => Promise.reject(new AtlasDataError('systems.json returned 500')),
      }),
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load/i)
    await user.type(box(), 'harbour')
    expect(options()).toHaveLength(0)
  })
})

// --- wiring into the shell --------------------------------------------------

function at(path: string) {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  return { user }
}

const palette = () => screen.queryByRole('dialog', { name: /search/i })

describe('the shell opens the palette', () => {
  it('opens on Cmd+K', async () => {
    const { user } = at('/reference')
    await user.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog', { name: /search/i })).toBeInTheDocument()
  })

  it('opens on Ctrl+K', async () => {
    const { user } = at('/reference')
    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: /search/i })).toBeInTheDocument()
  })

  it('opens from inside a panel search box, which is the point of it', async () => {
    const { user } = at('/reference')
    const filter = await screen.findByRole('searchbox', { name: /filter systems/i })
    await user.click(filter)
    await user.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog', { name: /search/i })).toBeInTheDocument()
  })

  it('returns focus to whatever opened it', async () => {
    const { user } = at('/reference')
    const filter = await screen.findByRole('searchbox', { name: /filter systems/i })
    await user.click(filter)
    await user.keyboard('{Meta>}k{/Meta}')
    await screen.findByRole('dialog', { name: /search/i })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(palette()).not.toBeInTheDocument())
    expect(filter).toHaveFocus()
  })

  it('stands the letter shortcuts down while it is open', async () => {
    const { user } = at('/reference')
    await user.keyboard('{Meta>}k{/Meta}')
    await screen.findByRole('dialog', { name: /search/i })
    await user.keyboard('a')
    expect(screen.queryByRole('dialog', { name: /About/i })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('a')
  })

  it('stands the topology shortcuts down while it is open', async () => {
    const { user } = at('/network')
    const labels = await screen.findByRole('button', { name: 'Labels' }, { timeout: 5000 })
    await user.keyboard('{Meta>}k{/Meta}')
    await screen.findByRole('dialog', { name: /search/i })
    await user.keyboard('l')
    expect(labels).toHaveAttribute('aria-pressed', 'false')
  })

  /**
   * The reproduction, end to end: clear the canvas once, then jump to a device
   * at the site already on screen. SiteTopology is keyed by site, so nothing
   * remounts and the URL was the only thing that changed.
   */
  it('lands on the device even after the canvas has been cleared once', async () => {
    const { user } = at('/network?focus=field_house_effector')
    const detail = await screen.findByRole(
      'region',
      { name: /device detail/i },
      { timeout: 5000 },
    )
    expect(within(detail).getByText(/Directional Effector/)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(within(detail).getByText(/Pick a device/)).toBeInTheDocument()

    await user.keyboard('{Meta>}k{/Meta}')
    await screen.findByRole('dialog', { name: /search/i })
    await user.type(screen.getByRole('combobox'), 'core_router')
    await waitFor(() =>
      expect(screen.queryAllByRole('option').length).toBeGreaterThan(0),
    )
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(within(detail).queryByText(/Pick a device/)).not.toBeInTheDocument(),
    )
    expect(within(detail).getByText('Core Router')).toBeInTheDocument()
  }, 15000)

  it('keeps Tab inside the dialog, which is what aria-modal already claims', async () => {
    const { user } = at('/reference')
    await user.keyboard('{Meta>}k{/Meta}')
    const dialog = await screen.findByRole('dialog', { name: /search/i })
    expect(screen.getByRole('combobox')).toHaveFocus()
    // Two presses used to reach the nav behind the backdrop and eight reached
    // the button that opens another dialog.
    for (let press = 0; press < 8; press += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  }, 15000)

  it('is the only modal on the page, even opened from another one', async () => {
    const { user } = at('/reference')
    await user.keyboard('?')
    await screen.findByRole('dialog', { name: /keyboard shortcuts/i })
    await user.keyboard('{Meta>}k{/Meta}')
    const palette = await screen.findByRole('dialog', { name: /search/i })
    // Both cards drew at z-50, the shortcuts one on top, while the caret sat
    // in the palette's box underneath it.
    expect(screen.getAllByRole('dialog')).toEqual([palette])
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1)
  })

  it('documents the key in the shortcuts dialog', async () => {
    const { user } = at('/reference')
    await user.keyboard('?')
    const dialog = await screen.findByRole('dialog', { name: /keyboard shortcuts/i })
    expect(within(dialog).getByText(/search everything/i)).toBeInTheDocument()
  })
})
