import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useWork } from '../../lib/ready'
import type { RiskLevel } from '../../types/atlas'
import type { Layout, NodeOffset } from '../../viz/force'
import { fitToScreen, zoomAbout, type Size, type Transform } from '../../viz/zoom'
import { linkStyle, nodeShapePath, nodeStyle } from './NetworkLegend'
import { riskColor } from './risk'
import { typeGlyph, zoneColor, zoneShort } from './zones'

const round = (v: number) => Math.round(v * 100) / 100

/** Movement past this many screen pixels is a drag, not a click. */
const DRAG_SLOP = 4

/** Above this zoom every label fits, so they all come on, as in the original. */
const LABEL_ZOOM = 1.6

export interface ForceGraphProps {
  siteLabel: string
  /** Positions, link endpoints and zone outlines, with any drags applied. */
  layout: Layout
  labelById: Map<string, string>
  /** Devices named by ?focus=, which the view pans onto. */
  focused: Set<string>
  selectedId: string | null
  hoverId: string | null
  /**
   * The isolate set: the device under the pointer or selected, plus everything
   * wired to it. Null when nothing is isolated.
   */
  highlight: Set<string> | null
  /** Null shows every zone; a zone id mutes the rest. */
  activeZone: string | null
  /** All labels at once is unreadable at 71 devices; off by default. */
  showLabels: boolean
  /** Label size multiplier from the toolbar, 1 is the original weight. */
  textScale: number
  /** Device glyph size multiplier, the topology's answer to the map's boxes. */
  nodeScale: number
  riskMode: boolean
  riskById: Map<string, RiskLevel>
  transform: Transform
  onTransform: (next: Transform) => void
  onSize: (size: Size) => void
  onSelect: (deviceId: string) => void
  onHover: (deviceId: string | null) => void
  onOffset: (deviceId: string, offset: NodeOffset) => void
  /** Clicking bare canvas clears the selection, as in the original. */
  onClearSelection: () => void
  /** Changing this refits: a new site or a new view mode, not a drag. */
  fitKey: string
  /** Bumped to ask for a refit without changing the layout. */
  fitNonce: number
}

/** Measures the container. jsdom always reports 0x0, which is the trap. */
function useMeasuredSize(
  ref: React.RefObject<HTMLDivElement | null>,
  report: (size: Size) => void,
): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  // Layout effect, not a passive one: measuring after paint means the graph is
  // visibly drawn once unfitted and then jumps.
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

  // Telling the parent from an effect, not from inside the state updater:
  // React may run an updater during another component's render, and setting
  // parent state there is the "cannot update while rendering" warning.
  useLayoutEffect(() => {
    report(size)
  }, [size, report])

  return size
}

function truncate(label: string): string {
  return label.length > 22 ? `${label.slice(0, 21)}…` : label
}

interface DrawnLabel {
  id: string
  x: number
  y: number
  text: string
}

/**
 * Which labels to draw, with overlapping ones dropped.
 *
 * The original measured every label with getBBox after each tick and culled
 * greedily. Estimating the box from the character count instead keeps this a
 * pure function of the layout, so it runs in a memo rather than a DOM pass and
 * survives a test environment that has no text metrics at all.
 */
