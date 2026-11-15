import { describe, expect, it } from 'vitest'

import { StaticProvider } from '../../data/StaticProvider'
import type { LossinessDimension } from '../../types/atlas'
import { CuratedProvider } from '../CuratedProvider'
import { SAMPLE_WALK } from './sampleWalk'

const realization = (dimensions: LossinessDimension[]) => {
  const found = dimensions.find((d) => d.key === 'realization_gap')
  if (!found) throw new Error('no realization_gap dimension')
  return found
}

describe('CuratedProvider', () => {
  it('reports the kind of the provider it wraps', () => {
    const base = new StaticProvider('/data')
    expect(new CuratedProvider(base, SAMPLE_WALK).kind).toBe(base.kind)
  })

  it('recomputes the realization gap from the edited coverage', async () => {
    const curated = new CuratedProvider(new StaticProvider('/data'), SAMPLE_WALK)
    const gap = realization((await curated.getLossiness()).dimensions)
    expect(gap.numerator).toBe(13)
    expect(gap.denominator).toBe(30)
    expect(gap.value_pct).toBe(43.3)
    const perSite = gap.detail.per_site as Record<string, { mapped_ids: string[] }>
    expect(perSite.westfield.mapped_ids).toEqual(['beacon', 'scan', 'trackwell'])
  })

  it('leaves the base report alone', async () => {
    const base = new StaticProvider('/data')
    await new CuratedProvider(base, SAMPLE_WALK).getLossiness()
    const gap = realization((await base.getLossiness()).dimensions)
    expect(gap.numerator).toBe(10)
    const perSite = gap.detail.per_site as Record<string, { mapped_ids: string[] }>
    expect(perSite.westfield.mapped_ids).toEqual([])
  })

  it('serves the edited coverage, once, with the grades recounted', async () => {
    const base = new StaticProvider('/data')
    const curated = new CuratedProvider(base, SAMPLE_WALK)
    const coverage = await curated.getCoverage()
    expect(await curated.getCoverage()).toBe(coverage)
    expect(coverage.sites.westfield.mappings.beacon.devices).toEqual(['wf_gate_sensor'])
    expect(coverage.confidence_counts).not.toEqual((await base.getCoverage()).confidence_counts)
  })

  it('passes the snapshots through, since they record builds rather than the screen', async () => {
    const base = new StaticProvider('/data')
    const curated = new CuratedProvider(base, SAMPLE_WALK)
    expect(await curated.getSnapshots()).toEqual(await base.getSnapshots())
  })

  it('passes every other getter through to the base', async () => {
    const base = new StaticProvider('/data')
    const curated = new CuratedProvider(base, SAMPLE_WALK)
    expect(await curated.getSystems()).toBe(await base.getSystems())
    expect(await curated.getProject()).toBe(await base.getProject())
    expect(await curated.getTopology('westfield')).toBe(await base.getTopology('westfield'))
    expect(await curated.getSourceSystemDeviceMap()).toBeNull()
  })
})
