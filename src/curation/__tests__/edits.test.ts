import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { crossFileFailures } from '../../data/LocalFileProvider'
import type {
  CheckedDevice, CoverageMatrix, CoverageSite, Mapping, System, Topology,
} from '../../types/atlas'
import {
  applyEdit, applyEdits, CurationError, editKey, upsertEdit, type Edit, type Review,
} from '../edits'
import { exportSystemDeviceMap } from '../serialise'
import { SAMPLE_WALK } from './sampleWalk'

const SYNTHETIC = join(process.cwd(), 'fixtures', 'synthetic')
const readJson = <T>(...parts: string[]): T =>
  JSON.parse(readFileSync(join(SYNTHETIC, ...parts), 'utf-8')) as T

const sampleCoverage = () => readJson<CoverageMatrix>('coverage.json')
const sampleSystems = () => readJson<System[]>('systems.json')

const STAMP = { reviewed_by: 'Site lead', reviewed_on: '2026-11-13' }

/** Two made-up matrix systems and a shortfall one, with a site that has a few devices. */
const SYSTEMS = [
  { id: 'alpha', name: 'Alpha', category: 'Deployed asset record' },
  { id: 'beta', name: 'Beta', category: 'Deployed asset record' },
  { id: 'gamma', name: 'Gamma', category: 'Deployed asset record' },
  { id: 'short', name: 'Short', category: 'Workflow shortfall' },
] as unknown as System[]

const mapping = (devices: string[], extra: Partial<Mapping> = {}): Mapping => ({
  devices, note: 'n', confidence: 'high', ...extra,
})

function matrix(site: Partial<CoverageSite> = {}): CoverageMatrix {
  return {
    default_site: 's',
    pending_review: {},
    confidence_counts: {},
    sites: {
      s: {
        label: 'S', scope: 'x', mappings: {}, not_deployed_at_site: {},
        unclaimed_devices: { infrastructure: ['d3'] },
        ...site,
      },
    },
  }
}

const found = (system: string, devices: string[], site = 's'): Edit => ({
  kind: 'review', site, system,
  review: { status: 'found', devices, confidence: 'high', note: 'seen', ...STAMP },
})
const clear = (system: string): Edit => ({ kind: 'review', site: 's', system, review: { status: 'clear' } })
const review = (system: string, r: Review): Edit => ({ kind: 'review', site: 's', system, review: r })

describe('the sample walk', () => {
  const before = sampleCoverage()
  const walked = applyEdits(structuredClone(before), SAMPLE_WALK, sampleSystems())

  it('gives Westfield three mappings and leaves its unclaimed list as the gateways and network gear', () => {
    expect(Object.keys(walked.sites.westfield.mappings)).toHaveLength(3)
    expect(walked.sites.westfield.unclaimed_devices.infrastructure).toEqual(
      ['wf_firewall', 'wf_ap', 'wf_northwind_gw', 'wf_crestline_gw', 'wf_internet'],
    )
  })

  it("adds the three grades to the sample's own counts", () => {
    const counts = before.confidence_counts
    expect(walked.confidence_counts).toMatchObject({
      high: counts.high + 1, medium: counts.medium + 1, low: counts.low + 1, total: 13,
    })
  })

  it('leaves its input unchanged, nested values included', () => {
    const input = sampleCoverage()
    const copy = structuredClone(input)
    applyEdits(input, SAMPLE_WALK, sampleSystems())
    expect(input).toEqual(copy)
  })

  it('writes the file the golden holds, byte for byte', () => {
    const { text } = exportSystemDeviceMap({
      raw: null, coverage: walked, source: 'sample', today: '2026-11-13',
    })
    const golden = join(process.cwd(), 'fixtures', 'parity', 'sample-walk', 'system_device_map.json')
    expect(existsSync(golden)).toBe(true)
    expect(text).toBe(readFileSync(golden, 'utf-8'))
  })

  it('passes the gates', () => {
    const project = readJson<{ sites: Array<{ id: string }> }>('project.json')
    const topologies = Object.fromEntries(
      project.sites.map((s) => [s.id, readJson<Topology>('sites', `${s.id}.json`)]),
    )
    expect(crossFileFailures({
      systems: sampleSystems(),
      links: readJson<{ current: never[] }>('links.json').current,
      coverage: walked,
      topologies,
      requirements: readJson('crosswalk.json'),
    })).toEqual([])
  })
})

