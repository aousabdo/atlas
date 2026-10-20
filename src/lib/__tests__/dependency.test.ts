import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type {
  CoverageMatrix, CoverageSite, Device, DeviceEdge, LinkSet, Mapping, System, Topology,
} from '../../types/atlas'
import { isReviewedSite, matrixIdSet } from '../coverage'
import {
  defaultRootChoice,
  resolveRoots,
  rootChoices,
  rootSensitivity,
  searchRootIds,
  siteDependencies,
  structuralRings,
  topologyWithout,
  type DependencyInput,
  type RootChoice,
} from '../dependency'
import { wiringAtSite } from '../wiring'

// ---------------------------------------------------------------------------
// The committed sample, read where the unit suite reads everything.
// ---------------------------------------------------------------------------
const FIXTURES = join(process.cwd(), 'fixtures', 'synthetic')
const read = <T,>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T
const SYSTEMS = read<System[]>('systems.json')
const LINKS = read<LinkSet>('links.json')
const COVERAGE = read<CoverageMatrix>('coverage.json')
const NORTHGATE = read<Topology>('sites/northgate.json')
const WESTFIELD = read<Topology>('sites/westfield.json')

const SAMPLE: DependencyInput = {
  topology: NORTHGATE,
  site: COVERAGE.sites.northgate,
  systems: SYSTEMS,
  links: LINKS.current,
}
const DECLARED: RootChoice = { source: 'declared' }
const sampleDeps = (choice: RootChoice = DECLARED) =>
  siteDependencies(SAMPLE, resolveRoots(NORTHGATE, COVERAGE.sites.northgate, choice))

const strandedIds = (deps: ReturnType<typeof sampleDeps>, id: string) =>
  deps.byDevice.get(id)!.systems.filter((s) => s.kind === 'stranded').map((s) => s.systemId)

// ---------------------------------------------------------------------------
// Small hand-built yards, in the style of wiring.test.ts.
// ---------------------------------------------------------------------------
function device(id: string, type = 'switch'): Device {
  return { id, label: id.toUpperCase(), zone: 'yard', type, ip: null, subnet: null, description: null }
}
function edge(source: string, target: string, link_type = 'ethernet'): DeviceEdge {
  return { source, target, link_type, label: null }
}
function topology(devices: Device[], edges: DeviceEdge[]): Topology {
  return {
    site_id: 'yard',
    meta: {
      label: 'Yard', name: 'yard', description: '', classification: 'UNCLASSIFIED//SAMPLE',
      version: '1', updated: '2026-01-01', device_count: devices.length, edge_count: edges.length,
    },
    zones: { yard: { label: 'Yard' } },
    devices,
    edges,
  }
}
const mapping = (devices: string[]): Mapping => ({ devices, note: '', confidence: 'high' })
function yardSite(mappings: Record<string, Mapping>, roots?: CoverageSite['decision_roots']): CoverageSite {
  return {
    label: 'Yard', scope: '', mappings, not_deployed_at_site: {},
    unclaimed_devices: { infrastructure: [] },
    ...(roots ? { decision_roots: roots } : {}),
  }
}
function system(id: string, risk: System['risk'] = 'low'): System {
  return {
    id, name: id.toUpperCase(), label: id, category: 'Deployed asset record', owner_group_id: 'og',
    owner_group: 'OG', color_key: 'a', confirmed: true, risk, risk_source: 'explicit', detail: '',
    integrations_prose: '',
  }
}

/**
 * desk (decision position) - sw - hub - cam (effector, high risk)
 *                            \- ap - handheld (decision position)
 */
const YARD = topology(
  [device('desk', 'endpoint'), device('sw'), device('hub'), device('cam', 'sensor'),
    device('ap', 'access_point'), device('handheld', 'endpoint')],
  [edge('desk', 'sw'), edge('sw', 'hub'), edge('hub', 'cam'), edge('sw', 'ap'), edge('ap', 'handheld')],
)
const YARD_SITE = yardSite(
  { eff: mapping(['cam']), fusion: mapping(['desk']) },
  { devices: ['desk', 'handheld'], assumed: ['handheld'], note: 'Test curation.' },
)
const YARD_INPUT: DependencyInput = {
  topology: YARD, site: YARD_SITE, systems: [system('eff', 'high'), system('fusion')], links: [],
}