function visibleLabels(
  layout: Layout,
  labelById: Map<string, string>,
  degree: Map<string, number>,
  showAll: boolean,
  highlight: Set<string> | null,
  selectedId: string | null,
  hoverId: string | null,
  fontSize: number,
  nodeScale: number,
): DrawnLabel[] {
  const candidates = layout.nodes.filter((node) => {
    if (node.id === selectedId || node.id === hoverId) return true
    if (highlight) return highlight.has(node.id)
    return showAll
  })
  if (candidates.length === 0) return []

  // Stagger above and below by position within the zone, so two neighbours in
  // a row do not butt heads before the cull below even runs.
  const seenPerZone = new Map<string, number>()
  const above = new Map<string, boolean>()
  for (const node of layout.nodes) {
    const index = seenPerZone.get(node.zone) ?? 0
    seenPerZone.set(node.zone, index + 1)
    above.set(node.id, index % 2 === 1)
  }

  // Selected first, then hovered, then the best-connected: a cull has to drop
  // the least informative label, not whichever happened to be drawn last.
  const ordered = [...candidates].sort((a, b) => {
    if (a.id === selectedId) return -1
    if (b.id === selectedId) return 1
    if (a.id === hoverId) return -1
    if (b.id === hoverId) return 1
    return (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
  })

  const kept: DrawnLabel[] = []
  const boxes: Array<[number, number, number, number]> = []
  for (const node of ordered) {
    const text = truncate(labelById.get(node.id) ?? node.id)
    const y = above.get(node.id)
      ? node.y - node.r * nodeScale - fontSize * 0.6
      : node.y + node.r * nodeScale + fontSize + 2
    const halfWidth = (text.length * fontSize * 0.56) / 2
    const box: [number, number, number, number] = [
      node.x - halfWidth,
      y - fontSize,
      node.x + halfWidth,
      y + fontSize * 0.3,
    ]
    const hit = boxes.some(
      (k) => !(box[2] < k[0] || box[0] > k[2] || box[3] < k[1] || box[1] > k[3]),
    )
    if (hit) continue
    boxes.push(box)
    kept.push({ id: node.id, x: node.x, y, text })
  }
  return kept
}

/**
 * The canvas: zone hulls, links and devices, with the pointer and keyboard
 * behaviour the tool being replaced had.
 *
 * Every coordinate here was worked out by d3 in viz/force and handed over as
 * plain numbers. Nothing in this file selects or appends a DOM node.
 */
export function ForceGraph({
  siteLabel,
  layout,
  labelById,
  focused,
  selectedId,
  hoverId,
  highlight,
  activeZone,
  showLabels,
  textScale,
  nodeScale,
  riskMode,
  riskById,
  transform,
  onTransform,
  onSize,
  onSelect,
  onHover,
  onOffset,
  onClearSelection,
  fitKey,
  fitNonce,
}: ForceGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measured = useMeasuredSize(containerRef, onSize)

  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const nodeDragRef = useRef<
    { pointerId: number; id: string; x: number; y: number; moved: boolean } | null
  >(null)
  /** A gesture that moved must not also land as a click and clear the view. */
  const movedRef = useRef(false)
  const fittedFor = useRef<string>('')
  const lastNonce = useRef(fitNonce)

  const [tip, setTip] = useState<{ x: number; y: number; id: string } | null>(null)

  const zoneOrder = layout.zones

  const degree = useMemo(() => {
    const counts = new Map<string, number>()
    for (const edge of layout.edges) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1)
      counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1)
    }
    return counts
  }, [layout.edges])

  const zoneOf = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node.zone])),
    [layout.nodes],
  )

  const fit = useCallback(() => {
    const fitted = fitToScreen(layout.bbox, measured)
    // Null means the container has not been laid out yet. Hold the transform
    // and wait for the next resize rather than accepting a k of 0, which turns
    // every 1/k below into Infinity and the SVG into NaN.
    if (fitted) onTransform(fitted)
    return fitted !== null
  }, [layout.bbox, measured, onTransform])

  /** Refit on a new site or view mode, and once the container gets a size. */
  const [everFitted, setEverFitted] = useState(false)
  useLayoutEffect(() => {
    if (fittedFor.current === fitKey) return
    if (fit()) {
      fittedFor.current = fitKey
      setEverFitted(true)
    }
  }, [fitKey, fit])

  // Unfitted means the transform is still IDENTITY and the graph is drawn at
  // the wrong scale in a corner. That is a frame nothing should photograph.
  useWork(!everFitted)

  useLayoutEffect(() => {
    if (lastNonce.current === fitNonce) return
    lastNonce.current = fitNonce
    fit()
  }, [fitNonce, fit])


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
    movedRef.current = false
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
        const k = Number.isFinite(transform.k) && transform.k > 0 ? transform.k : 1
        if (
          Math.abs(event.clientX - drag.x) > DRAG_SLOP ||
          Math.abs(event.clientY - drag.y) > DRAG_SLOP
        ) {
          drag.moved = true
          movedRef.current = true
        }
        onOffset(drag.id, { dx: (event.clientX - drag.x) / k, dy: (event.clientY - drag.y) / k })
        nodeDragRef.current = { ...drag, x: event.clientX, y: event.clientY }
        return
      }

      const pan = panRef.current
      if (!pan || pan.pointerId !== event.pointerId) return
      const dx = event.clientX - pan.x
      const dy = event.clientY - pan.y
      if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) movedRef.current = true
      panRef.current = { ...pan, x: event.clientX, y: event.clientY }
      onTransform({ ...transform, x: transform.x + dx, y: transform.y + dy })
    },
    [transform, onTransform, onOffset],
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
      pointerId: event.pointerId,
      id,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    }
  }, [])

  /** True once for the click that closes a gesture which actually moved. */
  const consumeMoved = () => {
    const moved = movedRef.current || nodeDragRef.current?.moved === true
    movedRef.current = false
    return moved
  }

  // Constant screen weight for strokes and labels under zoom. This is the
  // division the fitToScreen guard protects: k is never 0, so inv is finite.
  const k = Number.isFinite(transform.k) && transform.k > 0 ? transform.k : 1
  const inv = 1 / k

  const labels = useMemo(
    () =>
      visibleLabels(
        layout,
        labelById,
        degree,
        showLabels || k > LABEL_ZOOM,
        highlight,
        selectedId,
        hoverId,
        10 * inv * textScale,
        nodeScale,
      ),
    [layout, labelById, degree, showLabels, highlight, selectedId, hoverId, k, inv, textScale, nodeScale],
  )

  const hovered = tip ? layout.nodes.find((node) => node.id === tip.id) : undefined
  const hoveredLabel = hovered ? (labelById.get(hovered.id) ?? hovered.id) : ''

  const colorOf = (nodeId: string, zone: string) =>
    riskMode ? riskColor(riskById.get(nodeId)) : zoneColor(zone, zoneOrder)

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-bg">
      {/* The dotted ground the original drew the graph on. It is what makes a
          pan read as movement rather than as nothing happening. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: 'radial-gradient(var(--color-line) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          backgroundPosition: `${round(transform.x)}px ${round(transform.y)}px`,
        }}
      />
      <svg
        role="img"
        aria-label={`Network topology of ${siteLabel}: ${layout.nodes.length} devices, ${layout.edges.length} links`}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClick={() => {
          if (!consumeMoved()) onClearSelection()
        }}
      >
        <g
          transform={`translate(${round(transform.x)},${round(transform.y)}) scale(${round(k)})`}
        >
          <g aria-hidden="true">
            {layout.hulls.map((hull) => {
              const muted = activeZone !== null && activeZone !== hull.zone
              const color = zoneColor(hull.zone, zoneOrder)
              const shared = {
                fill: color,
                fillOpacity: muted ? 0.02 : 0.085,
                stroke: color,
                strokeOpacity: muted ? 0.1 : 0.55,
                strokeWidth: round(1.2 * inv),
              }
              return (
                <g key={hull.zone} data-testid={`hull-${hull.zone}`}>
                  {hull.kind === 'circle' ? (
                    <circle
                      cx={round(hull.cx)}
                      cy={round(hull.cy)}
                      r={round(hull.r)}
                      {...shared}
                    />
                  ) : (
                    <path d={hull.d} {...shared} />
                  )}
                  <text
                    x={round(hull.labelX)}
                    y={round(hull.labelY)}
                    textAnchor="middle"
                    fontSize={round(10 * inv * textScale)}
                    fontWeight={600}
                    letterSpacing={round(1.5 * inv * textScale)}
                    fill={color}
                    opacity={muted ? 0.2 : 0.85}
                    paintOrder="stroke fill"
                    stroke="var(--color-bg)"
                    strokeWidth={round(3 * inv)}
                    strokeLinejoin="round"
                  >
                    {zoneShort(hull.zone)}
                  </text>
                </g>
              )
            })}
          </g>

          <g aria-hidden="true">
            {layout.edges.map((edge) => {
              const style = linkStyle(edge.linkType)
              const lit = highlight
                ? highlight.has(edge.source) && highlight.has(edge.target)
                : false
              let opacity = 0.22
              if (lit) opacity = 0.95
              else if (highlight) opacity = 0.04
              else if (activeZone) {
                const inZone =
                  zoneOf.get(edge.source) === activeZone ||
                  zoneOf.get(edge.target) === activeZone
                opacity = inZone ? 0.22 : 0.04
              }
              const heavy =
                edge.linkType === 'microwave' || edge.linkType === 'microwave_60ghz'
              return (
                <path
                  key={edge.id}
                  d={`M${round(edge.x1)},${round(edge.y1)}L${round(edge.x2)},${round(edge.y2)}`}
                  fill="none"
                  stroke={style.color}
                  strokeWidth={round((lit ? 2.4 : heavy ? 2.4 : 1.3) * inv)}
                  strokeDasharray={style.dash ?? undefined}
                  strokeOpacity={opacity}
                />
              )
            })}
          </g>

          {/* Link labels, only for the pair currently isolated. */}
          <g aria-hidden="true">
            {highlight &&
              layout.edges
                .filter(
                  (edge) =>
                    edge.label && highlight.has(edge.source) && highlight.has(edge.target),
                )
                .map((edge) => (
                  <text
                    key={`label-${edge.id}`}
                    x={round((edge.x1 + edge.x2) / 2)}
                    y={round((edge.y1 + edge.y2) / 2 - 4 * inv)}
                    textAnchor="middle"
                    fontSize={round(9 * inv * textScale)}
                    fill="var(--color-muted-3)"
                  >
                    {edge.label}
                  </text>
                ))}
          </g>

          <g>
            {layout.nodes.map((node) => {
              const shape = nodeStyle(node.type).shape
              const isFocused = focused.has(node.id)
              const isSelected = node.id === selectedId
              const color = colorOf(node.id, node.zone)
              let opacity = 1
              if (highlight) opacity = highlight.has(node.id) ? 1 : 0.14
              else if (activeZone && node.zone !== activeZone) opacity = 0.25

              return (
                <g
                  key={node.id}
                  role="graphics-symbol"
                  tabIndex={0}
                  aria-label={labelById.get(node.id) ?? node.id}
                  data-testid={`device-${node.id}`}
                  data-focused={isFocused ? 'true' : 'false'}
                  data-selected={isSelected ? 'true' : 'false'}
                  data-zone={node.zone}
                  transform={`translate(${round(node.x)},${round(node.y)})`}
                  opacity={opacity}
                  className="cursor-pointer outline-none"
                  onPointerDown={(event) => startNodeDrag(node.id, event)}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!consumeMoved()) onSelect(node.id)
                  }}
                  onPointerEnter={(event) => {
                    onHover(node.id)
                    const rect = containerRef.current?.getBoundingClientRect()
                    if (!rect || !Number.isFinite(event.clientX)) return
                    setTip({
                      id: node.id,
                      x: event.clientX - rect.left,
                      y: event.clientY - rect.top,
                    })
                  }}
                  onPointerLeave={() => {
                    onHover(null)
                    setTip(null)
                  }}
                  onFocus={() => onHover(node.id)}
                  onBlur={() => onHover(null)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    onSelect(node.id)
                  }}
                >
                  <path
                    d={nodeShapePath(shape, node.r * nodeScale)}
                    fill={isSelected ? 'var(--color-surface-2)' : 'var(--color-bg)'}
                    stroke={color}
                    strokeWidth={round((isSelected ? 3 : isFocused ? 2.8 : 1.8) * inv)}
                  />
                  <text
                    x={0}
                    y={0}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={round(node.r * 0.95 * nodeScale)}
                    fill={color}
                    pointerEvents="none"
                  >
                    {typeGlyph(node.type)}
                  </text>
                </g>
              )
            })}
          </g>

          <g aria-hidden="true">
            {labels.map((label) => (
              <text
                key={`text-${label.id}`}
                x={round(label.x)}
                y={round(label.y)}
                textAnchor="middle"
                fontSize={round(10 * inv * textScale)}
                fontWeight={label.id === selectedId ? 600 : 400}
                fill={label.id === selectedId ? 'var(--color-accent-ink)' : 'var(--color-ink)'}
                paintOrder="stroke fill"
                stroke="var(--color-bg)"
                strokeWidth={round(3 * inv)}
                strokeLinejoin="round"
                pointerEvents="none"
              >
                {label.text}
              </text>
            ))}
          </g>
        </g>
      </svg>

      {hovered && tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 max-w-72 rounded border border-line bg-surface/95 px-2 py-1 text-xs backdrop-blur"
          style={{ left: round(tip.x + 14), top: round(tip.y + 14) }}
        >
          <span className="block font-semibold text-accent-ink">{hoveredLabel}</span>
          <span className="block text-muted-3">
            {zoneShort(hovered.zone)} · {hovered.type}
            {riskMode && ` · ${riskById.get(hovered.id) ?? 'unmapped'} risk`}
          </span>
        </div>
      )}


    </div>
  )
}
