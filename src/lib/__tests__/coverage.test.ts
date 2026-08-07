import { cleanup, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import { StaticProvider } from '../../data/StaticProvider'
import { renderWithProvider } from '../../test/renderWithProvider'
import { AnalyticsTab } from '../../tabs/analytics/AnalyticsTab'
import { NetworkTab } from '../../tabs/network/NetworkTab'
import { ReferenceTab } from '../../tabs/reference/ReferenceTab'
import type { Mapping } from '../../types/atlas'
import {
  countMappings,
  formatPercent,
  isRealizedMapping,
  matrixIdSet,
  percentOf,
  realizedAnywhere,
  realizedConfidenceCounts,
  realizedSystemIds,
} from '../coverage'
import { computeLossiness } from '../lossiness'

const MATRIX = new Set(['ucop', 'recon', 'homing'])

function mapping(over: Partial<Mapping> = {}): Mapping {
  return { devices: ['d1'], note: '', confidence: 'high', ...over }
}

describe('isRealizedMapping', () => {
  it('accepts a mapping that names hardware and is a matrix system', () => {
    expect(isRealizedMapping('ucop', mapping(), MATRIX)).toBe(true)
  })

  it('rejects a mapping that names no hardware', () => {
    expect(isRealizedMapping('homing', mapping({ devices: [] }), MATRIX)).toBe(false)
  })

  it('rejects a mapping the matrix does not carry', () => {
    expect(isRealizedMapping('atak', mapping(), MATRIX)).toBe(false)
  })

  it('rejects a mapping that declares itself outside the matrix', () => {
    // Belt and braces: the curator's flag is honoured even when a stale
    // matrix still happens to carry the id.
    expect(
      isRealizedMapping('ucop', mapping({ matrix_id_exists: false }), MATRIX),
    ).toBe(false)
  })
})

describe('countMappings', () => {
  const site = {
    label: 'Test',
    scope: '',
    mappings: {
      ucop: mapping(),
      recon: mapping({ devices: ['d1', 'd2'] }),
      homing: mapping({ devices: [] }),
      atak: mapping({ matrix_id_exists: false }),
    },
    not_deployed_at_site: {},
    unclaimed_devices: { infrastructure: [] },
  }

  it('splits the recorded mappings into three disjoint buckets', () => {
    const counts = countMappings(site, MATRIX)
    expect(counts).toEqual({
      recorded: 4,
      realized: 2,
      softwareOnly: 1,
      outsideMatrix: 1,
    })
  })

  it('never loses or double counts a mapping', () => {
    const c = countMappings(site, MATRIX)
    expect(c.realized + c.softwareOnly + c.outsideMatrix).toBe(c.recorded)
  })
})

describe('formatPercent', () => {
  it('prints whole percent, because the ratios are small integers', () => {
    expect(formatPercent(percentOf(10, 32))).toBe('31%')
  })

  it('prints the same string for a value already rounded to a tenth', () => {
    // 31.2 is what the ingest records; 31.25 is what a tab recomputes. Both
    // must reach the reader as the same figure.
    expect(formatPercent(31.2)).toBe(formatPercent(percentOf(10, 32)))
  })

  it('leaves an empty denominator at zero rather than dividing by it', () => {
    expect(formatPercent(percentOf(0, 0))).toBe('0%')
  })
})

/**
 * The regression this file exists for.
 *
 * Three tabs used to print three different answers to "how many systems are
 * mapped at Northgate": 13 (mapping rows), 11 (rows naming hardware) and 10
 * (rows naming hardware that are also matrix systems). 10 is the definition;
 * the others are real facts that must carry their own labels.
 *
 * Every consumer is exercised through its own code path here, so the test
 * fails if any one of them starts computing the figure its own way again.
 */
describe('every consumer agrees on what mapped means', () => {
  it('reports one realized count in the library, the bundle and all three tabs', async () => {
    const provider = new StaticProvider('/data')
    const systems = await provider.getSystems()
    const coverage = await provider.getCoverage()
    const bundled = await provider.getLossiness()
    const matrixIds = matrixIdSet(systems)

    // 1. The predicate, applied directly.
    const realized = realizedSystemIds(coverage.sites.northgate, matrixIds)
    expect(realized.length).toBeGreaterThan(0)
    expect(realized.length).toBeLessThan(
      Object.keys(coverage.sites.northgate.mappings).length,
    )

    // 2. The Python ingest's own tally, carried in the bundle.
    const perSite = bundled.dimensions.find((d) => d.key === 'realization_gap')!.detail
      .per_site as Record<string, { mapped: number }>
    expect(perSite.northgate.mapped).toBe(realized.length)

    // 3. The browser recomputation LocalFileProvider serves.
    const recomputed = computeLossiness({
      systems,
      links: await provider.getLinks(),
      requirements: await provider.getRequirements(),
      coverage,
      topologies: {
        northgate: await provider.getTopology('northgate'),
        westfield: await provider.getTopology('westfield'),
      },
    })
    const recomputedGap = recomputed.dimensions.find(
      (d) => d.key === 'realization_gap',
    )!
    expect(recomputedGap.numerator).toBe(realizedAnywhere(coverage, matrixIds).length)
    expect(
      (recomputedGap.detail.per_site as Record<string, { mapped: number }>).northgate
        .mapped,
    ).toBe(realized.length)

    // 4. The confidence buckets, which grade exactly the realized mappings.
    const buckets = realizedConfidenceCounts(coverage, matrixIds)
    expect(buckets.total).toBe(realizedAnywhere(coverage, matrixIds).length)
    expect(coverage.confidence_counts.total).toBe(buckets.total)

    const share = formatPercent(percentOf(realized.length, systems.length))

    // 5. The Network tab, which labels both the realized systems and the
    //    mapping rows rather than printing one under the other's name.
    const network = await renderWithProvider(createElement(NetworkTab))
    expect(
      await screen.findByText(new RegExp(`${realized.length} systems realized`)),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        new RegExp(
          `${Object.keys(coverage.sites.northgate.mappings).length} mappings recorded`,
        ),
      ),
    ).toBeInTheDocument()
    network.unmount()
    cleanup()

    // 6. The Analytics coverage panel.
    const analytics = await renderWithProvider(createElement(AnalyticsTab))
    expect(
      await screen.findByText(`${realized.length} / ${systems.length}`),
    ).toBeInTheDocument()
    expect(screen.getAllByText(share).length).toBeGreaterThan(0)
    analytics.unmount()
    cleanup()

    // 7. The Reference confidence section.
    await renderWithProvider(createElement(ReferenceTab))
    expect(
      await screen.findByText(`${realized.length} of ${systems.length}`),
    ).toBeInTheDocument()
    // One bullet per confidence grade, each a share of the same denominator.
    const graded = screen.getAllByText(
      new RegExp(`^\\d+ of ${buckets.total} realized mappings$`),
    )
    expect(graded).toHaveLength(3)
    expect(
      graded.reduce((sum, el) => sum + Number(el.textContent!.split(' ')[0]), 0),
    ).toBe(buckets.total)
    expect(screen.getAllByText(share).length).toBeGreaterThan(0)
  })
})
