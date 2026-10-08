import { describe, expect, it } from 'vitest'

import type {
  CoverageMatrix, CoverageSite, LinkSet, LossinessReport, Mapping, Requirement,
  System, Topology,
} from '../../types/atlas'
import { compositeIndex, computeLossiness, pct } from '../lossiness'

/**
 * THE MIRRORED TABLE. ingest/tests/test_lossiness.py carries the same one
 * under the same name, and the two must stay identical line for line.
 *
 * Nothing else compares the browser's arithmetic against the ingest's. The
 * provider contract runs the same assertions against both providers, but it
 * asserts counts and shapes and not a single percentage, so when the two
 * engines rounded 10 of 32 to 31.2 and 31.3 the whole suite stayed green and
 * the app printed both figures.
 *
 * Every ratio here whose denominator is 32 and whose numerator is even but not
 * a multiple of four lands EXACTLY on a half at the tenth place, which is the
 * only place the two rules could ever differ:
 *
 *   10 of 32 is 31.25, and rounds DOWN to 31.2, because 2 is even.
 *    6 of 32 is 18.75, and rounds UP   to 18.8, because 7 is odd.
 *
 * Both directions are here on purpose. A table of ties that all fell the same
 * way would pass just as happily against half-up.
 */
const PCT_CASES: Array<[number, number, number]> = [
  [0, 0, 0],
  [0, 32, 0],
  [32, 32, 100],
  [9, 11, 81.8],
  [1, 3, 33.3],
  [2, 32, 6.2],
  [6, 32, 18.8],
  [10, 32, 31.2],
  [14, 32, 43.8],
  [18, 32, 56.2],
  [22, 32, 68.8],
  [26, 32, 81.2],
  [30, 32, 93.8],
]

describe('pct', () => {
  it.each(PCT_CASES)('reports %i of %i as %f percent', (num, den, expected) => {
    expect(pct(num, den)).toBe(expected)
  })

  it('breaks a tie to even in both directions', () => {
    // The half-up rule this replaced returned 31.3 and 18.8. Asserting both
    // ties is what stops a future "just use Math.round" from passing.
    expect(pct(10, 32)).toBe(31.2)
    expect(pct(6, 32)).toBe(18.8)
  })

  it('leaves an empty denominator at zero rather than dividing by it', () => {
    expect(pct(3, 0)).toBe(0)
  })
})

const MATRIX_IDS = ['alpha', 'bravo']

function system(id: string, over: Partial<System> = {}): System {
  return {
    id,
    name: id.toUpperCase(),
    label: id.toUpperCase(),
    category: 'sensor',
    owner_group_id: 'og',
    owner_group: 'Owner Group',
    color_key: 'a',
    confirmed: true,
    risk: 'low',
    risk_source: 'explicit',
    detail: '',
    integrations_prose: '',
    ...over,
  }
}

function mapping(over: Partial<Mapping> = {}): Mapping {
  return { devices: ['dev-1'], note: '', confidence: 'high', ...over }
}

function site(mappings: Record<string, Mapping>): CoverageSite {
  return {
    label: 'Harbor Yard',
    scope: 'Harbor Yard',
    mappings,
    not_deployed_at_site: {},
    unclaimed_devices: { infrastructure: [] },
  }
}

function inputs(mappings: Record<string, Mapping>) {
  const systems = MATRIX_IDS.map((id) => system(id))
  const coverage: CoverageMatrix = {
    default_site: 'harbor',
    sites: { harbor: site(mappings) },
    pending_review: {},
    confidence_counts: {},
  }
  const links: LinkSet = { current: [], desired: [] }
  const requirements: Requirement[] = []
  const topologies: Record<string, Topology> = {}
  return { systems, links, requirements, coverage, topologies }
}

function realization(report: LossinessReport) {
  return report.dimensions.find((d) => d.key === 'realization_gap')!
}

describe('the realization gap leaves shortfall rows out', () => {
  it('counts neither realized nor unmapped a row that records a gap', () => {
    // Mirrors test_realization_gap_leaves_shortfall_rows_out in the ingest.
    const base = inputs({ alpha: mapping() })
    const report = computeLossiness({
      ...base,
      systems: [system('alpha'), system('gap', { category: 'Workflow shortfall', risk: 'high' })],
    })
    const gap = realization(report)
    expect([gap.numerator, gap.denominator]).toEqual([1, 1])
    expect(gap.detail.shortfalls).toEqual(['gap'])
    expect(gap.detail.unmapped).toEqual([])
    expect((gap.detail.per_site as Record<string, { total: number }>).harbor.total).toBe(1)
  })
})

/**
 * The bundle that used to be counted two ways at once.
 *
 * A mapping declaring matrix_id_exists false for an id the matrix DOES carry
 * passed the ingest's gates, and then the realization gap counted it (it
 * tested membership) while the confidence tally dropped it (it tested the
 * flag). Both figures render in one card in ConfidenceSection. The gate in
 * atlas_ingest.validate now refuses the bundle, and this asserts the browser
 * would have answered one way regardless.
 */
describe('the realization gap and the confidence tally agree', () => {
  it('does not count a mapping that declares itself outside the matrix', () => {
    const report = computeLossiness(
      inputs({
        alpha: mapping({ matrix_id_exists: false }),
        bravo: mapping(),
      }),
    )
    expect(realization(report).numerator).toBe(1)
    expect(realization(report).detail.per_site).toMatchObject({
      harbor: { mapped: 1, mapped_ids: ['bravo'] },
    })
  })

  it('does not count a mapping that names no hardware', () => {
    const report = computeLossiness(
      inputs({ alpha: mapping({ devices: [] }), bravo: mapping() }),
    )
    expect(realization(report).numerator).toBe(1)
  })
})

describe('compositeIndex', () => {
  it('averages the percentage dimensions in tenths, tie to even', () => {
    // 31.2 and 31.3 average to 31.25, a tie at the tenth place. 312 is even,
    // so it stands. The half-up mean this replaced returned 31.3.
    const report = {
      dimensions: [
        dimension('requirement_attrition', 31.2),
        dimension('ownership_ambiguity', 31.3),
      ],
      top_gaps: [],
    } as unknown as LossinessReport
    expect(compositeIndex(report)).toBe(31.2)
  })

  it('ignores the count dimensions rather than inventing a rate for them', () => {
    const report = {
      dimensions: [
        dimension('requirement_attrition', 50),
        { key: 'integration_gap', unit: 'count', value_pct: null },
      ],
      top_gaps: [],
    } as unknown as LossinessReport
    expect(compositeIndex(report)).toBe(50)
  })

  it('is zero when there is no percentage dimension to average', () => {
    expect(compositeIndex({ dimensions: [], top_gaps: [] } as LossinessReport)).toBe(0)
  })
})

function dimension(key: string, valuePct: number) {
  return { key, unit: 'pct' as const, value_pct: valuePct }
}
