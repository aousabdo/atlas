/**
 * Tests for the graph analysis.
 *
 * Two kinds of case, deliberately:
 *
 *   1. Tiny graphs whose answer can be worked out on paper. A five node chain
 *      has three cut vertices and you can name them. These are the tests that
 *      say what the code is supposed to mean.
 *   2. The committed sample topology (71 devices, 86 edges) and randomly built
 *      small graphs, both checked against a brute force reference written in
 *      this file: remove the thing, recount the components. The reference is
 *      obviously correct and far too slow to ship, which is the whole point of
 *      having it here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Device, DeviceEdge, DeviceId, Topology } from '../../types/atlas'
import {
  articulationPoints,
  blastRadius,
  bridges,
  buildGraph,
  derivedRootIds,
  tracePaths,
  type GraphInput,
} from '../graph'

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function device(id: string, over: Partial<Device> = {}): Device {
  return {
    id,
    label: id.toUpperCase(),
    zone: 'core',
    type: 'switch',
    ip: null,
    subnet: null,
    description: null,
    ...over,
  }
}

function edge(source: string, target: string, over: Partial<DeviceEdge> = {}): DeviceEdge {
  return { source, target, link_type: 'ethernet', label: null, ...over }
}

/** Devices named by the edges, plus any extra bare ids. */
function graphOf(pairs: Array<[string, string]>, extra: string[] = []): GraphInput {
  const ids = new Set<string>(extra)
  for (const [a, b] of pairs) {
    ids.add(a)
    ids.add(b)
  }
  return {
    devices: [...ids].sort().map((id) => device(id)),
    edges: pairs.map(([a, b]) => edge(a, b)),
    zones: {},
  }
}

function chainOf(ids: string[]): GraphInput {
  const pairs: Array<[string, string]> = []
  for (let i = 1; i < ids.length; i += 1) pairs.push([ids[i - 1]!, ids[i]!])
  return graphOf(pairs, ids)
}

/** n nodes in a ring. Deep enough to blow a recursive DFS, and no cut vertex. */
function ringOf(n: number): GraphInput {
  const ids = Array.from({ length: n }, (_, i) => `n${String(i).padStart(6, '0')}`)
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < n; i += 1) pairs.push([ids[i]!, ids[(i + 1) % n]!])
  return graphOf(pairs, ids)
}

/** n nodes in a line. Same depth, and every interior node is a cut vertex. */
function lineOf(n: number): GraphInput {
  const ids = Array.from({ length: n }, (_, i) => `n${String(i).padStart(6, '0')}`)
  return chainOf(ids)
}

const SAMPLE: Topology = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'synthetic', 'sites', 'northgate.json'), 'utf-8'),
) as Topology

// ---------------------------------------------------------------------------
// Brute force reference. Correct by inspection, O(V * (V + E)), never shipped.
// ---------------------------------------------------------------------------

function undirected(input: GraphInput): Map<string, Set<string>> {
  const ids = new Set(input.devices.map((d) => d.id))
  const adjacency = new Map<string, Set<string>>()
  for (const id of ids) adjacency.set(id, new Set())
  for (const e of input.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    if (e.source === e.target) continue
    adjacency.get(e.source)!.add(e.target)
    adjacency.get(e.target)!.add(e.source)
  }
  return adjacency
}

function bruteComponents(
  input: GraphInput,
  dropNode: string | null = null,
  dropLink: [string, string] | null = null,
): string[][] {
  const adjacency = undirected(input)
  const seen = new Set<string>()
  const out: string[][] = []
  for (const start of [...adjacency.keys()].sort()) {
    if (start === dropNode || seen.has(start)) continue
    const part: string[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const v = stack.pop()!
      part.push(v)
      for (const w of adjacency.get(v)!) {
        if (w === dropNode || seen.has(w)) continue
        if (
          dropLink &&
          ((dropLink[0] === v && dropLink[1] === w) || (dropLink[1] === v && dropLink[0] === w))
        ) {
          continue
        }
        seen.add(w)
        stack.push(w)
      }
    }
    out.push(part.sort())
  }
  return out
}

function bruteArticulation(input: GraphInput): string[] {
  const base = bruteComponents(input).length
  return input.devices
    .map((d) => d.id)
    .filter((id) => bruteComponents(input, id).length > base)
    .sort()
}

function bruteBridges(input: GraphInput): string[] {
  const base = bruteComponents(input).length
  const links = new Set<string>()
  for (const e of input.edges) {
    if (e.source === e.target) continue
    links.add([e.source, e.target].sort().join('|'))
  }
  return [...links]
    .filter((key) => {
      const [a, b] = key.split('|') as [string, string]
      return bruteComponents(input, null, [a, b]).length > base
    })
    .sort()
}

function randomGraph(seed: number, nodes: number, edgeCount: number): GraphInput {
  let state = seed >>> 0
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const ids = Array.from({ length: nodes }, (_, i) => `r${i}`)
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < edgeCount; i += 1) {
    const a = ids[Math.floor(next() * nodes)]!
    const b = ids[Math.floor(next() * nodes)]!
    pairs.push([a, b])
  }
  return graphOf(pairs, ids)
}

