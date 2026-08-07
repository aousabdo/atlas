import { describe, expect, it } from 'vitest'

import { fitToScreen, panToFit } from '../zoom'

const BBOX = { x: 0, y: 0, w: 1000, h: 800 }

describe('fitToScreen', () => {
  it('fits a normal container', () => {
    const t = fitToScreen(BBOX, { width: 1200, height: 900 })
    expect(t).not.toBeNull()
    expect(t!.k).toBeGreaterThan(0)
    expect(Number.isFinite(t!.x) && Number.isFinite(t!.y)).toBe(true)
  })

  it('returns null for a zero-width container instead of a zero scale', () => {
    expect(fitToScreen(BBOX, { width: 0, height: 900 })).toBeNull()
  })

  it('returns null for a zero-height container', () => {
    expect(fitToScreen(BBOX, { width: 1200, height: 0 })).toBeNull()
  })

  it('returns null for a container that has not been laid out at all', () => {
    expect(fitToScreen(BBOX, { width: 0, height: 0 })).toBeNull()
  })

  it('never returns a transform with k of 0', () => {
    for (const size of [
      { width: 1, height: 1 },
      { width: 1200, height: 900 },
      { width: 10000, height: 4 },
    ]) {
      const t = fitToScreen(BBOX, size)
      if (t) expect(t.k).toBeGreaterThan(0)
    }
  })

  it('caps the scale at 2 so a tiny graph is not blown up', () => {
    const t = fitToScreen({ x: 0, y: 0, w: 10, h: 10 }, { width: 1200, height: 900 })
    expect(t!.k).toBeLessThanOrEqual(2)
  })

  it('returns null for an empty bounding box', () => {
    expect(fitToScreen(null, { width: 1200, height: 900 })).toBeNull()
  })

  it('produces geometry that stays finite when inverted', () => {
    // This is the actual failure mode: width / t.k downstream.
    const t = fitToScreen(BBOX, { width: 1200, height: 900 })!
    expect(Number.isFinite(1200 / t.k)).toBe(true)
  })
})

describe('panToFit', () => {
  it('returns null when the container has no size', () => {
    expect(panToFit([{ x: 1, y: 2 }], { width: 0, height: 0 }, 1)).toBeNull()
  })

  it('returns null when there are no points to fit', () => {
    expect(panToFit([], { width: 1200, height: 900 }, 1)).toBeNull()
  })

  it('fits a selected device set', () => {
    const t = panToFit([{ x: 10, y: 10 }, { x: 90, y: 90 }], { width: 1200, height: 900 }, 1)
    expect(t).not.toBeNull()
    expect(Number.isFinite(t!.x) && Number.isFinite(t!.y) && t!.k > 0).toBe(true)
  })
})
