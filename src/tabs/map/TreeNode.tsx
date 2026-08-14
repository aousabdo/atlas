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

export const RISK_STROKE: Record<RiskLevel, string> = {
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

/**
 * The two tones a colour key carries, exported because the legend has to name
 * exactly the colours the canvas paints and must not keep its own copy.
 */
export function nodeTone(colorKey: string, leaf: boolean): string {
  const name = TOKEN[colorKey]
  if (!name) return 'var(--color-muted)'
  return `var(--node-${name}-${leaf ? 'leaf' : 'bg'})`
}

export function fillFor(node: TreeNodeData, riskMode: boolean): string {
  if (riskMode && node.leaf && node.risk) return RISK_FILL[node.risk]
  return nodeTone(node.colorKey, Boolean(node.leaf))
}

/** Border colour. Leaves outline in their branch tone, which reads as depth. */
export function strokeFor(node: TreeNodeData, riskMode: boolean): string {
  if (riskMode && node.leaf && node.risk) return RISK_STROKE[node.risk]
  return nodeTone(node.colorKey, false)
}

/**
 * Advance width per character, in ems, as an upper bound for the UI face.
 *
 * The alternative was to measure: render the text, read getComputedTextLength,
 * size the box, render again. That needs a laid-out DOM with the webfont
 * already resolved, so it costs a second pass, it jitters as Inter loads, it
 * reports 0 in jsdom so none of this could be tested, and the first paint of
 * every node is the wrong size. A table is deterministic, testable, and right
 * on the first frame.
 *
 * Every figure is rounded up rather than to the true advance. Over-estimating
 * costs a few pixels of empty box; under-estimating clips the label, which is
 * the failure this exists to prevent, so the error is spent on the safe side.
 */
const ADVANCE_SPACE = 0.32
const ADVANCE_NARROW = 0.4
const ADVANCE_LOWER = 0.6
const ADVANCE_DIGIT = 0.62
const ADVANCE_UPPER = 0.74
/**
 * Symbols, and any script this table does not model.
 *
 * Above the widest Latin letter on purpose. A label from somebody's own
 * workbook can carry an ampersand, a currency mark or a Cyrillic name, and the
 * only answer that is never wrong in the damaging direction is a generous one.
 */
const ADVANCE_UNKNOWN = 0.78
const ADVANCE_WIDE = 0.92
/** CJK, Kana, Hangul and emoji are drawn on a full-width body. */
const ADVANCE_FULL_WIDTH = 1.05

const WIDE = new Set([...'MWmw@%'])
const NARROW = new Set([...'iljItfr.,:;\'!|()[]{}'])
/** ASCII letters plus Latin-1 Supplement and Latin Extended-A/B. */
const LATIN_LETTER = /[A-Za-z\u00C0-\u024F]/

/** Bold is drawn on the root and the level-1 branches, and bold is wider. */
const BOLD_STRETCH = 1.06

/** Clear space between the text and the border, horizontally and vertically. */
export const PAD_X = 7
export const PAD_Y = 5

/** Baseline-to-baseline distance as a multiple of the font size. */
export const LINE_HEIGHT = 1.25

function advanceEm(ch: string): number {
  if (ch === ' ') return ADVANCE_SPACE
  const cp = ch.codePointAt(0) ?? 0
  if (cp > 0x2e7f) return ADVANCE_FULL_WIDTH
  if (cp > 0x024f) return ADVANCE_UNKNOWN
  if (WIDE.has(ch)) return ADVANCE_WIDE
  if (NARROW.has(ch)) return ADVANCE_NARROW
  if (cp >= 0x30 && cp <= 0x39) return ADVANCE_DIGIT
  if (!LATIN_LETTER.test(ch)) return ADVANCE_UNKNOWN
  return ch === ch.toLowerCase() ? ADVANCE_LOWER : ADVANCE_UPPER
}

/** Width one line of label occupies at `fontSize`, in user units. */
export function lineWidth(text: string, fontSize: number, bold: boolean): number {
  let em = 0
  for (const ch of text) em += advanceEm(ch)
  return em * fontSize * (bold ? BOLD_STRETCH : 1)
}

export interface NodeGeometry {
  width: number
  height: number
  rx: number
  fontSize: number
  lineHeight: number
}

/**
 * Box and type sizes per depth, from cuas_tool_template_v6.html:3480-3482, and
 * then whatever the label actually needs on top.
 *
 * The per-depth sizes were constants while the label was data, so the map drew
 * a 25-character name in an 85px box and centred it, losing characters off both
 * ends. A reader cannot see that: "Partner Agency" reads as "artner Agenc" and
 * looks like a name. The two view controls made it worse rather than better,
 * because the label scale multiplied the type and the box scale multiplied the
 * box, so turning labels up was a way to clip them.
 *
 * So the depth sizes are a floor and the label sets the rest. The box scale
 * still does what it says, it raises the floor; the label scale can no longer
 * push text past the border, because the border moves with it. The cost is that
 * a long name draws a wide node, and wide nodes on a radial layout can touch.
 * Touching boxes are a nuisance the reader can see and fix, with Grid or by
 * dragging a node. A clipped name is a lie the reader cannot see at all.
 */
export function geometryFor(
  node: TreeNodeData,
  level: number,
  textScale = 1,
  nodeScale = 1,
): NodeGeometry {
  const isRoot = level === 0
  const lines = node.label.split('\n')
  const fontSize = (isRoot ? 13 : level === 1 ? 11.5 : level === 2 ? 10.5 : 9.5) * textScale
  const lineHeight = fontSize * LINE_HEIGHT
  const bold = level <= 1

  const floorWidth = (isRoot ? 120 : level === 1 ? 105 : level === 2 ? 95 : 85) * nodeScale
  const floorHeight = (isRoot ? 52 : lines.length > 1 ? 42 : 32) * nodeScale

  let widest = 0
  for (const line of lines) {
    const w = lineWidth(line, fontSize, bold)
    if (w > widest) widest = w
  }

  const width = Math.max(floorWidth, widest + 2 * PAD_X)
  const height = Math.max(floorHeight, lines.length * lineHeight + 2 * PAD_Y)
  return { width, height, rx: isRoot ? height / 2 : 10 * nodeScale, fontSize, lineHeight }
}

export interface TreeNodeProps {
  position: Position
  /** Layout position plus any offset the reader dragged it to. */
  at: { x: number; y: number }
  expanded: boolean
  selected: boolean
  riskMode: boolean
  textScale: number
  /** Minimum box size multiplier. Separate from textScale: a reader may want a
   *  bigger hit target without bigger text, or the reverse. It sets the floor
   *  rather than the size, because a box smaller than its own label is not a
   *  smaller box, it is a label with its ends cut off. */
  nodeScale: number
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onDragStart: (id: string, event: React.PointerEvent) => void
  /**
   * True when the pointer moved far enough that this was a drag, not a click.
   *
   * Call it once per activation: the canvas consumes the flag, because the
   * click that closes a drag arrives after the drag record has been released.
   */
  didDrag: () => boolean
}

export function TreeNode({
  position, at, expanded, selected, riskMode, textScale, nodeScale,
  onToggle, onSelect, onDragStart, didDrag,
}: TreeNodeProps) {
  const { node, level } = position
  const { x, y } = at
  const hasChildren = Boolean(node.children && node.children.length > 0)
  const { width, height, rx, fontSize, lineHeight } =
    geometryFor(node, level, textScale, nodeScale)
  const lines = node.label.split('\n')
  const soft = Boolean(node.soft)

  const activate = () => {
    // A pointer that travelled was repositioning the node, not choosing it.
    if (didDrag()) return
    if (hasChildren) onToggle(node.id)
    else onSelect(node.id)
  }

  /**
   * A click on a node is not a click on the ground.
   *
   * The canvas below clears the selection when the bare ground is clicked, so
   * without this a click that opened a system would bubble straight on and
   * close it again in the same tick. Same guard the topology puts on its
   * device groups.
   */
  const onNodeClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    activate()
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
      onClick={onNodeClick}
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
          // Centred on the box as a block, so the same rule places one line,
          // two, or the five a verbose name from somebody's own workbook wraps
          // into. The old offsets were written for two lines and put a third
          // through the bottom border.
          y={(i - (lines.length - 1) / 2) * lineHeight}
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
