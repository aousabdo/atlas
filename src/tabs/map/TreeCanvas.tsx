import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import type { LinkSet } from '../../types/atlas'
import type { TreeNode as TreeNodeData } from '../../types/tree'
import type { Position } from '../../viz/radial'
import { advanceGesture, beginGesture, type Gesture } from '../../viz/gesture'
import { zoomAbout, type Size, type Transform, safeScale } from '../../viz/zoom'
import { CrossLinks } from './CrossLinks'
import { TreeNode, fillFor } from './TreeNode'

const round = (v: number) => Math.round(v * 100) / 100

export interface Offset {
  dx: number
  dy: number
}

export interface TreeCanvasProps {
  positions: Record<string, Position>
  parentOf: Record<string, string>
  links: LinkSet
  expanded: Record<string, boolean | undefined>
  selected: string | null
  riskMode: boolean
  showLinks: boolean
  showDesired: boolean
  clean: boolean
  textScale: number
  nodeScale: number
  offsets: Record<string, Offset>
  transform: Transform
  /**
   * A setter, not a sink for a value.
   *
   * A pan is a stream of pointermove events, and a browser can deliver a whole
   * burst of them in one task. Computing `transform.x + dx` from the prop reads
   * whatever value the last render carried, so every event in the burst but the
   * last is thrown away: measured, a 60px pan delivered as sixty one-pixel
   * moves panned the canvas 1px. Handing back an updater makes each step apply
   * to the value the one before it produced.
   */
  onTransform: (next: Transform | ((previous: Transform) => Transform)) => void
  onSize: (size: Size) => void
  /** A delta to add, for the same reason: the parent owns the running total. */
  onOffset: (id: string, delta: Offset) => void
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  /** Clicking bare canvas clears the selection, exactly as the topology does. */
  onClearSelection: () => void
}

/** Parent-to-child edge, the same easing as the tool being replaced. */
function edgePath(parent: { x: number; y: number }, child: { x: number; y: number }) {
  const dx = child.x - parent.x
  const dy = child.y - parent.y
  return [
    `M${round(parent.x)},${round(parent.y)}`,
    `C${round(parent.x + dx * 0.4)},${round(parent.y + dy * 0.1)}`,
    `${round(parent.x + dx * 0.6)},${round(parent.y + dy * 0.9)}`,
    `${round(child.x)},${round(child.y)}`,
  ].join(' ')
}

function useMeasuredSize(ref: React.RefObject<HTMLDivElement | null>, report: (s: Size) => void) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    // Rounded: the fit divides by this, so a fractional container width makes
    // the zoom transform, and therefore every drawn coordinate, irreproducible
    // between two runs that differ only in sub-pixel layout.
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  // Telling the parent is its own effect. Calling report() inside the setSize
  // updater ran a parent setState during this component's render, which React
  // warns about and which can tear if the parent re-renders mid-commit.
  useLayoutEffect(() => {
    report(size)
  }, [size, report])

  return size
}

