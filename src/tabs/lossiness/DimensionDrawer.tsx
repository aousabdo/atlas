import { useEffect, useRef, type ReactNode } from 'react'

import type { LossinessDimension } from '../../types/atlas'

/**
 * The entities behind a figure.
 *
 * Every dimension stores its evidence under a different shape, because the
 * things being counted are different things: requirement titles, system ids,
 * link pairs, device ids, questions. The readers below are the one place that
 * knows those shapes, so the scorecard can ask how many entities a drawer will
 * hold without learning any of them.
 */

const TITLE_ID = 'lossiness-drawer-title'

export interface DrawerProps {
  dimension: LossinessDimension
  systemName: (id: string) => string
  siteLabel: (id: string) => string
  onClose: () => void
}

export function DimensionDrawer({
  dimension,
  systemName,
  siteLabel,
  onClose,
}: DrawerProps) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panel.current?.focus()
  }, [dimension.key])

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-40 flex justify-end bg-bg/70"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
        className="h-full w-full max-w-xl overflow-y-auto border-l border-line bg-surface p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={TITLE_ID} className="text-lg font-semibold text-ink">
              {dimension.label}
            </h2>
            <p className="mt-1 text-sm text-muted">{LEAD[dimension.key] ?? EVIDENCE_LEAD}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded border border-line px-3 py-1 text-sm text-ink"
          >
            Close
          </button>
        </div>
        <div className="mt-5">
          <DrawerBody
            dimension={dimension}
            systemName={systemName}
            siteLabel={siteLabel}
          />
        </div>
      </div>
    </div>
  )
}

const EVIDENCE_LEAD = 'The entities behind the figure.'

const LEAD: Record<string, string> = {
  requirement_attrition:
    'Requirements from the March matrix with no home in the current architecture. Nothing replaced them; they were dropped.',
  ownership_ambiguity:
    'Systems whose owning organization is assumed rather than stated. The owner shown elsewhere in this tool is a classifier guess for these.',
  realization_gap:
    'Systems with no device at any site mapped to them. They exist in the matrix and nowhere on a network diagram.',
  integration_gap:
    'Integrations the architecture calls for that no current link satisfies.',
  evidence_gap:
    'Where each risk level came from. A level read from a cell outranks one a keyword rule produced.',
  orphaned_hardware:
    'Devices on a site network that no system in the matrix claims. Each one is either out of scope or a mapping nobody has written yet.',
  open_questions:
    'Questions the analyst logged against the mapping and has not answered.',
}

function DrawerBody({
  dimension,
  systemName,
  siteLabel,
}: Omit<DrawerProps, 'onClose'>) {
  switch (dimension.key) {
    case 'requirement_attrition':
      return <DroppedRequirements dimension={dimension} />
    case 'ownership_ambiguity':
      return <SystemList ids={unconfirmed(dimension)} systemName={systemName} />
    case 'realization_gap':
      return (
        <RealizationBody
          dimension={dimension}
          systemName={systemName}
          siteLabel={siteLabel}
        />
      )
    case 'integration_gap':
      return <MissingLinks dimension={dimension} systemName={systemName} />
    case 'evidence_gap':
      return <EvidenceBody dimension={dimension} systemName={systemName} />
    case 'orphaned_hardware':
      return <OrphanedDevices dimension={dimension} siteLabel={siteLabel} />
    case 'open_questions':
      return <OpenQuestions dimension={dimension} systemName={systemName} />
    default:
      return (
        <p className="text-sm text-muted">
          This dimension carries no drill-down evidence.
        </p>
      )
  }
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-2">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0">
      {children}
    </li>
  )
}

