import { useMemo, useState, type ReactNode } from 'react'

import { EmptyState } from '../../components/EmptyState'
import { LoadFailed } from '../../components/LoadFailed'
import { ShortfallNote } from '../../components/ShortfallNote'
import { useCuration } from '../../curation/CurationContext'
import { localDate } from '../../curation/dates'
import { CurationError, editKey, type Edit, type Review } from '../../curation/edits'
import {
  buildChecklist, systemStanding, walkSummary, type Checklist, type DeviceRow,
} from '../../curation/walk'
import type { AtlasDataProvider } from '../../data/provider'
import { useAtlas } from '../../data/useAtlas'
import { fieldableSystemIds, matrixIdSet, shortfallSystemIds } from '../../lib/coverage'
import type {
  CoverageMatrix, Device, DeviceId, Project, SiteId, SiteSummary, System, SystemId, Topology,
} from '../../types/atlas'
import { SiteSelector } from '../network/SiteSelector'
import { CheckForm } from './CheckForm'
import { AssignChooser, DeviceList, type DeviceActions, type ZoneBlock } from './DeviceList'
import { ReviewForm, type PickerZone } from './ReviewForm'
import { SystemList, type SystemItem } from './SystemList'

interface WalkData {
  /** The provider without edits that this load was made over. */
  base: AtlasDataProvider
  project: Project
  systems: System[]
  /** As edited in this tab. */
  coverage: CoverageMatrix
  /** As loaded, before any review made here. */
  loaded: CoverageMatrix
  topologies: Record<SiteId, Topology>
}

async function load(provider: AtlasDataProvider, base: AtlasDataProvider): Promise<WalkData> {
  const [project, systems, coverage, loaded] = await Promise.all([
    provider.getProject(), provider.getSystems(), provider.getCoverage(), base.getCoverage(),
  ])
  const drawings = await Promise.all(
    project.sites.map(async (site) => [site.id, await provider.getTopology(site.id)] as const),
  )
  return { base, project, systems, coverage, loaded, topologies: Object.fromEntries(drawings) }
}

/** The one form open on the page, and where. */
type Open =
  | { kind: 'system'; systemId: SystemId }
  | { kind: 'assign'; deviceId: DeviceId; systemId: SystemId | '' }
  | { kind: 'check'; deviceId: DeviceId }

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const byDeviceLabel = (a: { label: string }, b: { label: string }) => byText(a.label, b.label)
const riskRank = (risk: string): number => (risk === 'high' ? 0 : risk === 'medium' ? 1 : risk === 'low' ? 2 : 3)

const own = <T,>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

const zoneLabel = (topology: Topology, zoneId: string): string =>
  own(topology.zones, zoneId)?.label ?? zoneId

/** The keys a row's edit is held under, from the one definition of them. */
const reviewKey = (site: SiteId, system: SystemId) =>
  editKey({ kind: 'review', site, system, review: { status: 'clear' } })
const checkKey = (site: SiteId, device: DeviceId) =>
  editKey({ kind: 'check', site, device, check: null })

/**
 * The zones with something open, in the checklist's order, each followed by
 * its settled devices; then the zones with nothing open, by label.
 */
function zoneBlocks(checklist: Checklist, topology: Topology): ZoneBlock[] {
  const open = checklist.zones.map((z) => ({ zoneId: z.zoneId, label: z.label, rows: [...z.devices] }))
  const byZone = new Map(open.map((block) => [block.zoneId, block]))
  const settled = new Map<string, DeviceRow[]>()
  const done = [...checklist.settled.devices, ...checklist.settled.checked]
  for (const row of done.sort((a, b) => byDeviceLabel(a.device, b.device))) {
    const block = byZone.get(row.device.zone)
    if (block) block.rows.push(row)
    else settled.set(row.device.zone, [...(settled.get(row.device.zone) ?? []), row])
  }
  const rest = [...settled].map(([zoneId, rows]) => ({ zoneId, label: zoneLabel(topology, zoneId), rows }))
  return [...open, ...rest.sort((a, b) => byText(a.label, b.label))]
}

/** The picker's zones and devices, by label, so a device is found where it is expected. */
function pickerZones(topology: Topology): PickerZone[] {
  const byZone = new Map<string, Device[]>()
  for (const device of topology.devices) {
    const list = byZone.get(device.zone) ?? []
    list.push(device)
    byZone.set(device.zone, list)
  }
  return [...byZone]
    .map(([id, devices]) => ({ id, label: zoneLabel(topology, id), devices: devices.sort(byDeviceLabel) }))
    .sort((a, b) => byText(a.label, b.label))
}

