import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProvider } from '../../../test/renderWithProvider'
import { NetworkTab } from '../NetworkTab'

/**
 * The topology has to be fitted into the part of the canvas nothing covers.
 *
 * ForceGraph's container is `absolute inset-0` and the device rail, the control
 * strip and the legend are painted on top of it, so a fit into the whole
 * container draws devices behind opaque cards. Measured on the built app,
 * counting a device as reachable only when elementFromPoint at its centre
 * resolves back into its own group:
 *
 *   1280x720   57 of 71 reachable
 *   1366x768   60 of 71
 *   1440x900   65 of 71
 *
 * jsdom lays nothing out, so the boxes are supplied here in the shape the
 * browser reported. Without the reserve the fit centres the graph in 1280x648
 * and devices land above the strip, left of the rail and under the legend, and
 * every assertion below fires.
 */
const CANVAS = { width: 1280, height: 648 }
const RAIL = 320
const STRIP_BOTTOM = 72
const STACK_TOP = 426 // 648 - 222

const box = (left: number, top: number, width: number, height: number) =>
  ({
    left, top, width, height,
    right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}),
  }) as DOMRect

/** Lay the topology out for real: jsdom reports every box as 0x0. */
function layOutTheTab() {
  const real = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function measured(this: Element) {
      switch (this.getAttribute('data-testid')) {
        case 'network-canvas':
          return box(0, 0, CANVAS.width, CANVAS.height)
        case 'network-chrome':
          return box(RAIL, 0, CANVAS.width - RAIL, CANVAS.height)
        case 'network-chrome-top':
          return box(RAIL + 12, 12, CANVAS.width - RAIL - 24, STRIP_BOTTOM - 12)
        case 'network-chrome-bottom':
          return box(RAIL + 12, STACK_TOP, CANVAS.width - RAIL - 24, CANVAS.height - STACK_TOP - 12)
        default:
          return real.call(this)
      }
    },
  )
}

const transformOf = (element: Element) => {
  const value = element.getAttribute('transform') ?? ''
  const translate = /translate\(([-\d.]+),([-\d.]+)\)/.exec(value)
  const scale = /scale\(([-\d.]+)\)/.exec(value)
  return {
    x: Number(translate?.[1] ?? 0),
    y: Number(translate?.[2] ?? 0),
    k: Number(scale?.[1] ?? 1),
  }
}

describe('Network Topology fits around its own chrome', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('places every device where no rail, strip or legend covers it', async () => {
    layOutTheTab()
    await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    const layer = graph.querySelector('g[transform]')
    expect(layer).not.toBeNull()
    const view = transformOf(layer!)
    expect(view.k).toBeGreaterThan(0)

    const devices = within(graph).getAllByRole('graphics-symbol')
    expect(devices).toHaveLength(71)

    const buried: string[] = []
    for (const device of devices) {
      const world = transformOf(device)
      const x = view.x + world.x * view.k
      const y = view.y + world.y * view.k
      if (x < RAIL || y < STRIP_BOTTOM || y > STACK_TOP || x > CANVAS.width) {
        buried.push(`${device.getAttribute('data-testid')} at ${Math.round(x)},${Math.round(y)}`)
      }
    }

    expect(buried, `${buried.length} of 71 devices are drawn under the chrome`).toEqual([])
  })

  it('refits when the rail is hidden, so the freed 320px is used', async () => {
    layOutTheTab()
    const { user } = await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    const layer = graph.querySelector('g[transform]') as SVGGElement
    const docked = transformOf(layer)

    // Hiding the rail moves the chrome layer's left edge, so the measurement
    // that follows the toggle has to be the one the fit uses. It was not: the
    // child's layout effect ran first, fitted for the rail that had just gone,
    // and the guard threw the corrected measurement away. Measured in Chrome,
    // the graph stayed fitted for a rail that was not there at 1280x720 and at
    // 1440x900, and refitted at 1366x768 only because the observer won a race.
    //
    // The strip is shorter here for the same reason it is in the browser: the
    // freed 320px lets the view-mode buttons and the counts share one line, so
    // hiding the rail returns height as well as width.
    const UNWRAPPED = 38
    vi.restoreAllMocks()
    const real = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function measured(this: Element) {
        switch (this.getAttribute('data-testid')) {
          case 'network-canvas':
          case 'network-chrome':
            return box(0, 0, CANVAS.width, CANVAS.height)
          case 'network-chrome-top':
            return box(12, 12, CANVAS.width - 24, UNWRAPPED - 12)
          case 'network-chrome-bottom':
            return box(12, STACK_TOP, CANVAS.width - 24, CANVAS.height - STACK_TOP - 12)
          default:
            return real.call(this)
        }
      },
    )

    await user.click(screen.getByRole('button', { name: 'Panel' }))
    const bare = transformOf(layer)

    expect(bare.k).toBeGreaterThan(docked.k)
    expect(bare.x).toBeLessThan(docked.x)
  })
})