// ---------------------------------------------------------------------------
describe('roots', () => {
  it('resolves the declared decision positions, sorted, with the note and the assumptions', () => {
    const roots = resolveRoots(NORTHGATE, COVERAGE.sites.northgate, DECLARED)
    expect(roots.deviceIds).toEqual([
      'field_client_devices', 'field_house_display', 'mcv_display', 'ops_laptop_cart',
      'ops_video_wall', 'ops_workstation_a', 'ops_workstation_b',
    ])
    expect(roots.assumedIds).toEqual(['field_client_devices', 'field_house_display', 'mcv_display'])
    expect(roots.note).toMatch(/Sample curation/)
    expect(roots.usable).toBe(true)
    expect(roots.key).toBe('@declared')
  })

  it('names a declared position the drawing lacks instead of dropping it', () => {
    const roots = resolveRoots(YARD, yardSite({}, { devices: ['desk', 'ghost'], note: 'x' }), DECLARED)
    expect(roots.deviceIds).toEqual(['desk'])
    expect(roots.unknownIds).toEqual(['ghost'])
    const none = resolveRoots(YARD, yardSite({}, { devices: ['ghost'], note: 'x' }), DECLARED)
    expect(none.usable).toBe(false)
  })

  it('never seeds a search from a position joined only by VLAN', () => {
    const vlan = topology([device('a'), device('b')], [edge('a', 'b', 'vlan')])
    const roots = resolveRoots(vlan, yardSite({}, { devices: ['a'], note: 'x' }), DECLARED)
    expect(roots.logicalOnlyIds).toEqual(['a'])
    expect(roots.usable).toBe(false)
  })

  it('defaults to the declared positions, and to the entry points where none are declared', () => {
    expect(defaultRootChoice(COVERAGE.sites.northgate)).toEqual({ source: 'declared' })
    expect(defaultRootChoice(COVERAGE.sites.westfield)).toEqual({ source: 'derived' })
    expect(resolveRoots(NORTHGATE, COVERAGE.sites.northgate, { source: 'derived' }).deviceIds)
      .toEqual(['internet'])
  })

  it('drops exactly the assumed positions for the comparison set', () => {
    const roots = resolveRoots(NORTHGATE, COVERAGE.sites.northgate, { source: 'declared-without-assumed' })
    expect(roots.deviceIds).toEqual(['ops_laptop_cart', 'ops_video_wall', 'ops_workstation_a', 'ops_workstation_b'])
    expect(roots.key).toBe('@declared-without-assumed')
  })

  it('offers the declared choices only where a site declares positions', () => {
    const keys = (site: CoverageSite | undefined, topo: Topology) => rootChoices(topo, site).map((c) => c.key)
    expect(keys(COVERAGE.sites.northgate, NORTHGATE).slice(0, 3)).toEqual(['@declared', '@declared-without-assumed', ''])
    expect(keys(COVERAGE.sites.westfield, WESTFIELD)).not.toContain('@declared')
    expect(keys(COVERAGE.sites.northgate, NORTHGATE)).toContain('endpoint')
  })
})

