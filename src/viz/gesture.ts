/**
 * One rule for "did this pointer gesture move, or was it a click".
 *
 * Both graph canvases need it and both got it wrong in the same way, so it
 * lives in one place rather than twice. The defect it exists to prevent: the
 * slop was compared against the *previous move* rather than against the press,
 * and the previous move was rewritten on every pointermove. A real mouse emits
 * a stream of one and two pixel moves, so no single step ever exceeded the
 * slop, the gesture was never marked as moved, and the click that closed a
 * 60px drag still landed as a click. Measured: dragging a leaf 20px in twenty
 * one-pixel moves moved it 43 world pixels and opened its detail panel; the
 * same drag delivered as one 20px move behaved correctly. Dragging a branch a
 * single pixel collapsed it.
 *
 * The slop here is measured from the press and nowhere else, and the step
 * delta is reported as zero until the gesture passes it, so a hand that shakes
 * two pixels during a click neither nudges the node nor swallows the click.
 */

/** Movement past this many screen pixels, measured from the press, is a drag. */
export const DRAG_SLOP = 4

export interface Gesture {
  pointerId: number
  /** Where the press landed. The slop is measured from here, always. */
  originX: number
  originY: number
  /** The last position the gesture was actually applied at. */
  lastX: number
  lastY: number
  /** Latches: a gesture that has moved stays moved until the next press. */
  moved: boolean
}

export interface GestureStep<G extends Gesture> {
  /** The record to store back on the ref. */
  next: G
  /** Screen pixels to apply this step, zero while the gesture is still a click. */
  dx: number
  dy: number
  /** Whether the gesture has now travelled past the slop, from the press. */
  moved: boolean
}

/** Start tracking a press. Callers may carry extra fields alongside. */
export function beginGesture(pointerId: number, x: number, y: number): Gesture {
  return { pointerId, originX: x, originY: y, lastX: x, lastY: y, moved: false }
}

/**
 * Advance a gesture to a new pointer position.
 *
 * `next` keeps whatever extra fields the caller put on the record, which is how
 * a node drag carries the id of the node it is dragging.
 */
export function advanceGesture<G extends Gesture>(
  gesture: G,
  x: number,
  y: number,
): GestureStep<G> {
  const moved =
    gesture.moved ||
    Math.abs(x - gesture.originX) > DRAG_SLOP ||
    Math.abs(y - gesture.originY) > DRAG_SLOP

  // While the gesture is still a click, lastX/lastY stay pinned to the press,
  // so the step that finally passes the slop carries the whole travel from the
  // press rather than just its own one pixel. Nothing is moved before that.
  return {
    next: moved ? { ...gesture, lastX: x, lastY: y, moved: true } : gesture,
    dx: moved ? x - gesture.lastX : 0,
    dy: moved ? y - gesture.lastY : 0,
    moved,
  }
}
