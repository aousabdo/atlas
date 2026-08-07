import { useMemo } from 'react'

import { EmptyState } from '../../components/EmptyState'
import type { Acronym } from '../../types/atlas'

export function AcronymsTable({
  acronyms,
  query,
}: {
  acronyms: Acronym[]
  query: string
}) {
  const needle = query.trim().toLowerCase()

  const rows = useMemo(
    () =>
      acronyms.filter(
        (acronym) =>
          !needle || `${acronym.acr} ${acronym.meaning}`.toLowerCase().includes(needle),
      ),
    [acronyms, needle],
  )

  if (acronyms.length === 0) {
    return (
      <EmptyState
        title="No acronyms in this bundle"
        detail="The glossary carried no entries. Edits live in glossary.json and take effect on the next ingest."
      />
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No acronyms match the filter"
        detail={`Nothing in the ${acronyms.length} entries matches "${query.trim()}". Clear the filter to see them all.`}
      />
    )
  }

  return (
    <>
      <p className="text-xs text-muted-3">
        <span className="tabular">{rows.length}</span> of{' '}
        <span className="tabular">{acronyms.length}</span> entries. Edits live in{' '}
        <code>glossary.json</code> and take effect on the next ingest.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table aria-label="Acronyms" className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-muted-3">
              <th scope="col" className="w-40 py-2 pr-4">
                Acronym
              </th>
              <th scope="col" className="py-2">
                Meaning
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((acronym) => (
              <tr key={acronym.acr} className="border-b border-line align-top">
                <td className="py-2 pr-4">
                  <code className="text-xs text-ink">{acronym.acr}</code>
                </td>
                <td className="py-2 text-muted">{acronym.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
