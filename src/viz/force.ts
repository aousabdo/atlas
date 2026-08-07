import {
  curveCatmullRomClosed,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  line,
  polygonHull,
} from 'd3'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3'

import type { BBox, Size } from './zoom'

export type ViewMode = 'force' | 'zone' | 'tree'

/** Node radius by device type, from TYPE_SHAPES in the original graph. */
export const TYPE_SIZE: Record<string, number> = {
  server: 14,
  cloud: 16,
  backbone: 16,
  router: 14,
  switch: 12,
  firewall: 15,
  sensor: 15,
  radio: 13,
  access_point: 12,
  application: 14,
  endpoint: 12,
  vlan: 12,
  gateway: 14,
  satellite_terminal: 13,
}
const DEFAULT_SIZE = 12

export function nodeRadius(type: string): number {
  return TYPE_SIZE[type] ?? DEFAULT_SIZE
}

/**
 * Zone tiers: cloud and WAN on top, venues at the bottom.
 *
 * Presentation metadata the site bundles do not carry. The original graph
 * hard-coded it, and the top-to-bottom reading is most of what makes the
 * layout recognisable. An unlisted zone lands in the middle band rather than
 * collapsing the layout.
 */
const ZONE_TIER: Record<string, number> = {
  cloud: 0,
  wan: 0,
  core: 1,
  field_house: 2,
  south_stand: 2,
  annex_closet: 2,
  mgmt: 2,
  sensor_net: 3,
  radio_net: 3,
  ops_net: 3,
  guest_net: 3,
  mobile_unit: 4,
  north_stand: 4,
  perimeter: 4,
}
const FALLBACK_TIER = 2

export function zoneTier(zoneId: string): number {
  return ZONE_TIER[zoneId] ?? FALLBACK_TIER
}

/**
 * The coordinate space the layout is computed in.
 *
 * Fixed rather than the container's measured size, so a resize re-fits the
 * zoom transform instead of re-running the simulation and reshuffling a graph
 * the reader was looking at.
 */
export const LAYOUT_CANVAS: Size = { width: 1200, height: 800 }

/** Enough ticks for alpha 0.9 decaying at 0.028 to reach alphaMin. */
const MAX_TICKS = 400

export interface LayoutDevice {
  id: string
  zone: string
  type: string
}

export interface LayoutEdge {
  source: string
  target: string
  link_type: string
  label?: string | null
}

export interface LayoutInput {
  devices: readonly LayoutDevice[]
  edges: readonly LayoutEdge[]
  /** Zone ids in bundle order. Zones with no devices are skipped. */
  zoneIds: readonly string[]
}

export interface PositionedNode {
  id: string
  zone: string
  type: string
  x: number
  y: number
  r: number
}

export interface PositionedEdge {
  id: string
  source: string
  target: string
  linkType: string
  label: string | null
  x1: number
  y1: number
  x2: number
  y2: number
}

export type ZoneHull =
  | { zone: string; kind: 'circle'; cx: number; cy: number; r: number; labelX: number; labelY: number }
  | { zone: string; kind: 'path'; d: string; labelX: number; labelY: number }

export interface Layout {
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  hulls: ZoneHull[]
  bbox: BBox | null
  canvas: Size
  /** Zones that hold devices, in the order the hulls were built in. */
  zones: string[]
}

/** How far a reader has dragged one device off its computed position. */
export interface NodeOffset {
  dx: number
  dy: number
}

/** x and y stay optional: d3 seeds them, and seeding them here to 0 would
 *  start every node coincident and defeat the simulation's own spread. */
type SimNode = SimulationNodeDatum & LayoutDevice

type SimEdge = SimulationLinkDatum<SimNode> & { linkType: string; label: string | null; id: string }

/**
 * A container that has not been laid out yet reports 0x0, and 0 divides its
 * way into NaN through every grid calculation below. Fall back to the nominal
 * canvas: the layout stays finite and the zoom transform, not the geometry, is
 * what waits for a real measurement.
 */
function usableSize(size: Size): Size {
  const width = Number.isFinite(size.width) && size.width > 0 ? size.width : LAYOUT_CANVAS.width
  const height = Number.isFinite(size.height) && size.height > 0 ? size.height : LAYOUT_CANVAS.height
  return { width, height }
}

