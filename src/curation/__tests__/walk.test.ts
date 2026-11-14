import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { matrixIdSet } from '../../lib/coverage'
import type { CoverageMatrix, CoverageSite, System, Topology } from '../../types/atlas'
import { applyEdits, type Edit } from '../edits'
import { buildChecklist, CHECKLIST_RULE, systemStanding, walkSummary } from '../walk'
import { SAMPLE_WALK } from './sampleWalk'

const SYNTHETIC = join(process.cwd(), 'fixtures', 'synthetic')
const readJson = <T>(...parts: string[]): T =>
  JSON.parse(readFileSync(join(SYNTHETIC, ...parts), 'utf-8')) as T

const coverage = readJson<CoverageMatrix>('coverage.json')
const systems = readJson<System[]>('systems.json')
const westfield = coverage.sites.westfield
const northgate = coverage.sites.northgate
const westfieldTopology = readJson<Topology>('sites', 'westfield.json')
const northgateTopology = readJson<Topology>('sites', 'northgate.json')

const STAMP = { reviewed_by: 'Site lead', reviewed_on: '2026-11-13' }

describe('the site summary', () => {
  it('counts Westfield as not looked at, with every device unrecorded', () => {
    expect(walkSummary(westfield, systems, westfieldTopology)).toEqual({
      fieldable: 30, realized: 0, noHardware: 0, absent: 0, notLookedAt: 30,
      devices: 8, carrying: 0, checked: 0, noRecord: 8,
    })
  })

  it("counts Northgate's systems and devices in disjoint buckets", () => {
    expect(walkSummary(northgate, systems, northgateTopology)).toEqual({
      fieldable: 30, realized: 10, noHardware: 2, absent: 18, notLookedAt: 0,
      devices: 71, carrying: 20, checked: 0, noRecord: 51,
    })
  })

  it('counts a system both mapped and checked absent once, as realized', () => {
    const site: CoverageSite = {
      ...westfield,
      mappings: { beacon: { devices: ['wf_gate_sensor'], note: 'n', confidence: 'high' } },
      not_deployed_at_site: { beacon: 'Not fielded here' },
    }
    expect(systemStanding(site, 'beacon', matrixIdSet(systems))).toMatchObject({ kind: 'realized' })
    expect(walkSummary(site, systems, westfieldTopology)).toMatchObject({
      fieldable: 30, realized: 1, noHardware: 0, absent: 0, notLookedAt: 29,
    })
  })
})