describe('what a device strands', () => {
  it('strands a system whose every device loses its path, and rings it in that risk', () => {
    const deps = siteDependencies(YARD_INPUT, resolveRoots(YARD, YARD_SITE, DECLARED))
    const hub = deps.byDevice.get('hub')!
    expect(hub.systems).toEqual([{
      kind: 'stranded', systemId: 'eff', lostDeviceIds: ['cam'], alsoRunsHere: false, alreadyCutOffIds: [], vlanOnlyIds: [],
    }])
    expect(hub.structural).toEqual({ risk: 'high', systemIds: ['eff'] })
  })

  it('calls a system on its only device "runs only here", with no ring', () => {
    const deps = siteDependencies(YARD_INPUT, resolveRoots(YARD, YARD_SITE, DECLARED))
    expect(deps.byDevice.get('cam')!.systems).toEqual([{ kind: 'runs-only-here', systemId: 'eff' }])
    expect(deps.byDevice.get('cam')!.structural).toBeNull()
  })

  it('never strands a system that runs on a decision position', () => {
    const deps = siteDependencies(YARD_INPUT, resolveRoots(YARD, YARD_SITE, DECLARED))
    expect(deps.byDevice.get('sw')!.systems.map((s) => s.systemId)).toEqual(['eff'])
    expect(deps.standings.find((s) => s.systemId === 'fusion')!.onRootIds).toEqual(['desk'])
  })

  it('names a decision position cut off from every system, a root always reaching itself', () => {
    const deps = siteDependencies(YARD_INPUT, resolveRoots(YARD, YARD_SITE, DECLARED))
    expect(deps.byDevice.get('ap')!.positionsCutOff).toEqual(['handheld'])
    expect(deps.byDevice.get('ap')!.systems).toEqual([])
  })

  it('never reads a VLAN as a way round', () => {
    const vlanned = { ...YARD, edges: [...YARD.edges, edge('desk', 'cam', 'vlan')] }
    const deps = siteDependencies({ ...YARD_INPUT, topology: vlanned }, resolveRoots(vlanned, YARD_SITE, DECLARED))
    expect(strandedIds(deps as never, 'hub')).toEqual(['eff'])
  })

  it('gives no verdict on systems when the device is the only root', () => {
    const lone = yardSite(YARD_SITE.mappings, { devices: ['desk'], note: 'x' })
    const deps = siteDependencies({ ...YARD_INPUT, site: lone }, resolveRoots(YARD, lone, DECLARED))
    const desk = deps.byDevice.get('desk')!
    expect(desk.notAssessed).toBe('only-root')
    expect(desk.systems).toEqual([])
    expect(desk.structural).toBeNull()
  })

  it('says nothing for a site nobody has reviewed', () => {
    const deps = siteDependencies(
      { topology: WESTFIELD, site: COVERAGE.sites.westfield, systems: SYSTEMS, links: LINKS.current },
      resolveRoots(WESTFIELD, COVERAGE.sites.westfield, { source: 'derived' }),
    )
    expect(deps.review).toBe('not-reviewed')
    expect(deps.byDevice.size).toBe(0)
    expect(deps.triage.status).toBe('not-reviewed')
  })
})

