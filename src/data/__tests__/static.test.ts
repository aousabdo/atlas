import { afterEach, describe, expect, it, vi } from 'vitest'

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

/**
 * A snapshot the manifest indexes and the host will not serve.
 *
 * Every label in manifest.snapshots is evidence the file was meant to exist:
 * bundle.py builds that list by globbing the snapshot files it has just
 * written. getSnapshots used to `.catch(() => null)` each one and filter the
 * nulls out, so three 404s and a thrown TypeError both came back as [], which
 * TrendView states as "This bundle carries none, so there is nothing to
 * compare". That is a claim about the data made out of a claim about the
 * network, and README's "Distinguish 'no data' from 'failed to load'" is the
 * rule it broke.
 *
 * The fetch stub in src/test/setup.ts serves the committed bundles, so these
 * cases install their own and put it back afterwards.
 */
describe('a snapshot that will not load is a failure, not an empty history', () => {
  const REAL_FETCH = globalThis.fetch

  const MANIFEST = {
    bundle_version: 1,
    tool_version: 'test',
    built_at: '2026-08-05T00:00:00',
    git_sha: 'x',
    source_label: 'test',
    baseline_date: '2026-03-05',
    snapshots: ['2026-06-01', '2026-07-01', '2026-08-01'],
    counts: {},
  }

  /** Invented, and shaped like what bundle.py writes. */
  const snapshot = (label: string) => ({
    label,
    built_at: `${label}T00:00:00`,
    git_sha: 'x',
    dimensions: [{
      key: 'requirement_attrition',
      label: 'Requirement attrition',
      numerator: 9,
      denominator: 11,
      value_pct: 81.8,
      unit: 'pct',
      severity: 'watch',
    }],
  })

  /** Serve the manifest; let the caller decide what each snapshot does. */
  function serve(snapshotResponse: (label: string) => Response) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) {
        return new Response(JSON.stringify(MANIFEST), { status: 200 })
      }
      return snapshotResponse(url.split('/').pop()!.replace('.json', ''))
    })
  }

  afterEach(() => vi.stubGlobal('fetch', REAL_FETCH))

  it('rejects rather than returning [] when every snapshot 404s', async () => {
    serve(() => new Response('not found', { status: 404 }))
    const p = new StaticProvider('/data')
    await expect(p.getSnapshots()).rejects.toBeInstanceOf(AtlasDataError)
  })

  it('rejects rather than returning [] when the network is gone', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (String(input).endsWith('manifest.json')) {
        return new Response(JSON.stringify(MANIFEST), { status: 200 })
      }
      throw new TypeError('Failed to fetch')
    })
    const p = new StaticProvider('/data')
    await expect(p.getSnapshots()).rejects.toBeInstanceOf(AtlasDataError)
  })

  /**
   * The worse case. Two of three arriving used to render a table with a
   * first-to-last change computed across a hole nothing disclosed.
   */
  it('rejects when only one of three is missing, rather than hiding the hole', async () => {
    serve((label) =>
      label === '2026-07-01'
        ? new Response('not found', { status: 404 })
        : new Response(JSON.stringify(snapshot(label)), { status: 200 }),
    )
    const p = new StaticProvider('/data')
    await expect(p.getSnapshots()).rejects.toThrow(/2026-07-01/)
  })

  it('names every label that failed, not just the first', async () => {
    serve((label) =>
      label === '2026-06-01'
        ? new Response(JSON.stringify(snapshot(label)), { status: 200 })
        : new Response('not found', { status: 404 }),
    )
    const p = new StaticProvider('/data')
    await expect(p.getSnapshots()).rejects.toThrow(/2026-07-01, 2026-08-01/)
  })

  it('still returns the snapshots when they all load', async () => {
    serve((label) => new Response(JSON.stringify(snapshot(label)), { status: 200 }))
    const p = new StaticProvider('/data')
    expect((await p.getSnapshots()).map((s) => s.label))
      .toEqual(['2026-06-01', '2026-07-01', '2026-08-01'])
  })

  /**
   * An empty index is the one thing that still means "no history yet", which
   * is what the provider interface promises and what the empty state is for.
   */
  it('returns [] when the manifest indexes no snapshots at all', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
      String(input).endsWith('manifest.json')
        ? new Response(JSON.stringify({ ...MANIFEST, snapshots: [] }), { status: 200 })
        : new Response('not found', { status: 404 }),
    )
    const p = new StaticProvider('/data')
    expect(await p.getSnapshots()).toEqual([])
  })

  /**
   * No index at all is a guess, not evidence, so a miss stays tolerated. No
   * bundle this code emits looks like this; the fallback predates the index.
   */
  it('tolerates a miss on the guessed label when there is no index', async () => {
    const { snapshots: _dropped, ...noIndex } = MANIFEST
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
      String(input).endsWith('manifest.json')
        ? new Response(JSON.stringify(noIndex), { status: 200 })
        : new Response('not found', { status: 404 }),
    )
    const p = new StaticProvider('/data')
    expect(await p.getSnapshots()).toEqual([])
  })

  /**
   * The air-gapped export must not be able to fail this way, and the reason is
   * structural: build-singlefile.mjs walks all of public/data, snapshots
   * included, so `get` answers from window.__ATLAS_DATA__ before it reaches a
   * fetch. The fetch below would reject if it were ever called.
   */
  it('serves inlined snapshots without fetching at all', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('the standalone build must never fetch')
    })
    window.__ATLAS_DATA__ = {
      'manifest.json': { ...MANIFEST, snapshots: ['2026-06-01'] },
      'snapshots/2026-06-01.json': snapshot('2026-06-01'),
    }
    try {
      const p = new StaticProvider('/definitely-not-a-real-path')
      expect((await p.getSnapshots()).map((s) => s.label)).toEqual(['2026-06-01'])
    } finally {
      delete window.__ATLAS_DATA__
    }
  })
})
