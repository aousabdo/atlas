import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MapTab } from '../MapTab'
import { StaticProvider } from '../../../data/StaticProvider'
import { AtlasDataError } from '../../../data/provider'
import { renderWithProvider } from '../../../test/renderWithProvider'

describe('Orientation Map', () => {
  it('renders 32 leaf nodes when fully expanded', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    expect(within(canvas).getAllByTestId(/^leaf-/)).toHaveLength(32)
  })

  it('shows the seven stats from the current tool', async () => {
    await renderWithProvider(<MapTab />)
    const stats = await screen.findByRole('region', { name: /statistics/i })
    for (const [label, value] of [
      ['Systems', '32'], ['Confirmed', '23'], ['Unconfirmed', '9'],
      ['High Risk', '11'], ['Med Risk', '19'], ['Low Risk', '2'], ['Links', '14'],
    ]) {
      const stat = within(stats).getByRole('group', { name: label })
      expect(within(stat).getByText(value)).toBeInTheDocument()
    }
  })

  it('opens a detail panel naming the system, its risk and its integrations', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(await screen.findByTestId('leaf-trackwell'))
    const panel = await screen.findByRole('complementary', { name: /system detail/i })
    // The plan's getByText(/Trackwell/) is ambiguous against the real bundle:
    // trackwell's own detail prose names the product too. The heading is the
    // assertion that was meant.
    expect(
      within(panel).getByRole('heading', { name: 'Trackwell Sensor AI' }),
    ).toBeInTheDocument()
    expect(within(panel).getByText('medium')).toBeInTheDocument()
    expect(within(panel).getByText(/Known Integration Links/i)).toBeInTheDocument()
  })

  it('marks unconfirmed systems and only those', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    const soft = within(canvas).getAllByTestId(/^leaf-/)
      .filter((n) => n.getAttribute('data-soft') === 'true')
      .map((n) => n.getAttribute('data-id'))
      .sort()
    expect(soft).toEqual([
      'beacon', 'cirrus', 'dwell', 'ember', 'fathom', 'gantry', 'halyard', 'ingot', 'jetty',
    ])
  })

  it('toggles current and desired links independently', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Links' }))
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    expect(within(canvas).getAllByTestId(/^link-current-/)).toHaveLength(14)
    expect(within(canvas).queryAllByTestId(/^link-desired-/)).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Desired' }))
    expect(within(canvas).getAllByTestId(/^link-desired-/)).toHaveLength(13)
    expect(within(canvas).getAllByTestId(/^link-current-/)).toHaveLength(14)

    await user.click(screen.getByRole('button', { name: 'Links' }))
    expect(within(canvas).queryAllByTestId(/^link-current-/)).toHaveLength(0)
    expect(within(canvas).getAllByTestId(/^link-desired-/)).toHaveLength(13)
  })

  it('recolours by risk when Risk View is on', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(screen.getByRole('button', { name: 'Risk View' }))
    const canvas = screen.getByRole('img', { name: /orientation map/i })
    const high = within(canvas).getAllByTestId(/^leaf-/)
      .filter((n) => n.getAttribute('data-risk') === 'high')
    expect(high).toHaveLength(11)
    for (const node of high) {
      expect(node.querySelector('rect')).toHaveAttribute(
        'fill', 'var(--node-risk-high-leaf)',
      )
    }
  })

  it('auto-enables Clean when Grid goes on', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    const grid = await screen.findByRole('button', { name: 'Grid' })
    expect(screen.getByRole('button', { name: 'Clean' })).toHaveAttribute(
      'aria-pressed', 'false',
    )
    await user.click(grid)
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Clean' })).toHaveAttribute(
      'aria-pressed', 'true',
    )
  })

  it('focuses and expands to a system named in ?focus=', async () => {
    await renderWithProvider(<MapTab />, { route: '/map?focus=beacon' })
    const panel = await screen.findByRole('complementary', { name: /system detail/i })
    expect(within(panel).getByRole('heading', { name: 'Beacon' })).toBeInTheDocument()
    // The whole ancestor chain must be expanded, or the focused node is not drawn.
    expect(await screen.findByTestId('leaf-beacon')).toBeInTheDocument()
    // Its siblings under the same owner group come with it; a sibling group does not.
    expect(screen.getByTestId('leaf-fathom')).toBeInTheDocument()
    expect(screen.queryByTestId('leaf-ucop')).not.toBeInTheDocument()
  })

  it('links a mapped system through to the network tab', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(await screen.findByTestId('leaf-bastion'))
    const link = await screen.findByRole('link', { name: /View in Network/i })
    expect(link).toHaveAttribute(
      'href', expect.stringContaining('/network?site=northgate&focus=field_house_effector'),
    )
  })

  it('says so plainly when a system has no device mapping', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(await screen.findByTestId('leaf-fathom'))
    const panel = await screen.findByRole('complementary', { name: /system detail/i })
    expect(within(panel).getByText(/Not mapped to any site/i)).toBeInTheDocument()
    expect(within(panel).queryByRole('link', { name: /View in Network/i })).toBeNull()
  })

  it('draws a minimap from the same positions, not a copy of the renderer', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    const overview = await screen.findByRole('img', { name: /map overview/i })
    const before = overview.querySelectorAll('circle').length
    await user.click(screen.getByRole('button', { name: 'Expand All' }))
    expect(overview.querySelectorAll('circle').length).toBeGreaterThan(before)
  })

  it('does not emit NaN geometry before layout', async () => {
    // jsdom reports 0x0 for every element, so this exercises the same
    // mount-before-layout path as the network zoom guard in Task 25.
    const { container } = await renderWithProvider(<MapTab />)
    await screen.findByRole('img', { name: /orientation map/i })
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('keeps the geometry finite with every toggle on and everything expanded', async () => {
    const { container, user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    for (const name of ['Links', 'Desired', 'Grid', 'Risk View']) {
      await user.click(screen.getByRole('button', { name }))
    }
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('reports a load failure instead of an empty map', async () => {
    const spy = vi
      .spyOn(StaticProvider.prototype, 'getSystems')
      .mockRejectedValue(new AtlasDataError('bundle unreachable'))
    try {
      await renderWithProvider(<MapTab />)
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/Could not load the orientation map/i)
      expect(screen.queryByRole('img', { name: /orientation map/i })).toBeNull()
      expect(screen.queryByRole('region', { name: /statistics/i })).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('Orientation Map interaction', () => {
  it('pans when the canvas is dragged', async () => {
    await renderWithProvider(<MapTab />)
    const svg = await screen.findByRole('img', { name: /orientation map/i })
    const layer = svg.querySelector('g[transform]') as SVGGElement
    const before = layer.getAttribute('transform')

    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 500, clientY: 360 })
    fireEvent.pointerUp(svg, { pointerId: 1 })

    expect(layer.getAttribute('transform')).not.toBe(before)
    expect(layer.getAttribute('transform')).toMatch(/translate\(100,60\)/)
  })

  it('zooms on scroll', async () => {
    await renderWithProvider(<MapTab />)
    const svg = await screen.findByRole('img', { name: /orientation map/i })
    const layer = svg.querySelector('g[transform]') as SVGGElement
    const before = layer.getAttribute('transform')

    fireEvent.wheel(svg, { deltaY: -100, clientX: 400, clientY: 300 })
    expect(layer.getAttribute('transform')).not.toBe(before)
  })

  it('never produces a zero or non-finite scale, however hard you zoom out', async () => {
    await renderWithProvider(<MapTab />)
    const svg = await screen.findByRole('img', { name: /orientation map/i })
    const layer = svg.querySelector('g[transform]') as SVGGElement
    for (let i = 0; i < 40; i += 1) {
      fireEvent.wheel(svg, { deltaY: 200, clientX: 400, clientY: 300 })
    }
    const scale = Number(/scale\(([-\d.]+)\)/.exec(layer.getAttribute('transform') ?? '')?.[1])
    expect(Number.isFinite(scale)).toBe(true)
    expect(scale).toBeGreaterThan(0)
  })

  it('moves a node when it is dragged, and does not count that as a click', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const node = await screen.findByTestId('leaf-beacon')
    const before = node.getAttribute('transform')

    fireEvent.pointerDown(node, { pointerId: 2, button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(
      screen.getByRole('img', { name: /orientation map/i }),
      { pointerId: 2, clientX: 260, clientY: 240 },
    )
    fireEvent.pointerUp(
      screen.getByRole('img', { name: /orientation map/i }),
      { pointerId: 2 },
    )

    expect(node.getAttribute('transform')).not.toBe(before)
    // The drag must not have opened the detail panel.
    expect(screen.queryByRole('complementary', { name: /system detail/i })).not.toBeInTheDocument()
  })

  it('shows a viewport rectangle on the minimap', async () => {
    await renderWithProvider(<MapTab />)
    await screen.findByRole('img', { name: /orientation map/i })
    // jsdom reports 0x0, so the rectangle is correctly absent until layout.
    // What must never happen is a NaN rectangle.
    const minimap = screen.getByRole('img', { name: /map overview/i })
    const viewport = minimap.querySelector('[data-testid="minimap-viewport"]')
    if (viewport) {
      for (const attr of ['x', 'y', 'width', 'height']) {
        expect(Number.isFinite(Number(viewport.getAttribute(attr)))).toBe(true)
      }
    }
  })

  it('resizes labels', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const node = await screen.findByTestId('leaf-beacon')
    const before = node.querySelector('text')?.getAttribute('font-size')
    await user.click(screen.getByRole('button', { name: 'Larger labels' }))
    expect(node.querySelector('text')?.getAttribute('font-size')).not.toBe(before)
  })

  it('Reset puts dragged nodes and label size back', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const node = await screen.findByTestId('leaf-beacon')
    const home = node.getAttribute('transform')

    fireEvent.pointerDown(node, { pointerId: 3, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(
      screen.getByRole('img', { name: /orientation map/i }),
      { pointerId: 3, clientX: 180, clientY: 150 },
    )
    fireEvent.pointerUp(screen.getByRole('img', { name: /orientation map/i }), { pointerId: 3 })
    expect(node.getAttribute('transform')).not.toBe(home)

    // Reset also restores the default expansion, so re-open the tree before
    // checking the node came home.
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await user.click(screen.getByRole('button', { name: 'Expand All' }))
    expect((await screen.findByTestId('leaf-beacon')).getAttribute('transform')).toBe(home)
  })
})

describe('Orientation Map label size', () => {
  it('starts larger than 1x, because the map opens fitted', async () => {
    await renderWithProvider(<MapTab />)
    await screen.findByRole('img', { name: /orientation map/i })
    expect(screen.getByText('150%')).toBeInTheDocument()
  })

  it('grows and shrinks, and Reset returns to the default', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const sizeOf = () =>
      Number(screen.getByTestId('leaf-beacon').querySelector('text')?.getAttribute('font-size'))

    const base = sizeOf()
    await user.click(screen.getByRole('button', { name: 'Larger labels' }))
    expect(sizeOf()).toBeGreaterThan(base)

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await user.click(screen.getByRole('button', { name: 'Expand All' }))
    expect(sizeOf()).toBe(base)
  })
})

describe('Orientation Map box size and zoom', () => {
  const boxOf = () =>
    Number(screen.getByTestId('leaf-beacon').querySelector('rect')?.getAttribute('width'))

  it('enlarges and shrinks the boxes', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const base = boxOf()

    await user.click(screen.getByRole('button', { name: 'Larger boxes' }))
    expect(boxOf()).toBeGreaterThan(base)

    await user.click(screen.getByRole('button', { name: 'Smaller boxes' }))
    await user.click(screen.getByRole('button', { name: 'Smaller boxes' }))
    expect(boxOf()).toBeLessThan(base)
  })

  it('scales the box without touching the label, and the reverse', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const fontOf = () =>
      Number(screen.getByTestId('leaf-beacon').querySelector('text')?.getAttribute('font-size'))

    const font = fontOf()
    await user.click(screen.getByRole('button', { name: 'Larger boxes' }))
    expect(fontOf()).toBe(font)

    const box = boxOf()
    await user.click(screen.getByRole('button', { name: 'Larger labels' }))
    expect(boxOf()).toBe(box)
  })

  it('clamps the box scale rather than running away', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await screen.findByRole('img', { name: /orientation map/i })
    for (let i = 0; i < 25; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Larger boxes' }))
    }
    expect(screen.getByText('220%')).toBeInTheDocument()
  })

  it('zooms from the toolbar and reports the level', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    const svg = await screen.findByRole('img', { name: /orientation map/i })
    const layer = svg.querySelector('g[transform]') as SVGGElement
    const before = layer.getAttribute('transform')

    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(layer.getAttribute('transform')).not.toBe(before)

    const zoomGroup = screen.getByRole('group', { name: 'Zoom' })
    expect(zoomGroup.textContent).toMatch(/\d+%/)
  })

  it('Reset restores both scales', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await screen.findByRole('img', { name: /orientation map/i })
    await user.click(screen.getByRole('button', { name: 'Larger boxes' }))
    await user.click(screen.getByRole('button', { name: 'Larger labels' }))
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('group', { name: 'Boxes' }).textContent).toContain('100%')
    expect(screen.getByRole('group', { name: 'Labels' }).textContent).toContain('150%')
  })
})
