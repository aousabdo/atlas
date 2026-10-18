import { describe, expect, it } from 'vitest'

import type { CoverageSite, Device, DeviceEdge, Link, Mapping, Topology } from '../../types/atlas'
import { wiringAtSite } from '../wiring'

function device(id: string): Device {
  return { id, label: id.toUpperCase(), zone: 'yard', type: 'switch', ip: null, subnet: null, description: null }
}
function edge(source: string, target: string, link_type = 'ethernet'): DeviceEdge {
  return { source, target, link_type, label: null }
}
function topology(ids: string[], edges: DeviceEdge[]): Topology {
  return {
    site_id: 'yard',
    meta: {
      label: 'Yard', name: 'yard', description: '', classification: 'UNCLASSIFIED//SAMPLE',
      version: '1', updated: '2026-01-01', device_count: ids.length, edge_count: edges.length,
    },
    zones: { yard: { label: 'Yard' } },
    devices: ids.map(device),
    edges,
  }
}
function mapping(devices: string[]): Mapping {
  return { devices, note: '', confidence: 'high' }
}
function site(mappings: Record<string, Mapping>, absent: Record<string, string> = {}): CoverageSite {
  return { label: 'Yard', scope: '', mappings, not_deployed_at_site: absent, unclaimed_devices: { infrastructure: [] } }
}
const link = (from: string, to: string): Link => ({ from, to, label: `${from} > ${to}`, extraction_method: 'override' })

/**
 * a1 - sw1 - sw2 - b1, with c1 off sw1. d runs on c1 too. v1 hangs off sw1
 * by VLAN only. x1 has no link at all.
 */
const YARD = topology(
  ['a1', 'sw1', 'sw2', 'b1', 'c1', 'v1', 'x1'],
  [edge('a1', 'sw1'), edge('sw1', 'sw2'), edge('sw2', 'b1'), edge('sw1', 'c1'), edge('v1', 'sw1', 'vlan')],
)
const MAPPED = site(
  {
    a: mapping(['a1']), b: mapping(['b1']), c: mapping(['c1']), d: mapping(['c1']),
    v: mapping(['v1']), x: mapping(['x1']), s: mapping([]),
  },
  { z: 'checked, absent' },
)
const IDS = new Set(['a', 'b', 'c', 'd', 'v', 'x', 's', 'n', 'z'])
const verdictOf = (from: string, to: string, at = MAPPED, topo = YARD) =>
  wiringAtSite([link(from, to)], at, topo, IDS)[0]!.verdict

describe('wiringAtSite', () => {
  it('finds a cable path and names every device whose loss breaks it', () => {
    expect(verdictOf('a', 'b')).toEqual({
      kind: 'wired', path: ['a1', 'sw1', 'sw2', 'b1'], hops: 3, cutDeviceIds: ['sw1', 'sw2'],
    })
  })

  it('reports no single device to lose when there is a second way round', () => {
    const ring = topology(['a1', 'sw1', 'sw2', 'b1'], [
      edge('a1', 'sw1'), edge('a1', 'sw2'), edge('sw1', 'b1'), edge('sw2', 'b1'),
    ])
    const verdict = verdictOf('a', 'b', site({ a: mapping(['a1']), b: mapping(['b1']) }), ring)
    expect(verdict).toMatchObject({ kind: 'wired', hops: 2, cutDeviceIds: [] })
  })

  it('says two systems on one device share it rather than tracing a path', () => {
    expect(verdictOf('c', 'd')).toEqual({ kind: 'co-hosted', sharedDeviceIds: ['c1'] })
  })

  it('never reads a VLAN as a cable path', () => {
    expect(verdictOf('a', 'v')).toMatchObject({ kind: 'logical-only', path: ['a1', 'sw1', 'v1'] })
  })

  it('says so when no path of any kind is drawn', () => {
    expect(verdictOf('a', 'x')).toEqual({ kind: 'no-path' })
  })

  it('cannot check an integration with an end that has no hardware here, and says why', () => {
    expect(verdictOf('a', 's')).toEqual({
      kind: 'unchecked', reasons: [{ systemId: 's', reason: 'software-only' }],
    })
    expect(verdictOf('n', 'a')).toEqual({
      kind: 'unchecked', reasons: [{ systemId: 'n', reason: 'no-record' }],
    })
    expect(verdictOf('z', 's')).toEqual({
      kind: 'unchecked',
      reasons: [{ systemId: 'z', reason: 'checked-absent' }, { systemId: 's', reason: 'software-only' }],
    })
  })

  it('ignores a mapped device the drawing does not have', () => {
    const verdict = verdictOf('a', 'b', site({ a: mapping(['a1', 'ghost']), b: mapping(['ghost']) }))
    expect(verdict).toEqual({
      kind: 'unchecked', reasons: [{ systemId: 'b', reason: 'not-in-drawing' }],
    })
  })
})
