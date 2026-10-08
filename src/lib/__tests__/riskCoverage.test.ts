import { describe, expect, it } from 'vitest'

import { StaticProvider } from '../../data/StaticProvider'
import type {
  CoverageMatrix,
  CoverageSite,
  Mapping,
  RiskLevel,
  System,
} from '../../types/atlas'
import { isShortfall, matrixIdSet, realizedAnywhere } from '../coverage'
import {
  bandSentence,
  realizationSitesBySystem,
  riskBandCoverage,
} from '../riskCoverage'

function system(id: string, risk: RiskLevel, over: Partial<System> = {}): System {
  return {
    id,
    name: id.toUpperCase(),
    label: id.toUpperCase(),
    category: 'Deployed asset record',
    owner_group_id: 'cbp',
    owner_group: 'CBP',
    color_key: 'cbp',
    confirmed: true,
    risk,
    risk_source: 'explicit',
    detail: '',
    integrations_prose: '',
    ...over,
  }
}

function mapping(over: Partial<Mapping> = {}): Mapping {
  return { devices: ['d1'], note: '', confidence: 'high', ...over }
}

function site(mappings: Record<string, Mapping>): CoverageSite {
  return {
    label: 'Test site',
    scope: '',
    mappings,
    not_deployed_at_site: {},
    unclaimed_devices: { infrastructure: [] },
  }
}

function coverage(sites: Record<string, CoverageSite>): CoverageMatrix {
  return { default_site: null, sites, pending_review: {}, confidence_counts: {} }
}

describe('shortfall rows', () => {
  it('are not systems, so no risk band counts them', () => {
    const bands = riskBandCoverage(
      [system('alpha', 'high'), system('gap', 'high', { category: 'Exchange shortfall' })],
      coverage({ yard: site({ alpha: mapping() }) }),
    )
    const high = bands.find((b) => b.risk === 'high')!
    expect(high.total).toBe(1)
  })
})

describe('realizationSitesBySystem', () => {
  it('names every site a system is realized at, sorted', () => {
    const sites = realizationSitesBySystem(
      coverage({
        westfield: site({ a: mapping() }),
        northgate: site({ a: mapping(), b: mapping() }),
      }),
      new Set(['a', 'b']),
    )
    expect(sites.get('a')).toEqual(['northgate', 'westfield'])
    expect(sites.get('b')).toEqual(['northgate'])
  })

  it('holds no key for a system no site realizes', () => {
    // The shared predicate's two rejections: no hardware named, and an id the
    // matrix does not carry. Neither is coverage, so neither gets an entry.
    const sites = realizationSitesBySystem(
      coverage({
        northgate: site({ a: mapping({ devices: [] }), stray: mapping() }),
      }),
      new Set(['a', 'b']),
    )
    expect(sites.has('a')).toBe(false)
    expect(sites.has('stray')).toBe(false)
  })
})

