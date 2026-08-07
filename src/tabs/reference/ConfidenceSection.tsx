import type { ReactNode } from 'react'

import { EmptyState } from '../../components/EmptyState'
import { ProvenanceChip } from '../../components/ProvenanceChip'
import type {
  Confidence,
  CoverageMatrix,
  Glossary,
  LossinessReport,
  Methodology,
  Project,
  System,
} from '../../types/atlas'

interface SiteRealization {
  id: string
  label: string
  mapped: number
  total: number
  pct: number
}

interface MappingRef {
  system: string
  site: string
}

const TONE = {
  high: 'border-l-risk-low',
  moderate: 'border-l-risk-medium',
  low: 'border-l-risk-high',
  scope: 'border-l-muted-3',
} as const

function Num({ children }: { children: ReactNode }) {
  return <span className="tabular text-ink">{children}</span>
}

/** See BuildSection: dates that move on every ingest run, masked in screenshots. */
const VOLATILE = { 'data-volatile': '' }

function Card({
  title,
  tone,
  children,
}: {
  title: string
  tone: keyof typeof TONE
  children: ReactNode
}) {
  return (
    <div
      className={`rounded border border-l-4 border-line bg-surface p-4 ${TONE[tone]}`}
    >
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-muted">{children}</ul>
    </div>
  )
}

/**
 * Per-site realization figures come from the lossiness report rather than being
 * recomputed here, so the tab cannot disagree with the Lossiness tab about the
 * same number. `detail` is deliberately untyped in the contract, hence the
 * narrowing.
 */
function perSiteRealization(report: LossinessReport): SiteRealization[] {
  const detail = report.dimensions.find((d) => d.key === 'realization_gap')?.detail
    .per_site
  if (!detail || typeof detail !== 'object') return []
  return Object.entries(detail as Record<string, Record<string, unknown>>)
    .map(([id, site]) => ({
      id,
      label: typeof site.label === 'string' ? site.label : id,
      mapped: typeof site.mapped === 'number' ? site.mapped : 0,
      total: typeof site.total === 'number' ? site.total : 0,
      pct: typeof site.pct === 'number' ? site.pct : 0,
    }))
    .filter((site) => site.total > 0)
}

/** The bundle's tally is authoritative; the walk over the matrix is the fallback
 *  for a bundle that predates the tally, never a second opinion about it. */
function tallied(counts: Record<string, number>, key: string, fallback: number): number {
  const value = counts[key]
  return typeof value === 'number' ? value : fallback
}

function mappingsAt(coverage: CoverageMatrix, level: Confidence): MappingRef[] {
  const out: MappingRef[] = []
  for (const [siteId, site] of Object.entries(coverage.sites)) {
    for (const [systemId, mapping] of Object.entries(site.mappings)) {
      if (mapping.devices.length > 0 && mapping.confidence === level) {
        out.push({ system: systemId, site: siteId })
      }
    }
  }
  return out.sort((a, b) => a.system.localeCompare(b.system))
}

function MappingRefs({ refs }: { refs: MappingRef[] }) {
  if (refs.length === 0) return null
  return (
    <span className="text-muted-2">
      {refs.map((ref, index) => (
        <span key={`${ref.site}-${ref.system}`}>
          {index > 0 && ', '}
          <code className="text-xs text-muted-2">
            {ref.system}@{ref.site}
          </code>
        </span>
      ))}
    </span>
  )
}

