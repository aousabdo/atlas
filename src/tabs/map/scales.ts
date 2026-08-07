/**
 * Ranges and defaults for the map's view controls.
 *
 * The map opens fitted, roughly half scale, so labels start above 1x to stay
 * readable at the default view.
 */
export const DEFAULT_TEXT_SCALE = 1.5
export const TEXT_MIN = 0.6
export const TEXT_MAX = 2.6

export const DEFAULT_NODE_SCALE = 1
export const NODE_MIN = 0.7
export const NODE_MAX = 2.2

export const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, Math.round(value * 100) / 100))
