import type { RiskLevel } from '../../types/atlas'
import type { TreeNode as TreeNodeData } from '../../types/tree'
import type { Position } from '../../viz/radial'

/**
 * colorKey -> token pair, carried verbatim from the tool being replaced.
 *
 * Branches take -bg and leaves the brighter -leaf. That two-tone split is what
 * gives the map its depth; using one colour per key washed the whole thing out.
 */
const NODE_KEYS = [
  'root', 'inv', 'dhsST', 'cbp', 'otherDHS', 'dhsHQ', 'dod', 'ext',
  'integ', 'sensor', 'platform', 'mitig', 'gaps',
] as const

const TOKEN: Record<string, string> = Object.fromEntries(
  NODE_KEYS.map((k) => [k, k.toLowerCase()]),
)

export const RISK_FILL: Record<RiskLevel, string> = {
  high: 'var(--node-risk-high-leaf)',
  medium: 'var(--node-risk-medium-leaf)',
  low: 'var(--node-risk-low-leaf)',
}

const RISK_STROKE: Record<RiskLevel, string> = {
  high: 'var(--node-risk-high-bg)',
  medium: 'var(--node-risk-medium-bg)',
  low: 'var(--node-risk-low-bg)',
}

/**
 * Labels sit on saturated mid-tone fills in both themes, and the token set has
 * no "ink on a coloured surface" role, so this is a literal.
 */
const ON_COLOR_INK = '#ffffff'

const SOFT_MARK = '#fbbf24'

function nodeToken(colorKey: string, leaf: boolean): string {
  const name = TOKEN[colorKey]
  if (!name) return 'var(--color-muted)'
  return `var(--node-${name}-${leaf ? 'leaf' : 'bg'})`
}

export function fillFor(node: TreeNodeData, riskMode: boolean): string {
  if (riskMode && node.leaf && node.risk) return RISK_FILL[node.risk]
  return nodeToken(node.colorKey, Boolean(node.leaf))
}

/** Border colour. Leaves outline in their branch tone, which reads as depth. */
export function strokeFor(node: TreeNodeData, riskMode: boolean): string {
  if (riskMode && node.leaf && node.risk) return RISK_STROKE[node.risk]
  return nodeToken(node.colorKey, false)
}

export interface NodeGeometry {
  width: number
  height: number
  rx: number
  fontSize: number
}

/** Box and type sizes per depth, from cuas_tool_template_v6.html:3480-3482. */
export function geometryFor(node: TreeNodeData, level: number): NodeGeometry {
  const isRoot = level === 0
  const lineCount = node.label.split('\n').length
  const fontSize = isRoot ? 13 : level === 1 ? 11.5 : level === 2 ? 10.5 : 9.5
  const width = isRoot ? 120 : level === 1 ? 105 : level === 2 ? 95 : 85
  const height = isRoot ? 52 : lineCount > 1 ? 42 : 32
  return { width, height, rx: isRoot ? height / 2 : 10, fontSize }
}

export interface TreeNodeProps {
  position: Position
  /** Layout position plus any offset the reader dragged it to. */
  at: { x: number; y: number }
  expanded: boolean
  selected: boolean
  riskMode: boolean
  textScale: number
  /** Box size multiplier. Separate from textScale: a reader may want a bigger
   *  hit target without bigger text, or the reverse. */
  nodeScale: number
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onDragStart: (id: string, event: React.PointerEvent) => void
  /** True when the pointer moved far enough that this was a drag, not a click. */
  didDrag: () => boolean
}

export function TreeNode({
  position, at, expanded, selected, riskMode, textScale, nodeScale,
  onToggle, onSelect, onDragStart, didDrag,
}: TreeNodeProps) {
  const { node, level } = position
  const { x, y } = at
  const hasChildren = Boolean(node.children && node.children.length > 0)
  const base = geometryFor(node, level)
  // The layout gaps do not scale with this, so large boxes can touch. That is
  // the point: it trades spacing for legibility, and Grid or dragging a node
  // resolves any collision.
  const width = base.width * nodeScale
  const height = base.height * nodeScale
  const rx = base.rx * nodeScale
  const fontSize = base.fontSize * textScale
  const lines = node.label.split('\n')
  const soft = Boolean(node.soft)

  const activate = () => {
    // A pointer that travelled was repositioning the node, not choosing it.
    if (didDrag()) return
    if (hasChildren) onToggle(node.id)
    else onSelect(node.id)
  }

  const name = node.label.replace(/\n/g, ' ')
  const label = hasChildren
    ? `${name}, ${expanded ? 'expanded' : 'collapsed'}`
    : `${name}${node.risk ? `, ${node.risk} risk` : ''}${soft ? ', unconfirmed' : ''}`

  return (
    <g
      data-testid={node.leaf ? `leaf-${node.id}` : `branch-${node.id}`}
      data-id={node.id}
      data-soft={String(soft)}
      {...(node.risk ? { 'data-risk': node.risk } : {})}
      transform={`translate(${x},${y})`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-expanded={hasChildren ? expanded : undefined}
      className="cursor-pointer"
      onPointerDown={(event) => {
        // Claim the pointer before the canvas does, so dragging a node moves
        // the node rather than panning the whole map.
        event.stopPropagation()
        onDragStart(node.id, event)
      }}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activate()
        }
      }}
    >
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={rx}
        fill={fillFor(node, riskMode)}
        stroke={
          selected
            ? 'var(--color-accent-ink)'
            : soft
              ? SOFT_MARK
              : strokeFor(node, riskMode)
        }
        strokeWidth={selected ? 3 : soft ? 2 : 1.5}
        strokeDasharray={soft ? '5,3' : undefined}
      />
      {lines.map((line, i) => (
        <text
          key={line + String(i)}
          x={0}
          y={lines.length === 1 ? 1 : -6 + i * (fontSize + 3)}
          textAnchor="middle"
          dominantBaseline="central"
          fill={ON_COLOR_INK}
          fontSize={fontSize}
          fontWeight={level <= 1 ? 700 : 500}
        >
          {line}
        </text>
      ))}
      {soft && (
        <>
          <circle cx={-width / 2 + 2} cy={-height / 2 + 2} r={9} fill={SOFT_MARK} />
          <text
            x={-width / 2 + 2}
            y={-height / 2 + 3}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--color-bg)"
            fontSize={11}
            fontWeight={800}
          >
            ?
          </text>
        </>
      )}
      {hasChildren && (
        <g transform={`translate(${width / 2 - 2},${-height / 2 + 2})`}>
          <circle r={8} fill="var(--color-surface)" stroke="var(--color-line)" strokeWidth={1} />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--color-ink)"
            fontSize={11}
            fontWeight={700}
          >
            {expanded ? '−' : '+'}
          </text>
        </g>
      )}
    </g>
  )
}
