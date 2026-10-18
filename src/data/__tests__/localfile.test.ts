import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { crossFileFailures, LocalFileProvider } from '../LocalFileProvider'
import { runProviderContract } from './contract'

const GENERATOR = join(process.cwd(), 'scripts', 'make-sample-workbook.mjs')

/**
 * The analyst's inputs, fabricated into a temporary directory.
 *
 * Nothing here is committed: .gitignore excludes *.xlsx and the data guard
 * fails on a tracked workbook, because a spreadsheet in this repo is the exact
 * shape of the mistake that was purged from its history. The generator is
 * cheap, so every run rebuilds the inputs rather than depending on a file
 * somebody put somewhere.
 *
 * This used to require $ATLAS_SOURCE_REPO and the real workbook, which meant it
 * ran on one machine and nowhere else, and after the purge renamed those paths
 * it ran nowhere at all. A contract suite that no machine can satisfy is not a
 * skip, it is a hole.
 */
const workspace = mkdtempSync(join(tmpdir(), 'atlas-sample-inputs-'))
execFileSync(process.execPath, [GENERATOR, workspace], { stdio: 'pipe' })

afterAll(() => rmSync(workspace, { recursive: true, force: true }))

function file(relative: string): File {
  return new File([readFileSync(join(workspace, relative))], basename(relative))
}

async function makeLocalProvider() {
  const p = new LocalFileProvider()
  await p.load({
    matrix: file('matrix.xlsx'),
    overrides: file('overrides.json'),
    glossary: file('glossary.json'),
    systemDeviceMap: file('system_device_map.json'),
    topologies: {
      northgate: file(join('sites', 'northgate.json')),
      westfield: file(join('sites', 'westfield.json')),
    },
  })
  return p
}

// The same suite StaticProvider passes, over the same sample vocabulary, from
// the workbook instead of the bundle. If one goes green and the other does not,
// the TypeScript classifier has diverged from the Python one.
runProviderContract('LocalFileProvider', makeLocalProvider)

const fixture = (...parts: string[]) =>
  JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'synthetic', ...parts), 'utf-8'))

/**
 * The contract proves both providers answer the same counts. This proves they
 * answer the same records.
 *
 * The workbook is built from this bundle, so name, category, Confirmed, the
 * explicit Risk Level and the integration prose are round trips and prove
 * nothing on their own. Everything else on the row is the classifier's output:
 * `id` from makeId, `label` from makeLabel, `owner_group_id`/`owner_group`/
 * `color_key` from classifyOwner over the raw owner clause, and `detail` from
 * the reassembly rule. Those are the fields transliterated from Python, and
 * those are the fields this compares.
 */
describe('LocalFileProvider agrees with the Python ingest', () => {
  it('parses the workbook into the same systems the bundle carries', async () => {
    expect(await (await makeLocalProvider()).getSystems()).toEqual(fixture('systems.json'))
  })

  it('parses the crosswalk sheet into the same requirements', async () => {
    expect(await (await makeLocalProvider()).getRequirements())
      .toEqual(fixture('crosswalk.json'))
  })

  /**
   * Compared as a set, not a list: both miners walk their systems in row order
   * but their fragment tables are built in different insertion orders, so the
   * mined links can come out in a different sequence. Which links exist, how
   * each was derived and what each is labelled are the claims that matter;
   * the order they arrive in is not part of the contract.
   */
  it('mines the same links from the same prose', async () => {
    const key = (l: { from: string; to: string; label: string; extraction_method: string }) =>
      `${[l.from, l.to].sort().join(' ')} | ${l.extraction_method} | ${l.label}`
    const links = await (await makeLocalProvider()).getLinks()
    const expected = fixture('links.json')
    expect(links.current.map(key).sort()).toEqual(expected.current.map(key).sort())
    expect(links.desired.map(key).sort()).toEqual(expected.desired.map(key).sort())
  })
})

