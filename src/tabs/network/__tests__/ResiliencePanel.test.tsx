import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { renderWithProvider } from '../../../test/renderWithProvider'
import type { Device, DeviceEdge, Topology } from '../../../types/atlas'
import { NetworkTab } from '../NetworkTab'
import { ResiliencePanel } from '../ResiliencePanel'

/** The panel, once its analysis has landed from the effect that computes it. */
function panel() {
  return screen.findByRole('region', { name: 'Resilience' })
}

/** The device list, which carries the same labels and would otherwise collide. */
function devices() {
  return screen.findByRole('region', { name: 'Devices' })
}

// ---------------------------------------------------------------------------
// A synthetic site, so the findings the committed sample does not contain (a
// topology already in two pieces, a source that reaches nothing) can still be
// asserted. Invented names, as everything in the sample bundle is.
// ---------------------------------------------------------------------------

function device(id: string, label: string, type: string, zone: string): Device {
  return { id, label, zone, type, ip: null, subnet: null, description: null }
}

function edge(source: string, target: string): DeviceEdge {
  return { source, target, link_type: 'ethernet', label: null }
}

const SPLIT: Topology = {
  site_id: 'sample_split',
  meta: {
    label: 'Sample Split Site',
    name: 'sample_split',
    description: 'Two pieces, on purpose.',
    classification: 'UNCLASSIFIED//SAMPLE',
    version: '1',
    updated: '2026-01-01',
    device_count: 5,
    edge_count: 3,
  },
  zones: { yard: { label: 'Yard' }, hut: { label: 'Hut' } },
  devices: [
    device('gate_sensor', 'Gate Sensor', 'sensor', 'yard'),
    device('yard_switch', 'Yard Switch', 'switch', 'yard'),
    device('watch_desk', 'Watch Desk', 'endpoint', 'yard'),
    device('hut_sensor', 'Hut Sensor', 'sensor', 'hut'),
    device('hut_relay', 'Hut Relay', 'switch', 'hut'),
  ],
  edges: [
    edge('gate_sensor', 'yard_switch'),
    edge('yard_switch', 'watch_desk'),
    edge('hut_sensor', 'hut_relay'),
  ],
}

function renderPanel(topology: Topology = SPLIT, selectedId: string | null = null) {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <ResiliencePanel
        topology={topology}
        selectedId={selectedId}
        onSelect={() => {}}
        overlay={null}
        onOverlay={() => {}}
      />
    </MemoryRouter>,
  )
  return { user }
}

