import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { useWork } from '../../lib/ready'
import type { Requirement, RequirementStatus } from '../../types/atlas'
import { buildRequirementsSankey } from '../../viz/sankey'

const STATUSES: RequirementStatus[] = [
  'Split out',
  'Renamed / split out',
  'Partly carried forward',
  'Condensed',
  "Didn't keep",
]

const STATUS_COLOR: Record<RequirementStatus, string> = {
  'Split out': 'var(--color-accent)',
  'Renamed / split out': 'var(--color-risk-medium)',
  'Partly carried forward': 'var(--color-group-dhshq)',
  Condensed: 'var(--color-risk-low)',
  "Didn't keep": 'var(--color-risk-high)',
}

const ROW_HEIGHT = 40
const MIN_HEIGHT = 300
const LABEL_FONT = 10
const LINE_HEIGHT = 11
/** Inter at 10px averages a shade over half its size per character. */
const CHAR_WIDTH = 5.4
/** A one-flow node is a couple of pixels tall; the pointer needs more than that. */
const MIN_HIT_HEIGHT = 10

const clamp = (low: number, value: number, high: number) =>
  Math.max(low, Math.min(high, value))

const charsThatFit = (gutter: number) => Math.floor((gutter - 10) / CHAR_WIDTH)

const truncate = (text: string, gutter: number) => {
  const fits = charsThatFit(gutter)
  return text.length > fits ? `${text.slice(0, Math.max(1, fits - 1))}…` : text
}

/**
 * Break a requirement over at most two lines rather than cutting it mid-word.
 *
 * These are sentences, and "Lack of tech to move tactical info from remote/of…"
 * tells a reader almost nothing. Two lines carry nearly all of them whole.
 */
function wrapLabel(text: string, gutter: number): string[] {
  const fits = charsThatFit(gutter)
  if (text.length <= fits) return [text]

  const words = text.split(' ')
  const first: string[] = []
  while (words.length && [...first, words[0]].join(' ').length <= fits) {
    first.push(words.shift() as string)
  }
  if (!first.length) return [truncate(text, gutter)]

  const second = words.join(' ')
  return [first.join(' '), second.length > fits ? truncate(second, gutter) : second]
}

export interface RequirementsSankeyProps {
  requirements: Requirement[]
  filterActive: boolean
  query: string
}

/**
 * Original baseline requirements flowing into the systems that carry them.
 *
 * Geometry comes from src/viz/sankey.ts and the SVG below is plain React, so
 * a resize is a re-render rather than a teardown and redraw.
 */
