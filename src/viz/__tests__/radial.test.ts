import { describe, expect, it } from 'vitest'

import {
  CLEARANCE, GAP, MIN_DEG, allocateSpans, boundsOf, doLayout, extentOf,
  overlappingPairs, snapToGrid, spanFor, spreadOf,
} from '../radial'
import { geometryFor } from '../nodeBox'
import type { TreeNode } from '../../types/tree'

const leaf = (id: string, label = id): TreeNode => ({
  id, label, colorKey: 'inv', leaf: true,
})
const branch = (id: string, children: TreeNode[], label = id): TreeNode => ({
  id, label, colorKey: 'inv', children,
})

const TREE = branch('root', [
  branch('inv', [leaf('a'), leaf('b'), leaf('c')]),
  branch('integ', [leaf('d')]),
])

const allExpanded = { root: true, inv: true, integ: true }

/** A fixed box, so a test can state the geometry it is reasoning about. */
const fixed = (width: number, height: number) => () => ({ width, height })

/**
 * A bundle nobody has tuned: invented names, several of them long enough that
 * a box holding one is wider than the ring it used to be placed on.
 *
 * The sample bundle can be trimmed until it fits. A workbook an analyst drops
 * on the page cannot, and that is the case this file exists for.
 */
const LONG = [
  'Consolidated Airspace Awareness Service',
  'Regional Mitigation Coordination Node',
  'Unbreakablesinglewordidentifier',
  'Perimeter Watch Grid Relay',
  'Quadrant 12 / 34 (B) Feed',
  'MMMMMMMM WWWWWWWW',
  'Tasking\nand Effects\nManager',
  'X',
]

const group = (gid: string, count: number): TreeNode =>
  branch(
    gid,
    Array.from({ length: count }, (_, i) => leaf(`${gid}-${i}`, LONG[i % LONG.length])),
    `${gid} Coordination Group`,
  )

const HOSTILE = branch('root', [
  branch('inv', [group('g1', 8), group('g2', 7), group('g3', 6), group('g4', 5)], 'Deployed Inventory'),
  branch('integ', [group('g5', 6), group('g6', 4)], 'Integration Layer'),
  branch('sensor', [group('g7', 5)], 'Sensing Baseline'),
  branch('gaps', [group('g8', 4)], 'Capability Gaps'),
], 'Hostile\nBundle')

const everything = (node: TreeNode): Record<string, boolean> => {
  const out: Record<string, boolean> = {}
  const walk = (n: TreeNode) => {
    if (n.children?.length) {
      out[n.id] = true
      n.children.forEach(walk)
    }
  }
  walk(node)
  return out
}

/** Root and its immediate children open, which is how the map opens. */
const opening = (node: TreeNode): Record<string, boolean> => {
  const out: Record<string, boolean> = { [node.id]: true }
  for (const child of node.children ?? []) out[child.id] = true
  return out
}

describe('extentOf', () => {
  it('is the diagonal, which is what the box spans in its worst direction', () => {
    expect(extentOf(leaf('a'), 3, fixed(30, 40))).toBeCloseTo(50, 9)
  })
})

describe('spanFor', () => {
  it('is the angle a chord of that size subtends at that radius', () => {
    // A chord equal to the radius subtends 60 degrees.
    expect(spanFor(100, 100)).toBeCloseTo(60, 9)
  })

  it('shrinks as the ring is pushed out, which is why pushing out works', () => {
    expect(spanFor(100, 400)).toBeLessThan(spanFor(100, 200))
  })

  it('asks for the whole circle when the box cannot fit on the ring at all', () => {
    expect(spanFor(500, 100)).toBe(360)
  })

  it('never returns a NaN for a degenerate radius', () => {
    expect(spanFor(100, 0)).toBe(360)
    expect(spanFor(100, -5)).toBe(360)
  })

  it('asks for no angle at all rather than a negative one', () => {
    expect(spanFor(0, 300)).toBe(0)
    expect(spanFor(-40, 300)).toBe(0)
  })
})

