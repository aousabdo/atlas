import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

  it('does not open a system when the click that closes a drag arrives', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const node = await screen.findByTestId('leaf-beacon')
    const svg = screen.getByRole('img', { name: /orientation map/i })

    fireEvent.pointerDown(node, { pointerId: 6, button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(svg, { pointerId: 6, clientX: 280, clientY: 250 })
    fireEvent.pointerUp(svg, { pointerId: 6 })
    // The browser dispatches click after pointerup, and fireEvent does not
    // synthesise it. Without this line the drag tests never reach activate().
    fireEvent.click(node)

    expect(
      screen.queryByRole('complementary', { name: /system detail/i }),
    ).not.toBeInTheDocument()
  })

  it('does not collapse a branch that was only dragged', async () => {
    await renderWithProvider(<MapTab />)
    const svg = await screen.findByRole('img', { name: /orientation map/i })
    const branch = await screen.findByTestId('branch-inv')
    expect(branch).toHaveAttribute('aria-expanded', 'true')

    fireEvent.pointerDown(branch, { pointerId: 7, button: 0, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: 370, clientY: 340 })
    fireEvent.pointerUp(svg, { pointerId: 7 })
    fireEvent.click(branch)

    expect(screen.getByTestId('branch-inv')).toHaveAttribute('aria-expanded', 'true')
  })

  it('still opens a system on the next real click after a drag', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const node = await screen.findByTestId('leaf-beacon')
    const svg = screen.getByRole('img', { name: /orientation map/i })

    fireEvent.pointerDown(node, { pointerId: 8, button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(svg, { pointerId: 8, clientX: 280, clientY: 250 })
    fireEvent.pointerUp(svg, { pointerId: 8 })
    fireEvent.click(node)

    // Swallowing one click must not latch. The next press is a fresh gesture.
    await user.click(screen.getByTestId('leaf-beacon'))
    expect(
      await screen.findByRole('complementary', { name: /system detail/i }),
    ).toBeInTheDocument()
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

/**
 * Where the floating pieces sit, asserted on the class list.
 *
 * jsdom lays nothing out, so a rectangle overlap cannot be measured here. What
 * can be pinned is the rule that produces the overlap: a fixed-width column on
 * one edge, and a chrome layer inset by that same width on that same edge. A
 * panel that shares an edge with the chrome without the inset is the defect.
 */
describe('Orientation Map chrome layout', () => {
  const has = (element: Element, token: string) =>
    element.className.split(/\s+/).includes(token)

  it('docks the detail panel beside the chrome, not on top of it', async () => {
    await renderWithProvider(<MapTab />, { route: '/map?focus=beacon' })
    await screen.findByRole('complementary', { name: /system detail/i })

    const detail = screen.getByTestId('map-detail')
    const chrome = screen.getByTestId('map-chrome')
    expect(has(detail, 'left-0')).toBe(true)
    expect(has(detail, 'w-80')).toBe(true)
    expect(has(chrome, 'left-80')).toBe(true)

    // Everything the panel used to bury is still on screen and still complete.
    const strip = screen.getByRole('toolbar', { name: 'View controls' })
    expect(within(strip).getAllByRole('button')).toHaveLength(8)
    expect(screen.getByRole('img', { name: /map overview/i })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Map controls' })).toBeInTheDocument()
  })

  it('gives the chrome the whole canvas back when the panel closes', async () => {
    const { user } = await renderWithProvider(<MapTab />, { route: '/map?focus=beacon' })
    const panel = await screen.findByRole('complementary', { name: /system detail/i })
    await user.click(within(panel).getByRole('button', { name: 'Close' }))

    expect(screen.queryByTestId('map-detail')).toBeNull()
    expect(has(screen.getByTestId('map-chrome'), 'left-0')).toBe(true)
  })

  it('lets a pan through the gaps in the top chrome band', async () => {
    await renderWithProvider(<MapTab />)
    await screen.findByRole('img', { name: /orientation map/i })

    // The band spans the full canvas width and is mostly empty. Only the two
    // control blocks inside it may take the pointer.
    const band = screen.getByTestId('map-chrome-top')
    expect(has(band, 'pointer-events-auto')).toBe(false)
    expect(
      screen.getByRole('region', { name: /statistics/i }).closest('.pointer-events-auto'),
    ).not.toBe(band)
    expect(
      screen.getByRole('toolbar', { name: 'Map controls' }).closest('.pointer-events-auto'),
    ).not.toBe(band)
  })
})

/**
 * The legend has to answer the question the colours pose.
 *
 * Asserted against the canvas rather than against a list of names, so a group
 * added to the bundle cannot end up drawn in a colour nothing explains.
 */
describe('Orientation Map legend', () => {
  const legendTones = () => {
    const legend = screen.getByRole('region', { name: 'Map legend' })
    const tones = new Set<string>()
    for (const row of legend.querySelectorAll('[data-swatch-fill]')) {
      tones.add(row.getAttribute('data-swatch-fill') ?? '')
      tones.add(row.getAttribute('data-swatch-stroke') ?? '')
    }
    return tones
  }

  const drawnFills = (canvas: HTMLElement) =>
    new Set(
      [...canvas.querySelectorAll('g[data-id] > rect')].map(
        (rect) => rect.getAttribute('fill') ?? '',
      ),
    )

  it('names a colour for everything drawn on the canvas', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    await user.click(screen.getByRole('button', { name: 'Expand All' }))
    await user.click(screen.getByRole('button', { name: /legend/i }))

    const tones = legendTones()
    expect(tones.size).toBeGreaterThan(0)
    for (const fill of drawnFills(canvas)) {
      expect([...tones]).toContain(fill)
    }
  })

  it('explains the risk ramp, and only while Risk View is on', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    await user.click(screen.getByRole('button', { name: 'Expand All' }))
    await user.click(screen.getByRole('button', { name: /legend/i }))

    expect(legendTones()).not.toContain('var(--node-risk-high-leaf)')

    await user.click(screen.getByRole('button', { name: 'Risk View' }))
    const tones = legendTones()
    for (const fill of drawnFills(canvas)) {
      expect([...tones]).toContain(fill)
    }
    expect(tones).toContain('var(--node-risk-high-leaf)')
  })
})

describe('Orientation Map shortcuts', () => {
  it('toggles Risk View on R', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await screen.findByRole('img', { name: /orientation map/i })
    await user.keyboard('r')
    expect(screen.getByRole('button', { name: 'Risk View' })).toHaveAttribute(
      'aria-pressed', 'true',
    )
    await user.keyboard('R')
    expect(screen.getByRole('button', { name: 'Risk View' })).toHaveAttribute(
      'aria-pressed', 'false',
    )
  })

  it('clears the selection on Escape', async () => {
    const { user } = await renderWithProvider(<MapTab />, { route: '/map?focus=beacon' })
    await screen.findByRole('complementary', { name: /system detail/i })
    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('complementary', { name: /system detail/i }),
    ).not.toBeInTheDocument()
  })

  it('spells the keys out on screen, since nothing else does', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await screen.findByRole('img', { name: /orientation map/i })
    await user.click(screen.getByRole('button', { name: /legend/i }))
    const legend = await screen.findByRole('region', { name: 'Map legend' })
    for (const key of ['F', 'C', 'R', 'Esc']) {
      expect(within(legend).getByText(key)).toBeInTheDocument()
    }
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

/**
 * A real mouse does not jump. It emits a stream of one and two pixel moves,
 * and the slop has to be measured against where the press landed, not against
 * the previous move.
 *
 * Measured in a browser against the code these tests were written for: a 20px
 * drag delivered as twenty one-pixel moves moved a leaf 43.71 world pixels and
 * still opened its detail panel; a 60px drag over sixty moves moved it 131.15
 * and still opened it. The same travel in one move behaved correctly, which is
 * why the single-move tests above passed throughout.
 */
describe('Orientation Map drag slop', () => {
  /** Deliver `total` px of travel one pixel at a time, as a mouse does. */
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

  it('does not open a system dragged 20px in twenty one-pixel moves', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const node = await screen.findByTestId('leaf-beacon')
    const svg = screen.getByRole('img', { name: /orientation map/i })
    const home = node.getAttribute('transform')

    fireEvent.pointerDown(node, { pointerId: 20, button: 0, clientX: 200, clientY: 200 })
    drip(svg, 20, { x: 200, y: 200 }, 20)
    fireEvent.pointerUp(svg, { pointerId: 20 })
    fireEvent.click(node)

    expect(node.getAttribute('transform')).not.toBe(home)
    expect(
      screen.queryByRole('complementary', { name: /system detail/i }),
    ).not.toBeInTheDocument()
  })

  it('does not collapse a branch dragged in one-pixel moves', async () => {
    await renderWithProvider(<MapTab />)
    const svg = await screen.findByRole('img', { name: /orientation map/i })
    const branch = await screen.findByTestId('branch-inv')
    expect(branch).toHaveAttribute('aria-expanded', 'true')

    fireEvent.pointerDown(branch, { pointerId: 21, button: 0, clientX: 300, clientY: 300 })
    drip(svg, 21, { x: 300, y: 300 }, 30)
    fireEvent.pointerUp(svg, { pointerId: 21 })
    fireEvent.click(branch)

    expect(screen.getByTestId('branch-inv')).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not nudge a node when the hand shakes during a click', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const node = await screen.findByTestId('leaf-beacon')
    const svg = screen.getByRole('img', { name: /orientation map/i })
    const home = node.getAttribute('transform')

    fireEvent.pointerDown(node, { pointerId: 22, button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(svg, { pointerId: 22, clientX: 202, clientY: 201 })
    fireEvent.pointerMove(svg, { pointerId: 22, clientX: 203, clientY: 202 })
    fireEvent.pointerUp(svg, { pointerId: 22 })
    fireEvent.click(node)

    // Two pixels is a click, so the record opens and the node has not moved.
    expect(node.getAttribute('transform')).toBe(home)
    expect(
      await screen.findByRole('complementary', { name: /system detail/i }),
    ).toBeInTheDocument()
  })

  it('does not pan the canvas during a click either', async () => {
    await renderWithProvider(<MapTab />)
    const svg = await screen.findByRole('img', { name: /orientation map/i })
    const layer = svg.querySelector('g[transform]') as SVGGElement
    const before = layer.getAttribute('transform')

    fireEvent.pointerDown(svg, { pointerId: 23, button: 0, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(svg, { pointerId: 23, clientX: 402, clientY: 301 })
    fireEvent.pointerUp(svg, { pointerId: 23 })

    expect(layer.getAttribute('transform')).toBe(before)
  })
})

/**
 * The two graph tabs used to disagree one tab apart: the topology cleared the
 * selection when the ground was clicked, the map did nothing at all. One rule,
 * and it is the topology's.
 */
describe('Orientation Map bare canvas', () => {
  it('clears the selection when the bare canvas is clicked', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(await screen.findByTestId('leaf-beacon'))
    expect(
      await screen.findByRole('complementary', { name: /system detail/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('img', { name: /orientation map/i }))
    expect(
      screen.queryByRole('complementary', { name: /system detail/i }),
    ).not.toBeInTheDocument()
  })

  it('keeps the record open through a pan delivered in one-pixel moves', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(await screen.findByTestId('leaf-beacon'))
    const svg = screen.getByRole('img', { name: /orientation map/i })

    fireEvent.pointerDown(svg, { pointerId: 24, button: 0, clientX: 400, clientY: 300 })
    for (let i = 1; i <= 60; i += 1) {
      fireEvent.pointerMove(svg, { pointerId: 24, clientX: 400 + i, clientY: 300 })
    }
    fireEvent.pointerUp(svg, { pointerId: 24 })
    fireEvent.click(svg)

    expect(
      screen.getByRole('complementary', { name: /system detail/i }),
    ).toBeInTheDocument()
  })

  it('does not clear when a system is picked, though the click starts on it', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(await screen.findByTestId('leaf-trackwell'))
    // The click must not bubble on to the ground and undo itself.
    expect(
      await screen.findByRole('complementary', { name: /system detail/i }),
    ).toBeInTheDocument()
  })
})

/**
 * The legend floats over the canvas, so it must cost the canvas nothing.
 *
 * Selecting a system insets the chrome by the width of the record, sliding the
 * legend from x=25 to x=345 across a tree that does not move. Hit-testable
 * nodes fell from 20 of 22 to 11 of 22 at 1280x720, 22 to 14 at 1366x768, 22
 * to 18 at 1440x900, and with Expand All and four marks on the card is 422x305
 * and covers 9 of 45.
 */
describe('Orientation Map legend footprint', () => {
  const has = (element: Element, token: string) =>
    element.className.split(/\s+/).includes(token)

  it('lets the pointer through to the tree underneath it', async () => {
    await renderWithProvider(<MapTab />)
    await screen.findByRole('img', { name: /orientation map/i })

    const card = screen.getByTestId('map-legend-card')
    expect(has(card, 'pointer-events-none')).toBe(true)
    expect(has(card, 'pointer-events-auto')).toBe(false)
    // Only the control that opens and closes it takes the pointer back.
    const claims = card.querySelectorAll('.pointer-events-auto')
    expect(claims).toHaveLength(1)
    expect(claims[0]).toBe(screen.getByRole('button', { name: /legend/i }))
  })

  it('starts closed, so it covers no node until asked for', async () => {
    // Reserving canvas for it was measured and rejected: the legend is a
    // corner and the fit works on a band, so the whole width went and the
    // drawing fell from 48% to 28%. One click is the cheaper price.
    const { user } = await renderWithProvider(<MapTab />)
    await screen.findByRole('img', { name: /orientation map/i })
    const toggle = screen.getByRole('button', { name: /legend/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: 'Map legend' })).toBeNull()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'Map legend' })).toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: 'Map legend' })).toBeNull()

    await user.click(toggle)
    expect(screen.getByRole('region', { name: 'Map legend' })).toBeInTheDocument()
  })

  it('gives the pointer to the stat tiles, not to the block they sit in', async () => {
    await renderWithProvider(<MapTab />)
    const stats = await screen.findByRole('region', { name: /statistics/i })

    // The section is a full-width block, and from x=200 to x=760 at 1440x900
    // it ate every pan and every node click that started under it.
    expect(has(stats, 'pointer-events-auto')).toBe(false)
    const tiles = within(stats).getAllByRole('group')
    expect(tiles).toHaveLength(7)
    for (const tile of tiles) {
      expect(has(tile, 'pointer-events-auto')).toBe(true)
    }
  })
})

