import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { resolveRoots, rootChoices, siteDependencies } from '../../../lib/dependency'
import { renderWithProvider } from '../../../test/renderWithProvider'
import type { CoverageSite, Device, DeviceEdge, System, Topology } from '../../../types/atlas'
import { NetworkTab } from '../NetworkTab'
import { UnclaimedPanel } from '../UnclaimedPanel'

async function openPanel(route?: string) {
  const rendered = await renderWithProvider(<NetworkTab />, route ? { route } : {})
  const region = await screen.findByRole('region', { name: 'Unclaimed devices' })
  const toggle = within(region).getByRole('button', { name: /^\W*Unclaimed devices/ })
  await rendered.user.click(toggle)
  return { ...rendered, region, toggle }
}

describe('Unclaimed devices', () => {
  it('counts the load-bearing devices among the ones no system claims, and says from where', async () => {
    const { region, toggle, user } = await openPanel()
    expect(toggle).toHaveAccessibleName(/11 of 52$/)
    expect(within(region).getByText('DECLARED')).toBeInTheDocument()
    expect(within(region).getByText('Measured from the 7 declared decision positions.')).toBeInTheDocument()
    // The positions, the assumptions and who chose them, one click away.
    await user.click(within(region).getByRole('button', { name: 'Name them' }))
    expect(within(region).getByText(/^Marked as assumptions: /)).toHaveTextContent(
      'ATAK / iTAK Field Devices, Field House Operator Display and Mobile Unit Displays',
    )
    expect(within(region).getByText(/Sample curation/)).toBeInTheDocument()
  })

  it('reconciles its 52 with the 51 the device map lists', async () => {
    const { region } = await openPanel()
    expect(within(region).getByText(/^52 of 71 devices carry no realized system here\./)).toHaveTextContent(
      'The device map lists 51 of them as infrastructure; the other is ATAK / iTAK Field Devices, named only by atak, which the systems matrix does not carry.',
    )
  })

  it('sorts them into groups that cover each device once', async () => {
    const { region } = await openPanel()
    for (const heading of [
      'Load-bearing (11)', 'Cuts devices off (8)', 'Nothing loses its path (18)', 'Hangs off one link (15)',
    ]) {
      expect(within(region).getByText(heading)).toBeInTheDocument()
    }
    expect(within(region).queryByText(/^Not assessed/)).not.toBeInTheDocument()
  })

  it('opens a load-bearing switch onto what rests on it', async () => {
    const { region, user } = await openPanel()
    const row = within(region).getByRole('button', { name: /^Field House Access Switch/ })
    expect(row).toHaveAccessibleName(/strands Bastion Effector \(high\) · cuts 1 decision position off/)
    await user.click(row)
    expect(within(region).getByText(/^Strands Bastion Effector: every device it runs on loses its path/))
      .toBeInTheDocument()
    expect(within(region).getAllByRole('button', { name: '2x Directional Effector (Pair)' }).length).toBeGreaterThan(0)
  })

  it('shows what Core Switch takes with it on the graph, systems and integrations counted', async () => {
    const { region, user } = await openPanel()
    await user.click(within(region).getByRole('button', { name: /^Core Switch/ }))
    expect(within(region).getByText(/^Breaks 3 documented integrations: .*This holds whatever the roots\./))
      .toBeInTheDocument()
    expect(within(region).getByText(/both ends still reach a decision position; they no longer reach each other/))
      .toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: 'Show on graph' }))
    const banner = await screen.findByRole('status', { name: /hypothetical view/i })
    expect(banner).toHaveTextContent(
      /17 of 71, 2 realized systems stranded, 3 documented integrations broken\. This is not the current state\./,
    )
  })

  it('names every verdict that rests on the assumed positions, and shows the alternative', async () => {
    const { region, toggle, user } = await openPanel()
    expect(within(region).getByText(/^9 devices' verdicts rest on the 3 positions marked as assumptions\./))
      .toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: 'List the 9' }))
    expect(within(region).getByText(/^: strands 2 systems; without them, strands 8 systems\./)).toBeInTheDocument()
    // Listed though its systems do not change: the position it cuts off is an assumed one.
    expect(within(region).getByText(
      /^: strands Bastion Effector and cuts 1 decision position off; without them, strands Bastion Effector\./,
    )).toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: 'Show without them' }))
    expect(await within(region).findByText('DECLARED · ASSUMPTIONS OUT')).toBeInTheDocument()
    expect(toggle).toHaveAccessibleName(/9 of 52$/)
    await user.click(within(region).getByRole('button', { name: 'Back to the declared set' }))
    expect(await within(region).findByText('DECLARED')).toBeInTheDocument()
    expect(toggle).toHaveAccessibleName(/11 of 52$/)
  })

  it('never calls an unreviewed site safe', async () => {
    const { region, toggle } = await openPanel('/network?site=westfield')
    expect(toggle).toHaveAccessibleName(/not reviewed$/)
    expect(within(region).getByText(/Nobody has recorded which systems run at Westfield Proving Ground/))
      .toHaveTextContent('Not reviewed is not zero.')
    expect(within(region).queryByText(/Load-bearing/)).not.toBeInTheDocument()
  })

  it('says the only entry point gets no verdict when measuring from the drawing', async () => {
    const { region, user } = await openPanel()
    await user.selectOptions(within(region).getByLabelText('Reachable from'), '')
    expect(await within(region).findByText('DERIVED')).toBeInTheDocument()
    expect(within(region).getByText('Not assessed (1)')).toBeInTheDocument()
    // The count says so too: one of the 52 was not measured at all.
    expect(within(region).getByRole('button', { name: /^\W*Unclaimed devices/ }))
      .toHaveAccessibleName(/ · 1 not assessed$/)
    expect(within(region).getByText(/^Internet is the only root, so removing it leaves nothing to measure from\./))
      .toBeInTheDocument()
  })
})

