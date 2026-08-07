import type { ReactNode } from 'react'

import { EmptyState } from '../../components/EmptyState'
import type { Manifest, Project } from '../../types/atlas'

/** Manifest count keys the ingest emits today. Anything else is shown under its
 *  raw key rather than dropped, because a silently hidden count is a lie. */
const COUNT_LABELS: Record<string, string> = {
  acronyms: 'Acronyms',
  confirmed: 'Confirmed systems',
  desired_links: 'Desired links',
  devices: 'Devices',
  links: 'Current links',
  requirements: 'Crosswalk requirements',
  sites: 'Sites',
  systems: 'Systems',
  unconfirmed: 'Unconfirmed systems',
}

/**
 * Marks a value that changes on every build or every ingest run.
 *
 * The visual suite masks these rather than the cards around them, so a layout
 * regression inside the provenance block is still visible while a fresh commit
 * sha does not rewrite a 1.3MB baseline. The values themselves are asserted in
 * src/tabs/reference/__tests__/ReferenceTab.test.tsx.
 */
const VOLATILE = { 'data-volatile': '' }

function Field({
  term,
  children,
}: {
  term: string
  children: ReactNode
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-3">{term}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  )
}

export function BuildSection({
  manifest,
  project,
}: {
  manifest: Manifest
  project: Project
}) {
  const counts = Object.entries(manifest.counts)

  return (
    <div className="space-y-6">
      <div className="rounded border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Build provenance</h3>
        <p className="mt-1 text-xs text-muted-3">
          Every figure on every tab comes from this build. The commit and the build time
          are what make a briefing slide reproducible.
        </p>
        <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field term="Tool version">
            <span {...VOLATILE}>{manifest.tool_version}</span>
          </Field>
          <Field term="Built at">
            <span {...VOLATILE} className="tabular">
              {manifest.built_at}
            </span>
          </Field>
          <Field term="Commit">
            <code {...VOLATILE} className="tabular text-accent-ink">
              {manifest.git_sha}
            </code>
          </Field>
          <Field term="Source workbook">{manifest.source_label}</Field>
          <Field term="Baseline date">
            <span {...VOLATILE} className="tabular">
              {manifest.baseline_date}
            </span>
          </Field>
          <Field term="Bundle version">
            <span {...VOLATILE} className="tabular">
              {manifest.bundle_version}
            </span>
          </Field>
          <Field term="Snapshots">
            {manifest.snapshots.length === 0 ? (
              <span className="text-muted-3">
                None yet, so the Lossiness tab has no history to trend
              </span>
            ) : (
              manifest.snapshots.map((label) => (
                <code
                  {...VOLATILE}
                  key={label}
                  className="mr-2 tabular text-xs text-muted-2"
                >
                  {label}
                </code>
              ))
            )}
          </Field>
        </dl>
      </div>

      <div className="rounded border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Sites and classification</h3>
        <p className="mt-1 text-xs text-muted-3">
          Markings are propagated from the source diagrams. This tool surfaces them and
          does not audit or enforce them.
        </p>
        {project.sites.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No sites in this bundle"
              detail="The project carries no site topologies, so the Network and Map tabs have nothing to draw."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table
              aria-label="Sites and classification"
              className="w-full border-collapse text-sm"
            >
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-muted-3">
                  <th scope="col" className="py-2 pr-4">
                    Site
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Classification
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Devices
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Links
                  </th>
                  <th scope="col" className="py-2">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {project.sites.map((site) => (
                  <tr key={site.id} className="border-b border-line">
                    <td className="py-2 pr-4">
                      <span className="text-ink">{site.label}</span>{' '}
                      <code className="text-xs text-muted-3">{site.id}</code>
                    </td>
                    <td className="py-2 pr-4">
                      <span className="rounded bg-risk-medium/15 px-2 py-px text-xs font-medium text-risk-medium-ink">
                        {site.classification}
                      </span>
                    </td>
                    <td className="py-2 pr-4 tabular text-muted">{site.device_count}</td>
                    <td className="py-2 pr-4 tabular text-muted">{site.edge_count}</td>
                    <td className="py-2 tabular text-muted">
                      <span {...VOLATILE}>{site.updated}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">What is in the bundle</h3>
        {counts.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No counts in the manifest"
              detail="The build emitted no tally. Absence of a count is not a count of zero."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table aria-label="Bundle counts" className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-muted-3">
                  <th scope="col" className="py-2 pr-4">
                    Item
                  </th>
                  <th scope="col" className="py-2">
                    Count
                  </th>
                </tr>
              </thead>
              <tbody>
                {counts.map(([key, value]) => (
                  <tr key={key} className="border-b border-line">
                    <td className="py-1.5 pr-4 text-muted">
                      {COUNT_LABELS[key] ?? key}
                    </td>
                    <td className="py-1.5 tabular text-ink">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