// ---------------------------------------------------------------------------
// buildGraph: the degenerate cases this codebase has been bitten by
// ---------------------------------------------------------------------------

describe('buildGraph', () => {
  it('handles an empty topology without inventing anything', () => {
    const g = buildGraph({ devices: [], edges: [], zones: {} })
    expect(g.nodeIds).toEqual([])
    expect(g.links).toEqual([])
    expect(g.components).toEqual([])
    expect(g.rootIds).toEqual([])
    expect(g.anomalies.isolatedDeviceIds).toEqual([])
  })

  it('handles a single node with no edges', () => {
    const g = buildGraph(graphOf([], ['solo']))
    expect(g.nodeIds).toEqual(['solo'])
    expect(g.components).toEqual([{ count: 1, deviceIds: ['solo'] }])
    expect(g.anomalies.isolatedDeviceIds).toEqual(['solo'])
  })

  it('reports a fully disconnected graph as one component per device', () => {
    const g = buildGraph(graphOf([], ['c', 'a', 'b']))
    expect(g.components).toEqual([
      { count: 1, deviceIds: ['a'] },
      { count: 1, deviceIds: ['b'] },
      { count: 1, deviceIds: ['c'] },
    ])
    expect(g.anomalies.isolatedDeviceIds).toEqual(['a', 'b', 'c'])
  })

  it('records a self loop and leaves it out of the adjacency', () => {
    const g = buildGraph({
      devices: [device('a'), device('b')],
      edges: [edge('a', 'a'), edge('a', 'b')],
      zones: {},
    })
    expect(g.anomalies.selfLoops).toEqual([{ edgeIndex: 0, deviceId: 'a' }])
    expect(g.links).toHaveLength(1)
    expect(g.links[0]).toMatchObject({ source: 'a', target: 'b', edgeIndexes: [1] })
  })

  it('collapses duplicate edges into one link and keeps every raw edge index', () => {
    const g = buildGraph({
      devices: [device('a'), device('b')],
      edges: [
        edge('a', 'b', { link_type: 'ethernet' }),
        edge('b', 'a', { link_type: 'vlan' }),
        edge('a', 'b', { link_type: 'ethernet' }),
      ],
      zones: {},
    })
    expect(g.links).toHaveLength(1)
    expect(g.links[0]).toMatchObject({
      source: 'a',
      target: 'b',
      linkTypes: ['ethernet', 'vlan'],
      edgeIndexes: [0, 1, 2],
      forward: true,
      reverse: true,
    })
    expect(g.anomalies.duplicateLinks).toEqual([
      { source: 'a', target: 'b', edgeIndexes: [0, 1, 2] },
    ])
  })

  it('drops an edge naming a device that does not exist, and says which id', () => {
    const g = buildGraph({
      devices: [device('a'), device('b')],
      edges: [edge('a', 'ghost'), edge('a', 'b')],
      zones: {},
    })
    expect(g.anomalies.unknownEndpoints).toEqual([
      { edgeIndex: 0, source: 'a', target: 'ghost', missingIds: ['ghost'] },
    ])
    expect(g.links).toHaveLength(1)
    expect(g.nodeIds).toEqual(['a', 'b'])
  })

  it('keeps one node for a duplicated device id and reports the duplicate', () => {
    const g = buildGraph({
      devices: [device('a'), device('a', { label: 'Second' }), device('b')],
      edges: [edge('a', 'b')],
      zones: {},
    })
    expect(g.nodeIds).toEqual(['a', 'b'])
    expect(g.anomalies.duplicateDeviceIds).toEqual([{ deviceId: 'a', indexes: [0, 1] }])
  })

  it('orders components largest first, then by their first id', () => {
    const g = buildGraph(graphOf([['x', 'y'], ['a', 'b'], ['m', 'n'], ['n', 'o']]))
    expect(g.components.map((c) => c.deviceIds)).toEqual([
      ['m', 'n', 'o'],
      ['a', 'b'],
      ['x', 'y'],
    ])
  })
})

describe('derivedRootIds', () => {
  it('picks the devices no recorded edge points at', () => {
    // a -> b -> c, and a -> d. Only a has nothing pointing at it.
    expect(derivedRootIds(graphOf([['a', 'b'], ['b', 'c'], ['a', 'd']]))).toEqual(['a'])
  })

  it('falls back to one representative per component when every device has a parent', () => {
    // A ring has no in-degree zero device at all, so without the fallback the
    // whole component would have no root and read as unreachable.
    expect(derivedRootIds(graphOf([['b', 'c'], ['c', 'a'], ['a', 'b']]))).toEqual(['a'])
  })

  it('gives every component a root', () => {
    const roots = derivedRootIds(graphOf([['a', 'b'], ['c', 'd'], ['d', 'c']]))
    expect(roots).toEqual(['a', 'c'])
  })

  it('names internet as the only root of the sample topology', () => {
    expect(derivedRootIds(SAMPLE)).toEqual(['internet'])
  })
})

