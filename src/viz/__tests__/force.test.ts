import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Topology } from '../../types/atlas'
import {
  computeLayout,
  LAYOUT_CANVAS,
  nodeRadius,
  TYPE_SIZE,
  withOffsets,
  zoneCentersForce,
  zoneHulls,
  type LayoutInput,
  type ViewMode,
} from '../force'

/** The real bundle, so the layout is exercised against the shape it ships with. */
function loadSite(name: string): LayoutInput {
  const raw = readFileSync(
    join(process.cwd(), 'public', 'data', 'sites', `${name}.json`),
    'utf-8',
  )
  const topology = JSON.parse(raw) as Topology
  return {
    devices: topology.devices,
    edges: topology.edges,
    zoneIds: Object.keys(topology.zones),
  }
}

const NORTHGATE = loadSite('northgate')
const WESTFIELD = loadSite('westfield')
const MODES: ViewMode[] = ['force', 'zone', 'tree']

function everyNumber(layout: ReturnType<typeof computeLayout>): number[] {
  const values: number[] = []
  for (const n of layout.nodes) values.push(n.x, n.y, n.r)
  for (const e of layout.edges) values.push(e.x1, e.y1, e.x2, e.y2)
  for (const h of layout.hulls) {
    values.push(h.labelX, h.labelY)
    if (h.kind === 'circle') values.push(h.cx, h.cy, h.r)
  }
  if (layout.bbox) values.push(layout.bbox.x, layout.bbox.y, layout.bbox.w, layout.bbox.h)
  return values
}