/**
 * The gutter the fit leaves at the top has to be the band's actual height.
 *
 * Measured, map-chrome-top is 1416x55 at 1440x900 but 1256x115 at 1280x720 and
 * 1342x115 at 1366x768, because the toolbar wraps onto its own line. A constant
 * cannot be both.
 */
describe('Orientation Map top gutter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const box = (width: number, height: number) =>
    ({
      width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect

  /** Lay the page out for real: jsdom reports every box as 0x0. */
  const layoutWith = (bandHeight: number) => {
    const real = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function measured(this: Element) {
        const id = this.getAttribute('data-testid')
        if (id === 'map-chrome-top') return box(1256, bandHeight)
        if (id === 'map-canvas') return box(1256, 720)
        return real.call(this)
      },
    )
  }

  const fittedY = async (bandHeight: number) => {
    layoutWith(bandHeight)
    const { container } = await renderWithProvider(<MapTab />)
    const svg = await within(container).findByRole('img', { name: /orientation map/i })
    const layer = svg.querySelector('g[transform]') as SVGGElement
    const y = /translate\([-\d.]+,([-\d.]+)\)/.exec(layer.getAttribute('transform') ?? '')?.[1]
    expect(y).toBeDefined()
    return Number(y)
  }

  it('reserves more room when the toolbar wraps than when it does not', async () => {
    const single = await fittedY(55)
    cleanup()
    vi.restoreAllMocks()
    const wrapped = await fittedY(115)

    // A fixed gutter fits both to the same place, which is the defect.
    expect(wrapped).toBeGreaterThan(single)
  })
})

