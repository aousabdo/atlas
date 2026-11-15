import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { LocalFileProvider, normaliseSystemDeviceMap } from '../../data/LocalFileProvider'
import type { CoverageMatrix } from '../../types/atlas'
import {
  canonicalJson, canonicalMapJson, exportSystemDeviceMap, LOCAL_EXPORT_NAME, SAMPLE_EXPORT_NAME,
} from '../serialise'

const CASES = join(process.cwd(), 'fixtures', 'parity', 'curation')
const outFiles = readdirSync(CASES).filter((name) => name.endsWith('.out.json')).sort()

const sampleCoverage = (): CoverageMatrix =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'fixtures', 'synthetic', 'coverage.json'), 'utf-8'),
  ) as CoverageMatrix

describe('canonicalJson', () => {
  it('writes what json.dumps(sort_keys=True, indent=2, ensure_ascii=False) writes', () => {
    // The literal is Python's own output for the same value.
    expect(canonicalJson({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: 'é' } })).toBe(
      '{\n  "a": {\n    "c": "é",\n    "d": [\n      3,\n      {\n        "e": 2,\n' +
        '        "f": 1\n      }\n    ]\n  },\n  "b": 1\n}\n',
    )
  })

  /**
   * JSON.stringify always writes integer-like keys first and in numeric order,
   * whatever order they were added in, so it would put "9" before "10". A
   * topology's device ids can be numbers, and they key the checked devices.
   */
  it('orders keys that look like numbers as text, as Python does', () => {
    expect(canonicalJson({ '10': 1, '9': 2, b: 3, e: {}, f: [] })).toBe(
      '{\n  "10": 1,\n  "9": 2,\n  "b": 3,\n  "e": {},\n  "f": []\n}\n',
    )
  })
})

describe('canonicalMapJson', () => {
  it('has canonical cases to re-read', () => {
    expect(outFiles.length).toBeGreaterThan(0)
  })

  for (const file of outFiles) {
    it(`writes ${file} back unchanged when it is read as the map`, () => {
      const text = readFileSync(join(CASES, file), 'utf-8')
      expect(canonicalMapJson(JSON.parse(text) as Record<string, unknown>)).toBe(text)
    })
  }
})

describe('exportSystemDeviceMap', () => {
  it('names the unedited sample as the sample, and stamps it as synthetic', () => {
    const { fileName, text } = exportSystemDeviceMap({
      raw: null, coverage: sampleCoverage(), source: 'sample', today: '2026-11-13',
    })
    expect(fileName).toBe(SAMPLE_EXPORT_NAME)
    expect(fileName).toBe('atlas-sample-system-device-map.json')
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(parsed._version).toBe('0.2-sample')
    expect(parsed._comment).toContain('2026-11-13')
    expect(parsed._comment).toContain('describes no real site')
    expect(text).not.toContain('confidence_counts')
    expect(Object.keys(parsed).sort()).toEqual(
      ['_comment', '_version', 'default_site', 'pending_review', 'sites'],
    )
  })

  it("keeps the analyst's own top-level keys, and stamps nothing of its own", () => {
    const raw = {
      _comment: 'analyst note',
      owner: 'range team',
      default_site: 'yard',
      sites: { yard: { label: 'Yard', mappings: { alpha: { devices: ['yard_cam'] } } } },
    }
    const before = structuredClone(raw)
    const { fileName, text } = exportSystemDeviceMap({
      raw, coverage: normaliseSystemDeviceMap(raw, new Set()), source: 'local', today: '2026-11-13',
    })
    expect(fileName).toBe(LOCAL_EXPORT_NAME)
    expect(fileName).toBe('system_device_map.json')
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(parsed._comment).toBe('analyst note')
    expect(parsed.owner).toBe('range team')
    expect(parsed).not.toHaveProperty('_version')
    // Unedited, the export is the canonical form of the file that was loaded.
    expect(text).toBe(canonicalMapJson(raw))
    // The source map is kept for every later export, so reading it must not change it.
    expect(raw).toEqual(before)
  })

  /**
   * Local data loaded with no map file has no source map either. Stamping it
   * "synthetic sample" would mislabel the analyst's own load.
   */
  it('does not stamp a local load that had no map file as the sample', () => {
    const coverage = normaliseSystemDeviceMap(null, new Set())
    const { fileName, text } = exportSystemDeviceMap({
      raw: null, coverage, source: 'local', today: '2026-11-13',
    })
    expect(fileName).toBe(LOCAL_EXPORT_NAME)
    expect(JSON.parse(text)).toEqual({ default_site: null, sites: {}, pending_review: {} })
  })
})

describe('LocalFileProvider.getSourceSystemDeviceMap', () => {
  // The analyst's inputs, fabricated afresh as src/data/__tests__/localfile.test.ts does.
  const workspace = mkdtempSync(join(tmpdir(), 'atlas-serialise-inputs-'))
  execFileSync(
    process.execPath, [join(process.cwd(), 'scripts', 'make-sample-workbook.mjs'), workspace],
    { stdio: 'pipe' },
  )
  afterAll(() => rmSync(workspace, { recursive: true, force: true }))

  const file = (name: string) => new File([readFileSync(join(workspace, name))], basename(name))

  it('returns the map file as it was parsed', async () => {
    const p = new LocalFileProvider()
    await p.load({ matrix: file('matrix.xlsx'), systemDeviceMap: file('system_device_map.json') })
    expect(await p.getSourceSystemDeviceMap()).toEqual(
      JSON.parse(readFileSync(join(workspace, 'system_device_map.json'), 'utf-8')),
    )
  })

  it('returns null when no map file was loaded', async () => {
    const p = new LocalFileProvider()
    await p.load({ matrix: file('matrix.xlsx') })
    expect(await p.getSourceSystemDeviceMap()).toBeNull()
  })
})