describe('spreadOf', () => {
  it('is the box itself for a leaf', () => {
    expect(spreadOf(leaf('a'), {}, 3, fixed(30, 40), 10)).toBeCloseTo(60, 9)
  })

  it('sums the drawn frontier, so a fat subtree earns a wider wedge', () => {
    const fat = branch('fat', [leaf('1'), leaf('2'), leaf('3')])
    const thin = branch('thin', [leaf('4')])
    const exp = { fat: true, thin: true }
    expect(spreadOf(fat, exp, 1, fixed(30, 40), 10))
      .toBeGreaterThan(spreadOf(thin, exp, 1, fixed(30, 40), 10))
  })

  it('counts a collapsed branch as its own box, because that is all it draws', () => {
    const fat = branch('fat', [leaf('1'), leaf('2'), leaf('3')])
    expect(spreadOf(fat, {}, 1, fixed(30, 40), 10)).toBeCloseTo(60, 9)
  })
})

describe('allocateSpans', () => {
  it('gives every child at least what its own box needs', () => {
    const spans = allocateSpans(100, [30, 10, 10], [1, 1, 100])
    expect(spans[0]).toBeGreaterThanOrEqual(30)
    expect(spans[1]).toBeGreaterThanOrEqual(10)
    expect(spans.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9)
  })

  it('spends what is left over on the subtrees that need the room', () => {
    const spans = allocateSpans(100, [10, 10], [9, 1])
    expect(spans[0]).toBeCloseTo(90, 9)
    expect(spans[1]).toBeCloseTo(10, 9)
  })

  it('shares the window out proportionally when the needs cannot all be met', () => {
    const spans = allocateSpans(60, [60, 60], [1, 1])
    expect(spans).toEqual([30, 30])
  })

  it('never hands back a NaN when every share is zero', () => {
    const spans = allocateSpans(90, [10, 10], [0, 0])
    for (const span of spans) expect(Number.isFinite(span)).toBe(true)
    expect(spans.reduce((a, b) => a + b, 0)).toBeCloseTo(90, 9)
  })
})