/**
 * A gesture arrives as a burst of events, and every one of them must count.
 *
 * fireEvent flushes React between events, which no browser promises: pointer
 * moves can arrive many to a task, and React batches everything in a task into
 * one render. Handlers that computed `transform.x + dx` from a prop therefore
 * kept only the last event of the burst. Measured in Chrome before the fix: a
 * 60px pan delivered as sixty one-pixel moves panned the canvas 1px, and a
 * 20px node drag delivered the same way moved the node 1 screen pixel's worth.
 *
 * These dispatch raw DOM events in one task, so they see what a browser sees.
 */
describe('Orientation Map gesture batching', () => {
  const burst = (target: Element, pointerId: number, from: { x: number; y: number }, total: number) => {
    for (let i = 1; i <= total; i += 1) {
      target.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true, pointerId, clientX: from.x + i, clientY: from.y,
        }),
      )
    }
  }
  const down = (target: Element, pointerId: number, at: { x: number; y: number }) => {
    target.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true, pointerId, button: 0, clientX: at.x, clientY: at.y,
      }),
    )
  }
  const panX = (layer: Element) =>
    Number(/translate\(([-\d.]+),/.exec(layer.getAttribute('transform') ?? '')?.[1])

  it('applies the whole pan when sixty moves arrive in one task', async () => {
    await renderWithProvider(<MapTab />)
    const svg = await screen.findByRole('img', { name: /orientation map/i })
    const layer = svg.querySelector('g[transform]') as SVGGElement
    const before = panX(layer)

    // One act, so all sixty land in one task and React renders once, exactly
    // as a browser delivers a fast pan.
    await act(async () => {
      down(svg, 40, { x: 700, y: 400 })
      burst(svg, 40, { x: 700, y: 400 }, 60)
    })
    fireEvent.pointerUp(svg, { pointerId: 40 })

    expect(panX(layer) - before).toBe(60)
  })

  it('applies the whole node drag when twenty moves arrive in one task', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const svg = screen.getByRole('img', { name: /orientation map/i })
    const node = await screen.findByTestId('leaf-beacon')
    const worldX = (element: Element) =>
      Number(/translate\(([-\d.]+),/.exec(element.getAttribute('transform') ?? '')?.[1])
    const before = worldX(node)
    const k = Number(/scale\(([-\d.]+)\)/.exec(
      (svg.querySelector('g[transform]') as SVGGElement).getAttribute('transform') ?? '',
    )?.[1])

    await act(async () => {
      down(node, 41, { x: 200, y: 200 })
      burst(svg, 41, { x: 200, y: 200 }, 20)
    })
    fireEvent.pointerUp(svg, { pointerId: 41 })

    // 20 screen pixels of travel, in world units. Every move counted.
    expect(worldX(screen.getByTestId('leaf-beacon')) - before).toBeCloseTo(20 / k, 6)
  })
})

