import { useEffect } from 'react'

export interface Shortcut {
  /** Single character, matched case-insensitively, or a named key like 'Escape'. */
  key: string
  description: string
  run: () => void
  /** Set for combinations like Cmd+K. */
  meta?: boolean
}

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
 * Global keyboard shortcuts.
 *
 * All of them live in this one document. The previous tool put the graph
 * shortcuts inside an iframe, which is why its help dialog had to say "click
 * into the network graph first to focus it" — a wart that disappears once
 * there is only one document.
 */
export function useShortcuts(shortcuts: Shortcut[], enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined

    function onKeyDown(event: KeyboardEvent) {
      // Never steal a keystroke from someone filling in a field.
      if (isTypingTarget(event.target)) return

      for (const shortcut of shortcuts) {
        const wantsMeta = shortcut.meta === true
        const hasMeta = event.metaKey || event.ctrlKey
        if (wantsMeta !== hasMeta) continue
        if (!wantsMeta && (event.altKey || event.shiftKey)) continue
        if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) continue

        event.preventDefault()
        shortcut.run()
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcuts, enabled])
}