describe('applyEdit on devices', () => {
  it('keeps a shared device claimed until its last mapping lets go', () => {
    const start = matrix({ mappings: { alpha: mapping(['d1']), beta: mapping(['d1']) }, unclaimed_devices: { infrastructure: [] } })
    const moved = applyEdit(start, found('beta', ['d2']), SYSTEMS)
    expect(moved.sites.s.unclaimed_devices.infrastructure).toEqual([])
    const cleared = applyEdit(moved, clear('alpha'), SYSTEMS)
    expect(cleared.sites.s.unclaimed_devices.infrastructure).toEqual(['d1'])
  })

  it('appends released devices in the order the mapping named them, skipping any already listed', () => {
    const start = matrix({ mappings: { alpha: mapping(['d9', 'd3', 'd7']) } })
    const cleared = applyEdit(start, clear('alpha'), SYSTEMS)
    expect(cleared.sites.s.unclaimed_devices.infrastructure).toEqual(['d3', 'd9', 'd7'])
  })

  it('removes the devices a mapping now names from the list, once each, in the given order', () => {
    const start = matrix({ unclaimed_devices: { infrastructure: ['d1', 'd2', 'd3'] } })
    const next = applyEdit(start, found('alpha', ['d2', 'd1', 'd2']), SYSTEMS)
    expect(next.sites.s.mappings.alpha.devices).toEqual(['d2', 'd1'])
    expect(next.sites.s.unclaimed_devices.infrastructure).toEqual(['d3'])
  })

  it('keeps other keys the prior mapping carried', () => {
    const start = matrix({ mappings: { alpha: { ...mapping(['d1']), extra_key: 'keep' } as Mapping } })
    const next = applyEdit(start, found('alpha', ['d1', 'd2']), SYSTEMS)
    expect(next.sites.s.mappings.alpha).toMatchObject({ extra_key: 'keep', note: 'seen', ...STAMP })
  })

  it('releases the devices of a no-hardware review and writes an empty stamped mapping', () => {
    const start = matrix({ mappings: { alpha: mapping(['d1']) } })
    const next = applyEdit(start, review('alpha', { status: 'no-hardware', confidence: 'low', note: 'none', ...STAMP }), SYSTEMS)
    expect(next.sites.s.mappings.alpha).toEqual({ devices: [], confidence: 'low', note: 'none', ...STAMP })
    expect(next.sites.s.unclaimed_devices.infrastructure).toEqual(['d3', 'd1'])
  })
})

describe('applyEdit replaces both records', () => {
  const both = () => matrix({
    mappings: { alpha: mapping(['d1']) },
    not_deployed_at_site: { alpha: 'old reason' },
  })

  it('ends with only the absence when reviewed absent', () => {
    const next = applyEdit(both(), review('alpha', { status: 'absent', reason: 'not here', ...STAMP }), SYSTEMS)
    expect(next.sites.s.mappings).toEqual({})
    expect(next.sites.s.not_deployed_at_site).toEqual({ alpha: { reason: 'not here', ...STAMP } })
    expect(next.sites.s.unclaimed_devices.infrastructure).toEqual(['d3', 'd1'])
  })

  it('ends with only the mapping when reviewed found', () => {
    const next = applyEdit(both(), found('alpha', ['d1']), SYSTEMS)
    expect(next.sites.s.not_deployed_at_site).toEqual({})
    expect(Object.keys(next.sites.s.mappings)).toEqual(['alpha'])
  })

  it('deletes both when cleared', () => {
    const next = applyEdit(both(), clear('alpha'), SYSTEMS)
    expect(next.sites.s.mappings).toEqual({})
    expect(next.sites.s.not_deployed_at_site).toEqual({})
  })
})