describe('fail closed: never call something safe that was not measured', () => {
  it('treats a declared position with no link at all as seeding nothing', () => {
    const lonely = topology([...YARD.devices, device('booth', 'endpoint')], YARD.edges)
    const site = yardSite(YARD_SITE.mappings, { devices: ['booth'], note: 'x' })
    const roots = resolveRoots(lonely, site, DECLARED)
    expect(roots.isolatedIds).toEqual(['booth'])
    expect(roots.usable).toBe(false)
    const deps = siteDependencies({ ...YARD_INPUT, topology: lonely, site }, roots)
    expect(deps.triage.status).toBe('no-roots')
    expect(deps.byDevice.get('sw')!.notAssessed).toBe('no-roots')
  })

  it('does not let a root with no link at all count itself as reached beside usable ones', () => {
    // desk is usable; booth has no link of any kind. booth must not seed
    // itself, so removing it is not a measured "nothing loses its path".
    const lonely = topology([...YARD.devices, device('booth', 'endpoint')], YARD.edges)
    const site = yardSite(YARD_SITE.mappings, { devices: ['booth', 'desk'], note: 'x' })
    const roots = resolveRoots(lonely, site, DECLARED)
    expect(roots.usable).toBe(true)
    expect(searchRootIds(roots)).toEqual(['desk'])
    const deps = siteDependencies({ ...YARD_INPUT, topology: lonely, site }, roots)
    const booth = deps.byDevice.get('booth')!
    expect(booth.blast!.removedWasReachable).toBe(false)
    expect(booth.notAssessed).toBe('not-reached')
    expect(deps.triage.groups['not-assessed']).toContain('booth')
    expect(deps.triage.groups['one-link']).not.toContain('booth')
  })

  it('names the devices of a stranded system that never had a path apart from the ones that lose it', () => {
    // eff runs on cam (behind hub), farcam (a piece no root reaches) and vcam (VLAN only).
    const mixed = topology(
      [...YARD.devices, device('far'), device('farcam', 'sensor'), device('vcam', 'sensor')],
      [...YARD.edges, edge('far', 'farcam'), edge('vcam', 'sw', 'vlan')],
    )
    const site = yardSite({ ...YARD_SITE.mappings, eff: mapping(['cam', 'farcam', 'vcam']) }, YARD_SITE.decision_roots)
    const deps = siteDependencies({ ...YARD_INPUT, topology: mixed, site }, resolveRoots(mixed, site, DECLARED))
    expect(deps.byDevice.get('hub')!.systems).toEqual([{
      kind: 'stranded', systemId: 'eff', lostDeviceIds: ['cam'], alsoRunsHere: false,
      alreadyCutOffIds: ['farcam'], vlanOnlyIds: ['vcam'],
    }])
  })

  it('counts a device listed twice in the drawing once', () => {
    const doubled = topology([...YARD.devices, device('sw')], YARD.edges)
    const deps = siteDependencies({ ...YARD_INPUT, topology: doubled }, resolveRoots(doubled, YARD_SITE, DECLARED))
    expect(deps.triage.population.filter((id) => id === 'sw')).toEqual(['sw'])
    expect(Object.values(deps.triage.groups).flat().filter((id) => id === 'sw')).toEqual(['sw'])
  })

  it('does not assess a device no root reaches to begin with', () => {
    // A piece of the drawing with no root in it: the rail yard.
    const pieces = topology(
      [...YARD.devices, device('rail_sw'), device('rail_cam', 'sensor')],
      [...YARD.edges, edge('rail_sw', 'rail_cam')],
    )
    const deps = siteDependencies({ ...YARD_INPUT, topology: pieces }, resolveRoots(pieces, YARD_SITE, DECLARED))
    expect(deps.byDevice.get('rail_sw')!.notAssessed).toBe('not-reached')
    expect(deps.triage.groups['not-assessed']).toEqual(['rail_cam', 'rail_sw'].sort())
    expect(deps.triage.groups['nothing-loses-path']).not.toContain('rail_sw')
  })

  it('still files a device that breaks an integration as load-bearing, whatever the roots', () => {
    // The only root also carries the only path between two systems.
    const line = topology(
      [device('a1'), device('hub', 'endpoint'), device('b1')],
      [edge('a1', 'hub'), edge('hub', 'b1')],
    )
    const site = yardSite({ a: mapping(['a1']), b: mapping(['b1']) }, { devices: ['hub'], note: 'x' })
    const deps = siteDependencies(
      { topology: line, site, systems: [system('a'), system('b')], links: [{ from: 'a', to: 'b', label: '', extraction_method: 'override' }] },
      resolveRoots(line, site, DECLARED),
    )
    const hub = deps.byDevice.get('hub')!
    expect(hub.notAssessed).toBe('only-root')
    expect(hub.integrations.map((i) => i.kind)).toEqual(['breaks'])
    expect(deps.triage.groups['load-bearing']).toEqual(['hub'])
  })

  it('counts only roots with a cable or radio link as one a system runs on', () => {
    const vlanned = topology(
      [device('desk', 'endpoint'), device('sw'), device('cam', 'sensor')],
      [edge('desk', 'sw', 'vlan'), edge('sw', 'cam')],
    )
    const site = yardSite({ eff: mapping(['cam', 'desk']) }, { devices: ['desk', 'sw'], note: 'x' })
    const deps = siteDependencies({ topology: vlanned, site, systems: [system('eff')], links: [] }, resolveRoots(vlanned, site, DECLARED))
    expect(deps.standings[0]!.onRootIds).toEqual([])
  })

  it('names a system that reaches no root, and one on VLAN links only, without charging any device', () => {
    const t = topology(
      [device('desk', 'endpoint'), device('sw'), device('far'), device('farcam', 'sensor'), device('v1'), device('v2')],
      [edge('desk', 'sw'), edge('far', 'farcam'), edge('v1', 'v2', 'vlan')],
    )
    const site = yardSite({ lost: mapping(['farcam']), ghost: mapping(['v1']) }, { devices: ['desk'], note: 'x' })
    const deps = siteDependencies({ topology: t, site, systems: [system('lost'), system('ghost')], links: [] }, resolveRoots(t, site, DECLARED))
    expect(deps.standings.map((s) => [s.systemId, s.status])).toEqual([['ghost', 'vlan-only'], ['lost', 'never-reaches']])
    expect([...deps.byDevice.values()].flatMap((d) => d.systems)).toEqual([])
  })
})

