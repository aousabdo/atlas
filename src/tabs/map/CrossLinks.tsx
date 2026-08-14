import type { Link } from '../../types/atlas'

export type LinkKind = 'current' | 'desired'

const STYLE: Record<LinkKind, {
  stroke: string
  width: number
  dash: string
  opacity: number
  fontSize: number
  spread: number
  radius: number
}> = {
  // Cyan dashed for what exists, amber dashed for what is only wanted. Both
  // carried from the tool being replaced so a reader keeps their intuition.
  current: {
    stroke: 'var(--color-accent)',
    width: 1.2, dash: '6,4', opacity: 0.55, fontSize: 9, spread: 18, radius: 6,
  },
  desired: {
    stroke: 'var(--color-risk-medium)',
    width: 1, dash: '3,3', opacity: 0.5, fontSize: 8, spread: 14, radius: 5,
  },
}

const round = (v: number) => Math.round(v * 100) / 100

interface Routed {
  link: Link
  index: number
  a: { x: number; y: number }
  b: { x: number; y: number }
  rank: number
}

/** Rough text width, so a label pill is sized without measuring the DOM. */
function pillWidth(text: string, fontSize: number) {
  return text.length * fontSize * 0.55 + 10
}

function curvedPath(a: { x: number; y: number }, b: { x: number; y: number }, bow: number) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  // Two endpoints can land on the same point when both collapse into the same
  // ancestor; the fallback keeps the normal vector finite instead of 0/0.
  const len = Math.hypot(dx, dy) || 1
  const off = len * bow
  const cx = (a.x + b.x) / 2 - (dy / len) * off
  const cy = (a.y + b.y) / 2 + (dx / len) * off
  return {
    d: `M${round(a.x)},${round(a.y)} Q${round(cx)},${round(cy)} ${round(b.x)},${round(b.y)}`,
    labelX: (a.x + 2 * cx + b.x) / 4,
    labelY: (a.y + 2 * cy + b.y) / 4,
    angle: normaliseAngle((Math.atan2(cy - a.y, cx - a.x) * 180) / Math.PI),
  }
}

function normaliseAngle(angle: number) {
  return angle > 90 || angle < -90 ? angle + 180 : angle
}

function orthogonalPath(a: { x: number; y: number }, b: { x: number; y: number }, channelX: number, r: number) {
  const dir = b.y > a.y ? 1 : -1
  const exit = b.x > channelX ? r : -r
  return {
    d: [
      `M${round(a.x)},${round(a.y)}`,
      `L${round(channelX - r)},${round(a.y)}`,
      `Q${round(channelX)},${round(a.y)} ${round(channelX)},${round(a.y + r * dir)}`,
      `L${round(channelX)},${round(b.y - r * dir)}`,
      `Q${round(channelX)},${round(b.y)} ${round(channelX + exit)},${round(b.y)}`,
      `L${round(b.x)},${round(b.y)}`,
    ].join(' '),
    labelX: channelX,
    labelY: (a.y + b.y) / 2,
    angle: -90,
  }
}

export interface LinkLegendEntry {
  kind: LinkKind
  stroke: string
  dash: string
  text: string
}

/**
 * The link encoding, read off the same STYLE table the paths use.
 *
 * A separate literal would be free to drift from what is drawn; this cannot.
 * The legend that renders these lives in MapLegend, so the map has one box
 * explaining everything rather than one box per encoding.
 */
export const LINK_LEGEND: Record<LinkKind, LinkLegendEntry> = {
  current: {
    kind: 'current',
    stroke: STYLE.current.stroke,
    dash: STYLE.current.dash,
    text: 'Current integration link',
  },
  desired: {
    kind: 'desired',
    stroke: STYLE.desired.stroke,
    dash: STYLE.desired.dash,
    text: 'Desired integration link',
  },
}

export interface CrossLinksProps {
  links: Link[]
  kind: LinkKind
  clean: boolean
  /** Nearest drawn position for a system, so a collapsed branch still anchors. */
  resolve: (id: string) => { x: number; y: number } | null
  /** 1/k, so link weight stays constant on screen under zoom. */
  scale: number
}

export function CrossLinks({ links, kind, clean, resolve, scale }: CrossLinksProps) {
  const style = STYLE[kind]

  const routed: Routed[] = links
    .map((link, index) => {
      const a = resolve(link.from)
      const b = resolve(link.to)
      return a && b ? { link, index, a, b, rank: 0 } : null
    })
    .filter((r): r is Routed => r !== null)

  // Channel spacing follows the vertical order of the links, exactly as the
  // original did, but the test id follows the data order so it stays stable.
  const byMidpoint = routed
    .slice()
    .sort((p, q) => (p.a.y + p.b.y) / 2 - (q.a.y + q.b.y) / 2)
  byMidpoint.forEach((r, i) => {
    r.rank = i
  })

  return (
    <g data-testid={`links-${kind}`} aria-hidden="true">
      {routed.map(({ link, index, a, b, rank }) => {
        const channelX = (a.x + b.x) / 2 + (rank - routed.length / 2) * style.spread
        const route = clean
          ? orthogonalPath(a, b, channelX, style.radius)
          : curvedPath(a, b, kind === 'current' ? 0.15 : 0.12)
        const width = pillWidth(link.label, style.fontSize)
        return (
          <g key={`${kind}-${link.from}-${link.to}-${String(index)}`}>
            <path
              data-testid={`link-${kind}-${String(index)}`}
              data-from={link.from}
              data-to={link.to}
              d={route.d}
              fill="none"
              stroke={style.stroke}
              strokeWidth={(style.width) * scale}
              strokeDasharray={style.dash}
              opacity={style.opacity}
            />
            <g
              transform={`translate(${round(route.labelX)},${round(route.labelY)}) rotate(${round(route.angle)})`}
            >
              <rect
                x={-width / 2}
                y={-style.fontSize}
                width={width}
                height={style.fontSize * 2}
                rx={4}
                fill="var(--color-surface)"
                stroke="var(--color-line)"
                strokeWidth={0.5}
                opacity={0.9}
              />
              <text
                x={0}
                y={1}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={(style.fontSize) * scale}
                fill={style.stroke}
              >
                {link.label}
              </text>
            </g>
          </g>
        )
      })}
    </g>
  )
}
