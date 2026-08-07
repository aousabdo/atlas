import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import type { LinkSet } from '../../types/atlas'
import type { TreeNode as TreeNodeData } from '../../types/tree'
import type { Position } from '../../viz/radial'
import { zoomAbout, type Size, type Transform } from '../../viz/zoom'
import { CrossLinks } from './CrossLinks'
import { TreeNode, fillFor } from './TreeNode'

const round = (v: number) => Math.round(v * 100) / 100


/** Movement past this many screen pixels is a drag, not a click. */
const DRAG_SLOP = 4

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
  onTransform: (next: Transform) => void
  onSize: (size: Size) => void
  onOffset: (id: string, offset: Offset) => void
  onToggle: (id: string) => void
  onSelect: (id: string) => void
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
  onTransform, onSize, onOffset, onToggle, onSelect,
}: TreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  useMeasuredSize(containerRef, onSize)

  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const nodeDragRef = useRef<
    { pointerId: number; id: string; x: number; y: number; moved: boolean } | null
  >(null)

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
      onTransform(
        zoomAbout(transform, factor, event.clientX - rect.left, event.clientY - rect.top),
      )
    },
    [transform, onTransform],
  )

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    // Reject secondary buttons only. Synthetic pointer events do not always
    // carry `button`, and `undefined !== 0` would refuse every drag.
    if (event.button > 0 || nodeDragRef.current) return
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
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
        const dx = (event.clientX - drag.x) / transform.k
        const dy = (event.clientY - drag.y) / transform.k
        if (Math.abs(event.clientX - drag.x) > DRAG_SLOP || Math.abs(event.clientY - drag.y) > DRAG_SLOP) {
          drag.moved = true
        }
        const existing = offsets[drag.id] ?? { dx: 0, dy: 0 }
        onOffset(drag.id, { dx: existing.dx + dx, dy: existing.dy + dy })
        nodeDragRef.current = { ...drag, x: event.clientX, y: event.clientY }
        return
      }

      const pan = panRef.current
      if (!pan || pan.pointerId !== event.pointerId) return
      const dx = event.clientX - pan.x
      const dy = event.clientY - pan.y
      panRef.current = { ...pan, x: event.clientX, y: event.clientY }
      onTransform({ ...transform, x: transform.x + dx, y: transform.y + dy })
    },
    [transform, offsets, onTransform, onOffset],
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
    nodeDragRef.current = {
      pointerId: event.pointerId, id, x: event.clientX, y: event.clientY, moved: false,
    }
  }, [])

  /** A drag that moved must not also count as a click. */
  const didDrag = useCallback(() => nodeDragRef.current?.moved === true, [])

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

  // Strokes keep a constant screen weight under zoom. transform.k is never 0,
  // which is what the fitToScreen guard exists to guarantee.
  const inv = 1 / transform.k

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-bg"
    >
      <svg
        role="img"
        aria-label="Orientation map"
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
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


      <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-muted-3">
        Scroll to zoom, drag to pan, drag a node to move it.
      </p>
    </div>
  )
}
