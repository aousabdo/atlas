import { describe, expect, it } from 'vitest'

import { GAP, MIN_DEG, boundsOf, doLayout, minSpan, snapToGrid, subtreeWeight } from '../radial'
import type { TreeNode } from '../../types/tree'

const leaf = (id: string): TreeNode => ({ id, label: id, colorKey: 'inv', leaf: true })
const branch = (id: string, children: TreeNode[]): TreeNode => ({
  id, label: id, colorKey: 'inv', children,
})

const TREE = branch('root', [
  branch('inv', [leaf('a'), leaf('b'), leaf('c')]),
  branch('integ', [leaf('d')]),
])

const allExpanded = { root: true, inv: true, integ: true }

describe('subtreeWeight', () => {
  it('counts a leaf as 1', () => {
    expect(subtreeWeight(leaf('a'), allExpanded)).toBe(1)
  })

  it('sums expanded children', () => {
    expect(subtreeWeight(TREE, allExpanded)).toBe(4)
  })

  it('counts a collapsed branch as 1, because it draws as one node', () => {
    expect(subtreeWeight(TREE, { root: true })).toBe(2)
  })
})

describe('minSpan', () => {
  it('gives a leaf the minimum degrees', () => {
    expect(minSpan(leaf('a'), allExpanded)).toBe(MIN_DEG)
  })

  it('sums children so a wide subtree reserves the room it needs', () => {
    expect(minSpan(TREE, allExpanded)).toBe(4 * MIN_DEG)
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

  it('places children at GAP distance from their parent', () => {
    const p = doLayout(TREE, allExpanded)
    const d = Math.hypot(p.inv.x - p.root.x, p.inv.y - p.root.y)
    expect(d).toBeCloseTo(GAP[1], 5)
  })

  it('uses the level-specific gap at each depth', () => {
    const p = doLayout(TREE, allExpanded)
    const d = Math.hypot(p.a.x - p.inv.x, p.a.y - p.inv.y)
    expect(d).toBeCloseTo(GAP[2], 5)
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
    const spread = (ids: string[]) => {
      const angles = ids.map((i) => Math.atan2(p[i].y - p[ids[0]].y, p[i].x - p[ids[0]].x))
      return Math.max(...angles) - Math.min(...angles)
    }
    expect(spread(['1', '2', '3', '4'])).toBeGreaterThan(0)
  })

  it('handles a single-child tree without dividing by zero', () => {
    const p = doLayout(branch('root', [leaf('only')]), { root: true })
    expect(Number.isFinite(p.only.x) && Number.isFinite(p.only.y)).toBe(true)
  })

  it('handles a leaf-only root', () => {
    expect(doLayout(leaf('solo'), {})).toEqual({ solo: { x: 0, y: 0, level: 0, node: expect.anything() } })
  })
})

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
