import { describe, expect, it } from 'vitest'

import { advanceGesture, beginGesture, DRAG_SLOP } from '../gesture'

/** Deliver a travel of `total` px in `steps` equal moves, as a mouse does. */
function drip(total: number, steps: number) {
  let gesture = beginGesture(1, 100, 100)
  const applied = { dx: 0, dy: 0 }
  for (let i = 1; i <= steps; i += 1) {
    const step = advanceGesture(gesture, 100 + (total * i) / steps, 100)
    gesture = step.next
    applied.dx += step.dx
    applied.dy += step.dy
  }
  return { gesture, applied }
}

describe('pointer gesture slop', () => {
  it('measures the slop from the press, not between consecutive moves', () => {
    // The defect this rule exists to prevent: twenty one-pixel moves are a
    // 20px drag, and no single step of it exceeds the slop.
    const { gesture } = drip(20, 20)
    expect(gesture.moved).toBe(true)
  })

  it('marks the gesture the moment the travel passes the slop, and not before', () => {
    let gesture = beginGesture(1, 100, 100)
    const marks: boolean[] = []
    for (let i = 1; i <= 6; i += 1) {
      const step = advanceGesture(gesture, 100 + i, 100)
      gesture = step.next
      marks.push(step.moved)
    }
    expect(marks).toEqual([false, false, false, false, true, true])
    expect(DRAG_SLOP).toBe(4)
  })

  it('applies nothing while the gesture is still a click', () => {
    let gesture = beginGesture(1, 100, 100)
    const step = advanceGesture(gesture, 102, 101)
    gesture = step.next
    expect(step.dx).toBe(0)
    expect(step.dy).toBe(0)
    // And the press it measures from is untouched, so the next move is still
    // compared against where the finger landed.
    expect(gesture.originX).toBe(100)
    expect(gesture.lastX).toBe(100)
  })

  it('carries the whole travel from the press on the step that passes the slop', () => {
    const gesture = beginGesture(1, 100, 100)
    const step = advanceGesture(gesture, 108, 93)
    expect(step.dx).toBe(8)
    expect(step.dy).toBe(-7)
  })

  it('applies the full travel however finely it is delivered', () => {
    expect(drip(60, 60).applied.dx).toBe(60)
    expect(drip(60, 1).applied.dx).toBe(60)
    expect(drip(60, 7).applied.dx).toBeCloseTo(60, 6)
  })

  it('latches: a gesture that moved stays moved even if it comes back', () => {
    let gesture = beginGesture(1, 100, 100)
    gesture = advanceGesture(gesture, 140, 100).next
    const back = advanceGesture(gesture, 100, 100)
    expect(back.moved).toBe(true)
    expect(back.dx).toBe(-40)
  })

  it('keeps whatever the caller hung on the record, such as the node id', () => {
    const drag = { ...beginGesture(3, 0, 0), id: 'beacon' }
    const step = advanceGesture(drag, 40, 0)
    expect(step.next.id).toBe('beacon')
    expect(step.next.pointerId).toBe(3)
  })
})