function DroppedRequirements({ dimension }: { dimension: LossinessDimension }) {
  const dropped = strings(dimension.detail.dropped)
  const byStatus = record(dimension.detail.by_status)
  return (
    <>
      <ul>
        {dropped.map((requirement) => (
          <li
            key={requirement}
            className="border-b border-line py-2 text-sm text-ink last:border-0"
          >
            {requirement}
          </li>
        ))}
      </ul>
      {Object.keys(byStatus).length > 0 && (
        <Group title="What happened to the other requirements">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {Object.entries(byStatus).map(([status, count]) => (
              <div key={status} className="flex justify-between gap-3">
                <span className="text-muted">{status}</span>
                <span className="tabular text-ink">{num(count)}</span>
              </div>
            ))}
          </div>
        </Group>
      )}
    </>
  )
}

function SystemList({
  ids,
  systemName,
}: {
  ids: string[]
  systemName: (id: string) => string
}) {
  return (
    <ul>
      {ids.map((id) => (
        <Row key={id}>
          <span className="text-sm text-ink">{systemName(id)}</span>
          <code className="tabular text-xs text-muted-2">{id}</code>
        </Row>
      ))}
    </ul>
  )
}

function RealizationBody({
  dimension,
  systemName,
  siteLabel,
}: Omit<DrawerProps, 'onClose'>) {
  const sites = perSite(dimension)
  return (
    <>
      <SystemList ids={unmapped(dimension)} systemName={systemName} />
      {shortfalls(dimension).length > 0 && (
        <Group title="Not counted">
          <p className="mb-1 text-xs text-muted-2">
            Shortfall rows record a gap in the architecture, not a system that
            could be fielded, so they are neither realized nor unmapped.
          </p>
          <SystemList ids={shortfalls(dimension)} systemName={systemName} />
        </Group>
      )}
      {sites.length > 0 && (
        <Group title="Mapped per site">
          <div className="space-y-1 text-sm">
            {sites.map((site) => (
              <div key={site.id} className="flex justify-between gap-3">
                <span className="text-muted">{site.label || siteLabel(site.id)}</span>
                <span className="tabular text-ink">
                  {site.mapped} of {site.total}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-2">
            A system counts as mapped when a device on that site names it. A site
            with no mappings yet is a gap in the survey rather than a claim that
            nothing runs there.
          </p>
        </Group>
      )}
    </>
  )
}

function MissingLinks({
  dimension,
  systemName,
}: {
  dimension: LossinessDimension
  systemName: (id: string) => string
}) {
  return (
    <ul>
      {missingLinks(dimension).map((link) => (
        <Row key={`${link.from}-${link.to}`}>
          <span className="text-sm text-ink">
            {link.label || `${systemName(link.from)} to ${systemName(link.to)}`}
          </span>
          <code className="tabular shrink-0 text-xs text-muted-2">
            {link.from} + {link.to}
          </code>
        </Row>
      ))}
    </ul>
  )
}

function EvidenceBody({
  dimension,
  systemName,
}: {
  dimension: LossinessDimension
  systemName: (id: string) => string
}) {
  const inferredIds = strings(dimension.detail.inferred)
  const overrideIds = strings(dimension.detail.override)
  if (inferredIds.length + overrideIds.length === 0) {
    return (
      <p className="text-sm text-ink">
        Nothing to show. All {dimension.denominator} risk levels were read
        straight from a cell in the source workbook, so no keyword rule and no
        curation override stands behind any of them.
      </p>
    )
  }
  return (
    <>
      <Group title="Risk inferred by a keyword rule">
        <SystemList ids={inferredIds} systemName={systemName} />
      </Group>
      <Group title="Risk set by a curation override">
        <SystemList ids={overrideIds} systemName={systemName} />
      </Group>
    </>
  )
}

function OrphanedDevices({
  dimension,
  siteLabel,
}: {
  dimension: LossinessDimension
  siteLabel: (id: string) => string
}) {
  const sites = orphanedBySite(dimension)
  return (
    <>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {sites.map((site) => (
          <span key={site.id} className="text-muted">
            {siteLabel(site.id)}{' '}
            <span className="tabular text-ink">{site.count}</span>
          </span>
        ))}
      </div>
      <ul className="mt-3">
        {sites.flatMap((site) =>
          site.devices.map((device) => (
            <Row key={`${site.id}-${device}`}>
              <code className="tabular text-sm text-ink">{device}</code>
              <span className="shrink-0 text-xs text-muted-2">
                {siteLabel(site.id)}
              </span>
            </Row>
          )),
        )}
      </ul>
    </>
  )
}

function OpenQuestions({
  dimension,
  systemName,
}: {
  dimension: LossinessDimension
  systemName: (id: string) => string
}) {
  return (
    <ul>
      {questions(dimension).map((entry) => (
        <li
          key={entry.subject}
          className="border-b border-line py-2 last:border-0"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-2">
            {systemName(entry.subject)}
          </p>
          <p className="mt-1 text-sm text-ink">{entry.question}</p>
        </li>
      ))}
    </ul>
  )
}

/* ---------- detail readers, shared with the scorecard ---------- */

export interface MissingLink {
  from: string
  to: string
  label: string
}

export interface SiteRealization {
  id: string
  label: string
  mapped: number
  total: number
}

export interface SiteDevices {
  id: string
  count: number
  devices: string[]
}

export interface OpenQuestion {
  subject: string
  question: string
}

export function unconfirmed(dimension: LossinessDimension): string[] {
  return strings(dimension.detail.unconfirmed)
}

/** Rows left out of the realization denominator because they are shortfalls. */
export function shortfalls(dimension: LossinessDimension): string[] {
  const value = dimension.detail.shortfalls
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
}

export function unmapped(dimension: LossinessDimension): string[] {
  return strings(dimension.detail.unmapped)
}

export function missingLinks(dimension: LossinessDimension): MissingLink[] {
  const explicit = records(dimension.detail.missing)
  if (explicit.length > 0) {
    return explicit.map((link) => ({
      from: text(link.from),
      to: text(link.to),
      label: text(link.label),
    }))
  }
  // Older bundles carried only the id pairs. A missing label is not a missing link.
  return arrays(dimension.detail.missing_pairs).map((pair) => ({
    from: text(pair[0]),
    to: text(pair[1]),
    label: '',
  }))
}

export function perSite(dimension: LossinessDimension): SiteRealization[] {
  return Object.entries(record(dimension.detail.per_site)).map(([id, value]) => {
    const site = record(value)
    return {
      id,
      label: text(site.label),
      mapped: num(site.mapped),
      total: num(site.total),
    }
  })
}

export function orphanedBySite(dimension: LossinessDimension): SiteDevices[] {
  const counts = record(dimension.detail.by_site)
  const ids = record(dimension.detail.device_ids)
  const keys = [...new Set([...Object.keys(counts), ...Object.keys(ids)])]
  return keys.map((id) => ({
    id,
    count: num(counts[id]),
    devices: strings(ids[id]),
  }))
}

export function questions(dimension: LossinessDimension): OpenQuestion[] {
  return records(dimension.detail.questions).map((entry) => ({
    subject: text(entry.subject),
    question: text(entry.question),
  }))
}

/** How many entities the drawer will list. Drives the button label. */
export function drillCount(dimension: LossinessDimension): number {
  switch (dimension.key) {
    case 'requirement_attrition':
      return strings(dimension.detail.dropped).length
    case 'ownership_ambiguity':
      return unconfirmed(dimension).length
    case 'realization_gap':
      return unmapped(dimension).length
    case 'integration_gap':
      return missingLinks(dimension).length
    case 'evidence_gap':
      return (
        strings(dimension.detail.inferred).length +
        strings(dimension.detail.override).length
      )
    case 'orphaned_hardware':
      return orphanedBySite(dimension).reduce((total, s) => total + s.devices.length, 0)
    case 'open_questions':
      return questions(dimension).length
    default:
      return 0
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (v): v is Record<string, unknown> => typeof v === 'object' && v !== null,
      )
    : []
}

function arrays(value: unknown): unknown[][] {
  return Array.isArray(value) ? value.filter((v): v is unknown[] => Array.isArray(v)) : []
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
