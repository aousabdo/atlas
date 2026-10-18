import { describe, expect, it } from 'vitest'

import type {
  CoverageMatrix, Device, Link, Mapping, Requirement, System, Topology,
} from '../../types/atlas'
import { plannedIntegrations } from '../planning'

function system(id: string, over: Partial<System> = {}): System {
  return {
    id, name: id.toUpperCase(), label: id.toUpperCase(), category: 'Deployed asset record',
    owner_group_id: 'og1', owner_group: 'Owner One', color_key: 'a', confirmed: true,
    risk: 'low', risk_source: 'explicit', detail: '', integrations_prose: '', ...over,
  }
}
const link = (from: string, to: string): Link => ({ from, to, label: `${from} > ${to}`, extraction_method: 'override' })
const req = (orig: string, current: string[]): Requirement => ({ orig, sys: 'OLD', current, status: 'Split out' })
const mapping = (devices: string[]): Mapping => ({ devices, note: '', confidence: 'high' })
const device = (id: string): Device => ({ id, label: id, zone: 'z', type: 'switch', ip: null, subnet: null, description: null })

const SYSTEMS = [
  system('a', { risk: 'high' }),
  system('b', { confirmed: false, owner_group_id: 'og2', owner_group: 'Owner Two' }),
  system('c', { risk: 'medium' }),
  system('d'),
  system('e'),
]
const LINKS = {
  current: [link('a', 'c'), link('c', 'e')],
  desired: [link('a', 'b'), link('c', 'd'), link('a', 'e')],
}
const REQUIREMENTS = [req('Joint picture', ['A', 'B']), req('Shared tracks', ['C']), req('Dropped', [])]
const COVERAGE: CoverageMatrix = {
  default_site: 'yard',
  sites: {
    yard: {
      label: 'Yard', scope: '', mappings: { a: mapping(['a1']), b: mapping(['b1']), e: mapping(['e1']) },
      not_deployed_at_site: { c: 'checked, absent' }, unclaimed_devices: { infrastructure: [] },
    },
    moor: {
      label: 'Moor', scope: '', mappings: {}, not_deployed_at_site: {},
      unclaimed_devices: { infrastructure: [] },
    },
  },
  pending_review: {},
  confidence_counts: {},
}
const YARD: Topology = {
  site_id: 'yard',
  meta: { label: 'Yard', name: 'yard', description: '', classification: 'UNCLASSIFIED//SAMPLE', version: '1', updated: '2026-01-01', device_count: 3, edge_count: 1 },
  zones: { z: { label: 'Z' } },
  devices: ['a1', 'b1', 'e1'].map(device),
  edges: [{ source: 'a1', target: 'b1', link_type: 'ethernet', label: null }],
}

const rows = () =>
  plannedIntegrations({
    systems: SYSTEMS, links: LINKS, requirements: REQUIREMENTS, coverage: COVERAGE,
    topologies: { yard: YARD },
  })
const row = (from: string, to: string) => rows().find((r) => r.link.from === from && r.link.to === to)!

describe('plannedIntegrations', () => {
  it('lists every planned integration once, in the order the file gives', () => {
    expect(rows().map((r) => `${r.link.from}-${r.link.to}`)).toEqual(['a-b', 'c-d', 'a-e'])
  })

  it('counts confirmed owners and says when it crosses an organisation', () => {
    expect(row('a', 'b')).toMatchObject({ confirmedOwners: 1, crossesOrg: true })
    expect(row('c', 'd')).toMatchObject({ confirmedOwners: 2, crossesOrg: false })
  })

  it('takes the higher risk of the two ends', () => {
    expect(row('a', 'b').risk).toBe('high')
    expect(row('c', 'd').risk).toBe('medium')
  })

  it('separates requirements it would join from requirements it only touches', () => {
    expect(row('a', 'b')).toMatchObject({ requirementsJoined: [0], requirementsTouched: [0] })
    expect(row('c', 'd')).toMatchObject({ requirementsJoined: [], requirementsTouched: [1] })
  })

  it('says whether the two are already reachable through recorded integrations', () => {
    expect(row('a', 'b').hopsToday).toBeNull()
    expect(row('a', 'e').hopsToday).toBe(2)
  })

  it('checks each reviewed site for hardware and a wire, and names an unreviewed one', () => {
    const sites = row('a', 'b').sites
    expect(sites.find((s) => s.siteId === 'yard')).toMatchObject({
      reviewed: true, verdict: { kind: 'wired', hops: 1 },
    })
    expect(sites.find((s) => s.siteId === 'moor')).toMatchObject({ reviewed: false })
    expect(row('c', 'd').sites.find((s) => s.siteId === 'yard')).toMatchObject({
      verdict: { kind: 'unchecked' },
    })
  })

  it('reads a reviewed site without a drawing as not checkable, never as no path', () => {
    const noDrawing = plannedIntegrations({
      systems: SYSTEMS, links: LINKS, requirements: REQUIREMENTS, coverage: COVERAGE, topologies: {},
    })
    expect(noDrawing[0]!.sites.find((s) => s.siteId === 'yard')).toMatchObject({
      reviewed: true, verdict: null,
    })
  })
})

describe('the planning facts stay inside what the bundle shows', () => {
  it('leaves out a planned link that is already recorded as current, and counts it', () => {
    const result = plannedIntegrations({
      systems: SYSTEMS,
      links: { current: [link('a', 'c')], desired: [link('c', 'a'), link('a', 'b')] },
      requirements: [], coverage: COVERAGE, topologies: {},
    })
    expect(result.map((r) => `${r.link.from}-${r.link.to}`)).toEqual(['a-b'])
  })

  it('counts nothing as carried by a requirement that was not kept', () => {
    const [ab] = plannedIntegrations({
      systems: SYSTEMS,
      links: { current: [], desired: [link('a', 'b')] },
      requirements: [{ orig: 'Gone', sys: 'OLD', current: ['A', 'B'], status: "Didn't keep" }],
      coverage: COVERAGE, topologies: {},
    })
    expect(ab!.requirementsTouched).toEqual([])
  })

  it('names the chain of recorded integrations that joins two systems today', () => {
    expect(row('a', 'e').chainToday).toEqual(['a', 'c', 'e'])
    expect(row('a', 'b').chainToday).toBeNull()
  })

  it('gives each row its own place in the file, so a repeated pair stays two rows', () => {
    const result = plannedIntegrations({
      systems: SYSTEMS,
      links: { current: [], desired: [link('a', 'b'), link('a', 'b')] },
      requirements: [], coverage: COVERAGE, topologies: {},
    })
    expect(result.map((r) => r.index)).toEqual([0, 1])
  })

  it('names a site that has a drawing but no device map as not reviewed', () => {
    const lone = { ...YARD, site_id: 'heath', meta: { ...YARD.meta, label: 'Heath' } }
    const [ab] = plannedIntegrations({
      systems: SYSTEMS, links: LINKS, requirements: REQUIREMENTS, coverage: COVERAGE,
      topologies: { yard: YARD, heath: lone },
    })
    expect(ab!.sites.find((s) => s.siteId === 'heath')).toEqual({
      siteId: 'heath', label: 'Heath', reviewed: false,
    })
  })
})

describe('a planned integration with a shortfall row at one end', () => {
  it('names the end that is a gap rather than a system', () => {
    const [only] = plannedIntegrations({
      systems: [...SYSTEMS, system('gap', { category: 'Workflow shortfall' })],
      links: { current: [], desired: [link('gap', 'a')] },
      requirements: [], coverage: COVERAGE, topologies: {},
    })
    expect(only!.shortfallEnds).toEqual(['gap'])
  })
})
