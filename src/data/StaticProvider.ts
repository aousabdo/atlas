import type {
  CoverageMatrix, Glossary, LinkSet, LossinessReport, Manifest, Methodology,
  Project, Requirement, SiteId, SnapshotMetrics, System, Topology,
} from '../types/atlas'
import { AtlasDataError, type AtlasDataProvider } from './provider'

/**
 * Reads the pre-built bundles emitted by the Python ingest package.
 *
 * Every response is cached for the lifetime of the provider: the bundles are
 * immutable for a given deploy, so refetching them would only add latency.
 *
 * When the page was produced by the single-file export, the bundles are
 * already inlined on window.__ATLAS_DATA__ and no fetch happens at all. That
 * is what lets the same app code run online and from a file:// URL.
 */
declare global {
  interface Window {
    __ATLAS_DATA__?: Record<string, unknown>
  }
}

export class StaticProvider implements AtlasDataProvider {
  readonly kind = 'static' as const
  private cache = new Map<string, Promise<unknown>>()

  constructor(private readonly baseUrl: string = `${import.meta.env.BASE_URL}data`) {}

  private get<T>(resource: string): Promise<T> {
    const inlined = globalThis.window?.__ATLAS_DATA__?.[resource]
    if (inlined !== undefined) return Promise.resolve(inlined as T)

    const existing = this.cache.get(resource)
    if (existing) return existing as Promise<T>

    const url = `${this.baseUrl.replace(/\/$/, '')}/${resource}`
    const request = (async () => {
      let response: Response
      try {
        response = await fetch(url)
      } catch (cause) {
        // A network failure is not "no data". Callers must be able to tell the
        // difference so a chart never renders 0 because a fetch died.
        throw new AtlasDataError(`Could not reach ${resource}`, cause, resource)
      }
      if (!response.ok) {
        throw new AtlasDataError(
          `${resource} returned ${response.status}`,
          undefined,
          resource,
        )
      }
      try {
        return (await response.json()) as T
      } catch (cause) {
        throw new AtlasDataError(`${resource} is not valid JSON`, cause, resource)
      }
    })()

    this.cache.set(resource, request)
    // A failed request must not poison the cache; a retry should be able to succeed.
    request.catch(() => this.cache.delete(resource))
    return request
  }

  getManifest() {
    return this.get<Manifest>('manifest.json')
  }
  getProject() {
    return this.get<Project>('project.json')
  }
  getSystems() {
    return this.get<System[]>('systems.json')
  }
  getLinks() {
    return this.get<LinkSet>('links.json')
  }
  getRequirements() {
    return this.get<Requirement[]>('crosswalk.json')
  }
  getGlossary() {
    return this.get<Glossary>('glossary.json')
  }
  getMethodology() {
    return this.get<Methodology>('methodology.json')
  }
  getCoverage() {
    return this.get<CoverageMatrix>('coverage.json')
  }
  getLossiness() {
    return this.get<LossinessReport>('lossiness.json')
  }

  async getTopology(siteId: SiteId): Promise<Topology> {
    const project = await this.getProject()
    if (!project.sites.some((s) => s.id === siteId)) {
      throw new AtlasDataError(
        `Unknown site '${siteId}'. Known sites: ${project.sites.map((s) => s.id).join(', ')}`,
        undefined,
        `sites/${siteId}.json`,
      )
    }
    return this.get<Topology>(`sites/${siteId}.json`)
  }

  /**
   * The committed history, or a failure. Never a short list.
   *
   * The manifest indexes the snapshots, because a static host cannot be
   * globbed. That index is a promise the files exist: bundle.py builds
   * manifest.snapshots by globbing the snapshot files it has just written. So
   * a label that will not load is a load failure, and it used to be swallowed
   * by a `.catch(() => null)` that the filter then removed. Three 404s and a
   * dead network both came back as [], which TrendView states as "This bundle
   * carries none, so there is nothing to compare" - a claim about the data
   * made out of a claim about the network.
   *
   * The partial case was worse than the total one. One missing snapshot in the
   * middle still rendered a table, with a first-to-last change computed across
   * a hole nothing on screen disclosed.
   *
   * README, "Distinguish 'no data' from 'failed to load'": a chart showing 0
   * because a fetch died is a lie, and lying is the one thing this tool cannot
   * do. An empty array still means "no history yet", exactly as the provider
   * interface says, and now it can only mean that.
   *
   * The single-file export is unaffected and stays that way: every bundle
   * under public/data, snapshots included, is inlined on window.__ATLAS_DATA__
   * and `get` returns before it reaches a fetch, so an air-gapped page has no
   * way to fail this.
   */
  async getSnapshots(): Promise<SnapshotMetrics[]> {
    const manifest = await this.getManifest()
    const indexed = manifest.snapshots
    if (indexed) return this.loadIndexedSnapshots(indexed)

    // No index at all, which no bundle this code has ever emitted produces.
    // The label below is a guess at the name bundle.py would have written, not
    // a promise from the bundle that the file is there, so a guess that misses
    // is genuinely no history and stays tolerated. Only an indexed label is
    // evidence, and only evidence can turn a miss into a failure.
    const guess = manifest.built_at.split('T')[0]
    return this.get<SnapshotMetrics>(`snapshots/${guess}.json`).then(
      (snapshot) => [snapshot],
      () => [],
    )
  }

  /** Every label, or a failure naming every label that did not load. */
  private async loadIndexedSnapshots(
    labels: readonly string[],
  ): Promise<SnapshotMetrics[]> {
    const settled = await Promise.allSettled(
      labels.map((label) => this.get<SnapshotMetrics>(`snapshots/${label}.json`)),
    )
    // allSettled, not all: the point of the message is which snapshots are
    // missing, and stopping at the first one would hide the rest of the hole.
    const failed = labels.filter((_, i) => settled[i].status === 'rejected')
    if (failed.length > 0) {
      const first = settled.find(
        (result) => result.status === 'rejected',
      ) as PromiseRejectedResult
      throw new AtlasDataError(
        `${failed.length} of ${labels.length} snapshot(s) the manifest indexes ` +
          `could not be loaded: ${failed.join(', ')}`,
        first.reason,
        `snapshots/${failed[0]}.json`,
      )
    }
    return settled.map(
      (result) => (result as PromiseFulfilledResult<SnapshotMetrics>).value,
    )
  }
}
