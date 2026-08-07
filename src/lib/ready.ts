import { useLayoutEffect } from 'react'

/**
 * Whether the current view has stopped moving.
 *
 * This exists for the visual suite, which previously waited on `networkidle`
 * plus a flat 1500ms. Neither says what it needs to say: StaticProvider caches
 * every bundle for the provider's lifetime, so after the first tab the network
 * goes quiet while a ResizeObserver has not yet delivered a size and a graph is
 * still sitting at the identity transform, drawn at the wrong scale in a
 * corner. A counter the views own says it exactly, and it is a fact about the
 * app rather than a guess about the clock.
 *
 * The published signal is two attributes on the document element:
 *   data-atlas-pending  the number of outstanding work tokens
 *   data-atlas-ready    "true" once the count reaches zero and two frames pass
 *
 * Both are inert: no styling keys off them and they cannot move a pixel.
 */
let pending = 0
let frame = 0

function hasDom(): boolean {
  return typeof document !== 'undefined' && document.documentElement !== null
}

function publish(): void {
  if (!hasDom()) return
  const root = document.documentElement
  root.dataset.atlasPending = String(pending)
  if (pending > 0) {
    root.removeAttribute('data-atlas-ready')
    return
  }
  if (typeof requestAnimationFrame !== 'function') {
    root.dataset.atlasReady = 'true'
    return
  }
  cancelAnimationFrame(frame)
  // Two frames: one for React to commit the work that released the last token,
  // one for the browser to paint that commit. Marking ready in the same frame
  // lets a screenshot land on the frame before.
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (pending === 0 && hasDom()) document.documentElement.dataset.atlasReady = 'true'
    })
  })
}

/** Claim a work token. The returned release is safe to call more than once. */
export function beginWork(): () => void {
  pending += 1
  publish()
  let released = false
  return () => {
    if (released) return
    released = true
    pending -= 1
    publish()
  }
}

/**
 * Holds the page "not ready" for as long as `busy`.
 *
 * A layout effect, not a passive one: on a handover between two busy views the
 * release and the next claim then both run synchronously inside the same
 * commit, before the browser can run the frames above, so the count never dips
 * to a momentary zero that a waiting screenshot could catch.
 */
export function useWork(busy: boolean): void {
  useLayoutEffect(() => {
    if (!busy) return
    return beginWork()
  }, [busy])
}

// fontsource declares font-display: swap, so text is laid out in a fallback
// face and reflows when the woff2 decodes. Every label width and wrap point
// moves at that moment, so nothing is ready before it.
if (hasDom() && typeof document.fonts !== 'undefined') {
  const release = beginWork()
  void document.fonts.ready.then(release, release)
} else {
  publish()
}
