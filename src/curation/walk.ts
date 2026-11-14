/**
 * The model behind the Site walk tab and its printed checklist: where each
 * system stands at one site, the site's summary, and the checklist in the
 * order a walk should take it. Pure, and read from the coverage as edited.
 */
import {
  absenceReason, confidenceGrade, fieldableSystemIds, isRealizedMapping, isReviewed, matrixIdSet,
  type ConfidenceGrade,
} from '../lib/coverage'
import { defaultRootChoice, resolveRoots, searchRootIds } from '../lib/dependency'
import { blastRadius } from '../lib/graph'
import type {
  CheckedAbsence, CheckedDevice, CoverageSite, Device, DeviceId, Mapping, ReviewStamp, RiskLevel,
  System, SystemId, Topology,
} from '../types/atlas'

/** The printed ordering rule, word for word. */
export const CHECKLIST_RULE =
  'Ordered by the risk level the workbook gives each system, high first. At the same level, ' +
  'the weakest evidence comes first: no record, ungraded, best guess, strong inference. ' +
  'Devices with no system recorded follow, most relied on first. Physically verified items, ' +
  'and devices checked and found to carry no system, are listed last.'

export type Standing =
  | { kind: 'realized'; mapping: Mapping }
  | { kind: 'no-hardware'; mapping: Mapping; reviewed: boolean }
  | { kind: 'absent'; reason: string; stamp: ReviewStamp | null }
  | { kind: 'none' }

const own = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record && Object.hasOwn(record, key) ? record[key] : undefined

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function stampOf(absence: string | CheckedAbsence): ReviewStamp | null {
  return typeof absence !== 'string' && isReviewed(absence)
    ? { reviewed_by: absence.reviewed_by, reviewed_on: absence.reviewed_on }
    : null
}

/**
 * One standing per system, in this precedence: realized, then no hardware,
 * then absent, then none. A file that records a system both as mapped and as
 * checked absent therefore counts it once, as the mapping says.
 */
export function systemStanding(
  site: CoverageSite,
  systemId: SystemId,
  matrixIds: ReadonlySet<SystemId>,
): Standing {
  const mapping = own(site.mappings, systemId)
  if (mapping && isRealizedMapping(systemId, mapping, matrixIds)) return { kind: 'realized', mapping }
  if (mapping && mapping.devices.length === 0) {
    return { kind: 'no-hardware', mapping, reviewed: isReviewed(mapping) }
  }
  const absence = own(site.not_deployed_at_site, systemId)
  if (absence !== undefined) {
    return { kind: 'absent', reason: absenceReason(absence), stamp: stampOf(absence) }
  }
  return { kind: 'none' }
}

export interface WalkSummary {
  fieldable: number
  realized: number
  noHardware: number
  absent: number
  notLookedAt: number
  devices: number
  carrying: number
  checked: number
  noRecord: number
}

const BUCKET = {
  realized: 'realized', 'no-hardware': 'noHardware', absent: 'absent', none: 'notLookedAt',
} as const

const namedDevices = (site: CoverageSite): Set<DeviceId> =>
  new Set(Object.values(site.mappings).flatMap((m) => m.devices))

/**
 * The fieldable systems in four disjoint buckets that sum to `fieldable`, and
 * the drawing's devices in three that sum to `devices`. A device carries a
 * recorded system when any mapping at the site names it, in the matrix or not.
 */
export function walkSummary(
  site: CoverageSite,
  systems: readonly System[],
  topology: Topology,
): WalkSummary {
  const matrixIds = matrixIdSet(systems)
  const fieldable = fieldableSystemIds(systems)
  const summary: WalkSummary = {
    fieldable: fieldable.size, realized: 0, noHardware: 0, absent: 0, notLookedAt: 0,
    devices: topology.devices.length, carrying: 0, checked: 0, noRecord: 0,
  }
  for (const id of fieldable) summary[BUCKET[systemStanding(site, id, matrixIds).kind]] += 1

  const named = namedDevices(site)
  for (const device of topology.devices) {
    if (named.has(device.id)) summary.carrying += 1
    else if (own(site.unclaimed_devices.checked, device.id)) summary.checked += 1
    else summary.noRecord += 1
  }
  return summary
}

export interface DeviceRow {
  device: Device
  systems: { id: SystemId; name: string; risk: RiskLevel | null; grade: ConfidenceGrade; outside: boolean }[]
  /** Devices that lose their path on the drawing if this one fails. */
  reliance: number
  check: CheckedDevice | null
}

export interface Checklist {
  locate: { system: System; record: 'none' | 'survey-gap' }[]
  zones: { zoneId: string; label: string; devices: DeviceRow[] }[]
  settled: {
    devices: DeviceRow[]
    checked: DeviceRow[]
    absent: { id: SystemId; name: string; reason: string; stamp: ReviewStamp | null }[]
    noHardware: { system: System; mapping: Mapping }[]
  }
}

/** High 0, medium 1, low 2; anything else, an outside-matrix system included, 3. */
const riskRank = (risk: RiskLevel | null): number =>
  risk === 'high' ? 0 : risk === 'medium' ? 1 : risk === 'low' ? 2 : 3

