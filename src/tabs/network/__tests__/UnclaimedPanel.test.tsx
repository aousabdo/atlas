import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithProvider } from '../../../test/renderWithProvider'
import { NetworkTab } from '../NetworkTab'

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
    expect(within(region).getByText(/^8 devices' verdicts rest on the 3 positions marked as assumptions\./))
      .toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: 'List the 8' }))
    expect(within(region).getByText(/^: strands 2 systems; without them, strands 8 systems\./)).toBeInTheDocument()
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
    expect(screen.getByText('From the 7 declared decision positions')).toBeInTheDocument()
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
