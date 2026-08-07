import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LocalFileProvider } from '../LocalFileProvider'
import { runProviderContract } from './contract'

// No default: a path baked in here would point at one machine's checkout and
// silently decide the suite for everyone else.
const SOURCE = process.env.ATLAS_SOURCE_REPO ?? ''
const MINDMAP = SOURCE ? join(SOURCE, 'traceability', 'mindmap') : ''
const MATRIX = MINDMAP ? join(MINDMAP, 'matrix.xlsx') : ''

const haveReferenceData = MATRIX !== '' && existsSync(MATRIX)

function file(path: string, name: string): File {
  return new File([readFileSync(path)], name)
}

async function makeLocalProvider() {
  const p = new LocalFileProvider()
  await p.load({
    matrix: file(MATRIX, 'matrix.xlsx'),
    overrides: file(join(MINDMAP, 'overrides.json'), 'overrides.json'),
    glossary: file(join(MINDMAP, 'glossary.json'), 'glossary.json'),
    systemDeviceMap: file(join(MINDMAP, 'system_device_map.json'), 'system_device_map.json'),
    topologies: {
      northgate: file(
        join(SOURCE, 'northgate', 'northgate_network.json'), 'northgate_network.json',
      ),
      westfield: file(
        join(SOURCE, 'westfield', 'westfield_network.json'),
        'westfield_network.json',
      ),
    },
  })
  return p
}

// The same suite StaticProvider passes. If one goes green and the other does
// not, the TypeScript classifier has diverged from the Python one.
if (haveReferenceData) {
  runProviderContract('LocalFileProvider', makeLocalProvider)
} else {
  describe.skip('AtlasDataProvider contract: LocalFileProvider', () => {
    it('needs the reference workbook', () => {})
  })
}

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
    if (!haveReferenceData) return
    const p = await makeLocalProvider()
    expect(await p.getSystems()).toHaveLength(32)
    await expect(p.load({ matrix: new File(['x'], 'bad.xlsx') })).rejects.toThrow()
    // Still serving the good parse, not a half-built one.
    expect(await p.getSystems()).toHaveLength(32)
  })
})
