import { useCallback, useRef } from 'react'

import { boundsOf, type Position } from '../../viz/radial'
import type { Size, Transform } from '../../viz/zoom'
import { fillFor } from './TreeNode'

const round = (v: number) => Math.round(v * 100) / 100

export interface MinimapProps {
  positions: Record<string, Position>
  selected: string | null
  riskMode: boolean
  transform: Transform
  /** Size of the main canvas, which is what the viewport rectangle describes. */
  canvasSize: Size
  onRecenter: (world: { x: number; y: number }) => void
}

/**
 * A second view of the same layout, and a way to navigate it.
 *
 * The tool being replaced drew this by monkey-patching the renderer to write
 * into a second element. Here it is an ordinary component reading the same
 * position map, which is the whole reason for computing geometry outside the
 * DOM.
 */
export function Minimap({
  positions, selected, riskMode, transform, canvasSize, onRecenter,
}: MinimapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const draggingRef = useRef(false)

  const drawn = Object.values(positions)
  const bounds = boundsOf(positions, 60)

  /** The world rectangle the main canvas is currently showing. */
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
      const svg = svgRef.current
      if (!svg) return null
      const rect = svg.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      // preserveAspectRatio="xMidYMid meet" letterboxes, so the drawn scale is
      // the smaller axis and the unused axis carries an offset.
      const scale = Math.min(rect.width / bounds.width, rect.height / bounds.height)
      if (!Number.isFinite(scale) || scale <= 0) return null
      const padX = (rect.width - bounds.width * scale) / 2
      const padY = (rect.height - bounds.height * scale) / 2
      return {
        x: bounds.minX + (clientX - rect.left - padX) / scale,
        y: bounds.minY + (clientY - rect.top - padY) / scale,
      }
    },
    [bounds.minX, bounds.minY, bounds.width, bounds.height],
  )

  const recenterFrom = useCallback(
    (clientX: number, clientY: number) => {
      const world = toWorld(clientX, clientY)
      if (world) onRecenter(world)
    },
    [toWorld, onRecenter],
  )

  return (
    <figure className="m-0">
      <svg
        ref={svgRef}
        role="img"
        aria-label="Map overview"
        viewBox={`${round(bounds.minX)} ${round(bounds.minY)} ${round(bounds.width)} ${round(bounds.height)}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-32 w-full cursor-pointer touch-none rounded border border-line bg-surface-2"
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
        {drawn.map((position) => {
          const isSelected = position.node.id === selected
          const radius = position.level === 0 ? 26 : position.level === 1 ? 18 : 11
          return (
            <circle
              key={position.node.id}
              cx={round(position.x)}
              cy={round(position.y)}
              r={isSelected ? radius + 8 : radius}
              fill={fillFor(position.node, riskMode)}
              stroke={isSelected ? 'var(--color-accent-ink)' : 'none'}
              strokeWidth={isSelected ? 8 : 0}
              opacity={isSelected ? 1 : 0.75}
            />
          )
        })}

        {viewport && (
          <rect
            data-testid="minimap-viewport"
            x={round(viewport.x)}
            y={round(viewport.y)}
            width={round(viewport.w)}
            height={round(viewport.h)}
            fill="var(--color-accent)"
            fillOpacity={0.1}
            stroke="var(--color-accent-ink)"
            strokeWidth={round(Math.max(bounds.width, bounds.height) / 200)}
            pointerEvents="none"
          />
        )}
      </svg>
      <figcaption className="mt-1 text-xs text-muted">
        {drawn.length} nodes drawn. Click or drag here to move the view.
      </figcaption>
    </figure>
  )
}
