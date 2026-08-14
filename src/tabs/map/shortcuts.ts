/**
 * The keys the Orientation Map answers to.
 *
 * Split out from the view so the mapping can be asserted without a canvas: two
 * of the four actions are no-ops until the container has a real size, and jsdom
 * never gives it one, so a test driving the component can only ever see half of
 * this table.
 *
 * The set is deliberately the intersection with Network Topology rather than a
 * copy of it. F and R mean the same thing on both canvases. L is not bound
 * here: on the topology it shows or hides device labels, and the map draws
 * every label as part of the node, so there is nothing for it to do. Binding it
 * to something else would make the same key mean two things one tab apart. The
 * digits stay with the shell for the same reason in reverse: the map has no
 * view modes to justify taking them back the way the topology does.
 */
export type MapAction = 'fit' | 'centre' | 'risk' | 'clear'

/** Shape of the parts of a KeyboardEvent this reads. */
export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  target: EventTarget | null
}

/** Same rule as the app-wide shortcuts: never steal a key from a text field. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

/**
 * The action a keystroke asks for, or null when the map does not want it.
 *
 * Null means "pass it on": the shell binds the digits, ? and A, and a modified
 * key belongs to the browser.
 */
export function mapAction(event: KeyLike): MapAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (isTypingTarget(event.target)) return null

  switch (event.key) {
    case 'f':
    case 'F':
      return 'fit'
    case 'c':
    case 'C':
      return 'centre'
    case 'r':
    case 'R':
      return 'risk'
    case 'Escape':
      return 'clear'
    default:
      return null
  }
}

/** What the legend prints, so the keys are documented where they are used. */
export const MAP_KEY_HINTS: Array<{ key: string; what: string }> = [
  { key: 'F', what: 'fit' },
  { key: 'C', what: 'centre' },
  { key: 'R', what: 'risk' },
  { key: 'Esc', what: 'clear' },
]