describe('the comparison without the assumed positions', () => {
  it('is not applicable without assumptions, or from roots that are not declared', () => {
    const none = yardSite(YARD_SITE.mappings, { devices: ['desk'], note: 'x' })
    const deps = siteDependencies({ ...YARD_INPUT, site: none }, resolveRoots(YARD, none, DECLARED))
    expect(rootSensitivity({ ...YARD_INPUT, site: none }, deps).status).toBe('not-applicable')
    const derived = siteDependencies(YARD_INPUT, resolveRoots(YARD, YARD_SITE, { source: 'derived' }))
    expect(rootSensitivity(YARD_INPUT, derived).status).toBe('not-applicable')
  })

  it('says every position is assumed only when that is so', () => {
    const all = yardSite(YARD_SITE.mappings, { devices: ['desk'], assumed: ['desk'], note: 'x' })
    const deps = siteDependencies({ ...YARD_INPUT, site: all }, resolveRoots(YARD, all, DECLARED))
    expect(rootSensitivity({ ...YARD_INPUT, site: all }, deps).status).toBe('no-roots-left')
    // The one left is joined only by VLAN: a different reason, named as such.
    const vlanned = topology([...YARD.devices, device('booth', 'endpoint')], [...YARD.edges, edge('booth', 'sw', 'vlan')])
    const site = yardSite(YARD_SITE.mappings, { devices: ['desk', 'booth'], assumed: ['desk'], note: 'x' })
    const input = { ...YARD_INPUT, topology: vlanned, site }
    const result = rootSensitivity(input, siteDependencies(input, resolveRoots(vlanned, site, DECLARED)))
    expect(result).toMatchObject({ status: 'alternative-unusable', unusableIds: ['booth'] })
  })

  it('counts a move into "not assessed" as a change, with its reason', () => {
    // Without the assumed handheld, the desk is the only root.
    const deps = siteDependencies(YARD_INPUT, resolveRoots(YARD, YARD_SITE, DECLARED))
    const result = rootSensitivity(YARD_INPUT, deps)
    expect(result.status).toBe('compared')
    if (result.status !== 'compared') return
    expect(result.changes.find((c) => c.deviceId === 'desk')?.without.notAssessed).toBe('only-root')
  })
})

describe('integrations on a shared device', () => {
  const shared = topology(
    [device('a1'), device('s1'), device('s2'), device('b1'), device('sw')],
    [edge('a1', 'sw'), edge('b1', 'sw'), edge('s1', 'sw'), edge('s2', 'sw')],
  )
  const link = { from: 'a', to: 'b', label: '', extraction_method: 'override' as const }
  const run = (aDevices: string[], bDevices: string[]) => {
    const site = yardSite({ a: mapping(aDevices), b: mapping(bDevices) }, { devices: ['sw'], note: 'x' })
    return siteDependencies({ topology: shared, site, systems: [system('a'), system('b')], links: [link] }, resolveRoots(shared, site, DECLARED))
  }

  it('survives losing one shared device when another remains', () => {
    expect(run(['s1', 's2'], ['s1', 's2']).byDevice.get('s1')!.integrations).toEqual([])
  })

  it('breaks when the last shared device goes and no other path is left', () => {
    const deps = run(['s1', 'a1'], ['s1', 'b1'])
    expect(deps.byDevice.get('s1')!.integrations).toEqual([])
    const isolated = topology([device('a1'), device('s1'), device('b1')], [edge('a1', 's1'), edge('s1', 'b1')])
    const site = yardSite({ a: mapping(['s1', 'a1']), b: mapping(['s1', 'b1']) }, { devices: ['a1'], note: 'x' })
    const d = siteDependencies({ topology: isolated, site, systems: [system('a'), system('b')], links: [link] }, resolveRoots(isolated, site, DECLARED))
    expect(d.byDevice.get('s1')!.integrations.map((i) => i.kind)).toEqual(['breaks'])
  })
})