/**
 * Where the two providers legitimately differ, stated rather than skipped.
 *
 * These are not classifier disagreements. A workbook carries no build history
 * and no provenance, so the fields the bundle gets from its build cannot be
 * recovered from an upload, and inventing them would be the lie. The contract
 * is written to accept either answer; this pins down which one this provider
 * gives, so a future change that starts fabricating provenance fails here.
 */
describe('what a workbook cannot carry, and does not pretend to', () => {
  it('has no build history, so snapshots are empty rather than invented', async () => {
    const p = await makeLocalProvider()
    expect(await p.getSnapshots()).toEqual([])
    expect((await p.getManifest()).snapshots).toEqual([])
  })

  it('names the uploaded file as its provenance, and no baseline date', async () => {
    const m = await (await makeLocalProvider()).getManifest()
    expect(m.source_label).toBe('matrix.xlsx')
    expect(m.git_sha).toBe('n/a')
    expect(m.baseline_date).toBe('')
  })
})

describe('LocalFileProvider upload hardening', () => {
  const zipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04])

  it('rejects a file whose magic bytes are not a zip', async () => {
    const p = new LocalFileProvider()
    await expect(
      p.load({ matrix: new File(['not a spreadsheet'], 'evil.xlsx') }),
    ).rejects.toThrow(/not a valid xlsx/i)
  })

  it('rejects .xlsm outright', async () => {
    const p = new LocalFileProvider()
    await expect(
      p.load({ matrix: new File([zipHeader], 'macro.xlsm') }),
    ).rejects.toThrow(/xlsm/i)
  })

  it('rejects a file over the size cap', async () => {
    const p = new LocalFileProvider()
    const huge = new File([new Uint8Array(60 * 1024 * 1024)], 'huge.xlsx')
    await expect(p.load({ matrix: huge })).rejects.toThrow(/too large/i)
  })

  it('never accepts HTML', async () => {
    const p = new LocalFileProvider()
    await expect(
      p.load({ matrix: new File(['<html>'], 'graph.html') }),
    ).rejects.toThrow(/HTML is never accepted/i)
  })

  it('reports which file failed, not just that something did', async () => {
    const p = new LocalFileProvider()
    await expect(
      p.load({ matrix: new File(['x'], 'broken.xlsx') }),
    ).rejects.toThrow(/broken\.xlsx/)
  })

  it('refuses to answer before a file is loaded', async () => {
    const p = new LocalFileProvider()
    await expect(p.getSystems()).rejects.toThrow(/No file loaded/i)
  })

  it('keeps the previous state when a later load fails', async () => {
    const p = await makeLocalProvider()
    expect(await p.getSystems()).toHaveLength(32)
    await expect(p.load({ matrix: new File(['x'], 'bad.xlsx') })).rejects.toThrow()
    // Still serving the good parse, not a half-built one.
    expect(await p.getSystems()).toHaveLength(32)
  })
})

/**
 * A hand-edited glossary is the one input an analyst types by hand, so it
 * arrives short of a key sooner or later.
 *
 * It must not cost them the load. The glossary contributes acronym expansions
 * and prose to one tab; the matrix, the links, the coverage and the topologies
 * do not read it at all. Refusing the whole load over a missing block would
 * take all of that away to protect nothing, and would be stricter than passing
 * no glossary at all, which this provider has always accepted.
 *
 * Content below is invented for these tests.
 */
