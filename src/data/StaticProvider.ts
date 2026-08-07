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

  async getSnapshots(): Promise<SnapshotMetrics[]> {
    // The manifest indexes the snapshots; a static host cannot be globbed.
    const manifest = await this.getManifest()
    const labels = manifest.snapshots ?? [manifest.built_at.split('T')[0]]
    const loaded = await Promise.all(
      labels.map((label) =>
        this.get<SnapshotMetrics>(`snapshots/${label}.json`).catch(() => null),
      ),
    )
    return loaded.filter((s): s is SnapshotMetrics => s !== null)
  }
}
