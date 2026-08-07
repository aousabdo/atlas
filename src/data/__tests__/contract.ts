import { describe, expect, it } from 'vitest'

import type { AtlasDataProvider } from '../provider'

/**
 * The provider contract, as executable assertions.
 *
 * Every implementation must pass this unchanged. Assertions are about shape,
 * invariants and referential integrity, never about a specific provider's
 * transport. The 5MAR baseline numbers appear here because both Phase 1
 * providers are fed the same source data; a provider serving a different
 * baseline would parameterise them.
 */
export function runProviderContract(
  name: string,
  makeProvider: () => Promise<AtlasDataProvider>,
) {
  describe(`AtlasDataProvider contract: ${name}`, () => {
    it('reports its kind', async () => {
      const p = await makeProvider()
      expect(['static', 'local-file', 'api']).toContain(p.kind)
    })

    it('returns a manifest with provenance', async () => {
      const m = await (await makeProvider()).getManifest()
      expect(m.bundle_version).toBeGreaterThanOrEqual(1)
      expect(m.source_label).toBeTruthy()
      expect(m.built_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('returns 32 systems for the 5MAR baseline', async () => {
      const systems = await (await makeProvider()).getSystems()
      expect(systems).toHaveLength(32)
    })

    it('splits systems 23 confirmed / 9 unconfirmed', async () => {
      const systems = await (await makeProvider()).getSystems()
      expect(systems.filter((s) => s.confirmed)).toHaveLength(23)
      expect(systems.filter((s) => !s.confirmed)).toHaveLength(9)
    })

    it('names the nine unconfirmed systems', async () => {
      const systems = await (await makeProvider()).getSystems()
      expect(systems.filter((s) => !s.confirmed).map((s) => s.id).sort()).toEqual([
        'beacon', 'cirrus', 'dwell', 'ember', 'fathom', 'gantry', 'halyard', 'ingot', 'jetty',
      ])
    })

    it('distributes risk 11 high / 19 medium / 2 low', async () => {
      const systems = await (await makeProvider()).getSystems()
      const count = (r: string) => systems.filter((s) => s.risk === r).length
      expect([count('high'), count('medium'), count('low')]).toEqual([11, 19, 2])
    })

    it('gives every system a unique id', async () => {
      const systems = await (await makeProvider()).getSystems()
      expect(new Set(systems.map((s) => s.id)).size).toBe(systems.length)
    })

    it('gives every system a display owner group', async () => {
      const systems = await (await makeProvider()).getSystems()
      expect(new Set(systems.map((s) => s.owner_group))).toEqual(
        new Set(['DHS S&T', 'CBP', 'Other DHS', 'DHS HQ/OCIO', 'DoD', 'External']),
      )
    })

    it('never truncates a system name', async () => {
      const systems = await (await makeProvider()).getSystems()
      for (const s of systems) expect(s.name.endsWith('..')).toBe(false)
    })

    it('returns 14 current and 13 desired links', async () => {
      const links = await (await makeProvider()).getLinks()
      expect(links.current).toHaveLength(14)
      expect(links.desired).toHaveLength(13)
    })

    it('only links systems that exist', async () => {
      const p = await makeProvider()
      const ids = new Set((await p.getSystems()).map((s) => s.id))
      const links = await p.getLinks()
      for (const l of [...links.current, ...links.desired]) {
        expect(ids.has(l.from), `link source ${l.from}`).toBe(true)
        expect(ids.has(l.to), `link target ${l.to}`).toBe(true)
      }
    })

    it('records how each link was derived', async () => {
      const links = await (await makeProvider()).getLinks()
      for (const l of links.current) {
        expect(['prose', 'override', 'manual']).toContain(l.extraction_method)
      }
    })

    it('returns 11 requirements including 2 that were not kept', async () => {
      const reqs = await (await makeProvider()).getRequirements()
      expect(reqs).toHaveLength(11)
      expect(reqs.filter((r) => r.status === "Didn't keep")).toHaveLength(2)
    })

    it('leaves dropped requirements with no current systems', async () => {
      const reqs = await (await makeProvider()).getRequirements()
      for (const r of reqs.filter((x) => x.status === "Didn't keep")) {
        expect(r.current).toEqual([])
      }
    })

    it('returns a glossary with 48 acronyms', async () => {
      const g = await (await makeProvider()).getGlossary()
      expect(g.acronyms).toHaveLength(48)
      expect(g.confidence_intro).toBeTruthy()
      expect(g.out_of_scope.length).toBeGreaterThan(0)
    })

    it('returns methodology reflecting the live classifier tables', async () => {
      const m = await (await makeProvider()).getMethodology()
      expect(m.owner_rules_count).toBe(23)
      expect(m.owner_rules).toHaveLength(23)
      expect(m.high_keywords).toHaveLength(19)
      expect(m.always_soft).toContain('beacon')
    })

    it('marks short owner rules as word-boundary matches', async () => {
      const m = await (await makeProvider()).getMethodology()
      const ice = m.owner_rules.find((r) => r.match === 'ICE')
      expect(ice?.match_mode).toBe('word_boundary')
    })

    it('returns coverage with both sites and the pending questions', async () => {
      const c = await (await makeProvider()).getCoverage()
      expect(Object.keys(c.sites).sort()).toEqual(['northgate', 'westfield'])
      expect(Object.keys(c.pending_review)).toHaveLength(7)
    })

    it('preserves the checked-and-absent facts', async () => {
      const c = await (await makeProvider()).getCoverage()
      expect(Object.keys(c.sites.northgate.not_deployed_at_site)).toHaveLength(20)
    })

    it('keeps the mapping that declares it is not a matrix system', async () => {
      const c = await (await makeProvider()).getCoverage()
      expect(c.sites.northgate.mappings.atak.matrix_id_exists).toBe(false)
    })

    it('returns all seven lossiness dimensions in order', async () => {
      const l = await (await makeProvider()).getLossiness()
      expect(l.dimensions.map((d) => d.key)).toEqual([
        'requirement_attrition', 'ownership_ambiguity', 'realization_gap',
        'integration_gap', 'evidence_gap', 'orphaned_hardware', 'open_questions',
      ])
    })

    it('gives every lossiness dimension its evidence', async () => {
      const l = await (await makeProvider()).getLossiness()
      for (const d of l.dimensions) {
        expect(d.detail, `${d.key} has no detail`).toBeTypeOf('object')
        expect(Object.keys(d.detail).length, `${d.key} detail is empty`).toBeGreaterThan(0)
        expect(['ok', 'watch', 'critical']).toContain(d.severity)
      }
    })

    it('reports requirement attrition as 9 of 11', async () => {
      const l = await (await makeProvider()).getLossiness()
      const d = l.dimensions.find((x) => x.key === 'requirement_attrition')!
      expect([d.numerator, d.denominator]).toEqual([9, 11])
    })

    it('ranks top gaps', async () => {
      const l = await (await makeProvider()).getLossiness()
      expect(l.top_gaps.length).toBeGreaterThan(0)
      const scores = l.top_gaps.map((g) => g.score)
      expect(scores).toEqual([...scores].sort((a, b) => b - a))
    })

    it('returns the Northgate topology', async () => {
      const t = await (await makeProvider()).getTopology('northgate')
      expect(t.devices).toHaveLength(71)
      expect(t.edges).toHaveLength(86)
      expect(Object.keys(t.zones)).toHaveLength(14)
      expect(t.meta.classification).toBe('UNCLASSIFIED//SAMPLE')
    })

    it('returns the Westfield Proving Ground topology', async () => {
      const t = await (await makeProvider()).getTopology('westfield')
      expect(t.devices).toHaveLength(8)
      expect(t.edges).toHaveLength(8)
    })

    it('keeps every topology edge attached to real devices', async () => {
      const t = await (await makeProvider()).getTopology('northgate')
      const ids = new Set(t.devices.map((d) => d.id))
      for (const e of t.edges) {
        expect(ids.has(e.source), `edge source ${e.source}`).toBe(true)
        expect(ids.has(e.target), `edge target ${e.target}`).toBe(true)
      }
    })

    it('puts every device in a declared zone', async () => {
      const t = await (await makeProvider()).getTopology('northgate')
      const zones = new Set(Object.keys(t.zones))
      for (const d of t.devices) {
        expect(zones.has(d.zone), `${d.id} zone ${d.zone}`).toBe(true)
      }
    })

    it('maps coverage only onto devices that exist', async () => {
      const p = await makeProvider()
      const c = await p.getCoverage()
      for (const siteId of Object.keys(c.sites)) {
        const t = await p.getTopology(siteId)
        const ids = new Set(t.devices.map((d) => d.id))
        for (const [sysId, m] of Object.entries(c.sites[siteId].mappings)) {
          for (const d of m.devices) {
            expect(ids.has(d), `${siteId}.${sysId} -> ${d}`).toBe(true)
          }
        }
      }
    })

    it('rejects an unknown site rather than returning empty data', async () => {
      const p = await makeProvider()
      await expect(p.getTopology('atlantis')).rejects.toThrow()
    })

    it('returns snapshots as an array, empty being a valid answer', async () => {
      const snaps = await (await makeProvider()).getSnapshots()
      expect(Array.isArray(snaps)).toBe(true)
      for (const s of snaps) expect(s.dimensions).toHaveLength(7)
    })
  })
}
