import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { crossFileFailures, normaliseSystemDeviceMap } from '../../data/LocalFileProvider'
import { matrixIdSet } from '../../lib/coverage'
import { realizationGap } from '../../lib/lossiness'
import type { CoverageMatrix, Link, Requirement, System, Topology } from '../../types/atlas'
import { applyEdits, upsertEdit, type Edit } from '../edits'
import { exportSystemDeviceMap } from '../serialise'
import { walkSummary } from '../walk'

/**
 * A walk on local data, kept the way the app keeps it: in the file.
 *
 * The map loaded is the browser's own export of the sample walk, with keys of
 * the analyst's own added, read the way LocalFileProvider reads a map. Edits
 * of every kind go on top, the result is exported as local data, and the
 * export is loaded and exported again. The end-to-end test walks the sample
 * through the screen; this walks the file, on local data, edit kind by kind.
 */

const SYNTHETIC = join(process.cwd(), 'fixtures', 'synthetic')
const readJson = <T>(...parts: string[]): T =>
  JSON.parse(readFileSync(join(SYNTHETIC, ...parts), 'utf-8')) as T

const systems = readJson<System[]>('systems.json')
const topologies: Record<string, Topology> = {
  northgate: readJson<Topology>('sites', 'northgate.json'),
  westfield: readJson<Topology>('sites', 'westfield.json'),
}
const links = readJson<{ current: Link[]; desired: Link[] }>('links.json')
const requirements = readJson<Requirement[]>('crosswalk.json')
const matrixIds = matrixIdSet(systems)

/** The map as loaded: the sample walk's export, plus keys of the analyst's own. */
function loadedMap(): Record<string, unknown> {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), 'fixtures', 'parity', 'sample-walk', 'system_device_map.json'), 'utf-8'),
  ) as Record<string, Record<string, Record<string, unknown>>>
  raw.owner = { team: 'Range team' } as never
  raw.sites.westfield.walk_plan = 'Gate first, then the yard'
  return raw
}

/** Non-ASCII on purpose: the bytes must survive both writers. */
const STAMP = { reviewed_by: 'Zoë Site lead', reviewed_on: '2026-11-14' }

const EDITS: Edit[] = [
  {
    kind: 'check', site: 'westfield', device: 'wf_northwind_gw',
    check: { ...STAMP, note: 'Carrier gateway; carries no matrix system' },
  },
  {
    kind: 'review', site: 'westfield', system: 'cbpsen',
    review: { status: 'absent', reason: 'Checked with the range lead: no feed here', ...STAMP },
  },
  {
    kind: 'review', site: 'westfield', system: 'kite',
    review: { status: 'no-hardware', confidence: 'medium', note: 'Client software only', ...STAMP },
  },
  {
    kind: 'review', site: 'westfield', system: 'fathom',
    review: {
      status: 'found', devices: ['wf_ap', 'wf_server'], confidence: 'high',
      note: 'Sonar feed rides the access point', ...STAMP,
    },
  },
]

const gates = (coverage: CoverageMatrix) =>
  crossFileFailures({
    systems, links: links.current, desired: links.desired, coverage, topologies, requirements,
  })

const figures = (coverage: CoverageMatrix) => ({
  realization: realizationGap(systems, coverage),
  westfield: walkSummary(coverage.sites.westfield, systems, topologies.westfield),
  northgate: walkSummary(coverage.sites.northgate, systems, topologies.northgate),
})

describe('a walk on local data, exported and loaded back', () => {
  const raw = loadedMap()
  const loaded = normaliseSystemDeviceMap(raw, matrixIds)
  const edits = EDITS.reduce<Edit[]>((list, edit) => upsertEdit(list, edit), [])
  const edited = applyEdits(loaded, edits, systems)

  const first = exportSystemDeviceMap({ raw, coverage: edited, source: 'local', today: '2026-11-14' })
  const reraw = JSON.parse(first.text) as Record<string, unknown>
  const reloaded = normaliseSystemDeviceMap(reraw, matrixIds)
  const second = exportSystemDeviceMap({
    raw: reraw, coverage: reloaded, source: 'local', today: '2026-11-15',
  })

  it('starts from a map the gates take, and exports under the local name', () => {
    expect(gates(loaded)).toEqual([])
    expect(first.fileName).toBe('system_device_map.json')
  })

  it('keeps every stamp, note, checked device and absence object through the reload', () => {
    const westfield = reloaded.sites.westfield
    expect(westfield.unclaimed_devices.checked).toEqual({
      wf_northwind_gw: { ...STAMP, note: 'Carrier gateway; carries no matrix system' },
    })
    expect(westfield.not_deployed_at_site.cbpsen).toEqual({
      reason: 'Checked with the range lead: no feed here', ...STAMP,
    })
    expect(westfield.mappings.kite).toEqual({
      devices: [], confidence: 'medium', note: 'Client software only', ...STAMP,
    })
    expect(westfield.mappings.fathom).toEqual({
      devices: ['wf_ap', 'wf_server'], confidence: 'high',
      note: 'Sonar feed rides the access point', ...STAMP,
    })
    // The walk the file already held, stamps and notes included.
    expect(westfield.mappings.beacon).toEqual({
      devices: ['wf_gate_sensor'], confidence: 'high', note: 'Gate sensor feeds the beacon',
      reviewed_by: 'Site lead', reviewed_on: '2026-11-13',
    })
    // A checked device stays on the list; the access point, now named, leaves it.
    expect(westfield.unclaimed_devices.infrastructure).toEqual(
      ['wf_firewall', 'wf_northwind_gw', 'wf_crestline_gw', 'wf_internet'],
    )
    expect(reloaded.sites).toEqual(edited.sites)
  })

  it('passes every cross-file gate once loaded back', () => {
    expect(gates(reloaded)).toEqual([])
  })

  it('reads to the same realization and walk figures before and after the reload', () => {
    expect(figures(reloaded)).toEqual(figures(edited))
    expect(figures(reloaded).westfield).toMatchObject({
      realized: 4, noHardware: 1, absent: 1, carrying: 4, checked: 1, noRecord: 3,
    })
  })

  it('exports the loaded-back file byte for byte as it was first written', () => {
    expect(second.text).toBe(first.text)
  })

  it("keeps the analyst's own keys, at the top and on the site", () => {
    expect(reraw.owner).toEqual({ team: 'Range team' })
    expect((reraw.sites as Record<string, Record<string, unknown>>).westfield.walk_plan).toBe(
      'Gate first, then the yard',
    )
    expect(reraw._comment).toBe(raw._comment)
    expect(reraw).not.toHaveProperty('confidence_counts')
  })
})