describe('Single points of failure', () => {
  it('names them and says how much each one cuts off', async () => {
    await renderWithProvider(<NetworkTab />)
    const region = await panel()

    expect(
      await within(region).findByRole('button', { name: /Single points of failure/ }),
    ).toHaveAccessibleName(/20/)

    // Counted on cable and radio: Core Switch strands 22 of the 71 devices.
    // The VLANs between the sensor, ops and management segments used to read
    // as a way round it, but every one of them rides through Core Switch.
    const row = await within(region).findByRole('button', { name: /^Core Switch/ })
    expect(row).toHaveAccessibleName(/22 of 71 cut off/)
  })

  it('names the devices joined only by logical links instead of counting pieces', async () => {
    await renderWithProvider(<NetworkTab />)
    const region = await panel()
    await within(region).findByRole('button', { name: /^Core Switch/ })

    expect(within(region).getByText(/joined only by VLAN links/)).toHaveTextContent(/5 devices/)
    expect(within(region).queryByText(/separate\s+pieces/)).not.toBeInTheDocument()
  })

  it('drills a chokepoint through to the devices it would isolate', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const region = await panel()
    await user.click(await within(region).findByRole('button', { name: /Show all 20/ }))

    const row = within(region).getByRole('button', { name: /^Field House Access Switch/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')

    // The three that lose their path, named rather than merely counted.
    expect(within(region).getByRole('button', { name: 'Field House Access Point' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Field House Operator Display' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: '2x Directional Effector (Pair)' })).toBeInTheDocument()
  })

  it('marks the chokepoints on the graph from the existing toolbar', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    const toggle = await screen.findByRole('button', { name: 'Chokepoints' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(within(graph).getByTestId('device-core_switch')).toHaveAttribute('data-focused', 'false')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(within(graph).getByTestId('device-core_switch')).toHaveAttribute('data-focused', 'true')
    // Not a cut vertex, so it stays unmarked.
    expect(within(graph).getByTestId('device-perimeter_radar')).toHaveAttribute(
      'data-focused',
      'false',
    )
  })

  it('stops claiming the rings are on while an overlay is hiding them', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    const region = await panel()
    const toggle = await screen.findByRole('button', { name: 'Chokepoints' })

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(within(graph).getByTestId('device-core_switch')).toHaveAttribute('data-focused', 'true')

    await user.click(
      within(await devices()).getByRole('button', { name: /Field House Access Switch/ }),
    )
    await user.click(await within(region).findByRole('button', { name: /Show on graph/ }))
    const banner = await screen.findByRole('status', { name: /hypothetical view/i })

    // An overlay dims everything outside its own answer, rings included, so
    // the marking is not on screen. The control has to say so rather than sit
    // pressed over nothing, and the ring must leave the DOM with the picture.
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toBeDisabled()
    expect(within(graph).getByTestId('device-core_switch')).toHaveAttribute(
      'data-focused',
      'false',
    )

    // The preference survives the overlay, so the rings come back with it.
    await user.click(within(banner).getByRole('button', { name: /current state/i }))
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toBeEnabled()
    expect(within(graph).getByTestId('device-core_switch')).toHaveAttribute('data-focused', 'true')
  })

  it('says when the recorded topology is already in more than one piece', async () => {
    renderPanel()
    const region = await panel()
    expect(await within(region).findByText(/2 separate pieces/)).toBeInTheDocument()
  })

  it('recomputes for another site instead of carrying the first one over', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const region = await panel()
    await within(region).findByRole('button', { name: /^Core Switch/ })

    await user.click(screen.getByRole('button', { name: /Westfield Proving Ground/ }))

    const next = await panel()
    expect(
      await within(next).findByRole('button', { name: /^Site Firewall Appliance/ }),
    ).toHaveAccessibleName(/2 of 8 cut off/)
    expect(within(next).queryByRole('button', { name: /^Core Switch/ })).not.toBeInTheDocument()
  })

  it('counts a device with no links as a piece, and names one joined only by VLAN', async () => {
    renderPanel({
      ...SPLIT,
      site_id: 'sample_split_extra',
      devices: [
        ...SPLIT.devices,
        device('lonely_post', 'Lonely Post', 'sensor', 'yard'),
        device('yard_tenant', 'Yard Tenant', 'application', 'yard'),
      ],
      edges: [
        ...SPLIT.edges,
        { source: 'yard_tenant', target: 'yard_switch', link_type: 'vlan', label: null },
      ],
    })
    const region = await panel()
    expect(await within(region).findByText(/3 separate pieces of 3, 2 and 1/)).toBeInTheDocument()
    expect(within(region).getByText(/joined only by VLAN links/)).toHaveTextContent(
      /1 device is joined only by VLAN links.*Yard Tenant/,
    )
  })

  it('does not claim a second way round when no cable or radio link is drawn at all', async () => {
    renderPanel({
      ...SPLIT,
      site_id: 'sample_all_vlan',
      devices: SPLIT.devices.slice(0, 3),
      edges: [
        { source: 'gate_sensor', target: 'yard_switch', link_type: 'vlan', label: null },
        { source: 'yard_switch', target: 'watch_desk', link_type: 'vlan', label: null },
      ],
    })
    const region = await panel()
    expect(
      await within(region).findByText(/No cable or radio link is drawn at this site/),
    ).toBeInTheDocument()
    expect(within(region).queryByText(/has a second way round/)).not.toBeInTheDocument()
    expect(within(region).queryByText(/No single point of failure/)).not.toBeInTheDocument()
  })

  it('says so plainly when nothing in the topology is a single point of failure', async () => {
    renderPanel({
      ...SPLIT,
      site_id: 'sample_pair',
      devices: SPLIT.devices.slice(3),
      edges: [edge('hut_sensor', 'hut_relay')],
    })
    const region = await panel()
    expect(await within(region).findByText(/No single point of failure/i)).toBeInTheDocument()
  })
})

describe('Blast radius', () => {
  it('answers the selection with what stops being reachable', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const region = await panel()
    await user.click(
      within(await devices()).getByRole('button', { name: /Field House Access Switch/ }),
    )

    expect(await within(region).findByText(/If this device is removed/i)).toBeInTheDocument()
    expect(within(region).getByText(/3 of 71/)).toBeInTheDocument()
    // A reachability count means nothing without the frame it was measured from.
    expect(within(region).getByText(/Internet/)).toBeInTheDocument()
  })

  it('never calls the devices joined only by VLAN cut off, and names them', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const region = await panel()
    await user.click(
      within(await devices()).getByRole('button', { name: /Field House Access Switch/ }),
    )
    expect(await within(region).findByText(/3 of 71/)).toBeInTheDocument()
    expect(within(region).queryByText(/already cut off/)).not.toBeInTheDocument()
    expect(within(region).getByText(/joined only by VLAN are left out/)).toHaveTextContent(/5/)

    await user.click(within(region).getByRole('button', { name: /Name the 5/ }))
    expect(within(region).getByRole('button', { name: 'Mission COP Application' })).toBeInTheDocument()
  })

  it('does not claim a route when every starting point is joined only by VLAN', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const region = await panel()
    await user.click(within(await devices()).getByRole('button', { name: /^Core Switch/ }))
    await user.selectOptions(within(region).getByLabelText('Reachable from'), 'application')

    expect(
      await within(region).findByText(/so on cable and radio nothing is reachable from/),
    ).toBeInTheDocument()
    expect(within(region).queryByText(/Nothing loses its path/)).not.toBeInTheDocument()
  })

  it('re-frames the question against the devices that matter, and says which', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const region = await panel()
    await user.click(within(await devices()).getByRole('button', { name: /Sensor Net Firewall/ }))
    expect(await within(region).findByText(/Measured from Internet/)).toBeInTheDocument()

    await user.selectOptions(within(region).getByLabelText('Reachable from'), 'endpoint')

    expect(
      await within(region).findByText(/Measured from the 10 endpoints/),
    ).toBeInTheDocument()
    expect(within(region).getByText(/8 of 71 lose their path/)).toBeInTheDocument()

    // Eight is a claim until the eight are named.
    await user.click(within(region).getByRole('button', { name: /Name the 8/ }))
    expect(within(region).getByRole('button', { name: 'Perimeter Radar' })).toBeInTheDocument()
  })

  it('says loudly that the graph is showing a hypothetical, and takes it back', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    const region = await panel()
    await user.click(
      within(await devices()).getByRole('button', { name: /Field House Access Switch/ }),
    )
    await user.click(await within(region).findByRole('button', { name: /Show on graph/ }))

    const banner = await screen.findByRole('status', { name: /hypothetical view/i })
    expect(banner).toHaveTextContent(/not the current state/i)

    // Lit: the device removed and the three it strands. The uplink it hangs
    // off keeps its own path to the core, so under the removal it is dimmed
    // with everything else, and that is exactly what tells the two views apart.
    expect(within(graph).getByTestId('device-field_house_ap')).toHaveAttribute('opacity', '1')
    expect(within(graph).getByTestId('device-core_agg_switch')).toHaveAttribute('opacity', '0.14')

    await user.click(within(banner).getByRole('button', { name: /current state/i }))
    expect(screen.queryByRole('status', { name: /hypothetical view/i })).not.toBeInTheDocument()
    // Back to the ordinary isolate: what it is wired to, lit.
    expect(within(graph).getByTestId('device-core_agg_switch')).toHaveAttribute('opacity', '1')
  })

  it('draws the removed device as removed, not as one of the devices it strands', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    const region = await panel()
    await user.click(
      within(await devices()).getByRole('button', { name: /Field House Access Switch/ }),
    )
    await user.click(await within(region).findByRole('button', { name: /Show on graph/ }))

    const banner = await screen.findByRole('status', { name: /hypothetical view/i })
    expect(banner).toHaveTextContent(/3 of 71/)

    // Lit means "lost its path". The device being removed did not lose a path,
    // it is the removal, so drawing it lit and still wired at full strength to
    // exactly the devices it stranded is the one picture this must not draw.
    expect(within(graph).getByTestId('device-field_house_switch')).toHaveAttribute(
      'opacity',
      '0.14',
    )
    // Dimmed alone would read as unaffected, so it is marked for what it is.
    expect(screen.getByTestId('removed-marker')).toBeInTheDocument()

    // The count on screen is the count in the banner. A reader counting marks
    // and a reader reading the sentence have to arrive at the same number.
    const lit = within(graph)
      .getAllByRole('graphics-symbol')
      .filter((node) => node.getAttribute('opacity') === '1')
    expect(lit).toHaveLength(3)
  })

  it('takes the removed marker away with the hypothetical', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const region = await panel()
    await user.click(
      within(await devices()).getByRole('button', { name: /Field House Access Switch/ }),
    )
    await user.click(await within(region).findByRole('button', { name: /Show on graph/ }))
    const banner = await screen.findByRole('status', { name: /hypothetical view/i })
    expect(screen.getByTestId('removed-marker')).toBeInTheDocument()

    await user.click(within(banner).getByRole('button', { name: /current state/i }))
    expect(screen.queryByTestId('removed-marker')).not.toBeInTheDocument()
  })

  it('leaves the hypothetical on Escape, like every other isolated view', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const region = await panel()
    await user.click(
      within(await devices()).getByRole('button', { name: /Field House Access Switch/ }),
    )
    await user.click(await within(region).findByRole('button', { name: /Show on graph/ }))
    await screen.findByRole('status', { name: /hypothetical view/i })

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(screen.queryByRole('status', { name: /hypothetical view/i })).not.toBeInTheDocument()
  })
})