describe('a glossary missing keys still loads', () => {
  function glossaryFile(body: unknown): File {
    return new File([JSON.stringify(body)], 'glossary.json')
  }

  async function loadWith(body: unknown) {
    const p = new LocalFileProvider()
    await p.load({ matrix: file('matrix.xlsx'), glossary: glossaryFile(body) })
    return p
  }

  const WHOLE = {
    confidence_intro: 'Sample intro sentence supplied by this test.',
    out_of_scope: ['Sample exclusion one'],
    methodology_extras: {
      risk_caveat: 'Sample risk caveat.',
      mapping_confidence_scale: 'Sample mapping scale note.',
      soft_ownership_note: 'Sample soft ownership note.',
    },
    acronyms: [{ acr: 'AAA', meaning: 'Sample expansion one' }],
  }

  it('counts no acronyms rather than dying on the count', async () => {
    const { acronyms, ...rest } = WHOLE
    expect(acronyms).toHaveLength(1)
    const p = await loadWith(rest)
    expect((await p.getGlossary()).acronyms).toEqual([])
    expect((await p.getManifest()).counts.acronyms).toBe(0)
    // The load the analyst actually came for is intact.
    expect(await p.getSystems()).toHaveLength(32)
  })

  it('fills the extras block when it is absent, keeping every other key', async () => {
    const { methodology_extras, ...rest } = WHOLE
    expect(methodology_extras.risk_caveat).toBeTruthy()
    const glossary = await (await loadWith(rest)).getGlossary()
    expect(glossary.methodology_extras).toEqual({
      risk_caveat: '',
      mapping_confidence_scale: '',
      soft_ownership_note: '',
    })
    expect(glossary.confidence_intro).toBe(WHOLE.confidence_intro)
    expect(glossary.out_of_scope).toEqual(WHOLE.out_of_scope)
    expect(glossary.acronyms).toEqual(WHOLE.acronyms)
  })

  it('fills only the extras that are absent from a partial block', async () => {
    const glossary = await (
      await loadWith({ ...WHOLE, methodology_extras: { risk_caveat: 'Kept.' } })
    ).getGlossary()
    expect(glossary.methodology_extras).toEqual({
      risk_caveat: 'Kept.',
      mapping_confidence_scale: '',
      soft_ownership_note: '',
    })
  })

  it('fills every key of a glossary that has none of them', async () => {
    const glossary = await (await loadWith({})).getGlossary()
    expect(glossary).toEqual({
      confidence_intro: '',
      out_of_scope: [],
      methodology_extras: {
        risk_caveat: '',
        mapping_confidence_scale: '',
        soft_ownership_note: '',
      },
      acronyms: [],
    })
  })

  it('treats a key written as null as absent rather than trusting the null', async () => {
    const glossary = await (
      await loadWith({ ...WHOLE, acronyms: null, confidence_intro: null })
    ).getGlossary()
    expect(glossary.acronyms).toEqual([])
    expect(glossary.confidence_intro).toBe('')
    expect(glossary.out_of_scope).toEqual(WHOLE.out_of_scope)
  })
})

/**
 * The gates, unit-tested the way validate() is.
 *
 * Mirrors ingest/tests/test_validate.py case for case. crossFileFailures is
 * pure and returns strings for exactly the reason validate() does: the gates
 * are testable without a workbook, and one run names everything that needs
 * fixing rather than the first thing.
 *
 * Every id, name and device below is invented.
 */