// ---------------------------------------------------------------------------
// articulationPoints
// ---------------------------------------------------------------------------

describe('articulationPoints', () => {
  it('finds nothing in an empty, single node or edgeless graph', () => {
    expect(articulationPoints({ devices: [], edges: [], zones: {} })).toEqual([])
    expect(articulationPoints(graphOf([], ['solo']))).toEqual([])
    expect(articulationPoints(graphOf([], ['a', 'b', 'c']))).toEqual([])
  })

  it('finds nothing in a triangle, where every device has two ways out', () => {
    expect(articulationPoints(graphOf([['a', 'b'], ['b', 'c'], ['c', 'a']]))).toEqual([])
  })

  it('names the three interior devices of a five device chain', () => {
    const found = articulationPoints(chainOf(['a', 'b', 'c', 'd', 'e']))
    expect(found.map((p) => p.deviceId).sort()).toEqual(['b', 'c', 'd'])
  })

  it('reports exactly what a cut vertex cuts off, not just that it is one', () => {
    // a - b - c - d - e. Remove b and you are left with {a} and {c,d,e}.
    // The larger piece keeps talking, so a is what goes dark.
    const b = articulationPoints(chainOf(['a', 'b', 'c', 'd', 'e'])).find((p) => p.deviceId === 'b')
    expect(b).toBeDefined()
    expect(b!.severedCount).toBe(1)
    expect(b!.severedDeviceIds).toEqual(['a'])
    expect(b!.retainedCount).toBe(3)
    expect(b!.retainedDeviceIds).toEqual(['c', 'd', 'e'])
    expect(b!.fragments).toEqual([
      { count: 3, deviceIds: ['c', 'd', 'e'] },
      { count: 1, deviceIds: ['a'] },
    ])
  })

  it('breaks a tie between equal fragments on the lowest id, so the answer is stable', () => {
    // a - b - c: removing b leaves {a} and {c}, both size one.
    const b = articulationPoints(chainOf(['a', 'b', 'c']))[0]!
    expect(b.deviceId).toBe('b')
    expect(b.retainedDeviceIds).toEqual(['a'])
    expect(b.severedDeviceIds).toEqual(['c'])
  })

  it('reports every fragment when a device cuts the graph into more than two', () => {
    // A hub with three leaves and nothing else: removing it leaves three ones.
    const hub = articulationPoints(graphOf([['hub', 'a'], ['hub', 'b'], ['hub', 'c']]))[0]!
    expect(hub.deviceId).toBe('hub')
    expect(hub.fragments).toEqual([
      { count: 1, deviceIds: ['a'] },
      { count: 1, deviceIds: ['b'] },
      { count: 1, deviceIds: ['c'] },
    ])
    expect(hub.severedDeviceIds).toEqual(['b', 'c'])
  })

  it('counts the severed devices by type against the whole graph total', () => {
    // Four sensors. Three hang off one switch; the fourth is elsewhere.
    const input: GraphInput = {
      devices: [
        device('sw', { type: 'switch' }),
        device('core', { type: 'switch' }),
        device('s1', { type: 'sensor' }),
        device('s2', { type: 'sensor' }),
        device('s3', { type: 'sensor' }),
        device('s4', { type: 'sensor' }),
      ],
      edges: [
        edge('core', 'sw'),
        edge('sw', 's1'),
        edge('sw', 's2'),
        edge('sw', 's3'),
        edge('core', 's4'),
      ],
      zones: {},
    }
    const sw = articulationPoints(input).find((p) => p.deviceId === 'sw')!
    expect(sw.severedCount).toBe(3)
    expect(sw.severedByType).toEqual([
      { key: 'sensor', label: 'sensor', count: 3, total: 4, deviceIds: ['s1', 's2', 's3'] },
    ])
  })

  it('groups the severed devices by zone, using the zone label from the topology', () => {
    const input: GraphInput = {
      devices: [
        device('core', { zone: 'core' }),
        device('c2', { zone: 'core' }),
        device('c3', { zone: 'core' }),
        device('sw', { zone: 'core' }),
        device('a', { zone: 'sensor_net' }),
        device('b', { zone: 'sensor_net' }),
      ],
      edges: [
        edge('core', 'c2'),
        edge('core', 'c3'),
        edge('core', 'sw'),
        edge('sw', 'a'),
        edge('a', 'b'),
      ],
      zones: { core: { label: 'Core' }, sensor_net: { label: 'Sensor Network' } },
    }
    const sw = articulationPoints(input).find((p) => p.deviceId === 'sw')!
    expect(sw.severedByZone).toEqual([
      { key: 'sensor_net', label: 'Sensor Network', count: 2, total: 2, deviceIds: ['a', 'b'] },
    ])
  })

  it('never blames a cut vertex for devices in another component', () => {
    // a-b-c is one component; x and y are a separate island that was already
    // unreachable from it. Removing b must not claim them.
    const input = graphOf([['a', 'b'], ['b', 'c'], ['x', 'y']])
    const b = articulationPoints(input).find((p) => p.deviceId === 'b')!
    expect(b.severedDeviceIds).toEqual(['c'])
    expect([...b.severedDeviceIds, ...b.retainedDeviceIds].sort()).toEqual(['a', 'c'])
  })

  it('orders the findings by damage, then by id', () => {
    // hub cuts off two; mid cuts off one.
    const input = graphOf([
      ['root', 'hub'],
      ['hub', 'mid'],
      ['mid', 'leaf'],
      ['hub', 'other'],
    ])
    expect(articulationPoints(input).map((p) => [p.deviceId, p.severedCount])).toEqual([
      ['hub', 2],
      ['mid', 1],
    ])
  })

  it('carries the device label so a finding can be read out loud', () => {
    const found = articulationPoints(chainOf(['a', 'b', 'c']))[0]!
    expect(found.label).toBe('B')
  })

  it('agrees with brute force on the sample topology', () => {
    expect(articulationPoints(SAMPLE).map((p) => p.deviceId).sort()).toEqual(
      bruteArticulation(SAMPLE),
    )
  })

  it('reports the sensor cut in the sample with the ids behind it', () => {
    const found = articulationPoints(SAMPLE).find((p) => p.deviceId === 'sensor_net_firewall')!
    expect(found.severedCount).toBe(8)
    expect(found.severedDeviceIds).toEqual([
      'perimeter_camera',
      'perimeter_radar',
      'remote_id_receiver',
      'sensor_net_eoir',
      'sensor_net_ptz',
      'sensor_net_radar',
      'sensor_net_rf_array',
      'sensor_net_switch',
    ])
    // "Lose this firewall and 8 devices go dark, including 7 of 12 sensors."
    expect(found.severedByType[0]).toEqual({
      key: 'sensor',
      label: 'sensor',
      count: 7,
      total: 12,
      deviceIds: [
        'perimeter_camera',
        'perimeter_radar',
        'remote_id_receiver',
        'sensor_net_eoir',
        'sensor_net_ptz',
        'sensor_net_radar',
        'sensor_net_rf_array',
      ],
    })
    expect(found.severedCount + found.retainedCount).toBe(SAMPLE.devices.length - 1)
  })

  it('agrees with brute force on random small graphs', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const input = randomGraph(seed, 9, 10)
      expect(articulationPoints(input).map((p) => p.deviceId).sort()).toEqual(
        bruteArticulation(input),
      )
    }
  })

  it('reports fragments that match a brute force removal, on random graphs', () => {
    for (let seed = 100; seed <= 120; seed += 1) {
      const input = randomGraph(seed, 10, 12)
      for (const found of articulationPoints(input)) {
        const own = new Set([...found.severedDeviceIds, ...found.retainedDeviceIds])
        const after = bruteComponents(input, found.deviceId).filter((part) =>
          part.some((id) => own.has(id)),
        )
        expect(found.fragments.map((f) => f.deviceIds).flat().sort()).toEqual(
          after.flat().sort(),
        )
        expect(found.fragments).toHaveLength(after.length)
      }
    }
  })

  it('does not blow the stack on a twenty thousand device ring', () => {
    // Recursive Tarjan dies here. A ring also has no cut vertex, so the answer
    // is small even though the depth is not.
    expect(articulationPoints(ringOf(20000))).toEqual([])
  })

  it('names every interior device of a long chain', () => {
    // A thousand rather than the ring's twenty, because naming the severed
    // devices of every cut vertex on a chain is quadratic by definition: each
    // of the 998 findings lists most of the graph. The ring above is what
    // covers the recursion depth.
    expect(articulationPoints(lineOf(1000))).toHaveLength(998)
  })

  it('returns the same answer twice for the same input', () => {
    expect(articulationPoints(SAMPLE)).toEqual(articulationPoints(SAMPLE))
  })
})