describe('Reach', () => {
  it('leads with the sources that reach nothing', async () => {
    const { user } = renderPanel(SPLIT)
    const region = await panel()

    await user.click(within(region).getByRole('button', { name: /^Reach/ }))
    fireEvent.change(within(region).getByLabelText('From device type'), {
      target: { value: 'sensor' },
    })
    fireEvent.change(within(region).getByLabelText('To device type'), {
      target: { value: 'endpoint' },
    })

    expect(await within(region).findByText(/1 of 2 sensor/)).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Hut Sensor' })).toBeInTheDocument()
  })

  it('carries a path as the evidence for every source that does reach', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const region = await panel()
    await user.click(within(region).getByRole('button', { name: /^Reach/ }))
    fireEvent.change(within(region).getByLabelText('From device type'), {
      target: { value: 'sensor' },
    })
    fireEvent.change(within(region).getByLabelText('To device type'), {
      target: { value: 'server' },
    })

    expect(await within(region).findByText(/All 12 sensor/)).toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: /Show all 12/ }))
    await user.click(within(region).getAllByRole('button', { name: /Show path/ })[0])

    const banner = await screen.findByRole('status', { name: /path view/i })
    expect(banner).toHaveTextContent(/hops/)
  })

  it('drops the traced path when either end of the question changes', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const region = await panel()
    await user.click(within(region).getByRole('button', { name: /^Reach/ }))
    fireEvent.change(within(region).getByLabelText('From device type'), {
      target: { value: 'sensor' },
    })
    fireEvent.change(within(region).getByLabelText('To device type'), {
      target: { value: 'server' },
    })
    expect(await within(region).findByText(/All 12 sensor/)).toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: /Show all 12/ }))
    await user.click(within(region).getAllByRole('button', { name: /Show path/ })[0])
    await screen.findByRole('status', { name: /path view/i })

    // A path is the evidence for one From/To pair. Ask about a different sink
    // and the banner is describing a route to somewhere nobody asked about,
    // over a canvas still lighting it, beside a panel answering something else.
    fireEvent.change(within(region).getByLabelText('To device type'), {
      target: { value: 'endpoint' },
    })
    expect(screen.queryByRole('status', { name: /path view/i })).not.toBeInTheDocument()

    // And again from the other end.
    await user.click(
      await within(region).findByRole('button', { name: /Show all \d+ that reach/ }),
    )
    await user.click(within(region).getAllByRole('button', { name: /Show path/ })[0])
    await screen.findByRole('status', { name: /path view/i })

    fireEvent.change(within(region).getByLabelText('From device type'), {
      target: { value: 'access_point' },
    })
    expect(screen.queryByRole('status', { name: /path view/i })).not.toBeInTheDocument()
  })
})