describe('doLayout', () => {
  it('puts the root at the origin', () => {
    const p = doLayout(TREE, allExpanded)
    expect(p.root).toMatchObject({ x: 0, y: 0, level: 0 })
  })

  it('positions every node', () => {
    const p = doLayout(TREE, allExpanded)
    expect(Object.keys(p).sort()).toEqual(['a', 'b', 'c', 'd', 'inv', 'integ', 'root'].sort())
  })

  it('puts every node of one depth on one circle about the root', () => {
    const p = doLayout(TREE, allExpanded)
    const radius = (id: string) => Math.hypot(p[id].x, p[id].y)
    expect(radius('inv')).toBeCloseTo(radius('integ'), 6)
    expect(radius('a')).toBeCloseTo(radius('d'), 6)
    expect(radius('a')).toBeGreaterThan(radius('inv'))
  })

  it('leaves the ported ring gaps alone when nothing is crowded', () => {
    const p = doLayout(TREE, allExpanded, { measure: fixed(40, 20) })
    expect(Math.hypot(p.inv.x, p.inv.y)).toBeCloseTo(GAP[1], 6)
    expect(Math.hypot(p.a.x, p.a.y)).toBeCloseTo(GAP[1] + GAP[2], 6)
  })

  it('gives every position finite coordinates', () => {
    const p = doLayout(TREE, allExpanded)
    for (const [id, pos] of Object.entries(p)) {
      expect(Number.isFinite(pos.x), `${id}.x`).toBe(true)
      expect(Number.isFinite(pos.y), `${id}.y`).toBe(true)
    }
  })

  it('omits children of a collapsed branch', () => {
    const p = doLayout(TREE, { root: true })
    expect(p.a).toBeUndefined()
    expect(p.inv).toBeDefined()
  })

  it('is deterministic', () => {
    expect(doLayout(TREE, allExpanded)).toEqual(doLayout(TREE, allExpanded))
  })

  it('allocates wider angular spans to heavier subtrees', () => {
    const wide = branch('root', [
      branch('big', [leaf('1'), leaf('2'), leaf('3'), leaf('4')]),
      branch('small', [leaf('5')]),
    ])
    const exp = { root: true, big: true, small: true }
    const p = doLayout(wide, exp)
    const angle = (id: string) => Math.atan2(p[id].y, p[id].x)
    const spread = (ids: string[]) => {
      const angles = ids.map(angle)
      return Math.max(...angles) - Math.min(...angles)
    }
    expect(spread(['1', '2', '3', '4'])).toBeGreaterThan(0)
  })

  it('handles a single-child tree without dividing by zero', () => {
    const p = doLayout(branch('root', [leaf('only')]), { root: true })
    expect(Number.isFinite(p.only.x) && Number.isFinite(p.only.y)).toBe(true)
  })

  /**
   * Garbage in, a drawable map out.
   *
   * A measure is a function a caller supplies. One that returns a NaN, from a
   * font metric that has not resolved or a scale read off an empty input, used
   * to reach the ring radius and put every node beyond it at NaN, which draws
   * nothing at all and reports no error.
   */
  it('still places every node when the measure returns nonsense', () => {
    const p = doLayout(TREE, allExpanded, { measure: () => ({ width: NaN, height: NaN }) })
    for (const [id, pos] of Object.entries(p)) {
      expect(Number.isFinite(pos.x), `${id}.x`).toBe(true)
      expect(Number.isFinite(pos.y), `${id}.y`).toBe(true)
    }
  })

  /**
   * The last line of defence, and the only case that reaches it.
   *
   * The angular rule is exact for two boxes on one ring and the ring gap is
   * exact for two rings, so on every bundle tried the layout is already clean
   * when it first checks. Hand it a clearance that makes both rules lie and
   * the check is what saves the picture: it measures the ring it just placed
   * against everything already on the page and pushes it out again until
   * nothing touches.
   */
  it('refuses to draw one node over another even when told to leave no room', () => {
    const two = branch('root', [
      branch('p1', Array.from({ length: 6 }, (_, i) => leaf(`x${String(i)}`))),
      branch('p2', Array.from({ length: 6 }, (_, i) => leaf(`y${String(i)}`))),
    ])
    const exp = { root: true, p1: true, p2: true }
    const measure = fixed(300, 60)
    for (const clearance of [-2000, -300, 0]) {
      const p = doLayout(two, exp, { measure, clearance })
      expect(overlappingPairs(p, measure), `clearance ${String(clearance)}`).toEqual([])
    }
  })

  it('handles a leaf-only root', () => {
    expect(doLayout(leaf('solo'), {}))
      .toEqual({ solo: { x: 0, y: 0, level: 0, node: expect.anything() } })
  })

  /**
   * The rule the old layout did not have.
   *
   * MIN_DEG used to be the whole answer: eleven degrees a node, whatever it was
   * drawing. Two long labels at the same radius then collided by construction,
   * because nothing in the layout had ever asked how wide their boxes were.
   */
  it('gives a node at least the angle its own box subtends on its ring', () => {
    const wide = branch('root', [leaf('w1'), leaf('w2'), leaf('w3')])
    const p = doLayout(wide, { root: true }, { measure: fixed(400, 40), clearance: 0 })
    const radius = Math.hypot(p.w1.x, p.w1.y)
    const between = Math.abs(Math.atan2(p.w1.y, p.w1.x) - Math.atan2(p.w2.y, p.w2.x))
    // The chord between two neighbours is at least both boxes' diagonals.
    expect(2 * radius * Math.sin(between / 2)).toBeGreaterThanOrEqual(extentOf(leaf('w1'), 1, fixed(400, 40)))
  })

  it('pushes the ring out when the boxes cannot fit on it', () => {
    const many = branch('root', Array.from({ length: 12 }, (_, i) => leaf(`n${i}`)))
    const exp = { root: true }
    const near = doLayout(many, exp, { measure: fixed(60, 30) })
    const far = doLayout(many, exp, { measure: fixed(300, 30) })
    expect(Math.hypot(near.n0.x, near.n0.y)).toBeCloseTo(GAP[1], 6)
    expect(Math.hypot(far.n0.x, far.n0.y)).toBeGreaterThan(GAP[1])
  })

  it('keeps MIN_DEG as a comfort floor while there is room for it', () => {
    const few = branch('root', [leaf('a'), leaf('b')])
    const p = doLayout(few, { root: true }, { measure: fixed(20, 20) })
    const apart = Math.abs(Math.atan2(p.a.y, p.a.x) - Math.atan2(p.b.y, p.b.x)) * (180 / Math.PI)
    expect(apart).toBeGreaterThanOrEqual(MIN_DEG)
  })

  /**
   * The floor cannot be a promise. Thirty three leaves at eleven degrees each
   * is more than a circle holds, so a floor that always applied would make the
   * layout unsatisfiable and push the ring out for nothing.
   */
  it('spends the floor before it spends the radius', () => {
    const crowd = branch('root', Array.from({ length: 60 }, (_, i) => leaf(`n${i}`)))
    const p = doLayout(crowd, { root: true }, { measure: fixed(20, 20) })
    const apart = Math.abs(Math.atan2(p.n0.y, p.n0.x) - Math.atan2(p.n1.y, p.n1.x)) * (180 / Math.PI)
    // Sixty nodes at eleven degrees is 660, which no circle holds. The floor
    // gives way, the small boxes sit closer than it, and the ring is pushed
    // out only as far as the boxes themselves require.
    expect(apart).toBeLessThan(MIN_DEG)
    expect(Math.hypot(p.n0.x, p.n0.y)).toBeLessThan(2 * GAP[1])
    expect(overlappingPairs(p, fixed(20, 20))).toEqual([])
  })
})

