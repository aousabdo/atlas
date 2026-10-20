/**
 * What rests on a device: the cross-layer blast radius.
 *
 * The resilience panel answers what a device takes with it on the drawing:
 * which devices lose their path. This joins that to the other two layers. Per
 * device, removed on its own: which realized systems it strands, which it cuts
 * part of, which documented integrations break, and which decision positions
 * are left with no system to reach. Then the devices no system claims are
 * sorted by what rests on them, so a grey switch that is the only way to an
 * effector stops reading as "no risk".
 *
 * Everything here is arithmetic on the recorded drawing, on cable and radio
 * only. A drawing shows what can reach, not what does. Every reachability
 * claim is measured from a root set, and the set travels with the result so
 * the screen can print it wherever the claim is made.
 *
 * Built only from what already exists: blastRadius and buildGraph (graph.ts),
 * wiringAtSite (wiring.ts), isRealizedMapping and isReviewedSite (coverage.ts).
 * No new graph algorithm.
 */
import { isRealizedMapping, isReviewedSite, matrixIdSet } from './coverage'
import {
  blastRadius, buildGraph, derivedRootIds, isLogicalLink, type BlastRadiusReport,
} from './graph'
import { wiringAtSite, type LinkWiring, type WiringVerdict } from './wiring'
import type {
  CoverageSite, DeviceId, Link, RiskLevel, System, SystemId, Topology,
} from '../types/atlas'

// ---------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------

export type RootChoice =
  | { source: 'declared' }
  | { source: 'declared-without-assumed' }
  | { source: 'derived' }
  | { source: 'type'; deviceType: string }

export interface RootSet {
  choice: RootChoice
  /** '@declared' | '@declared-without-assumed' | '' (derived) | the device type. */
  key: string
  /** On the drawing, sorted. */
  deviceIds: DeviceId[]
  /** Declared but not on the drawing: named, never dropped. */
  unknownIds: DeviceId[]
  /** Joined only by VLAN: they seed nothing. */
  logicalOnlyIds: DeviceId[]
  /** On the drawing with no link of any kind: they reach nothing but themselves, so seed nothing. */
  isolatedIds: DeviceId[]
  /** Declared choices only. */
  assumedIds: DeviceId[]
  note: string | null
  /** At least one root has a cable or radio link to seed a search from. */
  usable: boolean
}

export function rootKey(choice: RootChoice): string {
  switch (choice.source) {
    case 'declared':
      return '@declared'
    case 'declared-without-assumed':
      return '@declared-without-assumed'
    case 'derived':
      return ''
    case 'type':
      return choice.deviceType
  }
}

export function choiceFromKey(key: string): RootChoice {
  if (key === '@declared') return { source: 'declared' }
  if (key === '@declared-without-assumed') return { source: 'declared-without-assumed' }
  if (key === '') return { source: 'derived' }
  return { source: 'type', deviceType: key }
}

/** Declared positions when the site has them, otherwise the drawing's entry points. */
export function defaultRootChoice(site: CoverageSite | undefined): RootChoice {
  return site?.decision_roots ? { source: 'declared' } : { source: 'derived' }
}

const sorted = <T,>(values: Iterable<T>) => [...values].sort() as T[]

export function resolveRoots(
  topology: Topology,
  site: CoverageSite | undefined,
  choice: RootChoice,
): RootSet {
  const onDrawing = new Set(topology.devices.map((d) => d.id))
  const declared = site?.decision_roots
  const assumed = new Set(declared?.assumed ?? [])
  let wanted: DeviceId[]
  switch (choice.source) {
    case 'declared':
      wanted = declared?.devices ?? []
      break
    case 'declared-without-assumed':
      wanted = (declared?.devices ?? []).filter((id) => !assumed.has(id))
      break
    case 'derived':
      wanted = derivedRootIds(topology)
      break
    case 'type':
      wanted = topology.devices.filter((d) => d.type === choice.deviceType).map((d) => d.id)
      break
  }
  const unique = sorted(new Set(wanted))
  const deviceIds = unique.filter((id) => onDrawing.has(id))
  const anomalies = buildGraph(topology).anomalies
  const logicalOnly = new Set(anomalies.logicalOnlyDeviceIds)
  const isolated = new Set(anomalies.isolatedDeviceIds)
  const logicalOnlyIds = deviceIds.filter((id) => logicalOnly.has(id))
  const isolatedIds = deviceIds.filter((id) => isolated.has(id))
  const isDeclared = choice.source === 'declared' || choice.source === 'declared-without-assumed'
  return {
    choice,
    key: rootKey(choice),
    deviceIds,
    unknownIds: unique.filter((id) => !onDrawing.has(id)),
    logicalOnlyIds,
    isolatedIds,
    assumedIds: isDeclared ? deviceIds.filter((id) => assumed.has(id)) : [],
    note: isDeclared ? (declared?.note ?? null) : null,
    usable: deviceIds.some((id) => !logicalOnly.has(id) && !isolated.has(id)),
  }
}

