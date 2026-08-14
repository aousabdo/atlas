import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ProviderContext } from '../../../data/ProviderContext'
import { AtlasDataError } from '../../../data/provider'
import { StaticProvider } from '../../../data/StaticProvider'
import { renderWithProvider } from '../../../test/renderWithProvider'
import { NetworkTab } from '../NetworkTab'

describe('Network Topology', () => {
  it('offers both sites', async () => {
    await renderWithProvider(<NetworkTab />)
    expect(
      await screen.findByRole('button', { name: /Northgate Sports Campus/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Westfield Proving Ground/ })).toBeInTheDocument()
  })

  it('reports the device and link counts for the active site', async () => {
    await renderWithProvider(<NetworkTab />)
    expect(await screen.findByText(/71 devices/)).toBeInTheDocument()
    expect(screen.getByText(/86 links/)).toBeInTheDocument()
  })

  it('renders one element per device once laid out', async () => {
    await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    expect(within(graph).getAllByRole('graphics-symbol')).toHaveLength(71)
  })

  it('does not emit NaN geometry when mounted before layout', async () => {
    // jsdom reports every element as 0x0, which is exactly the trap. If the
    // guard is missing, this fills the DOM with NaN and the assertion fires.
    const { container } = await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('keeps geometry finite in every view mode at zero container size', async () => {
    const { container, user } = await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    for (const label of ['Zones', 'Tree', 'Force']) {
      await user.click(screen.getByRole('button', { name: label }))
      expect(container.innerHTML, `${label} mode`).not.toMatch(/NaN|Infinity/)
    }
  })

  it('labels every device on demand, still without NaN font sizes', async () => {
    const { container, user } = await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    await user.click(screen.getByRole('button', { name: 'Labels' }))
    expect(within(graph).getAllByText(/Switch/).length).toBeGreaterThan(0)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('lists all 14 Northgate zones', async () => {
    await renderWithProvider(<NetworkTab />)
    const zones = await screen.findByRole('region', { name: /zones/i })
    expect(within(zones).getAllByRole('button')).toHaveLength(15) // 14 + "all"
  })

  it('shows device detail including the systems it implements', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    await user.click(await screen.findByRole('button', { name: /Effector/i }))
    const detail = await screen.findByRole('region', { name: /device detail/i })
    expect(within(detail).getByText(/Implements/i)).toBeInTheDocument()
    // field_house_effector realizes the Bastion Effector system, and the chip is a router
    // link to the map tab rather than a message across an iframe bridge.
    expect(within(detail).getByRole('link', { name: 'Bastion Effector' })).toHaveAttribute(
      'href',
      '/map?focus=bastion',
    )
    expect(within(detail).getByText('Field House')).toBeInTheDocument()
    expect(within(detail).getByText(/Connections \(1\)/)).toBeInTheDocument()
  })

  it('switches to Westfield Proving Ground without stale counts', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    await user.click(await screen.findByRole('button', { name: /Westfield Proving Ground/ }))
    expect(await screen.findByText(/8 devices/)).toBeInTheDocument()
    expect(screen.queryByText(/71 devices/)).not.toBeInTheDocument()
    const graph = await screen.findByRole('img', { name: /network topology/i })
    expect(within(graph).getAllByRole('graphics-symbol')).toHaveLength(8)
  })

  it('offers the three view modes', async () => {
    await renderWithProvider(<NetworkTab />)
    for (const m of ['Force', 'Zones', 'Tree']) {
      expect(await screen.findByRole('button', { name: m })).toBeInTheDocument()
    }
  })

  it('focuses a device set from a query parameter', async () => {
    await renderWithProvider(<NetworkTab />, {
      route: '/network?site=northgate&focus=field_house_effector',
    })
    const graph = await screen.findByRole('img', { name: /network topology/i })
    expect(within(graph).getByTestId('device-field_house_effector')).toHaveAttribute(
      'data-focused',
      'true',
    )
    expect(within(graph).getByTestId('device-perimeter_radar')).toHaveAttribute(
      'data-focused',
      'false',
    )
  })

  it('opens the focused device in the detail panel', async () => {
    await renderWithProvider(<NetworkTab />, { route: '/network?focus=field_house_effector' })
    const detail = await screen.findByRole('region', { name: /device detail/i })
    expect(within(detail).getByText('2x Directional Effector (Pair)')).toBeInTheDocument()
  })

  it('honours a site named in the query parameter', async () => {
    await renderWithProvider(<NetworkTab />, { route: '/network?site=westfield' })
    expect(await screen.findByText(/8 devices/)).toBeInTheDocument()
    expect(await screen.findByText(/No systems are mapped to this site yet/)).toBeInTheDocument()
  })

  it('narrows the device list to a zone without dropping it from the graph', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const zones = await screen.findByRole('region', { name: /zones/i })
    await user.click(within(zones).getByRole('button', { name: /Field House/ }))
    const devices = screen.getByRole('region', { name: 'Devices' })
    expect(within(devices).getAllByRole('button')).toHaveLength(4)
    const graph = screen.getByRole('img', { name: /network topology/i })
    expect(within(graph).getAllByRole('graphics-symbol')).toHaveLength(71)
  })

  it('legends the link and node types present at the site', async () => {
    await renderWithProvider(<NetworkTab />)
    const legend = await screen.findByRole('region', { name: /legend/i })
    expect(within(legend).getByText('Ethernet')).toBeInTheDocument()
    expect(within(legend).getByText('VLAN')).toBeInTheDocument()
    expect(within(legend).getByText('Sensor')).toBeInTheDocument()
    expect(within(legend).getByText('Firewall')).toBeInTheDocument()
  })

  it('draws each zone as its own coloured hull with a short label', async () => {
    await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    const hull = within(graph).getByTestId('hull-core')
    const shape = hull.querySelector('path, circle')!
    expect(shape.getAttribute('fill')).toBe('var(--zone-core)')
    expect(shape.getAttribute('stroke')).toBe('var(--zone-core)')
    expect(hull.querySelector('text')).toHaveTextContent('CORE')

    // A different zone, a different token: uniform grey hulls were the bug.
    const other = within(graph).getByTestId('hull-field_house').querySelector('path, circle')!
    expect(other.getAttribute('fill')).toBe('var(--zone-field-house)')
  })

  it('lands on a site that loaded when the map names one that did not', async () => {
    // The defect: default_site is copied verbatim off the system to device
    // map, which names every site the analyst has coverage for rather than
    // every site whose topology they loaded. Preferring it landed the tab on a
    // site the provider has nothing for, with the site switcher inside the
    // view that failed to render and no way back but editing ?site= by hand.
    const provider = new StaticProvider('/data')
    const real = provider.getProject.bind(provider)
    provider.getProject = async () => {
      const project = await real()
      return {
        ...project,
        default_site: 'a_site_with_no_topology',
        sites: project.sites.filter((site) => site.id === 'westfield'),
      }
    }
    render(
      <MemoryRouter>
        <ProviderContext.Provider value={provider}>
          <NetworkTab />
        </ProviderContext.Provider>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/8 devices/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('still honours default_site when its topology did load', async () => {
    const provider = new StaticProvider('/data')
    const real = provider.getProject.bind(provider)
    provider.getProject = async () => ({ ...(await real()), default_site: 'westfield' })
    render(
      <MemoryRouter>
        <ProviderContext.Provider value={provider}>
          <NetworkTab />
        </ProviderContext.Provider>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/8 devices/)).toBeInTheDocument()
  })

  it('reports a load failure instead of an empty graph', async () => {
    const provider = new StaticProvider('/data')
    provider.getTopology = () =>
      Promise.reject(new AtlasDataError('sites/northgate.json returned 500'))
    render(
      <MemoryRouter>
        <ProviderContext.Provider value={provider}>
          <NetworkTab />
        </ProviderContext.Provider>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load/)
    expect(screen.queryByRole('img', { name: /network topology/i })).not.toBeInTheDocument()
  })
})

/**
 * A pointer event carrying coordinates jsdom refuses to construct.
 *
 * `new PointerEvent({clientX: NaN})` throws in the WebIDL conversion, so the
 * only way to test the guard against a non-finite pointer is to attach the
 * values after the event exists. A real browser produces these; the guard is
 * why one of them does not turn the whole SVG into NaN.
 */
function nonFinitePointer(type: string, pointerId: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  Object.defineProperty(event, 'button', { value: 0 })
  Object.defineProperty(event, 'clientX', { value: Number.NaN })
  Object.defineProperty(event, 'clientY', { value: clientY })
  return event
}

/** The graph node group, which is what carries the transform and the state flags. */
async function graphNode(testId: string) {
  const graph = await screen.findByRole('img', { name: /network topology/i })
  return within(graph).getByTestId(testId)
}

describe('Network Topology interaction', () => {
  it('moves a device when it is dragged, and does not count that as a click', async () => {
    await renderWithProvider(<NetworkTab />)
    const svg = await screen.findByRole('img', { name: /network topology/i })
    const node = await graphNode('device-core_switch')
    const home = node.getAttribute('transform')

    fireEvent.pointerDown(node, { pointerId: 2, button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 290, clientY: 260 })
    fireEvent.pointerUp(svg, { pointerId: 2 })

    expect(node.getAttribute('transform')).not.toBe(home)
    // Dragging must not select: the detail panel stays on its empty state.
    const detail = screen.getByRole('region', { name: /device detail/i })
    expect(within(detail).getByText(/Pick a device/)).toBeInTheDocument()
  })

  it('drags a device without leaving a NaN anywhere in the canvas', async () => {
    const { container } = await renderWithProvider(<NetworkTab />)
    const svg = await screen.findByRole('img', { name: /network topology/i })
    const node = await graphNode('device-field_house_effector')

    const home = node.getAttribute('transform')

    fireEvent.pointerDown(node, { pointerId: 5, button: 0, clientX: 100, clientY: 100 })
    fireEvent(svg, nonFinitePointer('pointermove', 5, 140))
    // The bad move moved nothing; the good one that follows still works.
    expect(node.getAttribute('transform')).toBe(home)
    fireEvent.pointerMove(svg, { pointerId: 5, clientX: 220, clientY: 40 })
    fireEvent.pointerUp(svg, { pointerId: 5 })

    expect(node.getAttribute('transform')).not.toBe(home)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('drags the zone outline along with the device inside it', async () => {
    await renderWithProvider(<NetworkTab />)
    const svg = await screen.findByRole('img', { name: /network topology/i })
    const hull = () =>
      within(svg).getByTestId('hull-field_house').querySelector('path, circle')!.getAttribute('d') ??
      within(svg).getByTestId('hull-field_house').querySelector('circle')!.getAttribute('cx')
    const before = hull()

    const node = within(svg).getByTestId('device-field_house_effector')
    fireEvent.pointerDown(node, { pointerId: 6, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(svg, { pointerId: 6, clientX: 400, clientY: 320 })
    fireEvent.pointerUp(svg, { pointerId: 6 })

    expect(hull()).not.toBe(before)
  })

  it('isolates a device on click and dims everything it is not wired to', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const node = await graphNode('device-field_house_effector')
    await user.click(node)

    expect(node).toHaveAttribute('data-selected', 'true')
    expect(node).toHaveAttribute('opacity', '1')
    // Wired to it, so it stays lit.
    expect(await graphNode('device-field_house_switch')).toHaveAttribute('opacity', '1')
    // Nothing to do with it, so it drops back.
    expect(await graphNode('device-perimeter_radar')).toHaveAttribute('opacity', '0.14')

    const detail = screen.getByRole('region', { name: /device detail/i })
    expect(within(detail).getByText('2x Directional Effector (Pair)')).toBeInTheDocument()
  })

  it('previews a device on hover without committing to it', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const node = await graphNode('device-field_house_effector')
    await user.hover(node)

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      '2x Directional Effector (Pair)',
    )
    expect(await graphNode('device-perimeter_radar')).toHaveAttribute('opacity', '0.14')
    // Preview only: the selection, and so the detail panel, is untouched.
    expect(node).toHaveAttribute('data-selected', 'false')

    await user.unhover(node)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(await graphNode('device-perimeter_radar')).toHaveAttribute('opacity', '1')
  })

  it('previews from the keyboard too, not only from the pointer', async () => {
    await renderWithProvider(<NetworkTab />)
    const node = await graphNode('device-field_house_effector')
    expect(node).toHaveAttribute('tabindex', '0')

    fireEvent.focus(node)
    expect(await graphNode('device-perimeter_radar')).toHaveAttribute('opacity', '0.14')

    fireEvent.keyDown(node, { key: 'Enter' })
    expect(await graphNode('device-field_house_effector')).toHaveAttribute('data-selected', 'true')

    fireEvent.blur(node)
    expect(await graphNode('device-field_house_effector')).toHaveAttribute('data-selected', 'true')
  })

  it('clears the selection when the bare canvas is clicked', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const node = await graphNode('device-field_house_effector')
    await user.click(node)
    expect(node).toHaveAttribute('data-selected', 'true')

    await user.click(screen.getByRole('img', { name: /network topology/i }))
    expect(await graphNode('device-field_house_effector')).toHaveAttribute('data-selected', 'false')
  })

  it('Esc clears the selection and the zone filter together', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    await user.click(await graphNode('device-field_house_effector'))
    const zones = screen.getByRole('region', { name: /zones/i })
    await user.click(within(zones).getByRole('button', { name: /Perimeter/ }))

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(await graphNode('device-field_house_effector')).toHaveAttribute('data-selected', 'false')
    expect(await graphNode('device-perimeter_radar')).toHaveAttribute('opacity', '1')
    expect(within(zones).getByRole('button', { name: /All zones/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('leaves Esc alone when there is nothing to clear', async () => {
    await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    // Unconsumed, so a dialog or the shell can still act on it.
    expect(event.defaultPrevented).toBe(false)
  })

  it('recolours devices by aggregate risk and legends the overlay', async () => {
    const { user, container } = await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    const legend = screen.getByRole('region', { name: /legend/i })
    expect(within(legend).queryByText('Risk overlay')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Risk' }))

    expect(within(legend).getByText('Risk overlay')).toBeInTheDocument()
    for (const level of ['High', 'Medium', 'Low', 'Unmapped']) {
      expect(within(legend).getByText(level)).toBeInTheDocument()
    }

    // field_house_effector realizes Bastion Effector, a high-risk system.
    const high = (await graphNode('device-field_house_effector')).querySelector('path')!
    expect(high.getAttribute('stroke')).toBe('var(--node-risk-high-leaf)')
    // sensor_net_radar's systems top out at medium.
    const medium = (await graphNode('device-sensor_net_radar')).querySelector('path')!
    expect(medium.getAttribute('stroke')).toBe('var(--node-risk-medium-leaf)')
    // No mapping claims the internet, which is not the same as low risk.
    const unmapped = (await graphNode('device-internet')).querySelector('path')!
    expect(unmapped.getAttribute('stroke')).toBe('var(--color-muted-3)')
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)

    await user.click(screen.getByRole('button', { name: 'Risk' }))
    expect((await graphNode('device-internet')).querySelector('path')!.getAttribute('stroke'))
      .toBe('var(--zone-wan)')
  })

  it('hides the risk toggle at a site with no mappings to aggregate', async () => {
    await renderWithProvider(<NetworkTab />, { route: '/network?site=westfield' })
    await screen.findByRole('img', { name: /network topology/i })
    expect(screen.queryByRole('button', { name: 'Risk' })).not.toBeInTheDocument()
  })

  it('draws the minimap and keeps its viewport rectangle finite', async () => {
    await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    const minimap = screen.getByTestId('network-minimap')
    expect(minimap.querySelectorAll('circle')).toHaveLength(71)
    expect(minimap.getAttribute('viewBox')).not.toMatch(/NaN|Infinity/)

    // jsdom reports 0x0, so the rectangle is correctly absent until layout.
    // What must never happen is a NaN rectangle.
    const viewport = minimap.querySelector('[data-testid="network-minimap-viewport"]')
    if (viewport) {
      for (const attr of ['x', 'y', 'width', 'height']) {
        expect(Number.isFinite(Number(viewport.getAttribute(attr)))).toBe(true)
      }
    }
  })

  it('moves the view when the minimap is dragged', async () => {
    const { container } = await renderWithProvider(<NetworkTab />)
    const svg = await screen.findByRole('img', { name: /network topology/i })
    const layer = svg.querySelector('g[transform]') as SVGGElement
    const before = layer.getAttribute('transform')

    // jsdom gives every element a zero-size box, and a zero-size minimap can
    // only produce a divide-by-zero. Give it a real one.
    const minimap = screen.getByTestId('network-minimap')
    minimap.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 }) as DOMRect

    fireEvent.pointerDown(minimap, { pointerId: 9, button: 0, clientX: 40, clientY: 30 })
    fireEvent.pointerMove(minimap, { pointerId: 9, clientX: 150, clientY: 70 })
    fireEvent.pointerUp(minimap, { pointerId: 9 })

    expect(layer.getAttribute('transform')).not.toBe(before)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('ignores a minimap drag with non-finite coordinates', async () => {
    const { container } = await renderWithProvider(<NetworkTab />)
    const svg = await screen.findByRole('img', { name: /network topology/i })
    const layer = svg.querySelector('g[transform]') as SVGGElement
    const before = layer.getAttribute('transform')

    const minimap = screen.getByTestId('network-minimap')
    minimap.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 }) as DOMRect

    fireEvent(minimap, nonFinitePointer('pointerdown', 10, 30))
    fireEvent.pointerUp(minimap, { pointerId: 10 })

    expect(layer.getAttribute('transform')).toBe(before)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })
})

describe('Network Topology keyboard shortcuts', () => {
  it('/ puts the cursor in the device filter', async () => {
    await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    fireEvent.keyDown(document.body, { key: '/' })
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: /filter devices/i }))
  })

  it('1, 2 and 3 switch the layout, and do not leave the view', async () => {
    await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })

    fireEvent.keyDown(document.body, { key: '2' })
    expect(screen.getByRole('button', { name: 'Zones' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(document.body, { key: '3' })
    expect(screen.getByRole('button', { name: 'Tree' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(document.body, { key: '1' })
    expect(screen.getByRole('button', { name: 'Force' })).toHaveAttribute('aria-pressed', 'true')
    // Still the topology, not whichever tab the shell binds these keys to.
    expect(screen.getByRole('img', { name: /network topology/i })).toBeInTheDocument()
  })

  it('L labels every device and unlabels it again', async () => {
    await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    expect(within(graph).queryAllByText(/Switch/)).toHaveLength(0)

    fireEvent.keyDown(document.body, { key: 'l' })
    expect(screen.getByRole('button', { name: 'Labels' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(graph).getAllByText(/Switch/).length).toBeGreaterThan(0)

    fireEvent.keyDown(document.body, { key: 'l' })
    expect(within(graph).queryAllByText(/Switch/)).toHaveLength(0)
  })

  it('R toggles the risk overlay where there is risk data to show', async () => {
    await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })

    fireEvent.keyDown(document.body, { key: 'r' })
    expect(screen.getByRole('button', { name: 'Risk' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(document.body, { key: 'r' })
    expect(screen.getByRole('button', { name: 'Risk' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('F refits without ever accepting a zero scale', async () => {
    const { container } = await renderWithProvider(<NetworkTab />)
    const svg = await screen.findByRole('img', { name: /network topology/i })
    const layer = svg.querySelector('g[transform]') as SVGGElement

    fireEvent.keyDown(document.body, { key: 'f' })

    // jsdom has no layout, so fitToScreen returns null and the transform is
    // held. The failure this guards is a scale of 0 being committed instead.
    const scale = Number(/scale\(([-\d.]+)\)/.exec(layer.getAttribute('transform') ?? '')?.[1])
    expect(scale).toBeGreaterThan(0)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('leaves the keyboard to the search box while it has the cursor', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    const search = screen.getByRole('searchbox', { name: /filter devices/i })
    await user.click(search)
    await user.keyboard('123')

    expect(search).toHaveValue('123')
    expect(screen.getByRole('button', { name: 'Force' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Network label size', () => {
  it('grows and shrinks the labels', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    await user.click(screen.getByRole('button', { name: 'Labels' }))

    const sizeOf = () =>
      Number(
        screen
          .getByRole('img', { name: /network topology/i })
          .querySelector('text')
          ?.getAttribute('font-size'),
      )

    const base = sizeOf()
    await user.click(screen.getByRole('button', { name: 'Larger labels' }))
    expect(sizeOf()).toBeGreaterThan(base)

    await user.click(screen.getByRole('button', { name: 'Smaller labels' }))
    await user.click(screen.getByRole('button', { name: 'Smaller labels' }))
    expect(sizeOf()).toBeLessThan(base)
  })

  it('reports the size as a percentage', async () => {
    await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    // Scoped: zoom reports a percentage in the same strip.
    expect(screen.getByRole('group', { name: 'Labels' })).toHaveTextContent('100%')
  })

  it('never scales past its bounds, however hard you press', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    for (let i = 0; i < 30; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Larger labels' }))
    }
    expect(screen.getByRole('group', { name: 'Labels' })).toHaveTextContent('260%')
  })
})

describe('Network node size', () => {
  const glyphOf = () =>
    screen
      .getByRole('img', { name: /network topology/i })
      .querySelector('[data-testid^="device-"] path')
      ?.getAttribute('d')

  it('enlarges and shrinks the device glyphs', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    const base = glyphOf()

    await user.click(screen.getByRole('button', { name: 'Larger nodes' }))
    expect(glyphOf()).not.toBe(base)

    await user.click(screen.getByRole('button', { name: 'Smaller nodes' }))
    expect(glyphOf()).toBe(base)
  })

  it('labels every control in words, not glyphs', async () => {
    await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    for (const name of ['Zoom', 'Nodes', 'Labels']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Fit' })).toBeInTheDocument()
  })

  it('keeps geometry finite at every node scale', async () => {
    const { user, container } = await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    for (let i = 0; i < 12; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Larger nodes' }))
    }
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })
})

describe('Network panel', () => {
  it('hides and restores the sidebar from the toolbar', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const panel = await screen.findByRole('complementary', { name: /topology controls/i })
    expect(panel).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Panel' }))
    expect(panel).not.toBeVisible()

    // A reopen affordance must exist, or the panel is gone for anyone who does
    // not know the shortcut.
    await user.click(screen.getByRole('button', { name: 'Panel' }))
    expect(panel).toBeVisible()
  })

  it('toggles on backslash', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const panel = await screen.findByRole('complementary', { name: /topology controls/i })
    await user.keyboard('\\')
    expect(panel).not.toBeVisible()
    await user.keyboard('\\')
    expect(panel).toBeVisible()
  })

  it('gives the canvas the space when the panel is closed', async () => {
    const { user, container } = await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    await user.click(screen.getByRole('button', { name: 'Panel' }))
    expect(container.querySelector('.left-80')).toBeNull()
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })
})

/**
 * The same slop rule as the map, from the same module, for the same reason.
 *
 * Measured in a browser before the fix: dragging a device 20px in twenty
 * one-pixel moves moved it and also selected it, and a 60px pan from bare
 * canvas delivered in sixty one-pixel moves cleared the selection on the click
 * that closed it. Both look like a mouse being used normally.
 */
describe('Network Topology drag slop', () => {
  const drip = (
    target: Element,
    pointerId: number,
    from: { x: number; y: number },
    total: number,
  ) => {
    for (let i = 1; i <= total; i += 1) {
      fireEvent.pointerMove(target, {
        pointerId,
        clientX: from.x + i,
        clientY: from.y + Math.round(i / 2),
      })
    }
  }

  it('does not select a device dragged 20px in twenty one-pixel moves', async () => {
    await renderWithProvider(<NetworkTab />)
    const svg = await screen.findByRole('img', { name: /network topology/i })
    const node = await graphNode('device-core_switch')
    const home = node.getAttribute('transform')

    fireEvent.pointerDown(node, { pointerId: 30, button: 0, clientX: 200, clientY: 200 })
    drip(svg, 30, { x: 200, y: 200 }, 20)
    fireEvent.pointerUp(svg, { pointerId: 30 })
    fireEvent.click(node)

    expect(node.getAttribute('transform')).not.toBe(home)
    expect(await graphNode('device-core_switch')).toHaveAttribute('data-selected', 'false')
    const detail = screen.getByRole('region', { name: /device detail/i })
    expect(within(detail).getByText(/Pick a device/)).toBeInTheDocument()
  })

  it('does not clear the selection on a pan delivered in one-pixel moves', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    const svg = await screen.findByRole('img', { name: /network topology/i })
    await user.click(await graphNode('device-field_house_effector'))
    expect(await graphNode('device-field_house_effector')).toHaveAttribute(
      'data-selected', 'true',
    )

    fireEvent.pointerDown(svg, { pointerId: 31, button: 0, clientX: 400, clientY: 300 })
    drip(svg, 31, { x: 400, y: 300 }, 60)
    fireEvent.pointerUp(svg, { pointerId: 31 })
    fireEvent.click(svg)

    expect(await graphNode('device-field_house_effector')).toHaveAttribute(
      'data-selected', 'true',
    )
  })

  it('does not nudge a device when the hand shakes during a click', async () => {
    await renderWithProvider(<NetworkTab />)
    const svg = await screen.findByRole('img', { name: /network topology/i })
    const node = await graphNode('device-core_switch')
    const home = node.getAttribute('transform')

    fireEvent.pointerDown(node, { pointerId: 32, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(svg, { pointerId: 32, clientX: 102, clientY: 101 })
    fireEvent.pointerMove(svg, { pointerId: 32, clientX: 103, clientY: 102 })
    fireEvent.pointerUp(svg, { pointerId: 32 })
    fireEvent.click(node)

    // Three pixels is a click: the device stays put and the record opens.
    expect(node.getAttribute('transform')).toBe(home)
    expect(await graphNode('device-core_switch')).toHaveAttribute('data-selected', 'true')
  })
})

/**
 * The topology shares the map's gesture rule, so it shares this test.
 *
 * Pointer moves can arrive many to a task, and React renders once per task, so
 * a handler that read the transform off a prop kept only the last event of a
 * burst. Measured on the map before the fix: a 60px pan applied 1px.
 */
describe('Network Topology gesture batching', () => {
  it('applies the whole pan when sixty moves arrive in one task', async () => {
    await renderWithProvider(<NetworkTab />)
    const svg = await screen.findByRole('img', { name: /network topology/i })
    const layer = svg.querySelector('g[transform]') as SVGGElement
    const panX = () =>
      Number(/translate\(([-\d.]+),/.exec(layer.getAttribute('transform') ?? '')?.[1])
    const before = panX()

    await act(async () => {
      svg.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true, pointerId: 33, button: 0, clientX: 500, clientY: 300,
        }),
      )
      for (let i = 1; i <= 60; i += 1) {
        svg.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true, pointerId: 33, clientX: 500 + i, clientY: 300,
          }),
        )
      }
    })
    fireEvent.pointerUp(svg, { pointerId: 33 })

    expect(panX() - before).toBe(60)
  })
})
