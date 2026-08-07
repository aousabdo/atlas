import { describe, expect, it } from 'vitest'

import type { Requirement } from '../../types/atlas'
import { buildRequirementsSankey } from '../sankey'

const REQS: Requirement[] = [
  { orig: 'A', sys: 'x', current: ['CROSSLINK', 'Fathom'], status: 'Split out' },
  { orig: 'B', sys: 'y', current: [], status: "Didn't keep" },
]

describe('buildRequirementsSankey', () => {
  it('creates one source node per requirement', () => {
    const g = buildRequirementsSankey(REQS, { width: 800, height: 400 })
    expect(g.nodes.filter((n) => n.side === 'requirement')).toHaveLength(2)
  })

  it('creates one target node per distinct current system', () => {
    const g = buildRequirementsSankey(REQS, { width: 800, height: 400 })
    expect(
      g.nodes
        .filter((n) => n.side === 'system')
        .map((n) => n.name)
        .sort(),
    ).toEqual(['CROSSLINK', 'Fathom'])
  })

  it('routes dropped requirements to an explicit loss node', () => {
    const g = buildRequirementsSankey(REQS, { width: 800, height: 400 })
    const loss = g.nodes.find((n) => n.side === 'loss')
    expect(loss).toBeDefined()
    expect(g.links.some((l) => l.target === loss!.index)).toBe(true)
  })

  it('gives every node finite geometry', () => {
    const g = buildRequirementsSankey(REQS, { width: 800, height: 400 })
    for (const n of g.nodes) {
      for (const v of [n.x0, n.x1, n.y0, n.y1]) {
        expect(Number.isFinite(v), `${n.name} has non-finite geometry`).toBe(true)
      }
    }
  })

  it('returns an empty graph rather than throwing on a zero-size container', () => {
    const g = buildRequirementsSankey(REQS, { width: 0, height: 0 })
    expect(g.nodes).toEqual([])
    expect(g.links).toEqual([])
  })

  it('handles a requirement set where nothing was carried forward', () => {
    const g = buildRequirementsSankey(
      [{ orig: 'A', sys: 'x', current: [], status: "Didn't keep" }],
      { width: 800, height: 400 },
    )
    expect(g.nodes.some((n) => n.side === 'loss')).toBe(true)
  })

  it('gives every link finite geometry and a drawable path', () => {
    const g = buildRequirementsSankey(REQS, { width: 800, height: 400 })
    expect(g.links).toHaveLength(3)
    for (const l of g.links) {
      for (const v of [l.y0, l.y1, l.width]) {
        expect(Number.isFinite(v)).toBe(true)
      }
      expect(l.path).toMatch(/^M[\d.-]+,[\d.-]+C/)
      expect(l.path).not.toMatch(/NaN/)
    }
  })

  it('keeps requirements on the left of the systems they flowed into', () => {
    const g = buildRequirementsSankey(REQS, { width: 800, height: 400 })
    const left = g.nodes.filter((n) => n.side === 'requirement')
    const right = g.nodes.filter((n) => n.side !== 'requirement')
    expect(Math.max(...left.map((n) => n.x1))).toBeLessThanOrEqual(
      Math.min(...right.map((n) => n.x0)),
    )
  })

  it('reports link ends as indices into nodes, not object references', () => {
    const g = buildRequirementsSankey(REQS, { width: 800, height: 400 })
    for (const l of g.links) {
      expect(typeof l.source).toBe('number')
      expect(g.nodes[l.source]).toBeDefined()
      expect(g.nodes[l.target]).toBeDefined()
    }
  })

  it('returns an empty graph for an empty requirement set', () => {
    const g = buildRequirementsSankey([], { width: 800, height: 400 })
    expect(g.nodes).toEqual([])
    expect(g.links).toEqual([])
  })
})