describe('the checklist', () => {
  it('lists every Westfield system to locate, high risk first, and orders its devices by reliance', () => {
    const w = buildChecklist(westfield, systems, westfieldTopology)
    expect(w.locate).toHaveLength(30)
    expect(w.locate.map((r) => r.system.risk).slice(0, 9)).toEqual(Array(9).fill('high'))
    expect(w.locate.map((r) => r.system.risk).slice(-2)).toEqual(['low', 'low'])
    expect(w.zones.map((z) => z.devices.map((d) => d.device.id))).toEqual([
      ['wf_firewall', 'wf_gate_sensor', 'wf_laptop', 'wf_ap', 'wf_server'],
      ['wf_crestline_gw', 'wf_internet', 'wf_northwind_gw'],
    ])
  })

  it('orders Northgate by risk, then evidence, then how much rests on each device', () => {
    const n = buildChecklist(northgate, systems, northgateTopology)
    expect(n.locate.map((r) => [r.system.id, r.record])).toEqual([['kite', 'survey-gap'], ['homing', 'survey-gap']])
    expect(n.zones.map((z) => z.zoneId)).toEqual([
      'ops_net', 'sensor_net', 'radio_net', 'perimeter', 'core', 'mgmt', 'cloud',
      'annex_closet', 'north_stand', 'south_stand', 'field_house', 'wan', 'guest_net',
    ])
    expect(n.zones[0].devices.map((d) => d.device.id)).toEqual([
      'ops_tak_server', 'ops_laptop_cart', 'ops_workstation_a', 'ops_net_switch',
      'ops_video_wall', 'ops_workstation_b',
    ])
    expect(n.zones[1].devices.map((d) => d.device.id)).toEqual([
      'remote_id_receiver', 'sensor_net_radar', 'sensor_net_eoir', 'sensor_net_rf_array',
      'sensor_net_ptz', 'sensor_net_firewall', 'sensor_net_switch',
    ])
    expect(n.zones[4].devices[0]).toMatchObject({ device: { id: 'core_switch' }, reliance: 17 })
    expect(n.settled.devices).toHaveLength(10)
    expect(n.settled.absent).toHaveLength(20)
  })

  it('moves a physically verified device to settled and reorders the zone after the sample walk', () => {
    const walked = applyEdits(coverage, SAMPLE_WALK, systems).sites.westfield
    const after = buildChecklist(walked, systems, westfieldTopology)
    expect(after.zones[0].devices.map((d) => d.device.id)).toEqual(['wf_server', 'wf_laptop', 'wf_firewall', 'wf_ap'])
    expect(after.settled.devices.map((d) => d.device.id)).toEqual(['wf_gate_sensor'])
  })

  it('moves a checked device to settled.checked and out of its zone', () => {
    const check: Edit = { kind: 'check', site: 'westfield', device: 'wf_northwind_gw', check: STAMP }
    const walked = applyEdits(coverage, [check], systems).sites.westfield
    const after = buildChecklist(walked, systems, westfieldTopology)
    expect(after.settled.checked.map((d) => [d.device.id, d.check])).toEqual([['wf_northwind_gw', STAMP]])
    expect(after.zones.map((z) => z.devices.map((d) => d.device.id))).toEqual([
      ['wf_firewall', 'wf_gate_sensor', 'wf_laptop', 'wf_ap', 'wf_server'],
      ['wf_crestline_gw', 'wf_internet'],
    ])
    expect(walkSummary(walked, systems, westfieldTopology)).toMatchObject({ checked: 1, noRecord: 7 })
  })

  it('takes a reviewed no-hardware system off the locate list and into settled', () => {
    const reviewed: Edit[] = [
      { kind: 'review', site: 'northgate', system: 'kite', review: { status: 'no-hardware', confidence: 'medium', note: 'Hosted off site', ...STAMP } },
      { kind: 'review', site: 'northgate', system: 'scan', review: { status: 'absent', reason: 'No scan lane here', ...STAMP } },
    ]
    const walked = applyEdits(coverage, reviewed, systems).sites.northgate
    const matrixIds = matrixIdSet(systems)
    expect(systemStanding(walked, 'kite', matrixIds)).toMatchObject({ kind: 'no-hardware', reviewed: true })
    expect(systemStanding(walked, 'homing', matrixIds)).toMatchObject({ kind: 'no-hardware', reviewed: false })
    expect(systemStanding(walked, 'scan', matrixIds)).toEqual({ kind: 'absent', reason: 'No scan lane here', stamp: STAMP })
    expect(systemStanding(walked, 'beacon', matrixIds)).toMatchObject({ kind: 'absent', stamp: null })

    const n = buildChecklist(walked, systems, northgateTopology)
    expect(n.locate.map((r) => [r.system.id, r.record])).toEqual([['homing', 'survey-gap']])
    expect(n.settled.noHardware.map((r) => r.system.id)).toEqual(['kite'])
  })

  it('prints the ordering rule word for word', () => {
    expect(CHECKLIST_RULE).toBe(
      'Ordered by the risk level the workbook gives each system, high first. At the same level, ' +
        'the weakest evidence comes first: no record, ungraded, best guess, strong inference. ' +
        'Devices with no system recorded follow, most relied on first. Physically verified items, ' +
        'and devices checked and found to carry no system, are listed last.',
    )
  })
})

describe('system standing', () => {
  it('reads a system with no record as none', () => {
    expect(systemStanding(westfield, 'beacon', matrixIdSet(systems))).toEqual({ kind: 'none' })
  })
})
