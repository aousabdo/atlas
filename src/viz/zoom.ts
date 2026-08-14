export interface Size {
  width: number
  height: number
}

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Transform {
  x: number
  y: number
  k: number
}

const PAD = 70
const MAX_SCALE = 2

/** No pan, no zoom. What a caller falls back to while it waits for a size. */
export const IDENTITY: Transform = { x: 0, y: 0, k: 1 }

/** Zoom limits, carried from the original graph's d3.zoom scaleExtent. */
export const MIN_ZOOM = 0.15
export const MAX_ZOOM = 6

/**
 * Zoom transform that fits `bbox` into `size`, or null when it cannot.
 *
 * Returning null rather than a transform is the whole point. The original
 * computed Math.min(width/bw, height/bh, 2) unconditionally; with a zero-size
 * container that is 0, which pins k at 0, and every later width/t.k yields
 * Infinity and fills the SVG with NaN geometry. The old tool dodged this by
 * only mounting the graph when its tab opened. React mounts before layout, so
 * the caller must handle null and wait for the next resize.
 */
export function fitToScreen(bbox: BBox | null, size: Size): Transform | null {
  if (!bbox) return null

  // The container check is the guard. Without it Math.min below is 0 for a
  // 0x0 container and returns a perfectly truthy {k: 0}, which the caller
  // then commits.
  if (!size.width || !size.height) return null
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return null

  const bw = bbox.w + PAD * 2
  const bh = bbox.h + PAD * 2
  if (!bw || !bh) return null

  const k = Math.min(size.width / bw, size.height / bh, MAX_SCALE)
  if (!Number.isFinite(k) || k <= 0) return null

  return {
    k,
    x: size.width / 2 - (bbox.x + bbox.w / 2) * k,
    y: size.height / 2 - (bbox.y + bbox.h / 2) * k,
  }
}

/** Pan-fit onto a selected set of devices. Same guard, same reason. */
export function panToFit(
  points: Array<{ x: number; y: number }>,
  size: Size,
  currentK: number,
): Transform | null {
  if (!points.length) return null
  if (!size.width || !size.height) return null
  if (!Number.isFinite(currentK) || currentK <= 0) return null

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2

  return { k: currentK, x: size.width / 2 - cx * currentK, y: size.height / 2 - cy * currentK }
}

/**
 * Scale about a fixed point, clamped to the original's zoom extent.
 *
 * The (px - t.x) / t.k here is the same division the guard above exists to
 * protect: a k of 0 would make it Infinity, so k is clamped away from 0 on
 * every path that produces a transform.
 */
export function zoomAbout(t: Transform, factor: number, px: number, py: number): Transform {
  if (!Number.isFinite(t.k) || t.k <= 0) return IDENTITY
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * factor))
  return {
    k,
    x: px - ((px - t.x) / t.k) * k,
    y: py - ((py - t.y) / t.k) * k,
  }
}

/**
 * A zoom scale safe to divide by, and whether it had to be rescued.
 *
 * Five call sites across the two canvases had each grown their own
 * `Number.isFinite(k) && k > 0 ? k : 1`, and every one of them was silent. A
 * silent clamp is the wrong trade here: if fitToScreen ever hands back a
 * degenerate transform, the canvas renders a perfectly plausible picture at
 * 100% zoom instead of failing, so the bug ships looking correct. That is the
 * confident wrong answer this project exists to argue against, and it already
 * cost the visual suite its ability to see the zero-size guard being removed.
 *
 * So the clamp stays, because a division by zero helps nobody, but it reports
 * itself. Callers mark the DOM, the e2e scan asserts the mark never appears,
 * and a degenerate zoom becomes a failing test rather than a screenshot nobody
 * questions.
 */
export function safeScale(k: number): { k: number; degenerate: boolean } {
  if (Number.isFinite(k) && k > 0) return { k, degenerate: false }
  return { k: 1, degenerate: true }
}
