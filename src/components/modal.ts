import { useEffect, useRef, type RefObject } from 'react'

/**
 * Everything a Tab press can land on, in document order.
 *
 * Deliberately not a general tabbability implementation: this app's dialogs
 * hold buttons, inputs and the odd link, and a list that guesses at hidden
 * subtrees would be a second, wronger layout engine. Anything disabled or
 * explicitly removed from the order is excluded, which is the whole rule.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function stopsIn(card: HTMLElement): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.tabIndex >= 0 && !element.hasAttribute('inert'),
  )
}

/**
 * Keep Tab inside a dialog.
 *
 * `aria-modal="true"` tells a screen reader that everything outside the dialog
 * is inert. The browser does not agree unless somebody makes it: without this,
 * two Tab presses out of the search box landed on the nav behind an opaque
 * backdrop, and six more reached a button that opens a second dialog. The
 * announcement and the keyboard have to describe the same page.
 *
 * Bound on the document in the capture phase rather than on the card, so a
 * press still comes back inside if focus has somehow already escaped, and so a
 * handler inside the dialog cannot swallow it first.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || event.altKey || event.metaKey || event.ctrlKey) return
      const card = ref.current
      if (!card) return

      const stops = stopsIn(card)
      // Nothing to move to. Hold the press rather than firing it into the page
      // behind, which is the failure this exists to prevent.
      if (stops.length === 0) {
        event.preventDefault()
        return
      }

      const at = stops.indexOf(document.activeElement as HTMLElement)
      const last = stops.length - 1
      let next: number
      if (at < 0) next = event.shiftKey ? last : 0
      else next = event.shiftKey ? (at === 0 ? last : at - 1) : at === last ? 0 : at + 1

      event.preventDefault()
      stops[next].focus()
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [ref])
}

/** Every modal currently on the page, oldest first. */
const open: Array<() => void> = []

/**
 * One modal at a time.
 *
 * Two `aria-modal` dialogs cannot both be true. Stacked, the shortcuts card
 * drew over the palette while the caret sat in the palette's box underneath
 * it, so a reader typed into a box they could not see, and Escape closed the
 * one they were not using.
 *
 * The older dialog stands down when a newer one opens, and it does so from the
 * newer one's mount effect rather than from the keystroke that opened it. The
 * first attempt at this listened for ⌘K here and passed in jsdom: in a browser
 * the App re-render that the same keystroke caused swapped this component's
 * listener out mid-dispatch, so it never fired and both cards stayed. Mounting
 * has no such race.
 */
export function useSoleModal(onDismiss: () => void): void {
  // Read at dismissal rather than captured at mount, so a re-render with a new
  // callback identity does not re-run the registration.
  const latest = useRef(onDismiss)
  latest.current = onDismiss

  useEffect(() => {
    const me = () => latest.current()
    for (const other of open.splice(0, open.length)) other()
    open.push(me)
    return () => {
      const at = open.indexOf(me)
      if (at >= 0) open.splice(at, 1)
    }
  }, [])
}