// ---------------------------------------------------------------------------
// bridges
// ---------------------------------------------------------------------------

describe('bridges', () => {
  it('finds nothing in an empty or edgeless graph', () => {
    expect(bridges({ devices: [], edges: [], zones: {} })).toEqual([])
    expect(bridges(graphOf([], ['a', 'b']))).toEqual([])
  })

  it('finds nothing in a triangle', () => {
    expect(bridges(graphOf([['a', 'b'], ['b', 'c'], ['c', 'a']]))).toEqual([])
  })

  it('treats every link of a chain as a bridge and names both sides', () => {
    const found = bridges(chainOf(['a', 'b', 'c']))
    expect(found.map((b) => [b.source, b.target])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ])
    const ab = found.find((b) => b.source === 'a')!
    expect(ab.sides).toEqual([
      { count: 2, deviceIds: ['b', 'c'] },
      { count: 1, deviceIds: ['a'] },
    ])
    expect(ab.severedDeviceIds).toEqual(['a'])
    expect(ab.retainedDeviceIds).toEqual(['b', 'c'])
  })

  it('carries the link types and the raw edge indexes behind the finding', () => {
    const input: GraphInput = {
      devices: [device('a'), device('b'), device('c')],
      edges: [
        edge('a', 'b', { link_type: 'microwave_60ghz' }),
        edge('b', 'c', { link_type: 'ethernet' }),
      ],
      zones: {},
    }
    const found = bridges(input).find((b) => b.source === 'a')!
    expect(found.linkTypes).toEqual(['microwave_60ghz'])
    expect(found.edgeIndexes).toEqual([0])
    expect(found.sourceLabel).toBe('A')
    expect(found.targetLabel).toBe('B')
  })

  it('still calls a doubly recorded link a bridge', () => {
    // Two records of the same adjacency are one link here, not two cables, so
    // the redundancy is on paper only and the link still cuts the graph.
    const input: GraphInput = {
      devices: [device('a'), device('b')],
      edges: [edge('a', 'b'), edge('a', 'b')],
      zones: {},
    }
    const found = bridges(input)
    expect(found).toHaveLength(1)
    expect(found[0]!.edgeIndexes).toEqual([0, 1])
  })

  it('is not fooled by a self loop pretending to be a second path', () => {
    const input: GraphInput = {
      devices: [device('a'), device('b')],
      edges: [edge('a', 'b'), edge('b', 'b')],
      zones: {},
    }
    expect(bridges(input)).toHaveLength(1)
  })

  it('counts the severed devices by type', () => {
    // Four devices on the core side, three behind the trunk, so the larger
    // piece is the one that plainly keeps talking.
    const input: GraphInput = {
      devices: [
        device('core', { type: 'switch' }),
        device('e1', { type: 'endpoint' }),
        device('e2', { type: 'endpoint' }),
        device('e3', { type: 'endpoint' }),
        device('sw', { type: 'switch' }),
        device('s1', { type: 'sensor' }),
        device('s2', { type: 'sensor' }),
      ],
      edges: [
        edge('core', 'e1'),
        edge('core', 'e2'),
        edge('core', 'e3'),
        edge('core', 'sw'),
        edge('sw', 's1'),
        edge('sw', 's2'),
      ],
      zones: {},
    }
    const found = bridges(input).find((b) => b.source === 'core' && b.target === 'sw')!
    expect(found.severedCount).toBe(3)
    expect(found.severedDeviceIds).toEqual(['s1', 's2', 'sw'])
    expect(found.severedByType).toEqual([
      { key: 'sensor', label: 'sensor', count: 2, total: 2, deviceIds: ['s1', 's2'] },
      { key: 'switch', label: 'switch', count: 1, total: 2, deviceIds: ['sw'] },
    ])
  })

  it('orders the findings by damage, then by the endpoint ids', () => {
    const found = bridges(chainOf(['a', 'b', 'c', 'd', 'e']))
    expect(found.map((b) => [b.source, b.target, b.severedCount])).toEqual([
      ['b', 'c', 2],
      ['c', 'd', 2],
      ['a', 'b', 1],
      ['d', 'e', 1],
    ])
  })

  it('agrees with brute force on the sample topology', () => {
    expect(bridges(SAMPLE).map((b) => `${b.source}|${b.target}`).sort()).toEqual(
      bruteBridges(SAMPLE),
    )
  })

  it('reports the sensor trunk in the sample with the ids behind it', () => {
    const found = bridges(SAMPLE).find(
      (b) => b.source === 'sensor_net_firewall' && b.target === 'sensor_net_switch',
    )!
    expect(found.severedCount).toBe(8)
    expect(found.severedDeviceIds).toContain('sensor_net_switch')
    expect(found.severedCount + found.retainedCount).toBe(SAMPLE.devices.length)
  })

  it('agrees with brute force on random small graphs', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const input = randomGraph(seed, 9, 10)
      expect(bridges(input).map((b) => `${b.source}|${b.target}`).sort()).toEqual(
        bruteBridges(input),
      )
    }
  })

  it('does not blow the stack on a twenty thousand device ring', () => {
    expect(bridges(ringOf(20000))).toEqual([])
  })

  it('returns the same answer twice for the same input', () => {
    expect(bridges(SAMPLE)).toEqual(bridges(SAMPLE))
  })
})

