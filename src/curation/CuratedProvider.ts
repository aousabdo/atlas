import type { AtlasDataProvider } from '../data/provider'
import { computeLossiness } from '../lib/lossiness'
import type { CoverageMatrix, LossinessReport, SiteId, Topology } from '../types/atlas'
import { applyEdits, type Edit } from './edits'

/**
 * The loaded provider with the reviews made in this tab laid over it.
 *
 * Only the coverage and the figures computed from it differ. Everything else,
 * the snapshots included, is the base's own: a snapshot records a build, and
 * the Trend view compares snapshots with each other, never with the screen.
 *
 * Nothing the base hands back is changed. applyEdits copies what it writes
 * into, and the base's objects are shared with the file it parsed.
 */
export class CuratedProvider implements AtlasDataProvider {
  readonly kind: AtlasDataProvider['kind']
  private memo = new Map<string, Promise<unknown>>()

  constructor(
    private readonly base: AtlasDataProvider,
    private readonly edits: readonly Edit[],
  ) {
    this.kind = base.kind
  }

  /** Computed once per provider. A failure is not kept, so a retry can succeed. */
  private once<T>(key: string, work: () => Promise<T>): Promise<T> {
    const held = this.memo.get(key)
    if (held) return held as Promise<T>
    const request = work()
    this.memo.set(key, request)
    request.catch(() => this.memo.delete(key))
    return request
  }

  getCoverage(): Promise<CoverageMatrix> {
    return this.once('coverage', async () => {
      const [coverage, systems] = await Promise.all([
        this.base.getCoverage(), this.base.getSystems(),
      ])
      return applyEdits(coverage, this.edits, systems)
    })
  }

  /** The same computation the local loader runs, over the edited coverage. */
  getLossiness(): Promise<LossinessReport> {
    return this.once('lossiness', async () => {
      const [systems, links, requirements, coverage, project] = await Promise.all([
        this.base.getSystems(), this.base.getLinks(), this.base.getRequirements(),
        this.getCoverage(), this.base.getProject(),
      ])
      const topologies: Record<SiteId, Topology> = Object.fromEntries(
        await Promise.all(
          project.sites.map(async (site) => [site.id, await this.base.getTopology(site.id)]),
        ),
      )
      return computeLossiness({ systems, links, requirements, coverage, topologies })
    })
  }

  getManifest() {
    return this.base.getManifest()
  }
  getProject() {
    return this.base.getProject()
  }
  getSystems() {
    return this.base.getSystems()
  }
  getLinks() {
    return this.base.getLinks()
  }
  getRequirements() {
    return this.base.getRequirements()
  }
  getGlossary() {
    return this.base.getGlossary()
  }
  getMethodology() {
    return this.base.getMethodology()
  }
  getTopology(siteId: SiteId) {
    return this.base.getTopology(siteId)
  }
  getSnapshots() {
    return this.base.getSnapshots()
  }
  async getSourceSystemDeviceMap() {
    return (await this.base.getSourceSystemDeviceMap?.()) ?? null
  }
}
