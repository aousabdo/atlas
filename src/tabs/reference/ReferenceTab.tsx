import { useState, type ReactNode } from 'react'

import { LoadFailed } from '../../components/LoadFailed'
import { useAtlas } from '../../data/useAtlas'
import type {
  CoverageMatrix,
  Glossary,
  LossinessReport,
  Manifest,
  Methodology,
  Project,
  System,
} from '../../types/atlas'
import { AcronymsTable } from './AcronymsTable'
import { BuildSection } from './BuildSection'
import { ConfidenceSection } from './ConfidenceSection'
import { MethodologySection } from './MethodologySection'
import { SystemsTable } from './SystemsTable'

interface ReferenceData {
  glossary: Glossary
  methodology: Methodology
  systems: System[]
  coverage: CoverageMatrix
  lossiness: LossinessReport
  manifest: Manifest
  project: Project
}

/** Headings and anchors are carried verbatim from the tool being replaced, so a
 *  link someone pasted into a briefing still lands on the same section. */
const SECTIONS = [
  { id: 'confidence', title: 'Confidence & caveats' },
  { id: 'methodology', title: 'Methodology' },
  { id: 'systems', title: 'Systems' },
  { id: 'acronyms', title: 'Acronyms' },
  { id: 'build', title: 'Architecture & build' },
] as const

const SUBTITLE =
  'Source-of-truth reference for the architecture, classification methods, and what we are (and are not) certain about.'

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id}>
      <h2
        id={id}
        className="scroll-mt-4 border-b border-line pb-2 text-lg font-semibold text-ink"
      >
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function ReferenceTab() {
  const state = useAtlas<ReferenceData>(async (provider) => {
    const [glossary, methodology, systems, coverage, lossiness, manifest, project] =
      await Promise.all([
        provider.getGlossary(),
        provider.getMethodology(),
        provider.getSystems(),
        provider.getCoverage(),
        provider.getLossiness(),
        provider.getManifest(),
        provider.getProject(),
      ])
    return { glossary, methodology, systems, coverage, lossiness, manifest, project }
  })
  const [query, setQuery] = useState('')

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <h1 className="text-xl font-semibold text-ink">Reference & Methodology</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{SUBTITLE}</p>
      </header>

      {state.status === 'loading' && (
        <p role="status" className="mt-8 text-sm text-muted">
          Loading the reference data.
        </p>
      )}

      {state.status === 'failed' && (
        <div className="mt-8">
          <LoadFailed
            resource={state.error.resource ?? 'the reference bundles'}
            message={state.error.message}
            onRetry={state.retry}
          />
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-4 rounded border border-line bg-surface p-3">
            <nav aria-label="Sections" className="flex flex-wrap gap-1">
              {SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="rounded px-2 py-1 text-sm text-muted hover:text-ink"
                >
                  {section.title}
                </a>
              ))}
            </nav>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="reference-filter"
                className="text-xs font-medium text-muted-3"
              >
                Filter systems and acronyms
              </label>
              <input
                id="reference-filter"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="trackwell, TAK, CBP, high"
                className="w-64 rounded border border-line bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-muted-3"
              />
            </div>
          </div>

          <div className="mt-8 space-y-10">
            <Section id="confidence" title="Confidence & caveats">
              <ConfidenceSection
                coverage={state.data.coverage}
                glossary={state.data.glossary}
                lossiness={state.data.lossiness}
                methodology={state.data.methodology}
                project={state.data.project}
                systems={state.data.systems}
              />
            </Section>

            <Section id="methodology" title="Methodology">
              <MethodologySection
                glossary={state.data.glossary}
                methodology={state.data.methodology}
              />
            </Section>

            <Section id="systems" title="Systems">
              <SystemsTable
                coverage={state.data.coverage}
                query={query}
                systems={state.data.systems}
              />
            </Section>

            <Section id="acronyms" title="Acronyms">
              <AcronymsTable acronyms={state.data.glossary.acronyms} query={query} />
            </Section>

            <Section id="build" title="Architecture & build">
              <BuildSection manifest={state.data.manifest} project={state.data.project} />
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