/** Weakest evidence first. */
const GRADE_RANK: Record<ConfidenceGrade, number> = { unspecified: 0, low: 1, medium: 2, high: 3 }

/** A device row with the first two parts of its key; reliance and label are on the row. */
interface Keyed {
  row: DeviceRow
  risk: number
  evidence: number
}

function keyed(row: DeviceRow): Keyed {
  if (row.systems.length === 0) return { row, risk: 4, evidence: 0 }
  const risk = Math.min(...row.systems.map((s) => riskRank(s.risk)))
  const evidence = Math.min(
    ...row.systems.filter((s) => riskRank(s.risk) === risk).map((s) => GRADE_RANK[s.grade]),
  )
  return { row, risk, evidence }
}

/** (risk rank, evidence rank, -reliance, label). */
const byKey = (a: Keyed, b: Keyed): number =>
  a.risk - b.risk ||
  a.evidence - b.evidence ||
  b.row.reliance - a.row.reliance ||
  byText(a.row.device.label, b.row.device.label)

const byLabel = (a: DeviceRow, b: DeviceRow): number => byText(a.device.label, b.device.label)

/**
 * The checklist for one site: systems to locate, then one section per zone of
 * devices with something still open, then what is already settled. Reliance
 * is measured from the roots the Network tab uses for the site by default.
 */
export function buildChecklist(
  site: CoverageSite,
  systems: readonly System[],
  topology: Topology,
): Checklist {
  const matrixIds = matrixIdSet(systems)
  const byId = new Map(systems.map((s) => [s.id, s]))

  const locate: Checklist['locate'] = []
  const noHardware: Checklist['settled']['noHardware'] = []
  for (const id of fieldableSystemIds(systems)) {
    const system = byId.get(id) as System
    const standing = systemStanding(site, id, matrixIds)
    if (standing.kind === 'none') locate.push({ system, record: 'none' })
    else if (standing.kind === 'no-hardware') {
      if (standing.reviewed) noHardware.push({ system, mapping: standing.mapping })
      else locate.push({ system, record: 'survey-gap' })
    }
  }
  const recordRank = (r: Checklist['locate'][number]) => (r.record === 'none' ? 0 : 1)
  locate.sort((a, b) =>
    riskRank(a.system.risk) - riskRank(b.system.risk) ||
    recordRank(a) - recordRank(b) ||
    byText(a.system.name, b.system.name))
  noHardware.sort((a, b) => byText(a.system.id, b.system.id))

  const onDevice = new Map<DeviceId, DeviceRow['systems']>()
  for (const [id, mapping] of Object.entries(site.mappings)) {
    if (mapping.devices.length === 0) continue
    // Naming a device, so the mapping is realized unless the matrix does not carry it.
    const outside = !isRealizedMapping(id, mapping, matrixIds)
    const system = outside ? undefined : byId.get(id)
    const entry = {
      id, name: system?.name ?? id, risk: system?.risk ?? null, grade: confidenceGrade(mapping), outside,
    }
    for (const deviceId of new Set(mapping.devices)) {
      const list = onDevice.get(deviceId) ?? []
      list.push({ ...entry })
      onDevice.set(deviceId, list)
    }
  }

  const rootIds = searchRootIds(resolveRoots(topology, site, defaultRootChoice(site)))
  const settledDevices: DeviceRow[] = []
  const checked: DeviceRow[] = []
  const open = new Map<string, Keyed[]>()
  for (const device of topology.devices) {
    const row: DeviceRow = {
      device,
      systems: (onDevice.get(device.id) ?? []).sort((a, b) => byText(a.name, b.name)),
      reliance: blastRadius(topology, device.id, { rootIds }).unreachableCount,
      check: own(site.unclaimed_devices.checked, device.id) ?? null,
    }
    if (row.systems.length > 0 && row.systems.every((s) => s.grade === 'high')) settledDevices.push(row)
    else if (row.systems.length === 0 && row.check) checked.push(row)
    else {
      const zone = open.get(device.zone) ?? []
      zone.push(keyed(row))
      open.set(device.zone, zone)
    }
  }

  const zones = [...open].map(([zoneId, devices]) => ({
    zoneId,
    label: own(topology.zones, zoneId)?.label ?? zoneId,
    devices: devices.sort(byKey),
  }))
  zones.sort((a, b) => byKey(a.devices[0], b.devices[0]) || byText(a.label, b.label))

  const absent = Object.entries(site.not_deployed_at_site)
    .map(([id, value]) => ({
      id, name: byId.get(id)?.name ?? id, reason: absenceReason(value), stamp: stampOf(value),
    }))
    .sort((a, b) => byText(a.id, b.id))

  return {
    locate,
    zones: zones.map(({ zoneId, label, devices }) => ({ zoneId, label, devices: devices.map((k) => k.row) })),
    settled: {
      devices: settledDevices.sort(byLabel),
      checked: checked.sort(byLabel),
      absent,
      noHardware,
    },
  }
}
