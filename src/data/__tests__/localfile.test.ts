import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { LocalFileProvider } from '../LocalFileProvider'
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