describe('checks', () => {
  const check = (device: string, c: CheckedDevice | null): Edit =>
    ({ kind: 'check', site: 's', device, check: c })

  it('writes a check and drops a blank note', () => {
    const next = applyEdit(matrix(), check('d3', { ...STAMP, note: '   ' }), SYSTEMS)
    expect(next.sites.s.unclaimed_devices.checked).toEqual({ d3: STAMP })
    const noted = applyEdit(matrix(), check('d3', { ...STAMP, note: 'a switch' }), SYSTEMS)
    expect(noted.sites.s.unclaimed_devices.checked?.d3.note).toBe('a switch')
  })

  it('removes the entry, then the emptied checked key, on a null check', () => {
    const start = matrix({ unclaimed_devices: { infrastructure: ['d3', 'd4'], checked: { d3: STAMP, d4: STAMP } } })
    const one = applyEdit(start, check('d3', null), SYSTEMS)
    expect(one.sites.s.unclaimed_devices.checked).toEqual({ d4: STAMP })
    const none = applyEdit(one, check('d4', null), SYSTEMS)
    expect('checked' in none.sites.s.unclaimed_devices).toBe(false)
  })

  it('drops a device check when a mapping takes the device', () => {
    const start = matrix({ unclaimed_devices: { infrastructure: ['d3'], checked: { d3: STAMP } } })
    const next = applyEdit(start, found('alpha', ['d3']), SYSTEMS)
    expect('checked' in next.sites.s.unclaimed_devices).toBe(false)
    expect(next.sites.s.unclaimed_devices.infrastructure).toEqual([])
  })

  it('leaves its input alone', () => {
    const start = matrix({ unclaimed_devices: { infrastructure: ['d3'], checked: { d3: STAMP } } })
    const copy = structuredClone(start)
    applyEdit(start, check('d3', null), SYSTEMS)
    applyEdit(start, found('alpha', ['d3']), SYSTEMS)
    expect(start).toEqual(copy)
  })
})

describe('applyEdit refusals', () => {
  const start = () => matrix({ mappings: { alpha: mapping(['d1']) } })
  const refuses = (edit: Edit) => expect(() => applyEdit(start(), edit, SYSTEMS)).toThrow(CurationError)

  it('refuses a shortfall system', () => refuses(found('short', ['d1'])))
  it('refuses an id the matrix lacks', () => refuses(found('nope', ['d1'])))
  it('refuses found with no devices', () => refuses(found('beta', [])))
  it('refuses absent with a blank reason', () =>
    refuses(review('beta', { status: 'absent', reason: '  ', ...STAMP })))
  it('refuses a check on a device a mapping names', () =>
    refuses({ kind: 'check', site: 's', device: 'd1', check: STAMP }))
})

describe('editKey and upsertEdit', () => {
  it('builds the keys', () => {
    expect(editKey(found('alpha', ['d1']))).toBe('s\0system\0alpha')
    expect(editKey({ kind: 'check', site: 's', device: 'd1', check: null })).toBe('s\0device\0d1')
  })

  it('keeps one edit per key with the last appended', () => {
    const a = found('alpha', ['d1'])
    const b = found('beta', ['d2'])
    const a2 = clear('alpha')
    expect(upsertEdit(upsertEdit([a, b], a2), found('gamma', ['d4']))).toEqual([b, a2, found('gamma', ['d4'])])
  })

  it('drops the check a found review supersedes, at its own site only', () => {
    const checkAt = (site: string, device: string, c: CheckedDevice | null = STAMP): Edit =>
      ({ kind: 'check', site, device, check: c })
    const before = [checkAt('s', 'd3'), checkAt('t', 'd3'), checkAt('s', 'd4'), checkAt('s', 'd5', null)]
    const assigned = found('alpha', ['d3', 'd5'])
    expect(upsertEdit(before, assigned)).toEqual([checkAt('t', 'd3'), checkAt('s', 'd4'), assigned])
  })

  it('keeps every check when the review names no device', () => {
    const checked: Edit = { kind: 'check', site: 's', device: 'd3', check: STAMP }
    const none = review('alpha', { status: 'no-hardware', confidence: 'low', note: '', ...STAMP })
    expect(upsertEdit([checked], none)).toEqual([checked, none])
    expect(upsertEdit([checked], clear('alpha'))).toEqual([checked, clear('alpha')])
  })
})

describe('applyEdits replays reviews before checks', () => {
  it('takes a check listed before the review that released its device', () => {
    const start = matrix({ mappings: { alpha: mapping(['d1']) } })
    const edits: Edit[] = [
      { kind: 'check', site: 's', device: 'd1', check: STAMP },
      found('alpha', ['d2']),
    ]
    const next = applyEdits(start, edits, SYSTEMS)
    expect(next.sites.s.mappings.alpha.devices).toEqual(['d2'])
    expect(next.sites.s.unclaimed_devices.checked).toEqual({ d1: STAMP })
  })

  it('still refuses a check on a device a review leaves named', () => {
    const start = matrix({ mappings: { alpha: mapping(['d1']) } })
    const edits: Edit[] = [
      found('alpha', ['d1']),
      { kind: 'check', site: 's', device: 'd1', check: STAMP },
    ]
    expect(() => applyEdits(start, edits, SYSTEMS)).toThrow(CurationError)
  })
})