describe('the sample, from the declared decision positions', () => {
  const deps = sampleDeps()

  it('finds the unclaimed switch that is the only way to the high-risk effector', () => {
    const d = deps.byDevice.get('field_house_switch')!
    expect(strandedIds(deps, 'field_house_switch')).toEqual(['bastion'])
    expect(d.structural).toEqual({ risk: 'high', systemIds: ['bastion'] })
    expect(d.positionsCutOff).toEqual(['field_house_display'])
    expect(d.blast!.unreachableCount).toBe(2)
  })

  it('finds that Core Switch breaks every wired integration', () => {
    const d = deps.byDevice.get('core_switch')!
    expect(strandedIds(deps, 'core_switch')).toEqual(['recon', 'tagpoint'])
    expect(d.integrations.filter((i) => i.kind === 'breaks')).toHaveLength(3)
    expect(d.integrations.filter((i) => i.endsKeepRoots).map((i) => `${i.link.from}-${i.link.to}`))
      .toEqual(['jetty-eventrel'])
    expect(d.blast!.unreachableCount).toBe(17)
  })

  it('names a partial loss with both lists, and never counts it as stranded', () => {
    const d = deps.byDevice.get('core_router')!
    expect(strandedIds(deps, 'core_router')).toEqual(['crosslink', 'eventrel'])
    expect(d.systems.find((s) => s.kind === 'partial')).toEqual({
      kind: 'partial', systemId: 'ucop', lostDeviceIds: ['cop_application', 'gov_cloud'],
      keptDeviceIds: ['mcv_display'], alsoRunsHere: false, deviceCount: 3,
    })
  })

  it('keeps a system that also runs on the device out of its ring', () => {
    const d = deps.byDevice.get('gov_cloud')!
    expect(d.systems.filter((s) => s.kind === 'stranded'))
      .toEqual([
        expect.objectContaining({ systemId: 'crosslink', alsoRunsHere: true }),
        expect.objectContaining({ systemId: 'eventrel', alsoRunsHere: false }),
      ])
    expect(d.structural).toEqual({ risk: 'medium', systemIds: ['eventrel'] })
  })

  it('cuts all four operations positions off when the operations switch goes', () => {
    const d = deps.byDevice.get('ops_net_switch')!
    expect(d.positionsCutOff).toEqual(['ops_laptop_cart', 'ops_video_wall', 'ops_workstation_a', 'ops_workstation_b'])
    expect(d.integrations.filter((i) => i.kind === 'breaks')).toHaveLength(2)
  })

  it('says a system loses an end when its only device goes', () => {
    const d = deps.byDevice.get('ops_tak_server')!
    expect(d.integrations.map((i) => i.kind)).toEqual(['loses-end', 'loses-end'])
    expect(d.systems).toContainEqual({ kind: 'runs-only-here', systemId: 'jetty' })
  })

  it('sorts the 52 unclaimed devices into five groups that cover them once', () => {
    const { triage } = deps
    expect(triage.status).toBe('measured')
    expect(triage.population).toHaveLength(52)
    expect(triage.listedUnclaimedIds).toHaveLength(51)
    expect(triage.notListed).toEqual([{ deviceId: 'field_client_devices', namedBy: ['atak'] }])
    expect(triage.groups['load-bearing']).toEqual([
      'core_edge_switch', 'core_router', 'core_switch', 'guest_net_ap', 'field_house_switch',
      'guest_net_switch', 'ops_net_switch', 'radio_net_switch', 'secure_backbone',
      'sensor_net_firewall', 'sensor_net_switch',
    ].sort((a, b) => label(a).localeCompare(label(b))))
    expect(triage.groups['cuts-devices-off'].map(label)).toEqual([
      'Annex Access Switch', 'Annex PoE Switch', 'Core Aggregation Switch', 'Management Switch',
      'North Stand Access Switch', 'North Stand PoE Injector', 'South Stand Access Switch',
      'South Stand PoE Injector',
    ])
    expect(triage.groups['nothing-loses-path']).toHaveLength(18)
    expect(triage.groups['one-link']).toHaveLength(15)
    expect(triage.groups['not-assessed']).toEqual([])
    const all = Object.values(triage.groups).flat()
    expect(new Set(all).size).toBe(52)
  })

  it('rings nine unclaimed or shared devices, one of them high', () => {
    const rings = structuralRings(deps)
    expect(rings.size).toBe(9)
    expect([...rings].filter(([, r]) => r.risk === 'high').map(([id]) => id)).toEqual(['field_house_switch'])
  })

  it('names every verdict that rests on the three assumed positions', () => {
    const sensitivity = rootSensitivity(SAMPLE, deps)
    expect(sensitivity.status).toBe('compared')
    if (sensitivity.status !== 'compared') return
    expect(sensitivity.changes.map((c) => c.deviceId).sort()).toEqual([
      'core_agg_switch', 'core_edge_switch', 'core_switch', 'field_house_switch', 'guest_net_ap',
      'guest_net_switch', 'mcv_router', 'mcv_switch', 'ops_net_switch',
    ])
    // Its systems stay the same; the position it cuts off is an assumed one.
    const fh = sensitivity.changes.find((c) => c.deviceId === 'field_house_switch')!
    expect(fh.shown.stranded).toEqual(fh.without.stranded)
    expect(fh.shown.positionsCutOff).toEqual(['field_house_display'])
    expect(fh.without.positionsCutOff).toEqual([])
    expect(sensitivity.rings).toEqual({ shown: { total: 9, high: 1 }, without: { total: 10, high: 4 } })
  })
})