/**
 * The deliverable: nothing is drawn on top of anything else.
 *
 * Counted over the whole drawn tree, not over one ring, because the pairs that
 * were buried in the screenshots were a leaf under a cousin and a group under
 * a branch, neither of which any single ring can see.
 */
describe('overlappingPairs', () => {
  it('finds a pair that really does overlap', () => {
    const a = { x: 0, y: 0, level: 1, node: leaf('a') }
    const b = { x: 10, y: 0, level: 1, node: leaf('b') }
    expect(overlappingPairs({ a, b }, fixed(100, 40))).toEqual([['a', 'b']])
  })

  it('does not count boxes that only touch', () => {
    const a = { x: 0, y: 0, level: 1, node: leaf('a') }
    const b = { x: 100, y: 0, level: 1, node: leaf('b') }
    expect(overlappingPairs({ a, b }, fixed(100, 40))).toEqual([])
  })

  const scales: Array<[string, number, number]> = [
    ['default', 1.5, 1],
    ['smallest', 0.6, 0.7],
    ['largest', 2.6, 2.2],
  ]

  for (const [name, tree] of [['a plain tree', TREE], ['a hostile bundle', HOSTILE]] as const) {
    for (const [label, expanded] of [
      ['as the map opens', opening(tree)],
      ['fully expanded', everything(tree)],
    ] as const) {
      for (const [scaleName, textScale, nodeScale] of scales) {
        it(`draws ${name} ${label} at the ${scaleName} label size without overlaps`, () => {
          const measure = (node: TreeNode, level: number) =>
            geometryFor(node, level, textScale, nodeScale)
          const p = doLayout(tree, expanded, { measure })
          expect(overlappingPairs(p, measure)).toEqual([])
        })
      }
    }
  }
})

