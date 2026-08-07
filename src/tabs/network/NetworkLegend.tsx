import { nodeRadius } from '../../viz/force'
import { RISK_COLOR, UNMAPPED_COLOR } from './risk'

export type NodeShape = 'circle' | 'rect' | 'diamond' | 'hexagon' | 'triangle'

export interface LinkStyle {
  label: string
  color: string
  dash: string | null
}

/**
 * Link encoding, carried from LINK_TYPES in the original graph: same hue
 * assignments, same dash patterns, expressed as design tokens so light mode
 * gets the contrast-checked variant rather than the dark-only hex.
 */
export const LINK_STYLE: Record<string, LinkStyle> = {
  ethernet: { label: 'Ethernet', color: 'var(--color-accent)', dash: null },
  microwave_60ghz: { label: '60 GHz microwave', color: 'var(--color-risk-high)', dash: null },
  microwave: { label: '60 GHz microwave', color: 'var(--color-risk-high)', dash: null },
  satellite: { label: 'Satellite', color: 'var(--color-risk-medium)', dash: '6 4' },
  wan: { label: 'WAN / ISP', color: 'var(--color-risk-medium)', dash: '6 4' },
  vlan: { label: 'VLAN', color: 'var(--color-risk-low)', dash: '2 3' },
  wireless: { label: 'Wireless', color: 'var(--color-group-dhshq)', dash: '4 3' },
}

const UNKNOWN_LINK: LinkStyle = { label: 'Other', color: 'var(--color-muted-3)', dash: null }

export function linkStyle(linkType: string): LinkStyle {
  return LINK_STYLE[linkType] ?? { ...UNKNOWN_LINK, label: linkType }
}

/**
 * Device encoding. Shape carries the type, exactly as the original did;
 * colour groups the types into families so 14 types do not need 14 hues the
 * token set does not have.
 */
export const NODE_STYLE: Record<string, { label: string; shape: NodeShape; color: string }> = {
  cloud: { label: 'Cloud', shape: 'circle', color: 'var(--color-group-ext)' },
  backbone: { label: 'Backbone', shape: 'diamond', color: 'var(--color-group-ext)' },
  router: { label: 'Router', shape: 'circle', color: 'var(--color-group-otherdhs)' },
  gateway: { label: 'Gateway', shape: 'circle', color: 'var(--color-group-otherdhs)' },
  switch: { label: 'Switch', shape: 'rect', color: 'var(--color-group-otherdhs)' },
  firewall: { label: 'Firewall', shape: 'hexagon', color: 'var(--color-group-dod)' },
  sensor: { label: 'Sensor', shape: 'triangle', color: 'var(--color-group-dhsst)' },
  radio: { label: 'Radio link', shape: 'circle', color: 'var(--color-group-dhsst)' },
  satellite_terminal: {
    label: 'Satellite terminal',
    shape: 'circle',
    color: 'var(--color-group-dhsst)',
  },
  access_point: { label: 'Access point', shape: 'circle', color: 'var(--color-group-dhshq)' },
  endpoint: { label: 'Endpoint', shape: 'circle', color: 'var(--color-group-dhshq)' },
  server: { label: 'Server', shape: 'rect', color: 'var(--color-group-cbp)' },
  application: { label: 'Application', shape: 'rect', color: 'var(--color-group-cbp)' },
  vlan: { label: 'VLAN segment', shape: 'diamond', color: 'var(--color-group-cbp)' },
}

const UNKNOWN_NODE = { label: 'Device', shape: 'circle' as NodeShape, color: 'var(--color-muted-3)' }