/**
 * The overlap guarantee, read off the drawn SVG rather than off the layout.
 *
 * The layout has its own check over its own coordinates, and a layout that
 * measured one box and drew another would pass it. This reads the transform of
 * every drawn node and the rect inside it, which is what the reader actually
 * looks at, and counts the pairs whose boxes intersect. The number that made
 * this necessary was 13 at Expand All on the committed bundle: "Enterprise
 * Common Picture" was drawn underneath its neighbour and could not be read at
 * any zoom.
 */
describe('no node is drawn on top of another', () => {
  interface Drawn { id: string; x: number; y: number; w: number; h: number }

  const drawn = (canvas: HTMLElement): Drawn[] =>
    [...canvas.querySelectorAll('g[data-id]')].map((group) => {
      const at = /translate\(([-\d.]+),([-\d.]+)\)/.exec(group.getAttribute('transform') ?? '')
      const rect = group.querySelector('rect')
      return {
        id: group.getAttribute('data-id') ?? '?',
        x: Number(at?.[1]) + Number(rect?.getAttribute('x')),
        y: Number(at?.[2]) + Number(rect?.getAttribute('y')),
        w: Number(rect?.getAttribute('width')),
        h: Number(rect?.getAttribute('height')),
      }
    })

  /** Pairs whose rectangles share any area. Reported by name, not counted. */
  const collisions = (boxes: Drawn[]): string[] => {
    const hits: string[] = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (overlapX > 0 && overlapY > 0) {
          hits.push(`${a.id} over ${b.id} by ${Math.round(overlapX)}x${Math.round(overlapY)}`)
        }
      }
    }
    return hits
  }

  it('at the view the map opens at', async () => {
    await renderWithProvider(<MapTab />)
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    const boxes = drawn(canvas)
    expect(boxes.length).toBeGreaterThan(20)
    for (const box of boxes) {
      expect(Number.isFinite(box.x) && Number.isFinite(box.w), box.id).toBe(true)
    }
    expect(collisions(boxes)).toEqual([])
  })

  it('with every branch expanded', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    const boxes = drawn(canvas)
    // The whole bundle: 32 systems, their groups and branches, and the root.
    expect(boxes.length).toBe(45)
    expect(collisions(boxes)).toEqual([])
  })

  /**
   * The label control changes every box, so it changes the layout. Turning it
   * to the top of its range is the case that used to bury the most nodes.
   */
  it('after the reader turns the labels all the way up', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const bigger = screen.getByRole('button', { name: 'Larger labels' })
    for (let i = 0; i < 10; i++) await user.click(bigger)
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    expect(collisions(drawn(canvas))).toEqual([])
  })

  /**
   * Grid is the same map by another placement rule, and it had the same hole:
   * a row spacing and a column pitch fixed at the sizes the boxes used to be.
   */
  it('with the grid placement, expanded', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(screen.getByRole('button', { name: 'Grid' }))
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    expect(collisions(drawn(canvas))).toEqual([])
  })

  it('with the grid placement and the labels turned up', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(screen.getByRole('button', { name: 'Grid' }))
    const bigger = screen.getByRole('button', { name: 'Larger labels' })
    for (let i = 0; i < 10; i++) await user.click(bigger)
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    expect(collisions(drawn(canvas))).toEqual([])
  })

  it('after the reader turns the boxes all the way up', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const bigger = screen.getByRole('button', { name: 'Larger boxes' })
    for (let i = 0; i < 10; i++) await user.click(bigger)
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    expect(collisions(drawn(canvas))).toEqual([])
  })
})