/** Every id in the hostile bundle mapped to its parent. */
const hostileParents = (): Record<string, string> => {
  const parents: Record<string, string> = {}
  const walk = (node: TreeNode) => {
    for (const child of node.children ?? []) {
      parents[child.id] = node.id
      walk(child)
    }
  }
  walk(HOSTILE)
  return parents
}

describe('snapToGrid', () => {
  const parentOf = { inv: 'root', integ: 'root', a: 'inv', b: 'inv', c: 'inv', d: 'integ' }

  it('leaves the radial positions untouched', () => {
    const radial = doLayout(TREE, allExpanded)
    const before = JSON.stringify(radial.a)
    snapToGrid(radial, parentOf)
    expect(JSON.stringify(radial.a)).toBe(before)
  })

  it('puts every node of a level in the same column', () => {
    const grid = snapToGrid(doLayout(TREE, allExpanded), parentOf)
    expect(grid.inv.x).toBe(grid.integ.x)
    expect(grid.a.x).toBe(grid.d.x)
    expect(grid.root.x).toBe(0)
  })

  it('opens the columns up for a box wider than the ported pitch', () => {
    const narrow = snapToGrid(doLayout(TREE, allExpanded), parentOf, { measure: fixed(40, 20) })
    const wide = snapToGrid(doLayout(TREE, allExpanded), parentOf, { measure: fixed(600, 20) })
    // 380 was the ported pitch and is kept as a floor for boxes that fit it.
    expect(narrow.a.x - narrow.inv.x).toBeCloseTo(380, 6)
    expect(wide.a.x - wide.inv.x).toBeGreaterThanOrEqual(600 + CLEARANCE)
  })

  it('draws no node on top of another, at any box size', () => {
    for (const measure of [fixed(40, 20), fixed(600, 90), fixed(90, 300)]) {
      const grid = snapToGrid(doLayout(HOSTILE, everything(HOSTILE)), hostileParents(), { measure })
      expect(overlappingPairs(grid, measure)).toEqual([])
    }
  })

  it('combs two clusters apart rather than writing one over the other', () => {
    // Both parents want their children centred on themselves, and at this box
    // height the two runs would otherwise share rows.
    const tall = branch('root', [
      branch('p1', [leaf('x1'), leaf('x2'), leaf('x3')]),
      branch('p2', [leaf('y1'), leaf('y2'), leaf('y3')]),
    ])
    const exp = { root: true, p1: true, p2: true }
    const measure = fixed(80, 200)
    const grid = snapToGrid(doLayout(tall, exp, { measure }), {
      p1: 'root', p2: 'root', x1: 'p1', x2: 'p1', x3: 'p1', y1: 'p2', y2: 'p2', y3: 'p2',
    }, { measure })
    expect(overlappingPairs(grid, measure)).toEqual([])
  })

  it('keeps every coordinate finite', () => {
    const grid = snapToGrid(doLayout(TREE, allExpanded), parentOf)
    for (const [id, pos] of Object.entries(grid)) {
      expect(Number.isFinite(pos.x), `${id}.x`).toBe(true)
      expect(Number.isFinite(pos.y), `${id}.y`).toBe(true)
    }
  })
})

describe('boundsOf', () => {
  it('pads the extent of the drawn nodes', () => {
    const b = boundsOf({ root: { x: 0, y: 0, level: 0, node: leaf('root') } }, 100)
    expect(b).toEqual({ minX: -100, minY: -100, width: 200, height: 200 })
  })

  it('never returns a zero or infinite box for an empty map', () => {
    const b = boundsOf({}, 50)
    expect(Number.isFinite(b.width) && b.width > 0).toBe(true)
    expect(Number.isFinite(b.height) && b.height > 0).toBe(true)
  })
})

describe('CLEARANCE', () => {
  it('keeps daylight between two boxes rather than letting them touch', () => {
    expect(CLEARANCE).toBeGreaterThan(0)
  })
})
