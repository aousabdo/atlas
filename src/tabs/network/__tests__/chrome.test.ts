import { describe, expect, it } from 'vitest'

import { fitToScreen } from '../../../viz/zoom'
import { fitInsideChrome, freeArea, NO_INSET, type ChromeInset } from '../chrome'

/**
 * The numbers are the ones measured on the built app, not invented ones.
 *
 * Canvas 1280x648 at 1280x720 of viewport; the rail is 320 wide; the control
 * strip ends 72px down because the view-mode buttons and the counts wrap onto
 * two lines below 1440; the bottom stack is 222px tall, of which the legend is
 * 210. At 1440x900 the canvas is 1440x828 and the strip does not wrap, so it
 * ends 38px down. Those two tops are why the reserve is measured rather than
 * declared: no constant is right at both.
 */
const SMALL = { width: 1280, height: 648 }
const LARGE = { width: 1440, height: 828 }
const SMALL_CHROME: ChromeInset = { left: 320, top: 72, bottom: 222 }
const LARGE_CHROME: ChromeInset = { left: 320, top: 38, bottom: 222 }

/** The topology's own layout box, near enough for the arithmetic. */
const BBOX = { x: -1130, y: -613, w: 2260, h: 1227 }

/** Where a world point lands on screen under a fitted transform. */
const project = (t: { x: number; y: number; k: number }, wx: number, wy: number) => ({
  x: t.x + wx * t.k,
  y: t.y + wy * t.k,
})

describe('freeArea', () => {
  it('takes the rail off the width and both bands off the height', () => {
    expect(freeArea(SMALL, SMALL_CHROME)).toEqual({ width: 960, height: 354 })
    expect(freeArea(LARGE, LARGE_CHROME)).toEqual({ width: 1120, height: 568 })
  })

  it('never reports a negative area for chrome larger than the canvas', () => {
    const tiny = { width: 200, height: 200 }
    expect(freeArea(tiny, SMALL_CHROME)).toEqual({ width: 0, height: 0 })
  })

  it('is the whole canvas when nothing is reserved', () => {
    expect(freeArea(SMALL, NO_INSET)).toEqual(SMALL)
  })
})

describe('fitInsideChrome', () => {
  it('holds the transform rather than committing a k of 0 for no free area', () => {
    expect(fitInsideChrome(BBOX, { width: 200, height: 200 }, SMALL_CHROME)).toBeNull()
    expect(fitInsideChrome(BBOX, { width: 0, height: 0 }, NO_INSET)).toBeNull()
    expect(fitInsideChrome(null, SMALL, SMALL_CHROME)).toBeNull()
  })

  it('agrees with the plain fit when there is no chrome to clear', () => {
    expect(fitInsideChrome(BBOX, SMALL, NO_INSET)).toEqual(fitToScreen(BBOX, SMALL))
  })

  /**
   * The assertion the defect fails.
   *
   * Fitting into the whole canvas put devices under the rail, under the control
   * strip and under the legend: 14 of 71 unreachable at 1280x720, 11 at
   * 1366x768, 6 at 1440x900, counted with elementFromPoint at each device's
   * centre. Every corner of the fitted box has to land in the free area.
   */
  for (const [name, size, inset] of [
    ['1280x720', SMALL, SMALL_CHROME],
    ['1440x900', LARGE, LARGE_CHROME],
  ] as const) {
    it(`keeps every corner of the graph clear of the chrome at ${name}`, () => {
      const fitted = fitInsideChrome(BBOX, size, inset)
      expect(fitted).not.toBeNull()
      const corners = [
        project(fitted!, BBOX.x, BBOX.y),
        project(fitted!, BBOX.x + BBOX.w, BBOX.y),
        project(fitted!, BBOX.x, BBOX.y + BBOX.h),
        project(fitted!, BBOX.x + BBOX.w, BBOX.y + BBOX.h),
      ]
      for (const corner of corners) {
        expect(corner.x).toBeGreaterThanOrEqual(inset.left)
        expect(corner.x).toBeLessThanOrEqual(size.width)
        expect(corner.y).toBeGreaterThanOrEqual(inset.top)
        expect(corner.y).toBeLessThanOrEqual(size.height - inset.bottom)
      }
    })

    it(`is what the unreserved fit is not at ${name}`, () => {
      // The defect, stated as an assertion. Fitting into the whole canvas puts
      // part of the graph in a band something opaque is painted over, which is
      // why 14 of 71 devices could not be reached at the smaller size.
      const plain = fitToScreen(BBOX, size)
      expect(plain).not.toBeNull()
      const corners = [
        project(plain!, BBOX.x, BBOX.y),
        project(plain!, BBOX.x + BBOX.w, BBOX.y),
        project(plain!, BBOX.x, BBOX.y + BBOX.h),
        project(plain!, BBOX.x + BBOX.w, BBOX.y + BBOX.h),
      ]
      const covered = corners.filter(
        (corner) =>
          corner.x < inset.left
          || corner.y < inset.top
          || corner.y > size.height - inset.bottom,
      )
      expect(covered.length).toBeGreaterThan(0)
    })
  }

  it('centres the graph in the free area, not in the canvas', () => {
    const fitted = fitInsideChrome(BBOX, SMALL, SMALL_CHROME)!
    const centre = project(fitted, BBOX.x + BBOX.w / 2, BBOX.y + BBOX.h / 2)
    expect(centre.x).toBeCloseTo(SMALL_CHROME.left + 960 / 2, 5)
    expect(centre.y).toBeCloseTo(SMALL_CHROME.top + 354 / 2, 5)
  })
})
