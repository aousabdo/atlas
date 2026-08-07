import { describe, expect, it } from 'vitest'

import type { LossinessDimension, Severity } from '../../types/atlas'
import {
  ATTRITION_DEFAULT_HEIGHT,
  ATTRITION_DEFAULT_WIDTH,
  buildAttritionStages,
  layoutAttrition,
  type AttritionGeometry,
} from '../attrition'

function dimension(
  key: string,
  numerator: number,
  denominator: number,
  severity: Severity,
  unit: 'pct' | 'count' = 'pct',
): LossinessDimension {
  return {
    key,
    label: key,
    numerator,
    denominator,
    value_pct: unit === 'pct' ? Math.round((1000 * numerator) / denominator) / 10 : null,
    unit,
    severity,
    detail: {},
  }
}

/** The real 2026-08-05 figures, so the geometry is exercised on real shapes. */
const DIMENSIONS: LossinessDimension[] = [
  dimension('requirement_attrition', 9, 11, 'watch'),
  dimension('ownership_ambiguity', 23, 32, 'watch'),
  dimension('realization_gap', 10, 32, 'critical'),
  dimension('integration_gap', 13, 13, 'critical', 'count'),
  dimension('evidence_gap', 32, 32, 'ok'),
  dimension('orphaned_hardware', 59, 79, 'critical', 'count'),
  dimension('open_questions', 7, 7, 'watch', 'count'),
]

const SIZE = { width: ATTRITION_DEFAULT_WIDTH, height: ATTRITION_DEFAULT_HEIGHT }

function allPaths(geometry: AttritionGeometry): string {
  return [
    ...geometry.bands.flatMap((b) => [b.keptPath, b.lossPath]),
    ...geometry.arrows.map((a) => a.path),
  ].join(' ')
}

function allNumbers(geometry: AttritionGeometry): number[] {
  return geometry.bands.flatMap((b) => [
    b.x0, b.x1, b.keptHeight, b.lossHeight,
    b.titleX, b.titleY, b.unitX, b.unitY,
    b.keptValueX, b.keptValueY, b.keptLabelX, b.keptLabelY,
    b.loss.x, b.loss.y, b.loss.width, b.loss.height,
    b.loss.valueX, b.loss.valueY, b.loss.labelX, b.loss.labelY,
  ])
}

describe('buildAttritionStages', () => {
  it('walks requirements to systems to hardware, in that order', () => {
    expect(buildAttritionStages(DIMENSIONS).map((s) => s.key)).toEqual([
      'requirement_attrition',
      'ownership_ambiguity',
      'realization_gap',
      'orphaned_hardware',
    ])
  })

  it('splits each stage into what it kept and what it lost', () => {
    const [requirements, ownership, realization] = buildAttritionStages(DIMENSIONS)
    expect(requirements).toMatchObject({ total: 11, kept: 9, lost: 2 })
    expect(ownership).toMatchObject({ total: 32, kept: 23, lost: 9 })
    expect(realization).toMatchObject({ total: 32, kept: 10, lost: 22 })
  })

  it('reads the orphaned hardware numerator as the loss, not the survivor', () => {
    const hardware = buildAttritionStages(DIMENSIONS)[3]
    // 59 of 79 devices are unclaimed, so 20 are explained by a system.
    expect(hardware).toMatchObject({ total: 79, kept: 20, lost: 59 })
  })

  it('names every loss node the reader has to see', () => {
    expect(buildAttritionStages(DIMENSIONS).map((s) => s.lossLabel)).toEqual([
      'not carried forward',
      'unconfirmed',
      'unmapped',
      'unexplained hardware',
    ])
  })

  it('skips a stage whose dimension the report does not carry', () => {
    const partial = DIMENSIONS.filter((d) => d.key !== 'realization_gap')
    expect(buildAttritionStages(partial).map((s) => s.key)).toEqual([
      'requirement_attrition',
      'ownership_ambiguity',
      'orphaned_hardware',
    ])
    expect(buildAttritionStages([])).toEqual([])
  })
})

