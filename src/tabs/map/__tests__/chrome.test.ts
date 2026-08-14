import { describe, expect, it } from 'vitest'

import { CHROME_PAD, CHROME_TOP_FALLBACK, topReserve } from '../chrome'

/**
 * The band wraps, so the gutter cannot be a constant.
 *
 * Measured heights: 55 at 1440x900, 115 at 1280x720 and at 1366x768. The old
 * constant 120 reserved less than the band occupied at both smaller sizes, by
 * exactly the 7px the band overhung it.
 */
describe('top chrome reserve', () => {
  it('clears a band that has wrapped onto a second line', () => {
    // 115 tall, sitting inside 12px of padding: the band ends at 127.
    expect(topReserve(115)).toBeGreaterThanOrEqual(115 + CHROME_PAD)
    expect(topReserve(115)).toBeGreaterThan(CHROME_TOP_FALLBACK)
  })

  it('gives the canvas back the space a single-line band does not use', () => {
    expect(topReserve(55)).toBeLessThan(CHROME_TOP_FALLBACK)
    expect(topReserve(55)).toBeGreaterThan(55 + CHROME_PAD)
  })

  it('grows with the band rather than tracking anything else', () => {
    expect(topReserve(115) - topReserve(55)).toBe(60)
  })

  it('falls back while nothing has been measured, rather than reserving zero', () => {
    for (const unmeasured of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(topReserve(unmeasured)).toBe(CHROME_TOP_FALLBACK)
    }
  })
})