/**
 * The roots a reachability search starts from: all of them but the ones with
 * no link of any kind, which can reach nothing and must not count themselves
 * as reached. VLAN-only roots stay in, because blastRadius already leaves them
 * out of the search and says so.
 */
export function searchRootIds(roots: RootSet): DeviceId[] {
  const isolated = new Set(roots.isolatedIds)
  return roots.deviceIds.filter((id) => !isolated.has(id))
}

/** The roots that can carry a path: neither joined only by VLAN nor without any link. */
export function usableRootIds(roots: RootSet): DeviceId[] {
  const unusable = new Set([...roots.logicalOnlyIds, ...roots.isolatedIds])
  return roots.deviceIds.filter((id) => !unusable.has(id))
}

export interface RootChoiceOption {
  choice: RootChoice
  key: string
  count: number
  /** declared-without-assumed only: how many declared positions on the drawing it leaves out. */
  removed?: number
}

/** The root sets a reader can measure from at this site, declared ones first. */
export function rootChoices(topology: Topology, site: CoverageSite | undefined): RootChoiceOption[] {
  const options: RootChoiceOption[] = []
  const add = (choice: RootChoice) =>
    options.push({ choice, key: rootKey(choice), count: resolveRoots(topology, site, choice).deviceIds.length })
  if (site?.decision_roots) {
    add({ source: 'declared' })
    // Counted from the resolved set, so a repeated or off-drawing assumption
    // never inflates the number in the option's label.
    const removed = resolveRoots(topology, site, { source: 'declared' }).assumedIds.length
    if (removed > 0) {
      add({ source: 'declared-without-assumed' })
      options[options.length - 1]!.removed = removed
    }
  }
  add({ source: 'derived' })
  for (const type of sorted(new Set(topology.devices.map((d) => d.type)))) {
    add({ source: 'type', deviceType: type })
  }
  return options
}

