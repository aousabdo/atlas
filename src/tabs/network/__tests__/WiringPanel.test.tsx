import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
      within(region).getByText('Every wired integration here breaks if a single device fails.'),
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

  it('says a site nobody has reviewed is unreviewed, not that nothing is wired', async () => {
    const { region } = await openPanel('/network?site=westfield')
    expect(within(region).getByText(/Nobody has recorded which systems run at/)).toBeInTheDocument()
    expect(within(region).queryByText(/wired/)).not.toBeInTheDocument()
  })
})
