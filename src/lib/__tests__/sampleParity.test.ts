import { describe, expect, it } from 'vitest'

import { StaticProvider } from '../../data/StaticProvider'
import { computeLossiness } from '../lossiness'

/**
 * The browser recomputes the report from the sample inputs, and the ingest
 * committed one computed from the same inputs. They must be the same report.
 * The mirrored unit tables pin the arithmetic; this pins the whole sample.
 */
describe('the committed sample report', () => {
  it('computes the committed sample report from the committed sample inputs', async () => {
    const provider = new StaticProvider('/data')
    const [systems, requirements, coverage, project, links, bundled] = await Promise.all([
      provider.getSystems(),
      provider.getRequirements(),
      provider.getCoverage(),
      provider.getProject(),
      provider.getLinks(),
      provider.getLossiness(),
    ])
    const drawings = await Promise.all(
      project.sites.map(async (site) => [site.id, await provider.getTopology(site.id)] as const),
    )
    const report = computeLossiness({
      systems, links, requirements, coverage, topologies: Object.fromEntries(drawings),
    })
    expect(report.dimensions).toEqual(bundled.dimensions)
    expect(report.top_gaps).toEqual(bundled.top_gaps)
  })
})