/** Zone ids that actually hold devices, bundle order first, strays appended. */
function presentZones(input: LayoutInput): string[] {
  const withDevices = new Set(input.devices.map((d) => d.zone))
  const ordered = input.zoneIds.filter((z) => withDevices.has(z))
  const known = new Set(ordered)
  for (const zone of withDevices) if (!known.has(zone)) ordered.push(zone)
  return ordered
}

function groupByZone<T extends { zone: string }>(
  nodes: readonly T[],
  zones: readonly string[],
): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const zone of zones) out[zone] = []
  for (const node of nodes) (out[node.zone] ??= []).push(node)
  return out
}

function byTier(zones: string[]): Array<[number, string[]]> {
  const tiers = new Map<number, string[]>()
  for (const zone of zones) {
    const tier = zoneTier(zone)
    const bucket = tiers.get(tier)
    if (bucket) bucket.push(zone)
    else tiers.set(tier, [zone])
  }
  return [...tiers.entries()].sort((a, b) => a[0] - b[0])
}

/** Force-mode zone attractors, verbatim from computeZoneCentersForce. */
export function zoneCentersForce(zones: string[], size: Size): Record<string, { x: number; y: number }> {
  const { width: W, height: H } = usableSize(size)
  const tiers = byTier(zones)
  const out: Record<string, { x: number; y: number }> = {}
  tiers.forEach(([, zs], ti) => {
    zs.forEach((zk, i) => {
      out[zk] = {
        x: W * ((i + 1) / (zs.length + 1)),
        y: H * ((ti + 1) / (tiers.length + 1)),
      }
    })
  })
  return out
}

/** Zone mode: tiered rows of packed grids, verbatim from computeZoneGridLayout. */
function zoneGridPositions(
  byZone: Record<string, Array<{ id: string }>>,
  zones: string[],
  size: Size,
): Record<string, { x: number; y: number }> {
  const { width: W, height: H } = usableSize(size)
  const tiers = byTier(zones)
  const pad = 36
  const rowH = (H - pad * 2) / tiers.length
  const out: Record<string, { x: number; y: number }> = {}

  tiers.forEach(([, group], ti) => {
    const arr = [...group].sort((a, b) => byZone[b].length - byZone[a].length)
    const colW = (W - pad * 2) / arr.length
    arr.forEach((zk, ci) => {
      const members = byZone[zk]
      if (members.length === 0) return
      const cellX = pad + ci * colW
      const cellY = pad + ti * rowH
      const innerPad = 22
      const titleH = 22
      const innerW = Math.max(colW - innerPad * 2, 1)
      const innerH = Math.max(rowH - innerPad * 2 - titleH, 1)
      const cols = Math.max(1, Math.ceil(Math.sqrt(members.length * (innerW / innerH))) || 1)
      const rows = Math.max(1, Math.ceil(members.length / cols))
      const dx = innerW / cols
      const dy = innerH / rows
      members.forEach((n, i) => {
        const r = Math.floor(i / cols)
        const c = i % cols
        out[n.id] = {
          x: cellX + innerPad + dx * (c + 0.5),
          y: cellY + innerPad + titleH + dy * (r + 0.5),
        }
      })
    })
  })
  return out
}

/** Tree mode: tier rows, zone columns weighted by device count, from computeTreeLayout. */
function treePositions(
  byZone: Record<string, Array<{ id: string }>>,
  zones: string[],
  size: Size,
): Record<string, { x: number; y: number }> {
  const { width: W, height: H } = usableSize(size)
  const tiers = byTier(zones)
  const pad = 50
  const rowH = (H - pad * 2) / tiers.length
  const out: Record<string, { x: number; y: number }> = {}

  tiers.forEach(([, zs], ti) => {
    const totalCount = zs.reduce((s, z) => s + byZone[z].length, 0) || 1
    const availW = W - pad * 2
    let xCursor = pad
    zs.forEach((zk) => {
      const members = byZone[zk]
      const zoneW = availW * (members.length / totalCount)
      if (members.length === 0) {
        xCursor += zoneW
        return
      }
      // Target 140 px per node horizontally so labels have room; zones with
      // many devices wrap into multiple rows.
      const maxPerRow = Math.max(3, Math.floor(zoneW / 140))
      const rows = Math.max(1, Math.ceil(members.length / maxPerRow))
      const perRow = Math.max(1, Math.ceil(members.length / rows))
      const dx = zoneW / (perRow + 1)
      const dy = (rowH - 40) / rows
      members.forEach((n, i) => {
        const r = Math.floor(i / perRow)
        const c = i % perRow
        out[n.id] = {
          x: xCursor + dx * (c + 1),
          y: pad + ti * rowH + 30 + dy * (r + 0.5),
        }
      })
      xCursor += zoneW
    })
  })
  return out
}