export function ConfidenceSection({
  coverage,
  glossary,
  lossiness,
  methodology,
  project,
  systems,
}: {
  coverage: CoverageMatrix
  glossary: Glossary
  lossiness: LossinessReport
  methodology: Methodology
  project: Project
  systems: System[]
}) {
  const realization = perSiteRealization(lossiness)
  const counts = coverage.confidence_counts
  const highMappings = mappingsAt(coverage, 'high')
  const mediumMappings = mappingsAt(coverage, 'medium')
  const lowMappings = mappingsAt(coverage, 'low')
  const explicit = systems.filter((s) => s.risk_source === 'explicit').length
  const inferred = systems.filter((s) => s.risk_source === 'inferred').length
  const override = systems.filter((s) => s.risk_source === 'override').length
  const questions = Object.entries(coverage.pending_review)
  const emptySites = realization.filter((site) => site.mapped === 0)

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm leading-relaxed text-muted">
        {glossary.confidence_intro}
      </p>

      <Card
        title="High confidence: directly lifted from an authoritative source"
        tone="high"
      >
        <li>
          <Num>{systems.length}</Num> systems read one for one from{' '}
          {project.source_label}, baseline <span {...VOLATILE}>{project.baseline_date}</span>.
        </li>
        <li>
          Owner group read from the workbook Owner Org column and routed by{' '}
          <Num>{methodology.owner_rules_count}</Num> ordered rules, listed under
          Methodology.
        </li>
        {project.sites.map((site) => (
          <li key={site.id}>
            {site.label}: <Num>{site.device_count}</Num> devices and{' '}
            <Num>{site.edge_count}</Num> links taken from the site diagram extract,
            updated <span {...VOLATILE}>{site.updated}</span>.
          </li>
        ))}
        <li>
          <Num>{tallied(counts, 'high', highMappings.length)}</Num> system to device
          mappings flagged high confidence, meaning physically verified from a Visio or
          an AAR.
        </li>
      </Card>

      <Card title="Moderate confidence: an inference rule was applied" tone="moderate">
        <li>
          Risk levels: <Num>{explicit}</Num> of <Num>{systems.length}</Num> read from the
          explicit Risk Level column
          <ProvenanceChip source="explicit" />, <Num>{inferred}</Num> derived by the
          keyword heuristic
          <ProvenanceChip source="inferred" />, <Num>{override}</Num> set in the curation
          overlay
          <ProvenanceChip source="override" />. The keyword lists are under Methodology.
        </li>
        <li>
          <Num>{tallied(counts, 'medium', mediumMappings.length)}</Num> mappings flagged
          medium confidence, a strong inference from role and context
          {mediumMappings.length > 0 && (
            <>
              : <MappingRefs refs={mediumMappings} />
            </>
          )}
          .
        </li>
        {realization.map((site) => (
          <li key={site.id}>
            <Num>{site.mapped}</Num> of <Num>{site.total}</Num> systems mapped to hardware
            at {site.label} (<Num>{site.pct}</Num>%).
          </li>
        ))}
      </Card>

      <Card title="Low confidence and pending: known unknowns" tone="low">
        <li>
          <Num>{tallied(counts, 'low', lowMappings.length)}</Num> mappings flagged low
          confidence, a best guess pending team confirmation
          {lowMappings.length > 0 && (
            <>
              : <MappingRefs refs={lowMappings} />
            </>
          )}
          .
        </li>
        <li>
          <Num>{questions.length}</Num> open questions recorded against the mapping file:
          <ul className="mt-2 space-y-1 border-l border-line pl-3 text-xs text-muted-2">
            {questions.map(([subject, question]) => (
              <li key={subject}>
                <code className="text-xs text-muted-2">{subject}</code>: {question}
              </li>
            ))}
          </ul>
        </li>
        {emptySites.map((site) => (
          <li key={site.id}>
            {site.label} has no system to device mappings yet. The site is pending team
            review, so its coverage figure is an absence of evidence rather than evidence
            of absence.
          </li>
        ))}
      </Card>

      <section
        aria-label="Out of scope"
        className={`rounded border border-l-4 border-line bg-surface p-4 ${TONE.scope}`}
      >
        <h3 className="text-sm font-semibold text-ink">Out of scope</h3>
        <p className="mt-1 text-xs text-muted-3">
          What this tool deliberately does not claim.
        </p>
        {glossary.out_of_scope.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No out-of-scope declarations"
              detail="The glossary carries no exclusions. Treat that as unreviewed rather than as a claim of total coverage."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {glossary.out_of_scope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
