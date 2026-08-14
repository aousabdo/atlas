/**
 * How much vertical space the floating top band needs, so the fit clears it.
 *
 * This used to be the constant 120, which is only ever right at one width. The
 * band wraps: measured, it is 1416x55 at 1440x900 but 1256x115 at 1280x720 and
 * 1342x115 at 1366x768, because the toolbar drops onto its own line. At both
 * smaller sizes the band ended 7px past the reserved space, so the fit put the
 * top of the tree underneath it. The band is measured now and this turns that
 * measurement into the gutter.
 */

/** The p-3 the band sits inside, once above it and once below it as a gap. */
export const CHROME_PAD = 12

/**
 * What to reserve before the band has been measured.
 *
 * jsdom reports every box as 0x0, and a resize observer that has not fired yet
 * reports nothing at all. Reserving zero in that window would fit the tree
 * under the band and then jump it once the measurement arrived.
 */
export const CHROME_TOP_FALLBACK = 120

/** Vertical gutter to keep free at the top of the canvas, in screen pixels. */
export function topReserve(bandHeight: number): number {
  if (!Number.isFinite(bandHeight) || bandHeight <= 0) return CHROME_TOP_FALLBACK
  return Math.round(bandHeight + CHROME_PAD * 2)
}