describe('Dashed rings in risk mode', () => {
  it('rings the grey switch that carries the high-risk effector, without recolouring it', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    await user.click(screen.getByRole('button', { name: /^Risk/ }))
    const ring = await within(graph).findByTestId('structural-ring-field_house_switch')
    expect(ring).toHaveAttribute('data-structural', 'high')
    expect(within(graph).getAllByTestId(/^structural-ring-/)).toHaveLength(9)
    // The device's own colour is still its own: no system lists it.
    const node = within(graph).getByTestId('device-field_house_switch')
    expect(node).toHaveAccessibleName(/its loss would strand Bastion Effector$/)
    // Every ring says which roots it was measured from.
    expect(screen.getByText(/^Dashed ring: its loss would strand a system of that risk, on the drawing, from the 7 declared decision positions\./))
      .toBeInTheDocument()
    expect(screen.getByTestId('legend-ring-row')).toHaveTextContent('Dashed ring: Its loss strands a system')
    // And each device's tooltip says what rests on it, with the roots.
    await user.hover(node)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Its loss strands Bastion Effector (high). From the 7 declared decision positions.',
    )
  })

  it('draws no rings at all from roots that are not declared', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    await user.click(screen.getByRole('button', { name: /^Risk/ }))
    await within(graph).findByTestId('structural-ring-field_house_switch')
    const resilience = await screen.findByRole('region', { name: 'Resilience' })
    await user.click(within(await screen.findByRole('region', { name: 'Devices' }))
      .getByRole('button', { name: /Core Switch/ }))
    await user.selectOptions(within(resilience).getByLabelText('Reachable from'), 'endpoint')
    expect(within(graph).queryAllByTestId(/^structural-ring-/)).toHaveLength(0)
    expect(screen.getByText(/^No dashed rings: they are drawn only from declared decision positions/))
      .toBeInTheDocument()
  })
})

describe('One root set across the tab', () => {
  it('drops a hypothetical on the graph when the roots change under it', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const resilience = await screen.findByRole('region', { name: 'Resilience' })
    await user.click(within(await screen.findByRole('region', { name: 'Devices' }))
      .getByRole('button', { name: /Core Switch/ }))
    await user.click(await within(resilience).findByRole('button', { name: /Show on graph/ }))
    expect(await screen.findByRole('status', { name: /hypothetical view/i })).toBeInTheDocument()
    await user.selectOptions(within(resilience).getByLabelText('Reachable from'), 'endpoint')
    expect(screen.queryByRole('status', { name: /hypothetical view/i })).not.toBeInTheDocument()
  })

  it('goes back to the declared positions when the site changes and comes back', async () => {
    const { region, user } = await openPanel()
    await user.selectOptions(within(region).getByLabelText('Reachable from'), '')
    expect(await within(region).findByText('DERIVED')).toBeInTheDocument()
    const sites = screen.getByRole('group', { name: 'Site' })
    await user.click(within(sites).getByRole('button', { name: /Westfield Proving Ground/ }))
    await screen.findByText(/8 devices/)
    await user.click(within(screen.getByRole('group', { name: 'Site' }))
      .getByRole('button', { name: /Northgate Sports Campus/ }))
    const back = await screen.findByRole('region', { name: 'Unclaimed devices' })
    await user.click(within(back).getByRole('button', { name: /^\W*Unclaimed devices/ }))
    expect(await within(back).findByText('DECLARED')).toBeInTheDocument()
  })

  it('tells the device detail what rests on a device no system lists, and on one a system does', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const list = await screen.findByRole('region', { name: 'Devices' })
    await user.click(within(list).getByRole('button', { name: /Field House Access Switch/ }))
    const detail = screen.getByRole('region', { name: 'Device detail' })
    expect(await within(detail).findByText(/^No system lists this device, but on the drawing its loss strands Bastion Effector \(high\)/))
      .toHaveTextContent('measured from the 7 declared decision positions. See If this device is removed.')
    expect(within(detail).queryByText(/expected to be unclaimed/i)).not.toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: /Government Cloud Tenancy/ }))
    expect(await within(detail).findByText(
      'Its loss also strands Event Relay Server (medium), measured from the 7 declared decision positions.',
    )).toBeInTheDocument()
  })

  it('measures the per-device answer from the same set the triage switched to', async () => {
    const { region, user } = await openPanel()
    const resilience = await screen.findByRole('region', { name: 'Resilience' })
    await user.click(within(await screen.findByRole('region', { name: 'Devices' }))
      .getByRole('button', { name: /Field House Access Switch/ }))
    expect(await within(resilience).findByText('Measured from the 7 declared decision positions.')).toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: 'Show without them' }))
    expect(await within(resilience).findByText(
      'Measured from the 4 declared decision positions not marked as assumptions.',
    )).toBeInTheDocument()
    expect(within(resilience).getByText('DECLARED · ASSUMPTIONS OUT')).toBeInTheDocument()
  })
})

