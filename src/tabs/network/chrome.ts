/**
 * How much of the topology canvas the docked rail and the floating chrome cover.
 *
 * The canvas is full bleed: ForceGraph's container is `absolute inset-0`, and
 * the device rail and the floating controls are painted on top of it. The fit
 * did not know that. It fitted the graph into the whole container, so every
 * device the fit placed under a control was drawn behind an opaque card and
 * could not be clicked, hovered or read, while the view strip still called the
 * action "Fit the whole topology".
 *
 * Measured against the built app, nothing selected, default site, counting a
 * device as reachable only when elementFromPoint at its centre resolves back
 * into its own group:
 *
 *   1280x720   57 of 71 devices reachable, 14 buried
 *   1366x768   60 of 71 reachable, 11 buried
 *   1440x900   65 of 71 reachable, 6 buried
 *
 * The blocker is overwhelmingly one card. The legend is 427x210 and sits at the
 * bottom left of the free area: it alone took 11, 9 and 5 of those. The top
 * strip, which wraps onto a second line below 1440, took 2 more at both smaller
 * sizes, and the rail took 1 at 1280x720 and 1 at 1440x900.
 *
 * The Orientation Map already answers this on one axis. src/tabs/map/chrome.ts
 * measures its top band and the fit reserves that height. This is the same
 * answer for a canvas whose chrome is on three sides, and it is measured for
 * the same reason: the strip is 72px tall at 1280x720 and 38px at 1440x900,
 * because the toolbar and the counts share a line only when there is room.
 */
import { fitToScreen, type BBox, type Size, type Transform } from '../../viz/zoom'

/** Screen pixels of the canvas that chrome covers, per edge. */
export interface ChromeInset {
  /** The docked device rail, which is on the left or not there at all. */
  left: number
  /** The view-mode strip, the counts and the hint line under them. */
  top: number
  /** The legend, the view strip and the minimap. */
  bottom: number
}

/** Nothing reserved. What a caller means before it has measured anything. */
export const NO_INSET: ChromeInset = { left: 0, top: 0, bottom: 0 }

/** The free area a fit may use, in screen pixels. Never negative. */
export function freeArea(size: Size, inset: ChromeInset): Size {
  return {
    width: Math.max(0, size.width - inset.left),
    height: Math.max(0, size.height - inset.top - inset.bottom),
  }
}

/**
 * Fit `bbox` into the part of `size` no chrome is painted over.
 *
 * Null for the same reason fitToScreen returns null: a container that has not
 * been laid out, or chrome that is currently larger than the canvas, must hold
 * the previous transform rather than commit a k of 0. Everything downstream
 * divides by k.
 */
export function fitInsideChrome(
  bbox: BBox | null,
  size: Size,
  inset: ChromeInset,
): Transform | null {
  const free = freeArea(size, inset)
  const fitted = fitToScreen(bbox, free)
  // Shift back into canvas coordinates: fitToScreen centred the box in the
  // free area, and the free area starts at the inset.
  return fitted ? { ...fitted, x: fitted.x + inset.left, y: fitted.y + inset.top } : null
}
