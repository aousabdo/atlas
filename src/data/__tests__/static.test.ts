import { describe, expect, it } from 'vitest'

import { AtlasDataError } from '../provider'
import { StaticProvider } from '../StaticProvider'
import { runProviderContract } from './contract'

// The fetch stub in src/test/setup.ts serves the committed bundles, so this
// exercises the real StaticProvider code path rather than reaching around it.
runProviderContract('StaticProvider', async () => new StaticProvider('/data'))

describe('StaticProvider error handling', () => {
  it('reports a failed load as an error, never as empty data', async () => {
    const p = new StaticProvider('/data')
    await expect(p.getTopology('atlantis')).rejects.toBeInstanceOf(AtlasDataError)
  })

  it('names the resource that failed', async () => {
    const p = new StaticProvider('/nowhere')
    await expect(p.getManifest()).rejects.toThrow(/manifest\.json/)
  })

  it('does not cache a failure, so a retry can succeed', async () => {
    const p = new StaticProvider('/nowhere')
    await expect(p.getManifest()).rejects.toThrow()
    // Second call re-requests rather than replaying the rejection.
    await expect(p.getManifest()).rejects.toThrow()
  })

  it('serves inlined data without fetching when the page is standalone', async () => {
    window.__ATLAS_DATA__ = {
      'manifest.json': {
        bundle_version: 1, tool_version: 'inline', built_at: '2026-08-05T00:00:00',
        git_sha: 'x', source_label: 'inline', baseline_date: '2026-03-05',
        snapshots: [], counts: { systems: 32 },
      },
    }
    try {
      const p = new StaticProvider('/definitely-not-a-real-path')
      expect((await p.getManifest()).tool_version).toBe('inline')
    } finally {
      delete window.__ATLAS_DATA__
    }
  })
})