describe('crossFileFailures', () => {
  const SYSTEM = {
    id: 'ucop', name: 'UAS Common Picture', label: 'UAS\nCommon Picture',
    category: 'Deployed asset record', owner_group_id: 'st',
    owner_group: 'DHS S&T', color_key: 'st', confirmed: true,
    risk: 'high' as const, risk_source: 'explicit' as const, detail: '',
    integrations_prose: '',
  }

  const REQUIREMENT = {
    orig: 'A requirement sentence', sys: 'a system',
    current: ['UAS Common Picture'], status: 'Condensed' as const,
  }

  function inputs(over: Partial<Parameters<typeof crossFileFailures>[0]> = {}) {
    return {
      systems: [SYSTEM],
      links: [],
      coverage: {
        default_site: null, sites: {}, pending_review: {}, confidence_counts: {},
      },
      topologies: {},
      requirements: [REQUIREMENT],
      ...over,
    }
  }

  function site(over: Record<string, unknown> = {}) {
    return {
      default_site: 'northgate',
      sites: {
        northgate: {
          label: 'Northgate', scope: '', mappings: {}, not_deployed_at_site: {},
          unclaimed_devices: { infrastructure: [] }, ...over,
        },
      },
      pending_review: {},
      confidence_counts: {},
    }
  }

  const mapping = (over: Record<string, unknown> = {}) => ({
    devices: [], note: '', confidence: 'high' as const, ...over,
  })

  /** One device, so the device gates have something to check against. */
  const topology = {
    northgate: {
      site_id: 'northgate',
      meta: {
        label: 'Northgate', name: '', description: '', classification: '',
        version: '', updated: '', source_images: null, visio_tabs: [],
        device_count: 1, edge_count: 0,
      },
      zones: {},
      devices: [{ id: 'd1', label: 'D1', zone: 'z', type: 'server' }],
      edges: [],
    },
  }

  it('passes clean inputs', () => {
    expect(crossFileFailures(inputs() as never)).toEqual([])
  })

  it('fails a mapping to a system the matrix does not carry', () => {
    const coverage = site({ mappings: { ghost: mapping({ devices: ['d1'] }) } })
    const fails = crossFileFailures(inputs({ coverage } as never) as never)
    expect(fails.some((f) => f.includes('ghost'))).toBe(true)
  })

  /**
   * The escape hatch is a documented negative fact, not a loophole to be
   * closed: it records that someone checked and the system is deliberately
   * absent from the matrix.
   */
  it('exempts a mapping that declares matrix_id_exists false', () => {
    const coverage = site({
      mappings: { atak: mapping({ devices: ['d1'], matrix_id_exists: false }) },
    })
    expect(
      crossFileFailures(inputs({ coverage, topologies: topology } as never) as never),
    ).toEqual([])
  })

  it('fails the flag pointed at an id the matrix does carry', () => {
    const coverage = site({
      mappings: { ucop: mapping({ devices: ['d1'], matrix_id_exists: false }) },
    })
    const fails = crossFileFailures(
      inputs({ coverage, topologies: topology } as never) as never,
    )
    expect(fails.some((f) => f.includes('matrix_id_exists:false'))).toBe(true)
  })

  it('fails hardware mapped to a shortfall row, as the ingest does', () => {
    const gapRow = { ...SYSTEM, id: 'gap', name: 'Gap', category: 'Workflow shortfall' }
    const coverage = site({ mappings: { gap: mapping({ devices: ['d1'] }) } })
    const fails = crossFileFailures(
      inputs({ systems: [SYSTEM, gapRow], coverage, topologies: topology } as never) as never,
    )
    expect(fails).toHaveLength(1)
    expect(fails[0]).toMatch(/gap.*shortfall/)
  })

  it('fails a shortfall row mapped with no devices, as the ingest does', () => {
    // Mirrors test_a_shortfall_row_mapped_with_no_devices_fails_too.
    const gapRow = { ...SYSTEM, id: 'gap', name: 'Gap', category: 'Workflow shortfall' }
    const coverage = site({ mappings: { gap: mapping({ devices: [] }) } })
    const fails = crossFileFailures(
      inputs({ systems: [SYSTEM, gapRow], coverage, topologies: topology } as never) as never,
    )
    expect(fails).toHaveLength(1)
    expect(fails[0]).toMatch(/not_deployed_at_site/)
  })

  it('passes a shortfall row checked absent, as the ingest does', () => {
    // Mirrors test_a_shortfall_row_checked_absent_is_fine.
    const gapRow = { ...SYSTEM, id: 'gap', name: 'Gap', category: 'Workflow shortfall' }
    const coverage = site({ not_deployed_at_site: { gap: 'checked, absent' } })
    expect(
      crossFileFailures(
        inputs({ systems: [SYSTEM, gapRow], coverage, topologies: topology } as never) as never,
      ),
    ).toEqual([])
  })

  it('fails a not_deployed_at_site entry for an unknown system', () => {
    const coverage = site({ not_deployed_at_site: { ghost: 'checked' } })
    const fails = crossFileFailures(inputs({ coverage } as never) as never)
    expect(fails.some((f) => f.includes('ghost'))).toBe(true)
  })

  it('fails a mapping naming a device the topology does not have', () => {
    const coverage = site({ mappings: { ucop: mapping({ devices: ['nosuchdevice'] }) } })
    const fails = crossFileFailures(
      inputs({ coverage, topologies: topology } as never) as never,
    )
    expect(fails.some((f) => f.includes('nosuchdevice'))).toBe(true)
  })

  it('fails unclaimed hardware the topology does not have', () => {
    const coverage = site({ unclaimed_devices: { infrastructure: ['nosuchdevice'] } })
    const fails = crossFileFailures(
      inputs({ coverage, topologies: topology } as never) as never,
    )
    expect(fails.some((f) => f.includes('unclaimed_devices'))).toBe(true)
  })

  /**
   * Without the site's topology there is nothing to check against, and
   * inventing a failure would block a legitimate partial load. The panel takes
   * topologies one file at a time, so a partial set is the normal case here.
   */
  it('skips the device gates when no topology was supplied for the site', () => {
    const coverage = site({ mappings: { ucop: mapping({ devices: ['anything'] }) } })
    expect(crossFileFailures(inputs({ coverage } as never) as never)).toEqual([])
  })

  it('fails a link whose end is not a matrix system id', () => {
    const links = [{
      from: 'ucop', to: 'phantom', label: 'x', extraction_method: 'override' as const,
    }]
    const fails = crossFileFailures(inputs({ links } as never) as never)
    expect(fails.some((f) => f.includes('phantom'))).toBe(true)
  })

  it('fails a crosswalk row naming a system the matrix does not carry', () => {
    const requirements = [{ ...REQUIREMENT, current: ['No Such System'] }]
    const fails = crossFileFailures(inputs({ requirements } as never) as never)
    expect(fails.some((f) => f.includes('No Such System'))).toBe(true)
  })

  it('collects every failure rather than stopping at the first', () => {
    const coverage = site({
      mappings: { ghost: mapping({ devices: ['d1'] }) },
      not_deployed_at_site: { alsoghost: 'checked' },
    })
    const links = [{
      from: 'ucop', to: 'phantom', label: 'x', extraction_method: 'override' as const,
    }]
    const fails = crossFileFailures(inputs({ coverage, links } as never) as never)
    expect(fails.length).toBeGreaterThanOrEqual(3)
  })

  /**
   * The one gate of validate() that is deliberately absent. mergeGlossary
   * decided the opposite for the opposite reason: a partial glossary costs no
   * correctness, so refusing a load over it would cost the analyst their
   * matrix, links, coverage and topologies to protect nothing.
   */
  it('says nothing about a glossary, which is not its business', () => {
    expect(crossFileFailures(inputs() as never)).toEqual([])
  })
})