export function RequirementsSankey({
  requirements,
  filterActive,
  query,
}: RequirementsSankeyProps) {
  const headingId = useId()
  const frameRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    // Rounded: contentRect.width is fractional, and every gutter, ribbon and
    // node x below is derived from it, so a third of a pixel of container
    // difference moves the entire diagram.
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0]?.contentRect.width ?? 0))
    })
    observer.observe(el)
    setWidth(Math.round(el.getBoundingClientRect().width))
    return () => observer.disconnect()
  }, [])

  // Every gutter, ribbon and node position below is derived from `width`, so
  // at width 0 the whole diagram is degenerate. Not ready until it is measured.
  useWork(width === 0)

  const height = Math.max(MIN_HEIGHT, requirements.length * ROW_HEIGHT)

  /**
   * Cap the flow and give the rest to the labels.
   *
   * A ribbon carries the same information at 500px as at 1500px, so on a wide
   * screen the middle was a very long flat band and the requirement text was
   * still being cut mid-word. Past the cap the extra width goes to the gutters,
   * where it buys whole sentences, and the diagram stops growing.
   */
  const gutterLeft = clamp(140, width * 0.32, 460)
  const gutterRight = clamp(90, width * 0.14, 210)
  const flow = clamp(220, width - gutterLeft - gutterRight, 560)
  const diagramWidth = gutterLeft + flow + gutterRight
  const graph = useMemo(
    () =>
      buildRequirementsSankey(requirements, {
        width: diagramWidth,
        height,
        paddingLeft: gutterLeft,
        paddingRight: gutterRight,
      }),
    [requirements, diagramWidth, height, gutterLeft, gutterRight],
  )

  /** Both directions of the graph, so either end can name the other. */
  const neighbours = useMemo(() => {
    const out = graph.nodes.map(() => [] as number[])
    const inbound = graph.nodes.map(() => [] as number[])
    for (const link of graph.links) {
      out[link.source]?.push(link.target)
      inbound[link.target]?.push(link.source)
    }
    return { out, inbound }
  }, [graph])

  /**
   * What stays lit while a node is hovered or focused. A requirement lights the
   * systems it feeds; a system lights the requirements that feed it. Entering
   * from either end answers the same question from the other side.
   */
  const related = useMemo(() => {
    if (active === null || !graph.nodes[active]) return null
    const onLeft = graph.nodes[active].side === 'requirement'
    const nodes = new Set<number>([active])
    const links = new Set<number>()
    for (const link of graph.links) {
      if (onLeft ? link.source === active : link.target === active) {
        links.add(link.index)
        nodes.add(onLeft ? link.target : link.source)
      }
    }
    return { nodes, links }
  }, [active, graph])

  const counts = STATUSES.map((status) => ({
    status,
    count: requirements.filter((r) => r.status === status).length,
  }))

  const hit = (text: string) => !filterActive || text.toLowerCase().includes(query)
  const nodeLit = (index: number) => {
    const node = graph.nodes[index]
    if (!filterActive || !node) return true
    if (node.side !== 'requirement') return hit(node.name)
    return graph.links
      .filter((l) => l.source === index)
      .some((l) => hit(node.name) || hit(graph.nodes[l.target].name))
  }

  const describe = (index: number) => {
    const node = graph.nodes[index]
    if (node.side === 'requirement') {
      const feeds = neighbours.out[index].map((i) => graph.nodes[i].name)
      return `${node.name}. Baseline ${node.sys}, ${node.status}. Feeds ${feeds.length}: ${feeds.join(', ')}.`
    }
    const from = neighbours.inbound[index].map((i) => graph.nodes[i].name)
    return `${node.name}. Carries ${from.length} baseline requirements: ${from.join(', ')}.`
  }

  return (
    <section
      data-filtered={filterActive ? 'true' : 'false'}
      className="rounded border border-line bg-surface p-4"
    >
      <h2 id={headingId} className="text-sm font-semibold tracking-wide text-ink">
        Requirements Coverage — Original Baseline → Current Systems
      </h2>

      <div ref={frameRef} className="mt-3 w-full" style={{ height }}>
        {graph.nodes.length > 0 && (
          <svg
            width={diagramWidth}
            height={height}
            role="group"
            aria-labelledby={headingId}
          >
            {graph.links.map((link) => {
              const dim = related
                ? !related.links.has(link.index)
                : filterActive && !(nodeLit(link.source) && nodeLit(link.target))
              const strong = related?.links.has(link.index) ?? false
              return (
                <path
                  key={link.index}
                  data-link={link.index}
                  data-highlighted={strong ? 'true' : 'false'}
                  d={link.path}
                  fill="none"
                  stroke={STATUS_COLOR[link.status]}
                  strokeWidth={Math.max(1, link.width)}
                  strokeOpacity={dim ? 0.05 : strong ? 0.9 : 0.45}
                  className="transition-[stroke-opacity] duration-150"
                />
              )
            })}
            {graph.nodes.map((node) => {
              const strong = related?.nodes.has(node.index) ?? false
              const lit = related ? strong : nodeLit(node.index)
              const fill =
                node.side === 'requirement'
                  ? STATUS_COLOR[node.status ?? 'Split out']
                  : node.side === 'loss'
                    ? 'var(--color-risk-high)'
                    : 'var(--color-accent)'
              const onLeft = node.side === 'requirement'
              // Requirements are sentences and wrap over two lines; system
              // names are short and stay on one.
              const lines = onLeft
                ? wrapLabel(node.name, gutterLeft)
                : [truncate(`${node.name} (${node.value})`, gutterRight)]
              const nodeHeight = Math.max(1, node.y1 - node.y0)
              const hitHeight = Math.max(MIN_HIT_HEIGHT, nodeHeight)
              const gutter = onLeft ? gutterLeft : gutterRight
              return (
                <g
                  key={node.index}
                  tabIndex={0}
                  role="img"
                  aria-label={describe(node.index)}
                  data-side={node.side}
                  data-node={node.name}
                  data-highlighted={strong ? 'true' : 'false'}
                  data-dimmed={lit ? 'false' : 'true'}
                  opacity={lit ? 1 : 0.15}
                  className="cursor-default transition-opacity duration-150"
                  onMouseEnter={() => setActive(node.index)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(node.index)}
                  onBlur={() => setActive(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setActive(null)
                  }}
                >
                  {/* First child of the group, so the native tooltip covers the
                      label too and not just the few pixels of the node itself. */}
                  <title>
                    {node.side === 'requirement'
                      ? `${node.name} (baseline: ${node.sys}, status: ${node.status})`
                      : node.name}
                  </title>
                  {/* Label gutter and node share one hit area: the text is the
                      only part of a one-pixel-tall node you can actually aim at. */}
                  <rect
                    x={onLeft ? node.x0 - gutter : node.x0}
                    y={(node.y0 + node.y1) / 2 - hitHeight / 2}
                    width={gutter + Math.max(1, node.x1 - node.x0)}
                    height={hitHeight}
                    fill="none"
                    pointerEvents="all"
                  />
                  <rect
                    x={node.x0}
                    y={node.y0}
                    width={Math.max(1, node.x1 - node.x0)}
                    height={nodeHeight}
                    fill={fill}
                    rx={2}
                    stroke={strong ? 'var(--color-ink)' : 'none'}
                    strokeWidth={strong ? 1.5 : 0}
                  />
                  <text
                    x={onLeft ? node.x0 - 6 : node.x1 + 6}
                    y={(node.y0 + node.y1) / 2 - ((lines.length - 1) * LINE_HEIGHT) / 2}
                    textAnchor={onLeft ? 'end' : 'start'}
                    dominantBaseline="middle"
                    fill={strong ? 'var(--color-ink)' : 'var(--color-muted)'}
                    fontSize={LABEL_FONT}
                    fontWeight={strong ? 600 : 400}
                    pointerEvents="none"
                  >
                    {lines.map((line, i) => (
                      <tspan
                        key={line}
                        x={onLeft ? node.x0 - 6 : node.x1 + 6}
                        dy={i === 0 ? 0 : LINE_HEIGHT}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {counts.map(({ status, count }) => (
          <li key={status} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ background: STATUS_COLOR[status] }}
            />
            {status}
            <span className="tabular text-muted-3">{count}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