describe('Unclaimed devices, from roots that are not declared', () => {
  it('never calls an endpoint picked by type a decision position', async () => {
    const { region, user } = await openPanel()
    await user.selectOptions(within(region).getByLabelText('Reachable from'), 'endpoint')
    expect(await within(region).findByText('BY DEVICE TYPE')).toBeInTheDocument()
    // Nowhere but the picker's own option for the declared set.
    const said = within(region).queryAllByText(/decision position/).filter((el) => el.tagName !== 'OPTION')
    expect(said.map((el) => el.textContent)).toEqual([])
    // The closing note still names the systems that run on a root, as roots.
    expect(within(region).getByText(/run on a root, so no other single loss can strand them/)).toBeInTheDocument()
  })
})

describe('An empty load-bearing group', () => {
  // desk (declared, runs fusion) reaches cam two ways, so sw strands nothing;
  // the rail yard is a piece no root reaches, so rail_sw is not measured.
  const device = (id: string, type = 'switch'): Device =>
    ({ id, label: id.toUpperCase(), zone: 'yard', type, ip: null, subnet: null, description: null })
  const edge = (source: string, target: string): DeviceEdge => ({ source, target, link_type: 'ethernet', label: null })
  const yard: Topology = {
    site_id: 'yard',
    meta: {
      label: 'Yard', name: 'yard', description: '', classification: 'UNCLASSIFIED//SAMPLE',
      version: '1', updated: '2026-01-01', device_count: 6, edge_count: 5,
    },
    zones: { yard: { label: 'Yard' } },
    devices: [device('desk', 'endpoint'), device('sw'), device('cam', 'sensor'),
      device('rail_cam', 'sensor'), device('rail_sw'), device('rail_cam2', 'sensor')],
    edges: [edge('desk', 'sw'), edge('sw', 'cam'), edge('desk', 'cam'), edge('rail_cam', 'rail_sw'), edge('rail_sw', 'rail_cam2')],
  }
  const mapping = (devices: string[]) => ({ devices, note: '', confidence: 'high' as const })
  const site: CoverageSite = {
    label: 'Yard', scope: '', not_deployed_at_site: {}, unclaimed_devices: { infrastructure: [] },
    mappings: { fusion: mapping(['desk']), eff: mapping(['cam']), rail: mapping(['rail_cam', 'rail_cam2']) },
    decision_roots: { devices: ['desk'], note: 'Test curation.' },
  }
  const system = (id: string): System => ({
    id, name: id.toUpperCase(), label: id, category: 'Deployed asset record', owner_group_id: 'og',
    owner_group: 'OG', color_key: 'a', confirmed: true, risk: 'high', risk_source: 'explicit', detail: '',
    integrations_prose: '',
  })

  it('counts only the devices that were measured, and points to the rest', async () => {
    const roots = resolveRoots(yard, site, { source: 'declared' })
    const deps = siteDependencies({ topology: yard, site, systems: ['fusion', 'eff', 'rail'].map(system), links: [] }, roots)
    expect(deps.triage.groups['not-assessed']).toEqual(['rail_sw'])
    const namers = {
      nameOf: (id: string) => id.toUpperCase(), riskOf: () => 'high' as const,
      labelOf: (id: string) => id.toUpperCase(),
      positionWord: (n: number) => (n === 1 ? 'decision position' : 'decision positions'),
    }
    render(
      <UnclaimedPanel
        topology={yard} deps={deps} sensitivity={null} roots={roots} rootOptions={rootChoices(yard, site)}
        onRootKey={() => {}} namers={namers} onSelect={() => {}} onShow={() => {}} siteLabel="Yard" reviewed
      />,
    )
    const region = screen.getByRole('region', { name: 'Unclaimed devices' })
    const toggle = within(region).getByRole('button', { name: /^\W*Unclaimed devices/ })
    expect(toggle).toHaveAccessibleName(/0 of 2 · 1 not assessed$/)
    toggle.click()
    expect(await within(region).findByText(/^The one measured device no system claims does not strand a system/))
      .toHaveTextContent('measured from the 1 declared decision position. The other 1 is not assessed; see below.')
    expect(within(region).queryByText(/^None of the 2 devices/)).not.toBeInTheDocument()
  })
})