// ---------------------------------------------------------------------------
// blastRadius
// ---------------------------------------------------------------------------

describe('blastRadius', () => {
  it('says so plainly when the device is not in the topology', () => {
    const report = blastRadius(chainOf(['a', 'b']), 'ghost')
    expect(report.exists).toBe(false)
    expect(report.unreachableCount).toBe(0)
    expect(report.unreachableDeviceIds).toEqual([])
  })

  it('reports nothing lost when the device is a leaf', () => {
    // a -> b -> c, remove c. Nothing hangs off it.
    const report = blastRadius(chainOf(['a', 'b', 'c']), 'c')
    expect(report.unreachableDeviceIds).toEqual([])
    expect(report.removedWasReachable).toBe(true)
    expect(report.reachableBeforeCount).toBe(3)
    expect(report.reachableAfterCount).toBe(2)
  })

  it('reports what falls off the far side of a cut vertex', () => {
    const report = blastRadius(chainOf(['a', 'b', 'c', 'd']), 'b')
    expect(report.rootIds).toEqual(['a'])
    expect(report.rootsFrom).toBe('derived')
    expect(report.unreachableCount).toBe(2)
    expect(report.unreachableDeviceIds).toEqual(['c', 'd'])
  })

  it('does not count the removed device itself as collateral', () => {
    const report = blastRadius(chainOf(['a', 'b', 'c', 'd']), 'b')
    expect(report.unreachableDeviceIds).not.toContain('b')
    expect(report.removedWasReachable).toBe(true)
  })

  it('honours roots supplied by the caller and says they were supplied', () => {
    // Rooted at d instead, removing b strands a rather than c and d.
    const report = blastRadius(chainOf(['a', 'b', 'c', 'd']), 'b', { rootIds: ['d'] })
    expect(report.rootsFrom).toBe('supplied')
    expect(report.rootIds).toEqual(['d'])
    expect(report.unreachableDeviceIds).toEqual(['a'])
  })

  it('reports a supplied root that is not in the topology instead of ignoring it', () => {
    const report = blastRadius(chainOf(['a', 'b', 'c']), 'b', { rootIds: ['a', 'ghost'] })
    expect(report.rootIds).toEqual(['a'])
    expect(report.unknownRootIds).toEqual(['ghost'])
  })

  it('separates what was already unreachable from what this removal costs', () => {
    // x-y is an island the root never reached. Removing b must not claim it.
    const input = graphOf([['a', 'b'], ['b', 'c'], ['x', 'y']])
    const report = blastRadius(input, 'b', { rootIds: ['a'] })
    expect(report.unreachableDeviceIds).toEqual(['c'])
    expect(report.alreadyUnreachableDeviceIds).toEqual(['x', 'y'])
  })

  it('loses everything downstream when the only root is removed', () => {
    const report = blastRadius(chainOf(['a', 'b', 'c']), 'a')
    expect(report.removedWasReachable).toBe(true)
    expect(report.unreachableDeviceIds).toEqual(['b', 'c'])
    expect(report.reachableAfterCount).toBe(0)
  })

  it('costs nothing when the device sits on a ring', () => {
    const report = blastRadius(graphOf([['a', 'b'], ['b', 'c'], ['c', 'a']]), 'b')
    expect(report.unreachableDeviceIds).toEqual([])
  })

  it('breaks out the loss by type and by zone', () => {
    const input: GraphInput = {
      devices: [
        device('root', { type: 'gateway', zone: 'core' }),
        device('sw', { type: 'switch', zone: 'core' }),
        device('s1', { type: 'sensor', zone: 'sensor_net' }),
        device('s2', { type: 'sensor', zone: 'sensor_net' }),
      ],
      edges: [edge('root', 'sw'), edge('sw', 's1'), edge('sw', 's2')],
      zones: { core: { label: 'Core' }, sensor_net: { label: 'Sensor Network' } },
    }
    const report = blastRadius(input, 'sw')
    expect(report.byType).toEqual([
      { key: 'sensor', label: 'sensor', count: 2, total: 2, deviceIds: ['s1', 's2'] },
    ])
    expect(report.byZone).toEqual([
      { key: 'sensor_net', label: 'Sensor Network', count: 2, total: 2, deviceIds: ['s1', 's2'] },
    ])
  })

  it('matches the articulation point finding on the sample topology', () => {
    // Same graph, same removal, two code paths. They must not disagree.
    const cut = articulationPoints(SAMPLE).find((p) => p.deviceId === 'sensor_net_firewall')!
    const report = blastRadius(SAMPLE, 'sensor_net_firewall')
    expect(report.unreachableDeviceIds).toEqual(cut.severedDeviceIds)
    expect(report.unreachableCount).toBe(8)
    expect(report.byType[0]).toMatchObject({ key: 'sensor', count: 7, total: 12 })
  })

  it('costs nothing for a device the sample topology does not hinge on', () => {
    expect(blastRadius(SAMPLE, 'ops_workstation_a').unreachableDeviceIds).toEqual([])
  })

  it('walks a twenty thousand device chain without recursing', () => {
    const report = blastRadius(lineOf(20000), 'n010000')
    expect(report.unreachableCount).toBe(9999)
  })

  it('returns the same answer twice for the same input', () => {
    expect(blastRadius(SAMPLE, 'core_switch')).toEqual(blastRadius(SAMPLE, 'core_switch'))
  })
})