/**
 * Force layout tuning, unchanged from the original graph. These numbers are
 * the result of manual tuning against the real Northgate topology; changing
 * them changes a layout people recognise.
 */
function runForce(nodes: SimNode[], edges: SimEdge[], zones: string[], size: Size): void {
  const centers = zoneCentersForce(zones, size)
  const { width: W, height: H } = usableSize(size)
  const simulation = forceSimulation<SimNode>(nodes).stop()
  simulation
    .force(
      'link',
      forceLink<SimNode, SimEdge>(edges)
        .id((d) => d.id)
        .distance(90)
        .strength(0.55),
    )
    .force('charge', forceManyBody<SimNode>().strength(-560))
    .force(
      'collision',
      forceCollide<SimNode>().radius((d) => nodeRadius(d.type) + 18),
    )
    .force('x', forceX<SimNode>().x((d) => centers[d.zone]?.x ?? W / 2).strength(0.12))
    .force('y', forceY<SimNode>().y((d) => centers[d.zone]?.y ?? H / 2).strength(0.12))
    .alphaDecay(0.028)
    .alpha(0.9)

  for (let i = 0; i < MAX_TICKS && simulation.alpha() > simulation.alphaMin(); i++) {
    simulation.tick()
  }
  simulation.stop()
}

const hullPath = line<[number, number]>().curve(curveCatmullRomClosed.alpha(0.6))

/**
 * Zone outlines, ported from updateHulls. Skipped where the shape degenerates.
 *
 * Exported because a dragged device has to drag its zone's outline with it,
 * and the original got that for free by rebuilding the hulls on every tick.
 */
export function zoneHulls(
  nodes: readonly PositionedNode[],
  zones: readonly string[],
): ZoneHull[] {
  const byZone = groupByZone(nodes, zones)
  const out: ZoneHull[] = []
  for (const zone of zones) {
    const members = byZone[zone] ?? []
    if (members.length === 0) continue

    if (members.length === 1) {
      const n = members[0]
      out.push({ zone, kind: 'circle', cx: n.x, cy: n.y, r: 40, labelX: n.x, labelY: n.y - 48 })
      continue
    }
    if (members.length === 2) {
      const [a, b] = members
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const r = Math.max(36, Math.hypot(b.x - a.x, b.y - a.y) / 2 + 28)
      out.push({ zone, kind: 'circle', cx: mx, cy: my, r, labelX: mx, labelY: my - r - 6 })
      continue
    }

    const points = members.map((n) => [n.x, n.y] as [number, number])
    const hull = polygonHull(points)
    if (!hull) {
      // Collinear members: fall back to a circle over their extent.
      const cx = points.reduce((s, p) => s + p[0], 0) / points.length
      const cy = points.reduce((s, p) => s + p[1], 0) / points.length
      const r = Math.max(36, ...points.map((p) => Math.hypot(p[0] - cx, p[1] - cy) + 28))
      out.push({ zone, kind: 'circle', cx, cy, r, labelX: cx, labelY: cy - r - 6 })
      continue
    }
    const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length
    const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length
    const expanded = hull.map((p) => {
      const dx = p[0] - cx
      const dy = p[1] - cy
      const d = Math.hypot(dx, dy) || 1
      const padding = 26
      return [p[0] + (dx / d) * padding, p[1] + (dy / d) * padding] as [number, number]
    })
    const d = hullPath(expanded)
    if (!d) continue
    const top = expanded.reduce((a, b) => (a[1] < b[1] ? a : b))
    out.push({ zone, kind: 'path', d, labelX: top[0], labelY: top[1] - 8 })
  }
  return out
}