export function WalkTab() {
  const { base } = useCuration()
  const state = useAtlas((provider) => load(provider, base), [base])

  // Every review makes a new provider and the tab reloads from it. The last
  // load stays on screen meanwhile, so a save neither blanks the page nor
  // throws the reader back to the top. Only a load over the same data is kept.
  const [held, setHeld] = useState<WalkData | null>(null)
  const fresh = state.status === 'ready' && state.data.base === base ? state.data : null
  if (fresh && fresh !== held) setHeld(fresh)
  const data = fresh ?? (held?.base === base ? held : null)

  return (
    <section>
      <h1 className="text-xl font-semibold text-ink">Site walk</h1>
      <p className="mt-1 text-sm text-muted">
        Record what a walk of one site found, system by system and device by device. A review
        takes effect across the app as soon as it is saved.
      </p>
      {state.status === 'failed' ? (
        <div className="mt-6">
          <LoadFailed resource="the site walk" message={state.error.message} onRetry={state.retry} />
        </div>
      ) : data ? (
        <Walk data={data} />
      ) : (
        <p role="status" className="mt-6 text-sm text-muted">
          Loading the site walk.
        </p>
      )}
    </section>
  )
}

function Walk({ data }: { data: WalkData }) {
  const [picked, setPicked] = useState<SiteId | null>(null)
  const { project, coverage, topologies } = data
  // A site the walk can edit has both a drawing and an entry in the map.
  const sites = project.sites.filter((s) => own(coverage.sites, s.id) && own(topologies, s.id))
  const siteId =
    [picked, coverage.default_site, project.default_site].find(
      (id) => id != null && sites.some((site) => site.id === id),
    ) ?? sites[0]?.id

  if (!siteId) {
    return (
      <div className="mt-6">
        <EmptyState
          title="No site to walk"
          detail="No loaded site has both a drawing and an entry in the system to device map, so there is nothing to review."
        />
      </div>
    )
  }
  // Keyed by site, so a form open at one site does not follow the reader to the next.
  return <SiteWalk key={siteId} data={data} siteId={siteId} sites={sites} onSite={setPicked} />
}

