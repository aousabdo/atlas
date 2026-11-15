import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { crossFileFailures, normaliseSystemDeviceMap, type RawSystemDeviceMap } from '../../data/LocalFileProvider'
import { matrixIdSet } from '../../lib/coverage'
import { realizationGap } from '../../lib/lossiness'
import type { System, Topology } from '../../types/atlas'
import { canonicalMapJson } from '../serialise'

/**
 * One set of cases, read by both engines.
 *
 * Every file in fixtures/parity/curation is read here and by
 * ingest/tests/test_curation_parity.py, so adding a case adds it to both and
 * the two cannot drift the way a pair of hand-mirrored tables can. Each holds a
 * map as the analyst's file has it, the systems and drawings it is read against,
 * and the expected refusals word for word. A file both engines accept also
 * states the realization it produces, and has a sibling <name>.out.json
 * holding the exact bytes both engines write it back as.
 */
const CASES = join(process.cwd(), 'fixtures', 'parity', 'curation')

interface Case {
  name: string
  systems: Array<Pick<System, 'id' | 'name' | 'category'>>
  topology_devices: Record<string, string[]>
  map: RawSystemDeviceMap
  expect: {
    failures: string[]
    realization?: {
      numerator: number
      per_site: Record<string, { mapped_ids: string[]; checked_absent: string[] }>
      by_confidence: Record<string, string[]>
    }
  }
}

const caseFiles = readdirSync(CASES)
  .filter((name) => name.endsWith('.json') && !name.endsWith('.out.json'))
  .sort()

const outFile = (file: string) => join(CASES, file.replace(/\.json$/, '.out.json'))

function readCase(file: string): Case {
  return JSON.parse(readFileSync(join(CASES, file), 'utf-8')) as Case
}

/** A full System around the three fields a case states, every other one neutral. */
function system(row: Case['systems'][number]): System {
  return {
    ...row,
    label: row.name,
    owner_group_id: 'unassigned',
    owner_group: 'Unassigned',
    color_key: 'inv',
    confirmed: true,
    risk: 'low',
    risk_source: 'explicit',
    detail: '',
    integrations_prose: '',
  }
}

/** Only the device ids are read by the gates, so only they are built. */
function topologies(devices: Case['topology_devices']): Record<string, Topology> {
  return Object.fromEntries(
    Object.entries(devices).map(([siteId, ids]) => [
      siteId,
      { site_id: siteId, devices: ids.map((id) => ({ id })) } as unknown as Topology,
    ]),
  )
}

describe('the shared curation cases', () => {
  it('has at least twenty cases', () => {
    expect(caseFiles.length).toBeGreaterThanOrEqual(20)
  })

  for (const file of caseFiles) {
    it(file.replace(/\.json$/, ''), () => {
      const c = readCase(file)
      const systems = c.systems.map(system)
      const coverage = normaliseSystemDeviceMap(c.map, matrixIdSet(systems))

      const failures = crossFileFailures({
        systems, links: [], coverage, topologies: topologies(c.topology_devices), requirements: [],
      }).filter((line) => line.startsWith('system_device_map.'))
      expect(failures).toEqual(c.expect.failures)

      if (c.expect.realization) {
        const gap = realizationGap(systems, coverage)
        const perSite = gap.detail.per_site as Record<
          string, { mapped_ids: string[]; checked_absent: string[] }
        >
        expect({
          numerator: gap.numerator,
          per_site: Object.fromEntries(
            Object.entries(perSite).map(([siteId, site]) => [
              siteId, { mapped_ids: site.mapped_ids, checked_absent: site.checked_absent },
            ]),
          ),
          by_confidence: gap.detail.by_confidence,
        }).toEqual(c.expect.realization)
      }
    })
  }
})

describe('the canonical serialisation of the shared cases', () => {
  for (const file of caseFiles) {
    const c = readCase(file)
    const accepted = c.expect.failures.length === 0

    it(`${file.replace(/\.json$/, '')} ${accepted ? 'writes its .out.json' : 'has no .out.json'}`, () => {
      // Only a file both engines accept is ever exported, so only it is pinned.
      expect(existsSync(outFile(file))).toBe(accepted)
      if (accepted) {
        expect(canonicalMapJson(c.map)).toBe(readFileSync(outFile(file), 'utf-8'))
      }
    })
  }

  /**
   * The ingest reads a map whose sites is not an object as the legacy flat
   * map, so the browser must too, or the two would write different files.
   */
  for (const sites of [null, [], 'northgate', 7]) {
    it(`reads sites: ${JSON.stringify(sites)} as the legacy flat map`, () => {
      const { map } = readCase('legacy-flat.json')
      expect(canonicalMapJson({ ...map, sites })).toBe(
        readFileSync(outFile('legacy-flat.json'), 'utf-8'),
      )
    })
  }
})