describe('the sample, from other roots', () => {
  it('does not assess the only entry point, and draws no rings from derived roots', () => {
    const deps = sampleDeps({ source: 'derived' })
    expect(deps.byDevice.get('internet')!.notAssessed).toBe('only-root')
    expect(deps.triage.groups['load-bearing']).toContain('core_agg_switch')
    expect(deps.triage.groups['load-bearing']).toHaveLength(9)
    expect(structuralRings(deps).size).toBe(0)
  })

  it('agrees with the declared roots on systems from any endpoint, but not on device counts', () => {
    const deps = sampleDeps({ source: 'type', deviceType: 'endpoint' })
    expect(strandedIds(deps, 'core_switch')).toEqual(['recon', 'tagpoint'])
    expect(deps.byDevice.get('core_switch')!.blast!.unreachableCount).toBe(9)
    expect(deps.triage.groups['load-bearing']).toContain('annex_switch')
  })

  it('breaks the same integrations whatever the roots', () => {
    const breaks = (choice: RootChoice) =>
      [...sampleDeps(choice).byDevice.values()].map((d) => d.integrations.map((i) => `${i.index}:${i.kind}`))
    expect(breaks({ source: 'derived' })).toEqual(breaks(DECLARED))
  })
})

describe('invariants', () => {
  it('breaks a wired integration exactly when the device is one of its cut devices', () => {
    const ids = matrixIdSet(SYSTEMS)
    const before = wiringAtSite(LINKS.current, COVERAGE.sites.northgate, NORTHGATE, ids)
    const deps = sampleDeps()
    const own = new Set(Object.values(COVERAGE.sites.northgate.mappings).flatMap((m) => m.devices))
    for (const row of before) {
      if (row.verdict.kind !== 'wired') continue
      for (const d of NORTHGATE.devices) {
        if (own.has(d.id)) continue
        const breaks = deps.byDevice.get(d.id)!.integrations.some((i) => i.index === row.index && i.kind === 'breaks')
        expect(breaks, `${d.id} on ${row.link.from}-${row.link.to}`).toBe(row.verdict.cutDeviceIds.includes(d.id))
      }
    }
  })

  it('reports the same blast radius the resilience panel does', () => {
    const deps = sampleDeps()
    const d = deps.byDevice.get('core_switch')!
    expect(d.blast!.rootIds).toEqual(deps.roots.deviceIds)
  })

  it('removes a device and every link touching it', () => {
    const without = topologyWithout(YARD, 'sw')
    expect(without.devices.map((d) => d.id)).not.toContain('sw')
    expect(without.edges.some((e) => e.source === 'sw' || e.target === 'sw')).toBe(false)
  })

  it('gives the same answer whatever order the drawing lists things in', () => {
    const shuffled: Topology = {
      ...NORTHGATE,
      devices: [...NORTHGATE.devices].reverse(),
      edges: [...NORTHGATE.edges].reverse(),
    }
    const a = sampleDeps()
    const b = siteDependencies({ ...SAMPLE, topology: shuffled },
      resolveRoots(shuffled, COVERAGE.sites.northgate, DECLARED))
    expect(b.triage).toEqual(a.triage)
    expect([...structuralRings(b)].sort()).toEqual([...structuralRings(a)].sort())
  })
})

describe('isReviewedSite', () => {
  it('counts a site reviewed when it records a system as present or checked absent', () => {
    expect(isReviewedSite(COVERAGE.sites.northgate)).toBe(true)
    expect(isReviewedSite(COVERAGE.sites.westfield)).toBe(false)
    expect(isReviewedSite(undefined)).toBe(false)
    expect(isReviewedSite(yardSite({}))).toBe(false)
    expect(isReviewedSite({ ...yardSite({}), not_deployed_at_site: { x: 'checked' } })).toBe(true)
  })
})

function label(id: string): string {
  return NORTHGATE.devices.find((d) => d.id === id)!.label
}