describe('computeLayout', () => {
  it.each(MODES)('gives every node a finite position in %s mode', (mode) => {
    const layout = computeLayout(NORTHGATE, mode, LAYOUT_CANVAS)
    expect(layout.nodes).toHaveLength(71)
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x), `${n.id} x`).toBe(true)
      expect(Number.isFinite(n.y), `${n.id} y`).toBe(true)
      expect(n.r).toBeGreaterThan(0)
    }
  })

  it.each(MODES)('positions both endpoints of all 86 links in %s mode', (mode) => {
    const layout = computeLayout(NORTHGATE, mode, LAYOUT_CANVAS)
    expect(layout.edges).toHaveLength(86)
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    for (const e of layout.edges) {
      expect(byId.get(e.source)).toMatchObject({ x: e.x1, y: e.y1 })
      expect(byId.get(e.target)).toMatchObject({ x: e.x2, y: e.y2 })
    }
  })

  it.each(MODES)('emits no NaN or Infinity at a zero-size container in %s mode', (mode) => {
    // React mounts before layout, so a 0x0 container is the first thing every
    // geometry function sees. Same class of bug as the zoom guard.
    const layout = computeLayout(NORTHGATE, mode, { width: 0, height: 0 })
    expect(layout.nodes).toHaveLength(71)
    for (const value of everyNumber(layout)) expect(Number.isFinite(value)).toBe(true)
    for (const hull of layout.hulls) {
      if (hull.kind === 'path') expect(hull.d).not.toMatch(/NaN|Infinity/)
    }
  })

  it('produces identical zone-mode geometry for the same input', () => {
    const a = computeLayout(NORTHGATE, 'zone', LAYOUT_CANVAS)
    const b = computeLayout(NORTHGATE, 'zone', LAYOUT_CANVAS)
    expect(b.nodes).toEqual(a.nodes)
  })

  it('produces identical tree-mode geometry for the same input', () => {
    const a = computeLayout(NORTHGATE, 'tree', LAYOUT_CANVAS)
    const b = computeLayout(NORTHGATE, 'tree', LAYOUT_CANVAS)
    expect(b.nodes).toEqual(a.nodes)
  })

  it('produces identical force-mode geometry for the same input', () => {
    // d3-force seeds from a deterministic LCG, so the graph does not reshuffle
    // itself between renders of the same data.
    const a = computeLayout(NORTHGATE, 'force', LAYOUT_CANVAS)
    const b = computeLayout(NORTHGATE, 'force', LAYOUT_CANVAS)
    expect(b.nodes).toEqual(a.nodes)
  })

  it('separates zone and tree geometry rather than reusing one layout', () => {
    const zone = computeLayout(NORTHGATE, 'zone', LAYOUT_CANVAS)
    const tree = computeLayout(NORTHGATE, 'tree', LAYOUT_CANVAS)
    expect(tree.nodes).not.toEqual(zone.nodes)
  })

  it('spreads the force layout out rather than piling nodes on one point', () => {
    const layout = computeLayout(NORTHGATE, 'force', LAYOUT_CANVAS)
    expect(layout.bbox!.w).toBeGreaterThan(200)
    expect(layout.bbox!.h).toBeGreaterThan(200)
    const distinct = new Set(layout.nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`))
    expect(distinct.size).toBe(71)
  })

  it('lays out the small site too', () => {
    const layout = computeLayout(WESTFIELD, 'force', LAYOUT_CANVAS)
    expect(layout.nodes).toHaveLength(8)
    expect(layout.edges).toHaveLength(8)
    for (const value of everyNumber(layout)) expect(Number.isFinite(value)).toBe(true)
  })

  it('returns an empty layout and a null bbox for a site with no devices', () => {
    const layout = computeLayout({ devices: [], edges: [], zoneIds: [] }, 'force', LAYOUT_CANVAS)
    expect(layout.nodes).toEqual([])
    expect(layout.edges).toEqual([])
    expect(layout.hulls).toEqual([])
    expect(layout.bbox).toBeNull()
  })

  it('drops edges whose endpoints are not in this site rather than throwing', () => {
    const layout = computeLayout(
      {
        devices: [{ id: 'a', zone: 'wan', type: 'router' }],
        edges: [{ source: 'a', target: 'ghost', link_type: 'ethernet' }],
        zoneIds: ['wan'],
      },
      'force',
      LAYOUT_CANVAS,
    )
    expect(layout.edges).toEqual([])
  })

  it('draws one hull per populated zone', () => {
    const layout = computeLayout(NORTHGATE, 'zone', LAYOUT_CANVAS)
    expect(layout.hulls.map((h) => h.zone).sort()).toEqual([...NORTHGATE.zoneIds].sort())
  })
})

describe('withOffsets', () => {
  it('returns the same layout object when nothing has been dragged', () => {
    const layout = computeLayout(NORTHGATE, 'force', LAYOUT_CANVAS)
    expect(withOffsets(layout, {})).toBe(layout)
  })

  it('moves the device, its links and its zone outline together', () => {
    const layout = computeLayout(NORTHGATE, 'zone', LAYOUT_CANVAS)
    const target = layout.nodes[0]
    const moved = withOffsets(layout, { [target.id]: { dx: 120, dy: -80 } })

    const after = moved.nodes.find((n) => n.id === target.id)!
    expect(after.x).toBeCloseTo(target.x + 120)
    expect(after.y).toBeCloseTo(target.y - 80)

    // Everything else stays exactly where it was.
    const other = moved.nodes.find((n) => n.id !== target.id)!
    const before = layout.nodes.find((n) => n.id === other.id)!
    expect(other.x).toBe(before.x)

    for (const edge of moved.edges) {
      if (edge.source === target.id) expect(edge.x1).toBeCloseTo(after.x)
      if (edge.target === target.id) expect(edge.x2).toBeCloseTo(after.x)
    }
    expect(moved.hulls).not.toEqual(layout.hulls)
    expect(moved.hulls.map((h) => h.zone)).toEqual(layout.hulls.map((h) => h.zone))
  })

  it('keeps every coordinate finite when handed a non-finite offset', () => {
    const layout = computeLayout(NORTHGATE, 'force', LAYOUT_CANVAS)
    const id = layout.nodes[0].id
    const moved = withOffsets(layout, { [id]: { dx: Number.NaN, dy: Infinity } })
    for (const value of everyNumber(moved)) expect(Number.isFinite(value)).toBe(true)
    for (const hull of moved.hulls) {
      if (hull.kind === 'path') expect(hull.d).not.toMatch(/NaN|Infinity/)
    }
  })

  it('ignores an offset for a device this site does not have', () => {
    const layout = computeLayout(WESTFIELD, 'force', LAYOUT_CANVAS)
    const moved = withOffsets(layout, { ghost: { dx: 10, dy: 10 } })
    expect(moved.nodes.map((n) => [n.x, n.y])).toEqual(layout.nodes.map((n) => [n.x, n.y]))
  })
})

describe('zoneHulls', () => {
  it('draws one outline per populated zone and none for an empty one', () => {
    const layout = computeLayout(NORTHGATE, 'force', LAYOUT_CANVAS)
    const hulls = zoneHulls(layout.nodes, [...layout.zones, 'nowhere'])
    expect(hulls.map((h) => h.zone)).toEqual(layout.zones)
  })

  it('falls back to a circle rather than nothing for two devices', () => {
    const hulls = zoneHulls(
      [
        { id: 'a', zone: 'wan', type: 'router', x: 0, y: 0, r: 12 },
        { id: 'b', zone: 'wan', type: 'router', x: 100, y: 0, r: 12 },
      ],
      ['wan'],
    )
    expect(hulls).toHaveLength(1)
    expect(hulls[0].kind).toBe('circle')
  })
})

describe('zoneCentersForce', () => {
  it('stacks tiers down the canvas and spreads zones across it', () => {
    const centers = zoneCentersForce(['cloud', 'wan', 'core'], { width: 1200, height: 800 })
    expect(centers.cloud.y).toBeLessThan(centers.core.y)
    expect(centers.cloud.x).toBeLessThan(centers.wan.x)
    expect(centers.cloud.y).toBe(centers.wan.y)
  })

  it('stays finite for a container with no size', () => {
    const centers = zoneCentersForce(['cloud', 'wan'], { width: 0, height: 0 })
    for (const c of Object.values(centers)) {
      expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true)
    }
  })
})

describe('nodeRadius', () => {
  it('uses the type sizes carried from the original graph', () => {
    expect(nodeRadius('cloud')).toBe(TYPE_SIZE.cloud)
    expect(nodeRadius('sensor')).toBe(15)
  })

  it('falls back to the default size for a type the bundle invents', () => {
    expect(nodeRadius('teleporter')).toBe(12)
  })
})
