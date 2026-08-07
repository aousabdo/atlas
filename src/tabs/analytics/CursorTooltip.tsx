import { useCallback, useId, useState } from 'react'

/**
 * Offsets carried from the tool being replaced: the panel sits to the right of
 * the pointer and slightly above it, so it never covers the cell being read.
 */
const OFFSET_X = 14
const OFFSET_Y = -10

interface Anchor {
  /** Identifies the element that opened the tooltip, so a stale blur cannot close a fresh hover. */
  owner: string
  text: string
  x: number
  y: number
}

interface Pointer {
  clientX: number
  clientY: number
}

export interface CursorTooltipHandle {
  id: string
  anchor: Anchor | null
  showAtPointer: (owner: string, text: string, event: Pointer) => void
  showAtElement: (owner: string, text: string, el: Element | null) => void
  follow: (event: Pointer) => void
  hide: (owner?: string) => void
  /** For aria-describedby: only the element currently showing the tooltip points at it. */
  describedBy: (owner: string) => string | undefined
}

/**
 * A single floating panel shared by every element in a card.
 *
 * Pointer users get a panel that tracks the cursor; keyboard users get the
 * same panel parked beside the focused element. One tooltip rather than one
 * per cell keeps the DOM flat and means only one thing can ever be open.
 */
export function useCursorTooltip(): CursorTooltipHandle {
  const id = useId()
  const [anchor, setAnchor] = useState<Anchor | null>(null)

  const showAtPointer = useCallback((owner: string, text: string, event: Pointer) => {
    setAnchor(text ? { owner, text, x: event.clientX, y: event.clientY } : null)
  }, [])

  const showAtElement = useCallback((owner: string, text: string, el: Element | null) => {
    if (!text || !el) {
      setAnchor(null)
      return
    }
    const box = el.getBoundingClientRect()
    setAnchor({ owner, text, x: box.right, y: box.top + box.height / 2 })
  }, [])

  const follow = useCallback((event: Pointer) => {
    setAnchor((prev) =>
      prev ? { ...prev, x: event.clientX, y: event.clientY } : prev,
    )
  }, [])

  const hide = useCallback((owner?: string) => {
    setAnchor((prev) => (owner === undefined || prev?.owner === owner ? null : prev))
  }, [])

  const describedBy = useCallback(
    (owner: string) => (anchor?.owner === owner ? id : undefined),
    [anchor, id],
  )

  return { id, anchor, showAtPointer, showAtElement, follow, hide, describedBy }
}

/**
 * Stays mounted and empty when closed rather than unmounting, so that the id
 * an aria-describedby points at always resolves to a real node.
 */
export function CursorTooltip({ id, anchor }: CursorTooltipHandle) {
  const open = anchor !== null
  return (
    <div
      id={id}
      role="tooltip"
      data-open={open ? 'true' : 'false'}
      aria-hidden={open ? undefined : 'true'}
      className="pointer-events-none fixed z-50 max-w-70 rounded-lg border border-accent/30 bg-surface-2 px-3.5 py-2 text-xs leading-relaxed font-medium text-ink shadow-xl"
      style={{
        left: (anchor?.x ?? 0) + OFFSET_X,
        top: (anchor?.y ?? 0) + OFFSET_Y,
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
      }}
    >
      {anchor?.text ?? ''}
    </div>
  )
}