export function nodeStyle(type: string) {
  return NODE_STYLE[type] ?? { ...UNKNOWN_NODE, label: type }
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

/** Path data for a device marker, centred on the origin. */
export function nodeShapePath(shape: NodeShape, r: number): string {
  switch (shape) {
    case 'rect':
      return `M${round(-r)},${round(-r)}H${round(r)}V${round(r)}H${round(-r)}Z`
    case 'diamond':
      return `M0,${round(-r)}L${round(r)},0L0,${round(r)}L${round(-r)},0Z`
    case 'triangle':
      return `M0,${round(-r)}L${round(r * 0.92)},${round(r * 0.72)}L${round(-r * 0.92)},${round(r * 0.72)}Z`
    case 'hexagon': {
      const points = Array.from({ length: 6 }, (_, i) => {
        const angle = (Math.PI / 3) * i - Math.PI / 2
        return `${round(r * Math.cos(angle))},${round(r * Math.sin(angle))}`
      })
      return `M${points.join('L')}Z`
    }
    case 'circle':
    default:
      return `M${round(-r)},0A${round(r)},${round(r)} 0 1,0 ${round(r)},0A${round(r)},${round(r)} 0 1,0 ${round(-r)},0Z`
  }
}

/**
 * Shape only, in a neutral tone.
 *
 * Colour on the canvas means zone, not device type, so a coloured swatch here
 * would claim an encoding the graph does not use.
 */
function Swatch({ type }: { type: string }) {
  const style = nodeStyle(type)
  const r = Math.min(nodeRadius(type), 8)
  return (
    <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true" className="shrink-0">
      <path
        d={nodeShapePath(style.shape, r)}
        fill="var(--color-bg)"
        stroke="var(--color-muted)"
        strokeWidth="1.4"
      />
    </svg>
  )
}

function LinkSwatch({ linkType }: { linkType: string }) {
  const style = linkStyle(linkType)
  return (
    <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true" className="shrink-0">
      <path
        d="M1,6H25"
        fill="none"
        stroke={style.color}
        strokeWidth="2"
        strokeDasharray={style.dash ?? undefined}
      />
    </svg>
  )
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3 shrink-0 rounded-full"
      style={{ background: color }}
    />
  )
}

const RISK_ROWS: Array<{ label: string; color: string }> = [
  { label: 'High', color: RISK_COLOR.high },
  { label: 'Medium', color: RISK_COLOR.medium },
  { label: 'Low', color: RISK_COLOR.low },
  { label: 'Unmapped', color: UNMAPPED_COLOR },
]

/** The gestures the canvas answers to, spelled out where they are needed. */
function Hints() {
  const keys = [
    ['click', 'isolate'],
    ['hover', 'preview'],
    ['drag', 'move'],
    ['esc', 'clear'],
  ]
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line pt-2 text-[11px] text-muted-3">
      {keys.map(([key, what], index) => (
        <span key={key} className="flex items-center gap-1.5">
          {index > 0 && <span aria-hidden="true">·</span>}
          <kbd className="rounded border border-line bg-surface-2 px-1 py-px text-[10px] text-muted">
            {key}
          </kbd>
          {what}
        </span>
      ))}
    </p>
  )
}

/**
 * Reads the encoding off the data rather than listing every type the schema
 * allows, so the legend cannot claim a link type this site does not have.
 */
export function NetworkLegend({
  deviceTypes,
  linkTypes,
  riskMode,
}: {
  deviceTypes: string[]
  linkTypes: string[]
  /** The risk column only appears while the overlay is on, as in the original. */
  riskMode: boolean
}) {
  return (
    <section aria-label="Legend" className="text-xs text-muted">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <div>
          <h3 className="mb-1.5 text-[10px] font-semibold tracking-widest text-muted-3 uppercase">
            Links
          </h3>
          <ul className="flex flex-col gap-0.5">
            {linkTypes.map((type) => (
              <li key={type} className="flex items-center gap-2">
                <LinkSwatch linkType={type} />
                <span>{linkStyle(type).label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-1.5 text-[10px] font-semibold tracking-widest text-muted-3 uppercase">
            Node types
          </h3>
          <ul className="grid grid-flow-col grid-rows-7 gap-x-4 gap-y-0.5">
            {deviceTypes.map((type) => (
              <li key={type} className="flex items-center gap-2">
                <Swatch type={type} />
                <span>{nodeStyle(type).label}</span>
              </li>
            ))}
          </ul>
        </div>
        {riskMode && (
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold tracking-widest text-muted-3 uppercase">
              Risk overlay
            </h3>
            <ul className="flex flex-col gap-0.5">
              {RISK_ROWS.map((row) => (
                <li key={row.label} className="flex items-center gap-2">
                  <Dot color={row.color} />
                  <span>{row.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <Hints />
    </section>
  )
}
