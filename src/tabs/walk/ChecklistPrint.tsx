import { memo, useMemo, type ReactNode } from 'react'

import { useCuration } from '../../curation/CurationContext'
import { localDate } from '../../curation/dates'
import { buildChecklist, CHECKLIST_RULE, systemStanding, type DeviceRow } from '../../curation/walk'
import { UNMARKED_NOTICE } from '../../data/ProviderContext'
import { fieldableSystemIds, matrixIdSet } from '../../lib/coverage'
import type { CoverageSite, System, Topology } from '../../types/atlas'

const GRADE_WORD: Record<string, string> = { unspecified: 'ungraded' }

const Box = () => <span className="checklist-box" aria-hidden="true" />
const Blank = ({ wide }: { wide?: boolean }) => (
  <span className={`checklist-blank${wide ? ' checklist-blank-wide' : ''}`} aria-hidden="true" />
)

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-4">
      <h2 className="border-b border-ink text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Stamp({ by, on }: { by?: string; on?: string }) {
  return by && on ? <> (reviewed by {by} on {on})</> : null
}

function DeviceLine({ row }: { row: DeviceRow }) {
  return (
    <li className="checklist-row">
      <Box /> <span className="font-medium">{row.device.label}</span>
      {' · '}
      {row.systems.length === 0 ? (
        'no system recorded'
      ) : (
        row.systems
          .map((s) => `${s.name} (${GRADE_WORD[s.grade] ?? s.grade}${s.outside ? ', not in the matrix' : ''})`)
          .join('; ')
      )}
      <div className="mt-1">
        carries: <Blank wide /> <Box /> carries no system
      </div>
    </li>
  )
}

/**
 * What prints from the Site walk tab: the checklist for the selected site, in
 * the order the walk should take it. Hidden on screen. The rest of the page
 * carries `data-print-hide`, so this is all that reaches the paper.
 */
export const ChecklistPrint = memo(function ChecklistPrint(props: {
  siteLabel: string
  site: CoverageSite
  systems: readonly System[]
  topology: Topology
}) {
  const { siteLabel, site, systems, topology } = props
  const { source, unsaved } = useCuration()
  const checklist = useMemo(() => buildChecklist(site, systems, topology), [site, systems, topology])
  // Once per system, and only a system that can be fielded: one recorded both as
  // mapped and as absent stands as the mapping says, and a shortfall row is no system.
  const absent = useMemo(() => {
    const ids = matrixIdSet(systems)
    const fieldable = fieldableSystemIds(systems)
    return checklist.settled.absent.filter(
      (a) => fieldable.has(a.id) && systemStanding(site, a.id, ids).kind === 'absent',
    )
  }, [checklist, site, systems])
  const marking =
    source.kind === 'sample' ? topology.meta.classification : source.marking ?? UNMARKED_NOTICE
  const { settled } = checklist

  return (
    <div data-testid="checklist-print" className="checklist-print hidden print:block">
      <div data-testid="checklist-header">
        <p className="text-lg font-semibold">{siteLabel}</p>
        <p className="font-semibold">{marking}</p>
        <p>
          Data: {source.label} · Printed {localDate(new Date())}
        </p>
        <p>
          Reviewer <Blank wide /> Date <Blank wide />
        </p>
        <p className="mt-1 text-sm">{CHECKLIST_RULE}</p>
        {unsaved > 0 && (
          <p className="text-sm font-semibold">
            {`Includes ${unsaved} unsaved review${unsaved === 1 ? '' : 's'}, not yet exported to a file`}
          </p>
        )}
      </div>

      <Section title="A. Systems to locate">
        <ul>
          {checklist.locate.map(({ system, record }) => (
            <li key={system.id} className="checklist-row">
              <Box /> <span className="font-medium">{system.name}</span> ({system.risk} risk)
              {record === 'survey-gap' && ' · survey gap'}
              <div className="mt-1">
                found on <Blank wide /> grade <Box /> H <Box /> M <Box /> L
              </div>
              <div className="mt-1">
                or not here: <Blank wide />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {checklist.zones.map((zone) => (
        <Section key={zone.zoneId} title={zone.label}>
          <ul>
            {zone.devices.map((row) => (
              <DeviceLine key={row.device.id} row={row} />
            ))}
          </ul>
        </Section>
      ))}

      <Section title="D. Already settled">
        <h3 className="mt-2 text-sm font-semibold">Devices physically verified</h3>
        <ul className="text-sm">
          {settled.devices.map((row) => (
            <li key={row.device.id} className="checklist-row">{row.device.label}</li>
          ))}
        </ul>
        <h3 className="mt-2 text-sm font-semibold">Devices checked, carrying no system</h3>
        <ul className="text-sm">
          {settled.checked.map((row) => (
            <li key={row.device.id} className="checklist-row">
              {row.device.label}
              <Stamp by={row.check?.reviewed_by} on={row.check?.reviewed_on} />
            </li>
          ))}
        </ul>
        <h3 className="mt-2 text-sm font-semibold">Systems checked absent</h3>
        <ul className="text-sm">
          {absent.map((a) => (
            <li key={a.id} className="checklist-row">
              {a.name}: {a.reason}
              <Stamp by={a.stamp?.reviewed_by} on={a.stamp?.reviewed_on} />
            </li>
          ))}
        </ul>
        <h3 className="mt-2 text-sm font-semibold">Systems recorded with no dedicated hardware</h3>
        <ul className="text-sm">
          {settled.noHardware.map(({ system, mapping }) => (
            <li key={system.id} className="checklist-row">
              {system.name}
              <Stamp by={mapping.reviewed_by} on={mapping.reviewed_on} />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
})
