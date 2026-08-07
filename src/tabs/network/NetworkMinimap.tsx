import { useCallback, useRef } from 'react'

import type { PositionedNode } from '../../viz/force'
import type { BBox, Size, Transform } from '../../viz/zoom'
import { zoneColor } from './zones'

const round = (v: number) => Math.round(v * 100) / 100

export interface NetworkMinimapProps {
  nodes: readonly PositionedNode[]
  bbox: BBox | null
  zoneOrder: readonly string[]
  selectedId: string | null
  transform: Transform
  /** Size of the main canvas, which is what the viewport rectangle describes. */
  canvasSize: Size
  onRecenter: (world: { x: number; y: number }) => void
}

const PAD = 60

/**
 * The whole graph at a glance, plus the rectangle showing what the canvas is
 * currently looking at. Click or drag inside it to move the view.
 *
 * The original drew this by rebuilding a second SVG on every simulation tick.
 * Here it is a component reading the same positioned nodes the canvas reads,
 * which is the point of computing geometry outside the DOM.
 */
export function NetworkMinimap({
  nodes,
  bbox,
  zoneOrder,
  selectedId,
  transform,
  canvasSize,
  onRecenter,
}: NetworkMinimapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const draggingRef = useRef(false)

  const view = bbox
    ? {
        minX: bbox.x - PAD,
        minY: bbox.y - PAD,
        width: Math.max(bbox.w + PAD * 2, 1),
        height: Math.max(bbox.h + PAD * 2, 1),
      }
    : { minX: 0, minY: 0, width: 1, height: 1 }

  /** The world rectangle the main canvas is showing right now. */
  const viewport =
    canvasSize.width > 0 && canvasSize.height > 0 && transform.k > 0
      ? {
          x: -transform.x / transform.k,
          y: -transform.y / transform.k,
          w: canvasSize.width / transform.k,
          h: canvasSize.height / transform.k,
        }
      : null

  /** Client point to world point, through the minimap's own viewBox. */
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
      const svg = svgRef.current
      if (!svg) return null
      const rect = svg.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      // preserveAspectRatio="xMidYMid meet" letterboxes, so the drawn scale is
      // the smaller axis and the other axis carries an offset.
      const scale = Math.min(rect.width / view.width, rect.height / view.height)
      if (!Number.isFinite(scale) || scale <= 0) return null
      const padX = (rect.width - view.width * scale) / 2
      const padY = (rect.height - view.height * scale) / 2
      return {
        x: view.minX + (clientX - rect.left - padX) / scale,
        y: view.minY + (clientY - rect.top - padY) / scale,
      }
    },
    [view.minX, view.minY, view.width, view.height],
  )

  const recenterFrom = useCallback(
    (clientX: number, clientY: number) => {
      const world = toWorld(clientX, clientY)
      if (world) onRecenter(world)
    },
    [toWorld, onRecenter],
  )

  // World units that land at roughly two screen pixels once the viewBox is
  // letterboxed into the panel. Fixed rather than measured: a resize observer
  // for a decoration is not worth a render cycle.
  const dotRadius = Math.max(view.width, view.height) / 90

  return (
    <figure className="m-0">
      <svg
        ref={svgRef}
        role="img"
        aria-label="Topology overview"
        data-testid="network-minimap"
        viewBox={`${round(view.minX)} ${round(view.minY)} ${round(view.width)} ${round(view.height)}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-24 w-full cursor-pointer touch-none rounded border border-line bg-bg"
        onPointerDown={(event) => {
          draggingRef.current = true
          event.currentTarget.setPointerCapture?.(event.pointerId)
          recenterFrom(event.clientX, event.clientY)
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) recenterFrom(event.clientX, event.clientY)
        }}
        onPointerUp={(event) => {
          draggingRef.current = false
          event.currentTarget.releasePointerCapture?.(event.pointerId)
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
      >
        {nodes.map((node) => (
          <circle
            key={node.id}
            cx={round(node.x)}
            cy={round(node.y)}
            r={round(node.id === selectedId ? dotRadius * 2.4 : dotRadius)}
            fill={zoneColor(node.zone, zoneOrder)}
            opacity={node.id === selectedId ? 1 : 0.8}
          />
        ))}

        {viewport && (
          <rect
            data-testid="network-minimap-viewport"
            x={round(viewport.x)}
            y={round(viewport.y)}
            width={round(Math.max(viewport.w, 1))}
            height={round(Math.max(viewport.h, 1))}
            fill="var(--color-accent)"
            fillOpacity={0.08}
            stroke="var(--color-accent-ink)"
            strokeWidth={round(Math.max(view.width, view.height) / 260)}
            strokeDasharray={`${round(Math.max(view.width, view.height) / 90)} ${round(Math.max(view.width, view.height) / 150)}`}
            pointerEvents="none"
          />
        )}
      </svg>
      <figcaption className="sr-only">
        The whole topology. Click or drag here to move the view.
      </figcaption>
    </figure>
  )
}