describe('layoutAttrition', () => {
  const stages = buildAttritionStages(DIMENSIONS)

  it('returns one band per stage with drawable paths', () => {
    const geometry = layoutAttrition(stages, SIZE)
    expect(geometry.bands).toHaveLength(4)
    for (const band of geometry.bands) {
      expect(band.keptPath.startsWith('M ')).toBe(true)
      expect(band.lossPath.endsWith('Z')).toBe(true)
    }
    expect(geometry.arrows).toHaveLength(3)
  })

  it('is empty at zero or negative size, because React mounts before layout', () => {
    for (const size of [
      { width: 0, height: ATTRITION_DEFAULT_HEIGHT },
      { width: ATTRITION_DEFAULT_WIDTH, height: 0 },
      { width: 0, height: 0 },
      { width: -800, height: 400 },
      { width: 800, height: -400 },
      { width: Number.NaN, height: 400 },
    ]) {
      const geometry = layoutAttrition(stages, size)
      expect(geometry.bands).toEqual([])
      expect(geometry.arrows).toEqual([])
    }
  })

  it('is empty when the padding leaves no room to draw', () => {
    expect(layoutAttrition(stages, { width: 960, height: 80 }).bands).toEqual([])
    expect(layoutAttrition(stages, { width: 40, height: 420 }).bands).toEqual([])
  })

  it('never emits NaN, Infinity or undefined into a path', () => {
    const geometry = layoutAttrition(stages, SIZE)
    expect(allPaths(geometry)).not.toMatch(/NaN|Infinity|undefined|null/)
    for (const value of allNumbers(geometry)) expect(Number.isFinite(value)).toBe(true)
  })

  it('survives a zero denominator without dividing by it', () => {
    const zeroed = buildAttritionStages([dimension('requirement_attrition', 0, 0, 'ok')])
    const geometry = layoutAttrition(zeroed, SIZE)
    expect(geometry.bands).toHaveLength(1)
    expect(geometry.bands[0].keptHeight).toBe(0)
    expect(allPaths(geometry)).not.toMatch(/NaN|Infinity/)
  })

  it('taller survivor means a taller kept band', () => {
    const [requirements, , realization] = layoutAttrition(stages, SIZE).bands
    // 81.8% carried forward against 31.2% mapped.
    expect(requirements.keptHeight).toBeGreaterThan(realization.keptHeight)
    // Both bands span the same trunk: only the split moves.
    expect(requirements.keptHeight + requirements.lossHeight).toBeCloseTo(
      realization.keptHeight + realization.lossHeight,
      1,
    )
  })

  it('lays the stages out left to right without overlapping', () => {
    const { bands } = layoutAttrition(stages, SIZE)
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i].x0).toBeGreaterThan(bands[i - 1].x1)
    }
  })

  it('keeps every band and loss node inside the viewport', () => {
    const geometry = layoutAttrition(stages, SIZE)
    for (const band of geometry.bands) {
      expect(band.x0).toBeGreaterThanOrEqual(0)
      expect(band.x1).toBeLessThanOrEqual(geometry.width)
      expect(band.titleY).toBeGreaterThan(0)
      expect(band.loss.x).toBeGreaterThanOrEqual(band.x0)
      expect(band.loss.y + band.loss.height).toBeLessThanOrEqual(geometry.height)
      expect(band.loss.labelY).toBeLessThanOrEqual(geometry.height)
    }
  })

  it('scales with the size it is given', () => {
    const wide = layoutAttrition(stages, { width: 1400, height: 520 })
    const narrow = layoutAttrition(stages, SIZE)
    expect(wide.bands[3].x1).toBeGreaterThan(narrow.bands[3].x1)
    expect(wide.trunkHeight).toBeGreaterThan(narrow.trunkHeight)
    expect(wide.bands[0].keptHeight / wide.trunkHeight).toBeCloseTo(
      narrow.bands[0].keptHeight / narrow.trunkHeight,
      3,
    )
  })
})
