import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { CoverageMatrix, System, Topology } from '../../../types/atlas'
import { WiringPanel } from '../WiringPanel'

import { renderWithProvider } from '../../../test/renderWithProvider'
import { NetworkTab } from '../NetworkTab'

async function openPanel(route?: string) {
  const { user } = await renderWithProvider(<NetworkTab />, route ? { route } : {})
  const region = await screen.findByRole('region', { name: 'Documented integrations' })
  const toggle = within(region).getByRole('button', { name: /Documented integrations/ })
  await user.click(toggle)
  return { user, region, toggle }
}

describe('Documented integrations', () => {
  it('checks every integration the documents record against the drawing', async () => {
    const { region, toggle } = await openPanel()
    expect(toggle).toHaveAccessibleName(/14$/)
    expect(within(region).getByText(/^3 wired/)).toHaveTextContent(
      '3 wired, 1 on a shared device, 10 cannot be checked here.',
    )
  })

  it('names the devices whose loss breaks each wired integration', async () => {
    const { user, region } = await openPanel()
    // Every one of the three hangs on single devices: worth a sentence.
    expect(
      within(region).getByText('Every wired integration here breaks if one device or cable fails.'),
    ).toBeInTheDocument()
    const row = within(region).getByRole('button', {
      name: /^Jetty C-UAS Integration Engine – Event Relay Server/,
    })
    expect(row).toHaveAccessibleName(/6 hops, breaks if any one of 5 devices fails/)
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    for (const name of ['Operations Switch', 'Core Switch', 'Core Router']) {
      expect(within(region).getAllByRole('button', { name }).length).toBeGreaterThan(0)
    }
  })

  it('lights the cable path on the graph', async () => {
    const { user, region } = await openPanel()
    await user.click(
      within(region).getByRole('button', { name: /^Recon Systems – UAS Common Picture/ }),
    )
    const banner = await screen.findByRole('status', { name: 'Path view' })
    expect(banner).toHaveTextContent(/from Recon Systems on .* to UAS Common Picture on .*, 6 hops/)
  })

  it('takes its own path off the graph when another row opens, and nothing else', async () => {
    const { user, region } = await openPanel()
    await user.click(
      within(region).getByRole('button', { name: /^Recon Systems – UAS Common Picture/ }),
    )
    expect(await screen.findByRole('status', { name: 'Path view' })).toBeInTheDocument()
    // A shared-device row has no path of its own, so the old one must not stay lit.
    await user.click(within(region).getByRole('button', { name: /^UAS Common Picture – CROSSLINK/ }))
    expect(screen.queryByRole('status', { name: 'Path view' })).not.toBeInTheDocument()
  })

  it('says when two systems share a device instead of tracing a path', async () => {
    const { region } = await openPanel()
    expect(
      within(region).getByRole('button', { name: /^UAS Common Picture – CROSSLINK/ }),
    ).toHaveAccessibleName(/both run on/)
  })

  it('says why an integration cannot be checked here', async () => {
    const { user, region } = await openPanel()
    await user.click(within(region).getByRole('button', { name: /Cannot be checked here \(10\)/ }))
    expect(within(region).getByText(/^Dispatch Management System \(DMS\/CAD\) – FPS Relay/))
      .toHaveTextContent(/Dispatch Management System \(DMS\/CAD\) is checked absent here/)
    expect(within(region).getByText(/^Jetty C-UAS Integration Engine – Relay Homing Plugin/))
      .toHaveTextContent(/Relay Homing Plugin has software only here/)
  })

  it('never calls one direct cable a second way round', async () => {
    const user = userEvent.setup()
    const system = (id: string) => ({ id, name: id.toUpperCase() }) as System
    const topology = {
      site_id: 'yard',
      meta: { label: 'Yard' },
      zones: {},
      devices: ['x1', 'y1', 'sw'].map((id) => ({ id, label: id, zone: 'z', type: 'switch' })),
      edges: [
        { source: 'x1', target: 'y1', link_type: 'ethernet', label: null },
        { source: 'x1', target: 'sw', link_type: 'ethernet', label: null },
      ],
    } as unknown as Topology
    const coverage = {
      sites: {
        yard: {
          label: 'Yard', scope: '', not_deployed_at_site: {}, unclaimed_devices: { infrastructure: [] },
          mappings: {
            x: { devices: ['x1'], note: '', confidence: 'high' },
            y: { devices: ['y1'], note: '', confidence: 'high' },
          },
        },
      },
    } as unknown as CoverageMatrix
    render(
      <WiringPanel
        topology={topology}
        coverage={coverage}
        systems={[system('x'), system('y')]}
        links={[{ from: 'x', to: 'y', label: '', extraction_method: 'override' }]}
        onSelect={() => {}}
        overlay={null}
        onOverlay={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Documented integrations/ }))
    expect(screen.getByRole('button', { name: /^X – Y/ })).toHaveAccessibleName(
      /1 hop, a single cable with no second way round/,
    )
    expect(screen.queryByText(/with a second way round/)).not.toBeInTheDocument()
    expect(
      screen.getByText('Every wired integration here breaks if one device or cable fails.'),
    ).toBeInTheDocument()
  })

  it('keeps a documented link recorded twice as two rows that open on their own', async () => {
    const user = userEvent.setup()
    const system = (id: string) => ({ id, name: id.toUpperCase() }) as System
    const topology = {
      site_id: 'yard',
      meta: { label: 'Yard' },
      zones: {},
      devices: ['x1', 'y1'].map((id) => ({ id, label: id, zone: 'z', type: 'switch' })),
      edges: [{ source: 'x1', target: 'y1', link_type: 'ethernet', label: null }],
    } as unknown as Topology
    const coverage = {
      sites: {
        yard: {
          label: 'Yard', scope: '', not_deployed_at_site: {}, unclaimed_devices: { infrastructure: [] },
          mappings: {
            x: { devices: ['x1'], note: '', confidence: 'high' },
            y: { devices: ['y1'], note: '', confidence: 'high' },
          },
        },
      },
    } as unknown as CoverageMatrix
    const twice = { from: 'x', to: 'y', label: '', extraction_method: 'override' as const }
    render(
      <WiringPanel
        topology={topology}
        coverage={coverage}
        systems={[system('x'), system('y')]}
        links={[twice, { ...twice, label: 'again' }]}
        onSelect={() => {}}
        overlay={null}
        onOverlay={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Documented integrations/ }))
    const [first, second] = screen.getAllByRole('button', { name: /^X – Y/ })
    await user.click(first!)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(second).toHaveAttribute('aria-expanded', 'false')
  })

  it('says a site nobody has reviewed is unreviewed, not that nothing is wired', async () => {
    const { region } = await openPanel('/network?site=westfield')
    expect(within(region).getByText(/Nobody has recorded which systems run at/)).toBeInTheDocument()
    expect(within(region).queryByText(/wired/)).not.toBeInTheDocument()
  })
})