/** The drawing without one device and every link touching it. */
export function topologyWithout(topology: Topology, deviceId: DeviceId): Topology {
  return {
    ...topology,
    devices: topology.devices.filter((d) => d.id !== deviceId),
    edges: topology.edges.filter((e) => e.source !== deviceId && e.target !== deviceId),
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type SystemEffect =
  /** The device is the only one of the system's devices that reached a root: its own risk. */
  | { kind: 'runs-only-here'; systemId: SystemId }
  /**
   * Every other device the system runs on that reached a root loses its path.
   * The ones that had no path to begin with, or are joined only by VLAN, are
   * named apart: nothing is said about them losing anything.
   */
  | {
      kind: 'stranded'
      systemId: SystemId
      lostDeviceIds: DeviceId[]
      alsoRunsHere: boolean
      alreadyCutOffIds: DeviceId[]
      vlanOnlyIds: DeviceId[]
    }
  /** Some of the system's devices lose their path and some keep it. */
  | {
      kind: 'partial'
      systemId: SystemId
      lostDeviceIds: DeviceId[]
      keptDeviceIds: DeviceId[]
      alsoRunsHere: boolean
      /** Every device the system runs on that has a cable or radio link, this one included. */
      deviceCount: number
    }

export interface IntegrationEffect {
  /** LinkWiring.index: the identity the Documented integrations panel uses. */
  index: number
  link: Link
  /** breaks: no shared device and no cable or radio path left. loses-end: an end has no hardware left. */
  kind: 'breaks' | 'loses-end'
  before: Extract<WiringVerdict, { kind: 'wired' } | { kind: 'co-hosted' }>
  after: WiringVerdict
  /** breaks only: both systems still have a device reaching a root. */
  endsKeepRoots: boolean
}

/**
 * not-reached: no root reaches the device before anything is removed (a
 * piece of the drawing with no root in it, or an unlinked device), so
 * removing it cannot be measured against the roots.
 */
export type NotAssessed = 'not-reviewed' | 'no-roots' | 'only-root' | 'vlan-only' | 'not-reached'

export interface DeviceDependency {
  deviceId: DeviceId
  label: string
  /** Realized systems that list this device: the direct layer. */
  runsSystemIds: SystemId[]
  isRoot: boolean
  notAssessed: NotAssessed | null
  /** blastRadius(topology, id, { rootIds }), the same search the resilience panel runs. */
  blast: BlastRadiusReport | null
  /** stranded, then partial, then runs-only-here; within each by system name. */
  systems: SystemEffect[]
  /** By the integration's index. Computed whenever the site is reviewed. */
  integrations: IntegrationEffect[]
  /** Roots left with no path to any other device a realized system runs on; by label. */
  positionsCutOff: DeviceId[]
  /** Highest risk among systems stranded that do not run here; null for roots and not assessed. */
  structural: { risk: RiskLevel; systemIds: SystemId[] } | null
}

export interface SystemStanding {
  systemId: SystemId
  /** Its devices on the drawing, sorted. */
  deviceIds: DeviceId[]
  onRootIds: DeviceId[]
  vlanOnlyIds: DeviceId[]
  alreadyCutOffIds: DeviceId[]
  status: 'assessable' | 'never-reaches' | 'vlan-only'
}

export type TriageGroup = 'load-bearing' | 'cuts-devices-off' | 'nothing-loses-path' | 'one-link' | 'not-assessed'
export const TRIAGE_ORDER: readonly TriageGroup[] = [
  'load-bearing', 'cuts-devices-off', 'nothing-loses-path', 'one-link', 'not-assessed',
]

export interface Triage {
  status: 'measured' | 'not-reviewed' | 'no-realized-system' | 'no-roots' | 'nothing-unclaimed'
  /** On no realized mapping. */
  population: DeviceId[]
  /** unclaimed_devices.infrastructure that are on the drawing. */
  listedUnclaimedIds: DeviceId[]
  /** Unclaimed but not on the device map's list, with the non-realized mappings that name them. */
  notListed: Array<{ deviceId: DeviceId; namedBy: string[] }>
  /** On the device map's unclaimed list though a realized system runs on it. */
  listedButClaimedIds: DeviceId[]
  /** Each by label, then id. */
  groups: Record<TriageGroup, DeviceId[]>
  notAssessed: Array<{ deviceId: DeviceId; reason: NotAssessed }>
}

export interface DependencyInput {
  topology: Topology
  site: CoverageSite | undefined
  systems: readonly System[]
  links: readonly Link[]
}

export interface SiteDependencies {
  review: 'not-reviewed' | 'no-realized-system' | 'reviewed'
  roots: RootSet
  realizedCount: number
  standings: SystemStanding[]
  /** Realized, but none of its devices is on the drawing. */
  notInDrawing: SystemId[]
  wiring: LinkWiring[]
  byDevice: ReadonlyMap<DeviceId, DeviceDependency>
  triage: Triage
}

const RISK_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }

function emptyGroups(): Record<TriageGroup, DeviceId[]> {
  return {
    'load-bearing': [], 'cuts-devices-off': [], 'nothing-loses-path': [], 'one-link': [], 'not-assessed': [],
  }
}

/**
 * Every device's dependency at one site, measured from one root set.
 *
 * O(V·(V+E)): one blast radius, one component pass and one wiring check over
 * the wired and shared-device integrations per device. Milliseconds at site
 * scale.
 */
export function siteDependencies(input: DependencyInput, roots: RootSet): SiteDependencies {
  const { topology, site, systems, links } = input
  const labelOf = new Map(topology.devices.map((d) => [d.id, d.label]))
  const byLabel = (a: DeviceId, b: DeviceId) =>
    (labelOf.get(a) ?? a).localeCompare(labelOf.get(b) ?? b) || a.localeCompare(b)
  const nameOf = new Map(systems.map((s) => [s.id, s.name]))
  const riskOf = new Map(systems.map((s) => [s.id, s.risk]))
  const matrixIds = matrixIdSet(systems)
  const onDrawing = new Set(topology.devices.map((d) => d.id))
  const graph = buildGraph(topology)
  const logicalOnly = new Set(graph.anomalies.logicalOnlyDeviceIds)

  const empty = (review: SiteDependencies['review'], status: Triage['status']): SiteDependencies => ({
    review, roots, realizedCount: 0, standings: [], notInDrawing: [], wiring: [],
    byDevice: new Map(),
    triage: {
      status, population: [], listedUnclaimedIds: [], notListed: [], listedButClaimedIds: [],
      groups: emptyGroups(), notAssessed: [],
    },
  })

  if (!site || !isReviewedSite(site)) return empty('not-reviewed', 'not-reviewed')

  // Realized systems and the devices each runs on, on the drawing.
  const drawn = new Map<SystemId, DeviceId[]>()
  const notInDrawing: SystemId[] = []
  for (const [id, mapping] of Object.entries(site.mappings)) {
    if (!isRealizedMapping(id, mapping, matrixIds)) continue
    const devices = sorted(new Set(mapping.devices.filter((d) => onDrawing.has(d))))
    if (devices.length === 0) notInDrawing.push(id)
    else drawn.set(id, devices)
  }
  const realizedCount = drawn.size + notInDrawing.length
  const claimed = new Set([...drawn.values()].flat())
  const runsOn = new Map<DeviceId, SystemId[]>()
  for (const [sid, devices] of drawn) {
    for (const d of devices) runsOn.set(d, [...(runsOn.get(d) ?? []), sid])
  }

  const wiring = wiringAtSite(links, site, topology, matrixIds)

  // Reachability before anything is removed, from the usable roots.
  const usableRoots = usableRootIds(roots)
  const pieceOf = new Map<DeviceId, number>()
  graph.components.forEach((piece, i) => piece.deviceIds.forEach((id) => pieceOf.set(id, i)))
  const rootPieces = new Set(usableRoots.map((id) => pieceOf.get(id)))
  const reachesBefore = (id: DeviceId) =>
    !logicalOnly.has(id) && pieceOf.has(id) && rootPieces.has(pieceOf.get(id))

  const standings: SystemStanding[] = [...drawn].map(([systemId, deviceIds]): SystemStanding => {
    const vlanOnlyIds = deviceIds.filter((d) => logicalOnly.has(d))
    const physical = deviceIds.filter((d) => !logicalOnly.has(d))
    const alreadyCutOffIds = physical.filter((d) => !reachesBefore(d))
    return {
      systemId,
      deviceIds,
      onRootIds: deviceIds.filter((d) => usableRoots.includes(d)),
      vlanOnlyIds,
      alreadyCutOffIds,
      status:
        physical.length === 0 ? 'vlan-only' : alreadyCutOffIds.length === physical.length ? 'never-reaches' : 'assessable',
    }
  }).sort((a, b) => a.systemId.localeCompare(b.systemId))

  const allSystemDevices = new Set(claimed)
  // A root's piece holds a system device other than itself.
  const hasOtherSystemDevice = (piece: readonly DeviceId[], root: DeviceId) =>
    piece.some((d) => d !== root && allSystemDevices.has(d))
  const rootPieceBefore = new Map(
    usableRoots.map((r) => [r, graph.components[pieceOf.get(r)!]?.deviceIds ?? [r]]),
  )

  const candidates = wiring.filter((w) => w.verdict.kind === 'wired' || w.verdict.kind === 'co-hosted')

  const byDevice = new Map<DeviceId, DeviceDependency>()
  for (const d of [...topology.devices].sort((a, b) => a.id.localeCompare(b.id))) {
    const X = d.id
    const isRoot = roots.deviceIds.includes(X)
    const without = topologyWithout(topology, X)

    // Integrations do not depend on the roots.
    const after = wiringAtSite(candidates.map((w) => w.link), site, without, matrixIds)
    const integrationRows = candidates.flatMap((row, i) => {
      const verdict = after[i]!.verdict
      const kind: IntegrationEffect['kind'] | null =
        verdict.kind === 'unchecked' ? 'loses-end'
          : verdict.kind === 'no-path' || verdict.kind === 'logical-only' ? 'breaks'
            : null
      return kind
        ? [{ row, kind, after: verdict }]
        : []
    })

    let notAssessed: NotAssessed | null = null
    if (!roots.usable) notAssessed = 'no-roots'
    else if (logicalOnly.has(X)) notAssessed = 'vlan-only'
    else if (usableRoots.length === 1 && usableRoots[0] === X) notAssessed = 'only-root'

    const blast = roots.usable ? blastRadius(topology, X, { rootIds: searchRootIds(roots) }) : null
    if (notAssessed === null && blast && !blast.removedWasReachable) notAssessed = 'not-reached'
    const lostSet = new Set(blast?.unreachableDeviceIds ?? [])
    const reachesAfter = (id: DeviceId) => id !== X && reachesBefore(id) && !lostSet.has(id)

    const systemsHere: SystemEffect[] = []
    const positionsCutOff: DeviceId[] = []
    if (notAssessed === null && blast) {
      for (const standing of standings) {
        if (standing.status !== 'assessable') continue
        const B = standing.deviceIds.filter((dev) => reachesBefore(dev))
        if (B.length === 0) continue
        const others = B.filter((dev) => dev !== X)
        const alsoRunsHere = standing.deviceIds.includes(X)
        if (others.length === 0) {
          if (B.includes(X)) systemsHere.push({ kind: 'runs-only-here', systemId: standing.systemId })
          continue
        }
        const lost = others.filter((dev) => lostSet.has(dev))
        const kept = others.filter((dev) => !lostSet.has(dev))
        if (kept.length === 0) {
          systemsHere.push({
            kind: 'stranded', systemId: standing.systemId, lostDeviceIds: lost, alsoRunsHere,
            alreadyCutOffIds: standing.alreadyCutOffIds.filter((dev) => dev !== X),
            vlanOnlyIds: standing.vlanOnlyIds.filter((dev) => dev !== X),
          })
        } else if (lost.length > 0) {
          systemsHere.push({
            kind: 'partial', systemId: standing.systemId, lostDeviceIds: lost, keptDeviceIds: kept, alsoRunsHere,
            deviceCount: standing.deviceIds.length - standing.vlanOnlyIds.length,
          })
        }
      }

      const graphWithout = buildGraph(without)
      const pieceWithout = new Map<DeviceId, readonly DeviceId[]>()
      for (const piece of graphWithout.components) for (const id of piece.deviceIds) pieceWithout.set(id, piece.deviceIds)
      for (const r of usableRoots) {
        if (r === X) continue
        if (!hasOtherSystemDevice(rootPieceBefore.get(r)!, r)) continue
        if (!hasOtherSystemDevice(pieceWithout.get(r) ?? [r], r)) positionsCutOff.push(r)
      }
      positionsCutOff.sort(byLabel)
    }

    const order = { stranded: 0, partial: 1, 'runs-only-here': 2 } as const
    systemsHere.sort(
      (a, b) => order[a.kind] - order[b.kind] ||
        (nameOf.get(a.systemId) ?? a.systemId).localeCompare(nameOf.get(b.systemId) ?? b.systemId),
    )

    const integrations: IntegrationEffect[] = integrationRows.map(({ row, kind, after: verdict }) => {
      const endKeeps = (sid: SystemId) => (drawn.get(sid) ?? []).some((dev) => reachesAfter(dev))
      return {
        index: row.index,
        link: row.link,
        kind,
        before: row.verdict as IntegrationEffect['before'],
        after: verdict,
        endsKeepRoots:
          kind === 'breaks' && notAssessed === null && endKeeps(row.link.from) && endKeeps(row.link.to),
      }
    })

    let structural: DeviceDependency['structural'] = null
    if (!isRoot && notAssessed === null) {
      const charged = systemsHere.filter(
        (s): s is Extract<SystemEffect, { kind: 'stranded' }> => s.kind === 'stranded' && !s.alsoRunsHere,
      )
      if (charged.length > 0) {
        const top = charged.reduce(
          (best, s) => Math.max(best, RISK_RANK[riskOf.get(s.systemId) ?? 'low'] ?? 0), 0,
        )
        const risk = (['low', 'medium', 'high'] as const)[top - 1] ?? 'low'
        structural = { risk, systemIds: charged.map((s) => s.systemId).sort() }
      }
    }

    byDevice.set(X, {
      deviceId: X,
      label: d.label,
      runsSystemIds: sorted(runsOn.get(X) ?? []),
      isRoot,
      notAssessed,
      blast,
      systems: systemsHere,
      integrations,
      positionsCutOff,
      structural,
    })
  }

  // Triage of the devices no realized system claims.
  // A repeated id is one device, as the graph folds it.
  const population = [...new Set(topology.devices.map((d) => d.id))].filter((id) => !claimed.has(id)).sort(byLabel)
  const listed = (site.unclaimed_devices?.infrastructure ?? []).filter((id) => onDrawing.has(id))
  const listedSet = new Set(listed)
  const namedBy = (id: DeviceId) =>
    Object.entries(site.mappings)
      .filter(([sid, m]) => !drawn.has(sid) && (m.devices ?? []).includes(id))
      .map(([sid]) => sid)
      .sort()
  const degree = new Map<DeviceId, Set<DeviceId>>()
  for (const e of topology.edges) {
    if (isLogicalLink(e.link_type) || e.source === e.target) continue
    if (!onDrawing.has(e.source) || !onDrawing.has(e.target)) continue
    degree.set(e.source, (degree.get(e.source) ?? new Set()).add(e.target))
    degree.set(e.target, (degree.get(e.target) ?? new Set()).add(e.source))
  }

  const groups = emptyGroups()
  const notAssessedList: Triage['notAssessed'] = []
  for (const id of population) {
    const dep = byDevice.get(id)!
    let group: TriageGroup
    // A broken integration holds whatever the roots, so it files a device as
    // load-bearing even where nothing else about it can be measured.
    const breaks = dep.integrations.some((i) => i.kind === 'breaks')
    if (breaks) group = 'load-bearing'
    else if (dep.notAssessed && dep.notAssessed !== 'no-roots') {
      group = 'not-assessed'
      notAssessedList.push({ deviceId: id, reason: dep.notAssessed })
    } else if (
      dep.systems.some((s) => s.kind === 'stranded' || s.kind === 'partial') ||
      dep.positionsCutOff.length > 0
    ) group = 'load-bearing'
    else if ((dep.blast?.unreachableCount ?? 0) > 0) group = 'cuts-devices-off'
    else if ((degree.get(id)?.size ?? 0) <= 1) group = 'one-link'
    else group = 'nothing-loses-path'
    groups[group].push(id)
  }

  const status: Triage['status'] =
    realizedCount === 0 ? 'no-realized-system'
      : !roots.usable ? 'no-roots'
        : population.length === 0 ? 'nothing-unclaimed'
          : 'measured'

  return {
    review: realizedCount === 0 ? 'no-realized-system' : 'reviewed',
    roots,
    realizedCount,
    standings,
    notInDrawing: notInDrawing.sort(),
    wiring,
    byDevice,
    triage: {
      status,
      population,
      listedUnclaimedIds: listed,
      notListed: population.filter((id) => !listedSet.has(id)).map((deviceId) => ({ deviceId, namedBy: namedBy(deviceId) })),
      listedButClaimedIds: listed.filter((id) => claimed.has(id)).sort(byLabel),
      groups: status === 'no-roots' ? emptyGroups() : groups,
      notAssessed: notAssessedList,
    },
  }
}

/** The dashed rings: only from declared decision positions, so a glance never hides which roots. */
export function structuralRings(
  deps: SiteDependencies,
): ReadonlyMap<DeviceId, { risk: RiskLevel; systemIds: SystemId[] }> {
  const source = deps.roots.choice.source
  if (source !== 'declared' && source !== 'declared-without-assumed') return new Map()
  const rings = new Map<DeviceId, { risk: RiskLevel; systemIds: SystemId[] }>()
  for (const [id, dep] of deps.byDevice) if (dep.structural) rings.set(id, dep.structural)
  return rings
}

/**
 * What a device's rows say about systems and decision positions, compared
 * across root sets. The devices a partly cut-off system loses and the
 * positions cut off are compared by id, because the detail names them: a
 * claim about an assumed position, or about which hardware loses its path,
 * rests on the assumption even when the systems named stay the same.
 */
export interface Verdict {
  group: TriageGroup | null
  notAssessed: NotAssessed | null
  stranded: SystemId[]
  partial: Array<{ systemId: SystemId; lostDeviceIds: DeviceId[] }>
  positionsCutOff: DeviceId[]
}

export interface VerdictChange {
  deviceId: DeviceId
  shown: Verdict
  without: Verdict
}

export type Sensitivity =
  | { status: 'not-applicable' }
  /** Every declared position is assumed (or not on the drawing). */
  | { status: 'no-roots-left'; assumedIds: DeviceId[] }
  /** Positions are left, but none has a cable or radio link to measure from. */
  | { status: 'alternative-unusable'; assumedIds: DeviceId[]; unusableIds: DeviceId[] }
  | {
      status: 'compared'
      assumedIds: DeviceId[]
      alternative: RootSet
      changes: VerdictChange[]
      rings: { shown: { total: number; high: number }; without: { total: number; high: number } }
    }

function verdictOf(deps: SiteDependencies, id: DeviceId): Verdict {
  const dep = deps.byDevice.get(id)
  const groupEntry = (Object.entries(deps.triage.groups) as Array<[TriageGroup, DeviceId[]]>)
    .find(([, ids]) => ids.includes(id))
  return {
    group: groupEntry ? groupEntry[0] : null,
    notAssessed: dep?.notAssessed ?? null,
    stranded: (dep?.systems ?? []).filter((s) => s.kind === 'stranded').map((s) => s.systemId).sort(),
    partial: (dep?.systems ?? [])
      .filter((s): s is Extract<SystemEffect, { kind: 'partial' }> => s.kind === 'partial')
      .map((s) => ({ systemId: s.systemId, lostDeviceIds: [...s.lostDeviceIds].sort() }))
      .sort((a, b) => a.systemId.localeCompare(b.systemId)),
    positionsCutOff: [...(dep?.positionsCutOff ?? [])].sort(),
  }
}

function ringCount(deps: SiteDependencies) {
  const rings = [...structuralRings(deps).values()]
  return { total: rings.length, high: rings.filter((r) => r.risk === 'high').length }
}

/**
 * Every verdict that rests on the positions marked as assumptions: recompute
 * without them and name each device whose verdict changes. Integrations never
 * change, because they do not depend on the roots.
 */
export function rootSensitivity(input: DependencyInput, deps: SiteDependencies): Sensitivity {
  if (deps.roots.choice.source !== 'declared' || deps.roots.assumedIds.length === 0) {
    return { status: 'not-applicable' }
  }
  const alternative = resolveRoots(input.topology, input.site, { source: 'declared-without-assumed' })
  if (alternative.deviceIds.length === 0) return { status: 'no-roots-left', assumedIds: deps.roots.assumedIds }
  if (!alternative.usable) {
    return {
      status: 'alternative-unusable',
      assumedIds: deps.roots.assumedIds,
      unusableIds: sorted(new Set([...alternative.logicalOnlyIds, ...alternative.isolatedIds])),
    }
  }
  const other = siteDependencies(input, alternative)
  const labelOf = new Map(input.topology.devices.map((d) => [d.id, d.label]))
  const changes: VerdictChange[] = []
  for (const id of deps.byDevice.keys()) {
    const shown = verdictOf(deps, id)
    const without = verdictOf(other, id)
    if (JSON.stringify(shown) !== JSON.stringify(without)) changes.push({ deviceId: id, shown, without })
  }
  changes.sort((a, b) =>
    (labelOf.get(a.deviceId) ?? a.deviceId).localeCompare(labelOf.get(b.deviceId) ?? b.deviceId))
  return {
    status: 'compared',
    assumedIds: deps.roots.assumedIds,
    alternative,
    changes,
    rings: { shown: ringCount(deps), without: ringCount(other) },
  }
}