/**
 * The same gates, through a real load of real files.
 *
 * This is the defect: the browser path shape-normalised, tallied confidence
 * and threw only on JSON and shape errors, so every cross-file inconsistency
 * that the CLI gate refuses loaded silently and became a number on a card. The
 * browser path is the one an analyst points at their own hand-maintained
 * files, which makes it more likely to carry one, not less.
 *
 * Every id and device invented below is invented for these tests.
 */
describe('a load refuses files that disagree with each other', () => {
  const jsonFile = (name: string, body: unknown) =>
    new File([JSON.stringify(body)], name)

  const readInput = (relative: string) =>
    JSON.parse(readFileSync(join(workspace, relative), 'utf-8'))

  it('refuses an sdmap mapping naming a system the matrix lacks', async () => {
    const sdmap = readInput('system_device_map.json')
    sdmap.sites.northgate.mappings.ghost_system = {
      confidence: 'high', devices: [], note: 'invented for this test',
    }
    const p = new LocalFileProvider()
    await expect(
      p.load({
        matrix: file('matrix.xlsx'),
        systemDeviceMap: jsonFile('system_device_map.json', sdmap),
      }),
    ).rejects.toThrow(/ghost_system: not a matrix system id/)
  })

  it('reads a mapping with no devices key as naming no hardware, as the ingest does', async () => {
    // The ingest reads entry.get("devices"). The browser used to read
    // mapping.devices.length and crash before any gate could name the row.
    const sdmap = readInput('system_device_map.json')
    delete sdmap.sites.northgate.mappings.homing.devices
    const p = new LocalFileProvider()
    await p.load({
      matrix: file('matrix.xlsx'),
      systemDeviceMap: jsonFile('system_device_map.json', sdmap),
    })
    const coverage = await p.getCoverage()
    expect(coverage.sites.northgate.mappings.homing.devices).toEqual([])
  })

  it('refuses a mapping naming a device the topology does not have', async () => {
    const sdmap = readInput('system_device_map.json')
    sdmap.sites.northgate.mappings.ucop.devices = ['no_such_device']
    const p = new LocalFileProvider()
    await expect(
      p.load({
        matrix: file('matrix.xlsx'),
        systemDeviceMap: jsonFile('system_device_map.json', sdmap),
        topologies: { northgate: file(join('sites', 'northgate.json')) },
      }),
    ).rejects.toThrow(/no_such_device' is not in the northgate topology/)
  })

  it('refuses an override link naming a system that does not exist', async () => {
    const overrides = readInput('overrides.json')
    overrides.cross_links.push({
      from: 'ucop', to: 'phantom_system', label: 'invented for this test',
    })
    const p = new LocalFileProvider()
    await expect(
      p.load({
        matrix: file('matrix.xlsx'),
        overrides: jsonFile('overrides.json', overrides),
      }),
    ).rejects.toThrow(/'phantom_system' is not a matrix system id/)
  })

  it('names every disagreement in one message, not just the first', async () => {
    const sdmap = readInput('system_device_map.json')
    sdmap.sites.northgate.mappings.ghost_system = {
      confidence: 'high', devices: [], note: 'invented for this test',
    }
    sdmap.sites.northgate.not_deployed_at_site = { another_ghost: 'checked' }
    const p = new LocalFileProvider()
    const failure = await p
      .load({
        matrix: file('matrix.xlsx'),
        systemDeviceMap: jsonFile('system_device_map.json', sdmap),
      })
      .then(() => null, (error: Error) => error)
    expect(failure?.message).toMatch(/ghost_system/)
    expect(failure?.message).toMatch(/another_ghost/)
    expect(failure?.message).toMatch(/2 cross-file integrity failure/)
  })

  /**
   * Refusing is only defensible because it costs the analyst nothing they
   * had. The load is atomic and the data already on screen survives it.
   */
  it('leaves the previously loaded data untouched', async () => {
    const p = await makeLocalProvider()
    expect(await p.getSystems()).toHaveLength(32)

    const sdmap = readInput('system_device_map.json')
    sdmap.sites.northgate.mappings.ghost_system = {
      confidence: 'high', devices: [], note: 'invented for this test',
    }
    await expect(
      p.load({
        matrix: file('matrix.xlsx'),
        systemDeviceMap: jsonFile('system_device_map.json', sdmap),
      }),
    ).rejects.toThrow()
    expect(await p.getSystems()).toHaveLength(32)
    expect((await p.getCoverage()).sites.northgate.mappings.ghost_system)
      .toBeUndefined()
  })

  /**
   * The sample inputs are what the CLI gate passes, so they must load here
   * too. If this ever fails, the two paths have stopped refusing the same
   * files and one of them is wrong.
   */
  it('still loads the sample inputs the CLI gate passes', async () => {
    expect(await (await makeLocalProvider()).getSystems()).toHaveLength(32)
  })
})