// ---------------------------------------------------------------------------
// tracePaths
// ---------------------------------------------------------------------------

describe('tracePaths', () => {
  it('returns an empty report for an empty graph', () => {
    const report = tracePaths({ devices: [], edges: [], zones: {} }, [], [])
    expect(report.paths).toEqual([])
    expect(report.sources).toEqual([])
    expect(report.truncated).toBe(false)
  })

  it('finds both arms of a diamond', () => {
    const input = graphOf([['a', 'b'], ['b', 'd'], ['a', 'c'], ['c', 'd']])
    const report = tracePaths(input, ['a'], ['d'])
    expect(report.paths.map((p) => p.deviceIds)).toEqual([
      ['a', 'b', 'd'],
      ['a', 'c', 'd'],
    ])
    expect(report.paths[0]!.hopCount).toBe(2)
    expect(report.sources[0]).toMatchObject({
      deviceId: 'a',
      reaches: true,
      shortestHops: 2,
      pathCount: 2,
    })
  })

  it('carries the link behind every hop', () => {
    const input: GraphInput = {
      devices: [device('a'), device('b')],
      edges: [edge('a', 'b', { link_type: 'wireless' })],
      zones: {},
    }
    const report = tracePaths(input, ['a'], ['b'])
    expect(report.paths[0]!.hops).toEqual([
      {
        source: 'a',
        target: 'b',
        linkTypes: ['wireless'],
        edgeIndexes: [0],
        along: 'forward',
      },
    ])
  })

  it('says when a hop runs against the recorded direction', () => {
    // The recorded direction here runs from the switch out to the sensor, so a
    // detection reaching the workstation travels backwards along it.
    const input = graphOf([['sw', 'sensor'], ['sw', 'ops']])
    const report = tracePaths(input, ['sensor'], ['ops'])
    expect(report.paths[0]!.hops.map((h) => h.along)).toEqual(['reverse', 'forward'])
  })

  it('names the sources that reach nothing, which is the finding', () => {
    const input = graphOf([['a', 'b'], ['x', 'y']])
    const report = tracePaths(input, ['a', 'x'], ['b'])
    expect(report.unreachedSourceIds).toEqual(['x'])
    expect(report.sources.find((s) => s.deviceId === 'x')).toMatchObject({
      reaches: false,
      shortestHops: null,
      witness: null,
      reachedSinkIds: [],
      unreachedSinkIds: ['b'],
    })
  })

  it('names the sinks nobody reaches', () => {
    const input = graphOf([['a', 'b'], ['x', 'y']])
    const report = tracePaths(input, ['a'], ['b', 'y'])
    expect(report.unreachedSinkIds).toEqual(['y'])
    expect(report.reachedSinkIds).toEqual(['b'])
  })

  it('reports requested ids the topology does not carry', () => {
    const report = tracePaths(chainOf(['a', 'b']), ['a', 'ghost'], ['b', 'phantom'])
    expect(report.unknownFromIds).toEqual(['ghost'])
    expect(report.unknownToIds).toEqual(['phantom'])
    expect(report.fromIds).toEqual(['a'])
    expect(report.toIds).toEqual(['b'])
  })

  it('treats a source that is also a sink as reaching itself, at zero hops', () => {
    const report = tracePaths(chainOf(['a', 'b']), ['a'], ['a', 'b'])
    expect(report.sources[0]!.shortestHops).toBe(0)
    expect(report.paths.map((p) => p.deviceIds)).toEqual([['a'], ['a', 'b']])
  })

  it('enumerates simple paths only, never revisiting a device', () => {
    const input = graphOf([['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'd']])
    const report = tracePaths(input, ['a'], ['d'])
    for (const path of report.paths) {
      expect(new Set(path.deviceIds).size).toBe(path.deviceIds.length)
    }
    // Shortest first, because that is what the cap keeps when it bites.
    expect(report.paths.map((p) => p.deviceIds)).toEqual([
      ['a', 'c', 'd'],
      ['a', 'b', 'c', 'd'],
    ])
  })

  it('follows the recorded direction when asked, and finds nothing upstream', () => {
    // sw -> sensor and sw -> ops. Nothing runs sensor to ops the recorded way.
    const input = graphOf([['sw', 'sensor'], ['sw', 'ops']])
    const report = tracePaths(input, ['sensor'], ['ops'], { direction: 'recorded' })
    expect(report.direction).toBe('recorded')
    expect(report.paths).toEqual([])
    expect(report.unreachedSourceIds).toEqual(['sensor'])
  })

  it('stops at the path cap and admits the answer is a lower bound', () => {
    // Five parallel two hop routes; ask for two.
    const pairs: Array<[string, string]> = []
    for (let i = 0; i < 5; i += 1) {
      pairs.push(['a', `m${i}`], [`m${i}`, 'z'])
    }
    const report = tracePaths(graphOf(pairs), ['a'], ['z'], { maxPaths: 2 })
    expect(report.paths).toHaveLength(2)
    expect(report.truncated).toBe(true)
    expect(report.truncationReasons).toContain('path-cap')
    // Truncating the enumeration must not make the reachability answer wrong.
    expect(report.sources[0]!.reaches).toBe(true)
  })

  it('shares the cap across sources rather than letting the first take it all', () => {
    const pairs: Array<[string, string]> = []
    for (let i = 0; i < 4; i += 1) pairs.push(['a', `m${i}`], [`m${i}`, 'z'], ['b', `m${i}`])
    const report = tracePaths(graphOf(pairs), ['a', 'b'], ['z'], { maxPathsPerSource: 1 })
    expect(report.paths.map((p) => p.fromId).sort()).toEqual(['a', 'b'])
    expect(report.truncationReasons).toContain('source-path-cap')
  })

  it('still reports reachability for a sink that lies beyond the hop cap', () => {
    const report = tracePaths(chainOf(['a', 'b', 'c', 'd', 'e']), ['a'], ['e'], { maxHops: 2 })
    expect(report.paths).toEqual([])
    expect(report.truncationReasons).toContain('hop-cap')
    expect(report.sources[0]).toMatchObject({ reaches: true, shortestHops: 4 })
    expect(report.sources[0]!.witness).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('records the limits it ran under, so a reader knows what was asked', () => {
    const report = tracePaths(chainOf(['a', 'b']), ['a'], ['b'], { maxHops: 3, maxPaths: 7 })
    expect(report.limits.maxHops).toBe(3)
    expect(report.limits.maxPaths).toBe(7)
  })

  it('survives a self loop, a duplicate edge and a dangling endpoint', () => {
    const input: GraphInput = {
      devices: [device('a'), device('b'), device('c')],
      edges: [
        edge('a', 'a'),
        edge('a', 'b'),
        edge('b', 'a'),
        edge('b', 'c'),
        edge('c', 'ghost'),
      ],
      zones: {},
    }
    const report = tracePaths(input, ['a'], ['c'])
    expect(report.paths.map((p) => p.deviceIds)).toEqual([['a', 'b', 'c']])
    expect(report.paths[0]!.hops[0]!.edgeIndexes).toEqual([1, 2])
  })

  it('answers the question the tool exists for on the sample topology', () => {
    // Does a detection reach a decision maker? Every sensor, every ops seat.
    const sensors = SAMPLE.devices.filter((d) => d.type === 'sensor').map((d) => d.id)
    const seats = ['ops_workstation_a', 'ops_workstation_b']
    const report = tracePaths(SAMPLE, sensors, seats, { maxHops: 8, maxPaths: 400 })
    expect(report.fromIds).toHaveLength(12)
    expect(report.unreachedSourceIds).toEqual([])
    expect(report.sources.find((s) => s.deviceId === 'sensor_net_radar')).toMatchObject({
      reaches: true,
      shortestHops: 4,
    })
    for (const source of report.sources) {
      expect(source.witness?.[0]).toBe(source.deviceId)
      expect(seats).toContain(source.witness?.at(-1))
    }
  })

  it('finds no sensor reaching an ops seat along the recorded direction', () => {
    // Which is why the default is either way: the recorded direction in this
    // bundle is the wiring order out from the demarc, not the direction a
    // detection travels.
    const sensors = SAMPLE.devices.filter((d) => d.type === 'sensor').map((d) => d.id)
    const report = tracePaths(SAMPLE, sensors, ['ops_workstation_a'], { direction: 'recorded' })
    expect(report.unreachedSourceIds).toHaveLength(12)
  })

  it('does not hang on a dense graph', () => {
    // Twelve devices wired to each other every way there is. Uncapped
    // enumeration here is in the tens of millions of paths.
    const ids = Array.from({ length: 12 }, (_, i) => `d${i}`)
    const pairs: Array<[string, string]> = []
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) pairs.push([ids[i]!, ids[j]!])
    }
    const started = Date.now()
    const report = tracePaths(graphOf(pairs), ['d0'], ['d11'])
    expect(Date.now() - started).toBeLessThan(2000)
    expect(report.paths.length).toBeLessThanOrEqual(report.limits.maxPaths)
    expect(report.truncated).toBe(true)
    expect(report.sources[0]!.reaches).toBe(true)
  })

  it('walks a twenty thousand device chain without recursing', () => {
    const ids = Array.from({ length: 20000 }, (_, i) => `n${String(i).padStart(6, '0')}`)
    const report = tracePaths(lineOf(20000), [ids[0]!], [ids[19999]!])
    expect(report.sources[0]!.reaches).toBe(true)
    expect(report.sources[0]!.shortestHops).toBe(19999)
    expect(report.paths).toEqual([])
  })

  it('returns the same answer twice for the same input', () => {
    const sensors = SAMPLE.devices.filter((d) => d.type === 'sensor').map((d: Device) => d.id)
    const seats: DeviceId[] = ['ops_workstation_a']
    expect(tracePaths(SAMPLE, sensors, seats)).toEqual(tracePaths(SAMPLE, sensors, seats))
  })

  it('does not care what order the caller lists the sources in', () => {
    const a = tracePaths(SAMPLE, ['sensor_net_radar', 'adsb_receiver'], ['ops_workstation_a'])
    const b = tracePaths(SAMPLE, ['adsb_receiver', 'sensor_net_radar'], ['ops_workstation_a'])
    expect(a).toEqual(b)
  })
})