function computeBBox(nodes: PositionedNode[]): BBox | null {
  if (nodes.length === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    if (n.x < minX) minX = n.x
    if (n.x > maxX) maxX = n.x
    if (n.y < minY) minY = n.y
    if (n.y > maxY) maxY = n.y
  }
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Positions for every device, plus link endpoints and zone outlines.
 *
 * Pure and deterministic: d3 works out the geometry here and React renders it.
 * Nothing in this module touches the DOM.
 */
export function computeLayout(input: LayoutInput, mode: ViewMode, size: Size): Layout {
  const canvas = usableSize(size)
  const zones = presentZones(input)

  const nodes: SimNode[] = input.devices.map((d) => ({ id: d.id, zone: d.zone, type: d.type }))
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // forceLink throws on an endpoint it cannot resolve, and a bundle can name a
  // device that is not in this site's device list.
  const usable = input.edges.filter((e) => byId.has(e.source) && byId.has(e.target))
  const edges: SimEdge[] = usable.map((e, i) => ({
    id: `${e.source}--${e.target}--${i}`,
    source: e.source,
    target: e.target,
    linkType: e.link_type,
    label: e.label ?? null,
  }))

  if (nodes.length > 0) {
    if (mode === 'force') {
      runForce(nodes, edges, zones, canvas)
    } else {
      const byZone = groupByZone(nodes, zones)
      const positions =
        mode === 'zone'
          ? zoneGridPositions(byZone, zones, canvas)
          : treePositions(byZone, zones, canvas)
      for (const n of nodes) {
        const p = positions[n.id]
        n.x = p ? p.x : canvas.width / 2
        n.y = p ? p.y : canvas.height / 2
      }
    }
  }

  const positioned: PositionedNode[] = nodes.map((n) => ({
    id: n.id,
    zone: n.zone,
    type: n.type,
    x: Number.isFinite(n.x) ? (n.x as number) : canvas.width / 2,
    y: Number.isFinite(n.y) ? (n.y as number) : canvas.height / 2,
    r: nodeRadius(n.type),
  }))
  const finalById = new Map(positioned.map((n) => [n.id, n]))

  const positionedEdges: PositionedEdge[] = edges.map((e) => {
    // forceLink rewrites source and target into node objects in force mode.
    const sourceId = typeof e.source === 'object' ? (e.source as SimNode).id : String(e.source)
    const targetId = typeof e.target === 'object' ? (e.target as SimNode).id : String(e.target)
    const s = finalById.get(sourceId)!
    const t = finalById.get(targetId)!
    return {
      id: e.id,
      source: sourceId,
      target: targetId,
      linkType: e.linkType,
      label: e.label,
      x1: s.x,
      y1: s.y,
      x2: t.x,
      y2: t.y,
    }
  })

  return {
    nodes: positioned,
    edges: positionedEdges,
    hulls: zoneHulls(positioned, zones),
    bbox: computeBBox(positioned),
    canvas,
    zones,
  }
}

/**
 * The same layout with reader-dragged devices moved, and everything that hangs
 * off a position moved with them: link endpoints and zone outlines.
 *
 * Returns the input untouched when nothing has been dragged, so the common
 * case costs a reference comparison rather than a rebuild.
 */
export function withOffsets(layout: Layout, offsets: Record<string, NodeOffset>): Layout {
  const moved = Object.keys(offsets)
  if (moved.length === 0) return layout

  const nodes = layout.nodes.map((n) => {
    const offset = offsets[n.id]
    if (!offset) return n
    // A non-finite offset would poison every hull and edge built from it.
    const dx = Number.isFinite(offset.dx) ? offset.dx : 0
    const dy = Number.isFinite(offset.dy) ? offset.dy : 0
    return { ...n, x: n.x + dx, y: n.y + dy }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const edges = layout.edges.map((e) => {
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    if (!s || !t) return e
    return { ...e, x1: s.x, y1: s.y, x2: t.x, y2: t.y }
  })

  return {
    ...layout,
    nodes,
    edges,
    hulls: zoneHulls(nodes, layout.zones),
    bbox: computeBBox(nodes),
  }
}