export function TreeCanvas({
  positions, parentOf, links, expanded, selected, riskMode,
  showLinks, showDesired, clean, textScale, nodeScale, offsets, transform,
  onTransform, onSize, onOffset, onToggle, onSelect, onClearSelection,
}: TreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  useMeasuredSize(containerRef, onSize)

  const panRef = useRef<Gesture | null>(null)
  const nodeDragRef = useRef<(Gesture & { id: string }) | null>(null)
  /**
   * Whether the gesture now ending actually moved.
   *
   * Separate from nodeDragRef because the click that closes a gesture is
   * dispatched after pointerup, and pointerup is where the drag record is
   * released. Reading `moved` off that record from the click handler read it
   * one event too late, so every drag also landed as a click: a leaf opened its
   * detail panel, a branch collapsed. This survives the release and is cleared
   * by the next press, which is what ForceGraph does on the topology.
   */
  const movedRef = useRef(false)

  /** Layout position plus any offset the reader dragged it to. */
  const at = useCallback(
    (position: Position) => {
      const offset = offsets[position.node.id]
      return offset
        ? { x: position.x + offset.dx, y: position.y + offset.dy }
        : { x: position.x, y: position.y }
    },
    [offsets],
  )


  const onWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      onTransform((previous) => zoomAbout(previous, factor, px, py))
    },
    [onTransform],
  )

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    // Reject secondary buttons only. Synthetic pointer events do not always
    // carry `button`, and `undefined !== 0` would refuse every drag.
    if (event.button > 0 || nodeDragRef.current) return
    movedRef.current = false
    panRef.current = beginGesture(event.pointerId, event.clientX, event.clientY)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      // A pointer event without usable coordinates must not move anything.
      // Everything downstream divides by transform.k, and one NaN here spreads
      // to every path in the SVG.
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return

      const drag = nodeDragRef.current
      if (drag && drag.pointerId === event.pointerId) {
        const step = advanceGesture(drag, event.clientX, event.clientY)
        nodeDragRef.current = step.next
        if (step.moved) movedRef.current = true
        // Zero until the slop is passed, so a click never nudges the node.
        if (step.dx === 0 && step.dy === 0) return
        const { k } = safeScale(transform.k)
        onOffset(drag.id, { dx: step.dx / k, dy: step.dy / k })
        return
      }

      const pan = panRef.current
      if (!pan || pan.pointerId !== event.pointerId) return
      const step = advanceGesture(pan, event.clientX, event.clientY)
      panRef.current = step.next
      if (step.moved) movedRef.current = true
      if (step.dx === 0 && step.dy === 0) return
      onTransform((previous) => ({
        ...previous,
        x: previous.x + step.dx,
        y: previous.y + step.dy,
      }))
    },
    [transform.k, onTransform, onOffset],
  )

  const endPointer = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    if (nodeDragRef.current?.pointerId === event.pointerId) {
      nodeDragRef.current = null
    }
  }, [])

  const startNodeDrag = useCallback((id: string, event: React.PointerEvent) => {
    if (event.button > 0) return
    movedRef.current = false
    nodeDragRef.current = {
      ...beginGesture(event.pointerId, event.clientX, event.clientY),
      id,
    }
  }, [])

  /**
   * True once, for the click that closes a gesture which actually moved.
   *
   * Consumed rather than merely read: a drag released outside the SVG never
   * produces a click, and a flag left standing would eat the next honest one.
   * The next press clears it anyway, so this is belt and braces.
   */
  const didDrag = useCallback(() => {
    const moved = movedRef.current || nodeDragRef.current?.moved === true
    movedRef.current = false
    return moved
  }, [])

  const resolve = useCallback(
    (id: string): { x: number; y: number } | null => {
      let current: string | undefined = id
      while (current) {
        const position = positions[current]
        if (position) return at(position)
        current = parentOf[current]
      }
      return null
    },
    [positions, parentOf, at],
  )

  const drawn = Object.values(positions)

  const edges: { key: string; d: string; node: TreeNodeData; root: boolean }[] = []
  for (const position of drawn) {
    if (!expanded[position.node.id]) continue
    for (const child of position.node.children ?? []) {
      const childPosition = positions[child.id]
      if (!childPosition) continue
      edges.push({
        key: `${position.node.id}-${child.id}`,
        d: edgePath(at(position), at(childPosition)),
        node: child,
        root: position.node.id === 'root',
      })
    }
  }

  // Strokes keep a constant screen weight under zoom. safeScale rescues a
  // degenerate k so this division cannot produce Infinity, and reports that
  // it had to, because a canvas drawn at a rescued 100% looks entirely
  // plausible and is the wrong answer.
  const { k: safeK, degenerate: degenerateZoom } = safeScale(transform.k)
  const inv = 1 / safeK

  return (
    <div
      ref={containerRef}
      data-testid="map-canvas"
      className="relative h-full w-full overflow-hidden bg-bg"
    >
      <svg
        role="img"
        // A rescued zoom means fitToScreen handed back something degenerate.
        // Marked so the e2e scan fails instead of photographing a plausible
        // picture drawn at 100%.
        data-degenerate-zoom={degenerateZoom || undefined}
        aria-label="Orientation map"
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        /*
          Bare canvas dismisses the record, the same rule the topology has had
          all along. The two graph tabs used to disagree one tab apart: there,
          clicking the ground cleared the selection; here, nothing happened and
          the panel could only be dismissed from its own Close button or Esc.
          A gesture that moved is a pan, not a dismissal, so it is guarded by
          the same consumed flag a node click uses. A click that landed on a
          node never reaches here: TreeNode stops it.
        */
        onClick={() => {
          if (!didDrag()) onClearSelection()
        }}
      >
        <g
          transform={`translate(${round(transform.x)},${round(transform.y)}) scale(${round(transform.k)})`}
        >
          <g aria-hidden="true">
            {edges.map((edge) => (
              <path
                key={edge.key}
                d={edge.d}
                fill="none"
                stroke={fillFor(edge.node, riskMode)}
                strokeWidth={round((edge.root ? 2.5 : 1.5) * inv)}
                opacity={0.45}
              />
            ))}
          </g>

          {showLinks && (
            <CrossLinks
              links={links.current}
              kind="current"
              clean={clean}
              resolve={resolve}
              scale={inv}
            />
          )}
          {showDesired && (
            <CrossLinks
              links={links.desired}
              kind="desired"
              clean={clean}
              resolve={resolve}
              scale={inv}
            />
          )}

          <g>
            {drawn.map((position) => (
              <TreeNode
                key={position.node.id}
                position={position}
                at={at(position)}
                expanded={Boolean(expanded[position.node.id])}
                selected={selected === position.node.id}
                riskMode={riskMode}
                textScale={textScale}
                nodeScale={nodeScale}
                onToggle={onToggle}
                onSelect={onSelect}
                onDragStart={startNodeDrag}
                didDrag={didDrag}
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  )
}