describe('riskBandCoverage', () => {
  it('derives the bands from the data rather than assuming three', () => {
    const bands = riskBandCoverage(
      [system('a', 'high'), system('b', 'high'), system('c', 'medium')],
      coverage({}),
    )
    expect(bands.map((b) => b.risk)).toEqual(['high', 'medium'])
    expect(bands.map((b) => b.total)).toEqual([2, 1])
  })

  it('reads worst first, and keeps a band it has never seen rather than dropping it', () => {
    // The cast is the point of the test: a bundle whose vocabulary grows must
    // still render, and must not be allowed to sort itself above high risk.
    const exotic = 'catastrophic' as unknown as RiskLevel
    const bands = riskBandCoverage(
      [system('a', 'low'), system('b', exotic), system('c', 'high'), system('d', 'medium')],
      coverage({}),
    )
    expect(bands.map((b) => b.risk)).toEqual(['high', 'medium', 'low', 'catastrophic'])
  })

  it('counts a system realized when any one site realizes it', () => {
    const bands = riskBandCoverage(
      [system('a', 'high'), system('b', 'high')],
      coverage({
        northgate: site({ a: mapping() }),
        westfield: site({ a: mapping(), b: mapping({ devices: [] }) }),
      }),
      )
    expect(bands[0].realized.map((r) => r.system.id)).toEqual(['a'])
    expect(bands[0].realized[0].sites).toEqual(['northgate', 'westfield'])
    expect(bands[0].unrealized.map((s) => s.id)).toEqual(['b'])
  })

  it('leaves no system out of exactly one of the two lists', () => {
    const bands = riskBandCoverage(
      [system('a', 'high'), system('b', 'high'), system('c', 'low')],
      coverage({ northgate: site({ a: mapping() }) }),
    )
    for (const band of bands) {
      expect(band.realized.length + band.unrealized.length).toBe(band.total)
    }
  })

  it('reports the share of the band, not of the whole estate', () => {
    const bands = riskBandCoverage(
      [system('a', 'high'), system('b', 'high'), system('c', 'low'), system('d', 'low')],
      coverage({ northgate: site({ a: mapping() }) }),
    )
    expect(bands[0].pct).toBe(50)
    expect(bands[1].pct).toBe(0)
  })

  it('does not divide by an empty band', () => {
    expect(riskBandCoverage([], coverage({}))).toEqual([])
  })

  it('sorts both lists by name so a reader can find a system in them', () => {
    const bands = riskBandCoverage(
      [
        system('z', 'high', { name: 'Alpha' }),
        system('a', 'high', { name: 'Zulu' }),
      ],
      coverage({}),
    )
    expect(bands[0].unrealized.map((s) => s.name)).toEqual(['Alpha', 'Zulu'])
  })
})

describe('bandSentence', () => {
  const band = (total: number, realized: number) =>
    riskBandCoverage(
      Array.from({ length: total }, (_, i) => system(`s${i}`, 'high')),
      coverage({
        northgate: site(
          Object.fromEntries(
            Array.from({ length: realized }, (_, i) => [`s${i}`, mapping()]),
          ),
        ),
      }),
    )[0]

  it('states the band, its size and how much of it is confirmed', () => {
    expect(bandSentence(band(11, 2))).toBe(
      'Of 11 high-risk systems, 2 are confirmed deployed at any site.',
    )
  })

  it('agrees with itself in number', () => {
    expect(bandSentence(band(1, 1))).toBe(
      'Of 1 high-risk system, 1 is confirmed deployed at any site.',
    )
    expect(bandSentence(band(3, 0))).toBe(
      'Of 3 high-risk systems, 0 are confirmed deployed at any site.',
    )
  })
})

/**
 * The committed sample bundle, so the figures the panel prints are pinned to
 * data a reviewer can open rather than to a fixture written to agree.
 */
describe('the sample bundle', () => {
  it('splits its realized systems across the bands the matrix declares', async () => {
    const provider = new StaticProvider('/data')
    const systems = await provider.getSystems()
    const cov = await provider.getCoverage()
    const bands = riskBandCoverage(systems, cov)

    // The flat headline is 10 of 30, and it hides that the high band is the
    // worst covered of the three. The two shortfall rows are both high risk
    // and are in no band, as they are in no realization figure.
    expect(
      bands.map((b) => [b.risk, b.total, b.realized.length]),
    ).toEqual([
      ['high', 9, 2],
      ['medium', 19, 8],
      ['low', 2, 0],
    ])

    // Every band's total sums to the systems that could be fielded, and every
    // band's realized systems sum to the same set the realization gap counts.
    expect(bands.reduce((n, b) => n + b.total, 0)).toBe(
      systems.filter((s) => !isShortfall(s)).length,
    )
    expect(
      bands.flatMap((b) => b.realized.map((r) => r.system.id)).sort(),
    ).toEqual(realizedAnywhere(cov, matrixIdSet(systems)))
  })

  it('names the sites behind a realized high-risk system', async () => {
    const provider = new StaticProvider('/data')
    const bands = riskBandCoverage(
      await provider.getSystems(),
      await provider.getCoverage(),
    )
    const high = bands[0]
    // Verified: only Northgate has been surveyed, so every realization is there.
    for (const entry of high.realized) expect(entry.sites).toEqual(['northgate'])
    expect(high.realized.map((r) => r.system.id)).toEqual(['bastion', 'fpsrel'])
  })
})