function SiteWalk(props: {
  data: WalkData
  siteId: SiteId
  sites: SiteSummary[]
  onSite: (id: SiteId) => void
}) {
  const { data, siteId, sites, onSite } = props
  const { edits, apply, revert, reviewer, setReviewer } = useCuration()
  const [open, setOpen] = useState<Open | null>(null)
  /** A row action the curation layer refused, on the row it was refused for. */
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null)
  const { systems, coverage } = data
  const site = coverage.sites[siteId]
  const topology = data.topologies[siteId]
  const loadedSite = own(data.loaded.sites, siteId)
  const today = localDate(new Date())

  const view = useMemo(() => {
    const matrixIds = matrixIdSet(systems)
    const byId = new Map<SystemId, System>()
    for (const system of systems) if (!byId.has(system.id)) byId.set(system.id, system)
    const items: SystemItem[] = [...fieldableSystemIds(systems)]
      .map((id) => ({ system: byId.get(id) as System, standing: systemStanding(site, id, matrixIds) }))
      .sort((a, b) =>
        riskRank(a.system.risk) - riskRank(b.system.risk) || byText(a.system.name, b.system.name))
    const labels = new Map(topology.devices.map((d) => [d.id, d.label]))
    return {
      items,
      itemById: new Map(items.map((item) => [item.system.id, item])),
      chooser: items.map((item) => item.system).sort((a, b) => byText(a.name, b.name)),
      summary: walkSummary(site, systems, topology),
      loadedRealized: loadedSite ? walkSummary(loadedSite, systems, topology).realized : 0,
      zones: zoneBlocks(buildChecklist(site, systems, topology), topology),
      picker: pickerZones(topology),
      labelOf: (id: DeviceId) => labels.get(id) ?? id,
      shortfalls: shortfallSystemIds(systems).map((id) => byId.get(id)?.name ?? id),
    }
  }, [systems, site, topology, loadedSite])

  const editKeys = new Set(edits.map(editKey))
  const close = () => setOpen(null)
  const fileChecks = loadedSite?.unclaimed_devices.checked
  const checkedInFile = (id: DeviceId) => !!fileChecks && Object.hasOwn(fileChecks, id)

  /** Why the curation layer refused, or null once it took the change. */
  const attempt = (change: () => void): string | null => {
    try {
      change()
      return null
    } catch (error) {
      if (error instanceof CurationError) return error.message
      throw error
    }
  }

  /** A row's own action: a refusal is said on that row, and a success clears it. */
  const onRow = (key: string, change: () => void) => {
    const message = attempt(change)
    setFailed(message ? { key, message } : null)
  }

  /** Writes one edit from a form. A refusal is said in the form, which stays open. */
  const save = (edit: Edit): string | null => {
    const message = attempt(() => apply(edit))
    if (message) return message
    const stamp = edit.kind === 'review' ? (edit.review.status === 'clear' ? null : edit.review) : edit.check
    if (stamp) setReviewer(stamp.reviewed_by)
    setOpen(null)
    setFailed(null)
    return null
  }
  const saveReview = (systemId: SystemId) => (review: Review) =>
    save({ kind: 'review', site: siteId, system: systemId, review })

  const reviewForm = (item: SystemItem, preselect?: DeviceId) => (
    <ReviewForm
      key={item.system.id}
      system={item.system}
      standing={item.standing}
      zones={view.picker}
      preselect={preselect}
      reviewer={reviewer}
      today={today}
      onSave={saveReview(item.system.id)}
      onCancel={close}
    />
  )

  const deviceForm = (row: DeviceRow): ReactNode => {
    if (!open || open.kind === 'system' || open.deviceId !== row.device.id) return null
    const device = row.device
    if (open.kind === 'check') {
      return (
        <CheckForm
          device={device}
          reviewer={reviewer}
          today={today}
          onSave={(check) => save({ kind: 'check', site: siteId, device: device.id, check })}
          onCancel={close}
        />
      )
    }
    const item = open.systemId ? view.itemById.get(open.systemId) : undefined
    return (
      <>
        <AssignChooser
          systems={view.chooser}
          value={open.systemId}
          onChange={(systemId) => setOpen({ ...open, systemId })}
          onCancel={close}
        />
        {item && reviewForm(item, device.id)}
      </>
    )
  }

  // The same button again closes its form. Open is flat, so its JSON is its identity.
  const toggle = (next: Open) =>
    setOpen((now) => (now && JSON.stringify(now) === JSON.stringify(next) ? null : next))

  const actions: DeviceActions = {
    isEdited: (id) => editKeys.has(checkKey(siteId, id)),
    isReviewable: (id) => view.itemById.has(id),
    onAssign: (deviceId, systemId) => toggle({ kind: 'assign', deviceId, systemId: systemId ?? '' }),
    onCheck: (deviceId) => toggle({ kind: 'check', deviceId }),
    onClearCheck: (deviceId) => {
      const key = checkKey(siteId, deviceId)
      // A check made here is cleared by dropping its edit; one the file holds
      // takes an edit that clears it. A cleared-check edit on a device the file
      // never checked would still stand in the way of an Undo naming it.
      onRow(key, () =>
        checkedInFile(deviceId)
          ? apply({ kind: 'check', site: siteId, device: deviceId, check: null })
          : revert(key))
    },
    onUndo: (deviceId) => {
      const key = checkKey(siteId, deviceId)
      onRow(key, () => revert(key))
    },
    errorFor: (id) => (failed?.key === checkKey(siteId, id) ? failed.message : null),
    form: deviceForm,
  }

  const s = view.summary
  const when = edits.length > 0 ? ` (${view.loadedRealized} when loaded)` : ''
  const lines = [
    [
      `${s.realized} of ${s.fieldable} realized${when}`, `${s.noHardware} recorded with no hardware`,
      `${s.absent} checked absent`, `${s.notLookedAt} not looked at`,
    ],
    [
      `${s.devices} devices`, `${s.carrying} carry a recorded system`,
      `${s.checked} checked, carrying none`, `${s.noRecord} with no record`,
    ],
  ]

  return (
    <>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <SiteSelector sites={sites} activeId={siteId} onSelect={onSite} />
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded border border-line bg-surface px-3 py-2 text-sm text-ink hover:bg-surface-2"
        >
          Print checklist
        </button>
      </div>

      {/* Two lines of disjoint buckets. A bucket never breaks across a line on a phone. */}
      <p data-testid="walk-summary" className="mt-4 text-sm text-ink">
        {lines.map((buckets, line) => (
          <span key={line} className={`block ${line ? 'text-muted' : ''}`}>
            {buckets.map((bucket, index) => (
              <span key={index}>
                {index > 0 && ' · '}
                <span className="whitespace-nowrap">{bucket}</span>
              </span>
            ))}
          </span>
        ))}
      </p>
      <ShortfallNote names={view.shortfalls} className="mt-1" />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SystemList
          items={view.items}
          labelOf={view.labelOf}
          isEdited={(id) => editKeys.has(reviewKey(siteId, id))}
          openId={open?.kind === 'system' ? open.systemId : null}
          onReview={(systemId) => toggle({ kind: 'system', systemId })}
          onUndo={(id) => {
            const key = reviewKey(siteId, id)
            onRow(key, () => revert(key))
          }}
          errorFor={(id) => (failed?.key === reviewKey(siteId, id) ? failed.message : null)}
          form={(item) => reviewForm(item)}
        />
        <DeviceList zones={view.zones} actions={actions} />
      </div>
    </>
  )
}
