import type {
  CoverageMatrix, Glossary, LinkSet, LossinessReport, Manifest, Methodology,
  Project, Requirement, SiteId, SnapshotMetrics, System, Topology,
} from '../types/atlas'

/**
 * The one interface the UI knows about.
 *
 * Phase 1 ships StaticProvider (pre-built bundles over fetch) and
 * LocalFileProvider (SheetJS in the browser; files never leave the machine).
 * Phase 2 adds ApiProvider against /api/*. The contract suite in
 * src/data/__tests__/contract.ts runs against every implementation, which is
 * what makes the Phase 2 swap a claim we have tested rather than hoped for.
 *
 * There is no projectId parameter. Phase 1 has exactly one project, so
 * threading an id nobody varies would be ceremony; it arrives with the
 * projects table in Phase 2 as an additive change to every signature.
 */
export interface AtlasDataProvider {
  readonly kind: 'static' | 'local-file' | 'api'

  getManifest(): Promise<Manifest>
  getProject(): Promise<Project>
  getSystems(): Promise<System[]>
  getLinks(): Promise<LinkSet>
  getRequirements(): Promise<Requirement[]>
  getGlossary(): Promise<Glossary>
  getMethodology(): Promise<Methodology>
  getCoverage(): Promise<CoverageMatrix>
  getLossiness(): Promise<LossinessReport>
  getTopology(siteId: SiteId): Promise<Topology>
  /** Empty array is a valid answer and means "no history yet", not a failure. */
  getSnapshots(): Promise<SnapshotMetrics[]>
}

/**
 * Thrown when data could not be loaded.
 *
 * Distinct from an empty result, because a chart rendering 0 after a failed
 * fetch is a lie and spec section 9 forbids it.
 */
export class AtlasDataError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    readonly resource?: string,
  ) {
    super(message)
    this.name = 'AtlasDataError'
  }
}
