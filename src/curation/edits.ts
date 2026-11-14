import { isShortfall, matrixIdSet, realizedConfidenceCounts } from '../lib/coverage'
import type {
  CheckedDevice, CoverageMatrix, CoverageSite, DeviceId, Mapping, ReviewStamp, SiteId, System, SystemId,
} from '../types/atlas'

type Grade = 'high' | 'medium' | 'low'

/** What a reviewer concluded about one system at one site. */
export type Review =
  | ({ status: 'found'; devices: DeviceId[]; confidence: Grade; note: string } & ReviewStamp)
  | ({ status: 'no-hardware'; confidence: Grade; note: string } & ReviewStamp)
  | ({ status: 'absent'; reason: string } & ReviewStamp)
  | { status: 'clear' }

export type Edit =
  | { kind: 'review'; site: SiteId; system: SystemId; review: Review }
  | { kind: 'check'; site: SiteId; device: DeviceId; check: CheckedDevice | null }

/** An edit the coverage cannot take. */
export class CurationError extends Error {}

export function editKey(edit: Edit): string {
  return edit.kind === 'review'
    ? `${edit.site}\0system\0${edit.system}`
    : `${edit.site}\0device\0${edit.device}`
}

/** One edit per row: the last word on a row is appended, so it is replayed last. */
export function upsertEdit(edits: readonly Edit[], edit: Edit): Edit[] {
  const key = editKey(edit)
  return [...edits.filter((e) => editKey(e) !== key), edit]
}

const mappedDevices = (mappings: Record<SystemId, Mapping>): Set<DeviceId> =>
  new Set(Object.values(mappings).flatMap((m) => m.devices))

function reviewSite(site: CoverageSite, system: SystemId, review: Review): CoverageSite {
  const mappings = { ...site.mappings }
  const absences = { ...site.not_deployed_at_site }
  const namedBefore = Object.values(site.mappings).flatMap((m) => m.devices)

  delete mappings[system]
  delete absences[system]

  switch (review.status) {
    case 'found':
      mappings[system] = {
        ...site.mappings[system],
        devices: [...new Set(review.devices)],
        confidence: review.confidence,
        note: review.note,
        reviewed_by: review.reviewed_by,
        reviewed_on: review.reviewed_on,
      }
      break
    case 'no-hardware':
      mappings[system] = {
        ...site.mappings[system],
        devices: [],
        confidence: review.confidence,
        note: review.note,
        reviewed_by: review.reviewed_by,
        reviewed_on: review.reviewed_on,
      }
      break
    case 'absent':
      absences[system] = {
        reason: review.reason, reviewed_by: review.reviewed_by, reviewed_on: review.reviewed_on,
      }
      break
    case 'clear':
      break
  }

  const claimed = mappedDevices(mappings)
  const released = namedBefore.filter((id) => !claimed.has(id))
  const kept = site.unclaimed_devices.infrastructure.filter((id) => !claimed.has(id))
  const infrastructure = [...kept]
  for (const id of released) if (!infrastructure.includes(id)) infrastructure.push(id)

  const unclaimed: CoverageSite['unclaimed_devices'] = {
    ...site.unclaimed_devices, infrastructure,
  }
  if (site.unclaimed_devices.checked) {
    const checked = Object.fromEntries(
      Object.entries(site.unclaimed_devices.checked).filter(([id]) => !claimed.has(id)),
    )
    if (Object.keys(checked).length > 0) unclaimed.checked = checked
    else delete unclaimed.checked
  }

  return { ...site, mappings, not_deployed_at_site: absences, unclaimed_devices: unclaimed }
}

function checkSite(site: CoverageSite, device: DeviceId, check: CheckedDevice | null): CoverageSite {
  if (mappedDevices(site.mappings).has(device)) {
    throw new CurationError(`${device} is named by a mapping, so it cannot be checked as unclaimed`)
  }
  const checked = { ...site.unclaimed_devices.checked }
  if (check === null) {
    delete checked[device]
  } else {
    const { note, ...stamp } = check
    checked[device] = note && note.trim() !== '' ? { ...stamp, note } : stamp
  }
  const unclaimed: CoverageSite['unclaimed_devices'] = { ...site.unclaimed_devices }
  if (Object.keys(checked).length > 0) unclaimed.checked = checked
  else delete unclaimed.checked
  return { ...site, unclaimed_devices: unclaimed }
}

/**
 * The coverage with one edit applied. Pure: the site it touches is copied
 * along with everything it writes into, because the loaders hand back nested
 * objects shared with the file they read.
 */
export function applyEdit(
  coverage: CoverageMatrix,
  edit: Edit,
  systems: readonly System[],
): CoverageMatrix {
  const site = coverage.sites[edit.site]
  if (!site) throw new CurationError(`There is no site '${edit.site}'`)

  let next: CoverageSite
  if (edit.kind === 'review') {
    const system = systems.find((s) => s.id === edit.system)
    if (!system) throw new CurationError(`'${edit.system}' is not a matrix system`)
    if (isShortfall(system)) {
      throw new CurationError(`${system.name} is a shortfall row, which is not reviewed at a site`)
    }
    const { review } = edit
    if (review.status === 'found' && review.devices.length === 0) {
      throw new CurationError('A found system must name at least one device')
    }
    if (review.status === 'absent' && review.reason.trim() === '') {
      throw new CurationError('An absent system needs a reason')
    }
    next = reviewSite(site, edit.system, review)
  } else {
    next = checkSite(site, edit.device, edit.check)
  }
  return { ...coverage, sites: { ...coverage.sites, [edit.site]: next } }
}

export function applyEdits(
  coverage: CoverageMatrix,
  edits: readonly Edit[],
  systems: readonly System[],
): CoverageMatrix {
  const result = edits.reduce((acc, edit) => applyEdit(acc, edit, systems), coverage)
  return {
    ...result,
    confidence_counts: realizedConfidenceCounts(result, matrixIdSet(systems)),
  }
}
