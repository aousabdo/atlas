/**
 * Graph analysis over a site topology: what holds it together, and what breaks
 * when a piece of it is gone.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * Every function here is a COMPUTATION over the recorded topology, not a
 * PREDICTION about the network. "Remove this switch and 23 devices lose their
 * path to the core" is arithmetic on the edges someone wrote down: it is true
 * of the drawing, and it is true of the site only insofar as the drawing is.
 * Nothing here models traffic, load, failover that was never drawn, a radio
 * that reaches further than its link says, or the probability of anything. If a
 * later change makes one of these read as a forecast ("likely to fail",
 * "expected outage", a confidence score on a removal), that change is wrong.
 * The value of these numbers is precisely that they are checkable against the
 * bundle, and a reader who disagrees with one can name the edge that is missing.
 *
 * UNDIRECTED FOR CONNECTIVITY, DIRECTION KEPT FOR TRACING
 *
 * Connectivity here is undirected. A link carries traffic both ways, so a cut
 * vertex, a bridge and a blast radius are all computed on the undirected graph.
 *
 * Direction is not thrown away: every hop of a traced path reports whether it
 * runs with or against the recorded edge, and `tracePaths` will follow the
 * recorded direction on request. The DEFAULT is still either way, because in
 * this data the recorded direction is a drawing convention rather than a
 * statement about flow. In the committed sample, every one of the 71 devices is
 * reachable from `internet` by following source to target, and no sensor
 * reaches an operator workstation that way: source to target is the order the
 * network was drawn outward from the demarc, not the direction a detection
 * travels. Treating it as flow would answer "does a detection reach a decision
 * maker" with a confident no, on every site, for no reason at all.
 *
 * EVIDENCE
 *
 * No count is returned without the ids behind it. A severed count comes with
 * the severed ids; a bridge comes with the indexes of the raw edges it came
 * from; a claim that a source reaches a sink comes with a path that proves it,
 * even when path enumeration was capped and returned nothing. Anything that
 * cannot be drilled into does not belong in this module.
 *
 * DEGENERATE INPUT
 *
 * The bundle is curated but not trusted. An empty topology, a lone device, a
 * fully disconnected graph, a self loop, the same link recorded twice, an edge
 * naming a device that is not in the device list, and the same device id listed
 * twice are all handled and REPORTED in `anomalies` rather than silently
 * dropped, because "the ingest wrote a dangling edge" is itself a finding.
 *
 * DETERMINISM
 *
 * Same input, same output, including the order of every array. Nothing here
 * depends on Set or object insertion order: node order is the sorted id order
 * and every returned list is sorted by an explicit rule stated where it is
 * built.
 */
import type { Device, DeviceEdge, DeviceId, Zone } from '../types/atlas'

/** A topology, or anything shaped enough like one to analyse. */
export interface GraphInput {
  devices: readonly Device[]
  edges: readonly DeviceEdge[]
  zones?: Readonly<Record<string, Zone>>
}

/** A set of devices that hang together, with the ids that make up the count. */
export interface Fragment {
  count: number
  /** Sorted. */
  deviceIds: DeviceId[]
}

/**
 * "7 of 12 sensors", with the seven named.
 *
 * `total` counts the whole graph, so a cut of three out of four reads
 * differently from three out of ninety.
 */
export interface Tally {
  key: string
  label: string
  count: number
  total: number
  deviceIds: DeviceId[]
}

/** One undirected link, after duplicate raw edges have been folded together. */
export interface GraphLink {
  /** The lexicographically smaller endpoint. Pairs are stored one way only. */
  source: DeviceId
  target: DeviceId
  /** Distinct link_type values across the raw edges behind it, sorted. */
  linkTypes: string[]
  /** Indexes into the input edges array. This is the drill through. */
  edgeIndexes: number[]
  /** At least one raw edge runs source to target. */
  forward: boolean
  /** At least one raw edge runs target to source. */
  reverse: boolean
}

/** Everything the input got wrong, named rather than swallowed. */
export interface GraphAnomalies {
  duplicateDeviceIds: Array<{ deviceId: DeviceId; indexes: number[] }>
  unknownEndpoints: Array<{
    edgeIndex: number
    source: DeviceId
    target: DeviceId
    missingIds: DeviceId[]
  }>
  selfLoops: Array<{ edgeIndex: number; deviceId: DeviceId }>
  /** Links carrying more than one raw edge record. */
  duplicateLinks: Array<{ source: DeviceId; target: DeviceId; edgeIndexes: number[] }>
  /** Devices no usable edge touches. */
  isolatedDeviceIds: DeviceId[]
}

export interface Graph {
  /** Every device id, sorted, duplicates folded. */
  nodeIds: DeviceId[]
  links: GraphLink[]
  /** Largest first, then by first id. */
  components: Fragment[]
  rootIds: DeviceId[]
  anomalies: GraphAnomalies
}

export interface ArticulationPoint {
  deviceId: DeviceId
  label: string
  /** What its component falls into once it is gone. Largest first. */
  fragments: Fragment[]
  retainedCount: number
  retainedDeviceIds: DeviceId[]
  severedCount: number
  severedDeviceIds: DeviceId[]
  severedByType: Tally[]
  severedByZone: Tally[]
}

export interface Bridge {
  source: DeviceId
  target: DeviceId
  sourceLabel: string
  targetLabel: string
  linkTypes: string[]
  edgeIndexes: number[]
  /** The two halves the link holds together. Larger first. */
  sides: [Fragment, Fragment]
  retainedCount: number
  retainedDeviceIds: DeviceId[]
  severedCount: number
  severedDeviceIds: DeviceId[]
  severedByType: Tally[]
  severedByZone: Tally[]
}

export interface BlastRadiusOptions {
  /**
   * Measure reachability from these devices instead of the derived roots. This
   * is how you ask the question that matters: root at the operator
   * workstations and the answer is what stops reaching a decision maker.
   */
  rootIds?: readonly DeviceId[]
}

export interface BlastRadiusReport {
  deviceId: DeviceId
  label: string
  /** False when the id is not in the topology. Everything else is then empty. */
  exists: boolean
  rootIds: DeviceId[]
  rootsFrom: 'derived' | 'supplied'
  /** Supplied roots the topology does not carry, named rather than dropped. */
  unknownRootIds: DeviceId[]
  reachableBeforeCount: number
  reachableAfterCount: number
  unreachableCount: number
  /** Reachable before, not after. Excludes the removed device itself. */
  unreachableDeviceIds: DeviceId[]
  byType: Tally[]
  byZone: Tally[]
  /** The removed device was itself reachable from the roots to begin with. */
  removedWasReachable: boolean
  /** Already cut off before this removal, so not this device's doing. */
  alreadyUnreachableDeviceIds: DeviceId[]
}

/** Either way along a link, or only the way the edge was recorded. */
export type TraceDirection = 'either' | 'recorded'

export interface TraceOptions {
  direction?: TraceDirection
  /** Across all sources. */
  maxPaths?: number
  /** So one busy source cannot spend the whole budget. */
  maxPathsPerSource?: number
  /** Longest path enumerated, in hops. */
  maxHops?: number
  /** Search budget, so a dense graph cannot hang the caller. */
  maxSteps?: number
}

export interface TraceHop {
  source: DeviceId
  target: DeviceId
  linkTypes: string[]
  edgeIndexes: number[]
  /** How the recorded edges run relative to this hop. */
  along: 'forward' | 'reverse' | 'both'
}

export interface TracePath {
  fromId: DeviceId
  toId: DeviceId
  /** In order, source first. */
  deviceIds: DeviceId[]
  hopCount: number
  hops: TraceHop[]
}

export interface SourceReach {
  deviceId: DeviceId
  label: string
  /** A fact about the graph. Not subject to any cap. */
  reaches: boolean
  reachedSinkIds: DeviceId[]
  unreachedSinkIds: DeviceId[]
  /** Fewest hops to the nearest sink, or null when it reaches none. */
  shortestHops: number | null
  /** A shortest path, so `reaches` is never an unevidenced claim. */
  witness: DeviceId[] | null
  /** Paths returned for this source, which the caps may have limited. */
  pathCount: number
}

export type TruncationReason = 'path-cap' | 'source-path-cap' | 'hop-cap' | 'step-cap'

export interface TraceReport {
  fromIds: DeviceId[]
  toIds: DeviceId[]
  unknownFromIds: DeviceId[]
  unknownToIds: DeviceId[]
  direction: TraceDirection
  limits: Required<Omit<TraceOptions, 'direction'>>
  /** A cap bit. The path list is a sample, and `sources` is still exact. */
  truncated: boolean
  truncationReasons: TruncationReason[]
  paths: TracePath[]
  sources: SourceReach[]
  reachedSinkIds: DeviceId[]
  unreachedSinkIds: DeviceId[]
  unreachedSourceIds: DeviceId[]
}

/**
 * Caps, chosen so a dense graph cannot hang a tab.
 *
 * The path count between two devices in a meshed graph is combinatorial: a
 * dozen devices wired to each other every way there is already carries tens of
 * millions of simple paths. Enumeration is therefore bounded three ways, and
 * the report says which bound bit.
 */
export const TRACE_DEFAULTS = {
  maxPaths: 200,
  maxPathsPerSource: 50,
  maxHops: 12,
  maxSteps: 200_000,
} as const

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

interface Neighbour {
  to: number
  link: number
}

interface Indexed {
  nodeIds: DeviceId[]
  devices: Device[]
  indexOf: Map<DeviceId, number>
  links: GraphLink[]
  /** Undirected, each list in ascending neighbour order. */
  adj: Neighbour[][]
  /** Along the recorded direction, and its reverse. */
  out: Neighbour[][]
  into: Neighbour[][]
  /** Whether any usable recorded edge points at this device. */
  hasIncoming: Uint8Array
  anomalies: GraphAnomalies
  zoneLabel: (zoneId: string) => string
}

/**
 * Node index is the sorted id position, which is what makes everything below
 * deterministic for free: sorting node indexes sorts device ids, and iterating
 * an adjacency list in index order iterates it in id order.
 */
function index(input: GraphInput): Indexed {
  const duplicateIndexes = new Map<DeviceId, number[]>()
  const firstDevice = new Map<DeviceId, Device>()
  input.devices.forEach((device, position) => {
    const seen = duplicateIndexes.get(device.id)
    if (seen) seen.push(position)
    else duplicateIndexes.set(device.id, [position])
    if (!firstDevice.has(device.id)) firstDevice.set(device.id, device)
  })

  const nodeIds = [...firstDevice.keys()].sort()
  const indexOf = new Map<DeviceId, number>()
  nodeIds.forEach((id, i) => indexOf.set(id, i))
  const devices = nodeIds.map((id) => firstDevice.get(id) as Device)

  const anomalies: GraphAnomalies = {
    duplicateDeviceIds: [...duplicateIndexes.entries()]
      .filter(([, positions]) => positions.length > 1)
      .map(([deviceId, indexes]) => ({ deviceId, indexes }))
      .sort((a, b) => a.deviceId.localeCompare(b.deviceId)),
    unknownEndpoints: [],
    selfLoops: [],
    duplicateLinks: [],
    isolatedDeviceIds: [],
  }

  interface Building {
    a: number
    b: number
    linkTypes: Set<string>
    edgeIndexes: number[]
    forward: boolean
    reverse: boolean
  }
  const building = new Map<string, Building>()
  const hasIncoming = new Uint8Array(nodeIds.length)

  input.edges.forEach((edge, edgeIndex) => {
    const sourceIndex = indexOf.get(edge.source)
    const targetIndex = indexOf.get(edge.target)
    if (sourceIndex === undefined || targetIndex === undefined) {
      const missingIds: DeviceId[] = []
      if (sourceIndex === undefined) missingIds.push(edge.source)
      if (targetIndex === undefined && edge.target !== edge.source) missingIds.push(edge.target)
      anomalies.unknownEndpoints.push({
        edgeIndex,
        source: edge.source,
        target: edge.target,
        missingIds: [...new Set(missingIds)].sort(),
      })
      return
    }
    if (sourceIndex === targetIndex) {
      // A self loop connects nothing to nothing. It cannot make a device less
      // cut off, so it is recorded and then kept out of the adjacency.
      anomalies.selfLoops.push({ edgeIndex, deviceId: edge.source })
      return
    }
    const a = Math.min(sourceIndex, targetIndex)
    const b = Math.max(sourceIndex, targetIndex)
    const key = `${a}|${b}`
    let record = building.get(key)
    if (!record) {
      record = { a, b, linkTypes: new Set(), edgeIndexes: [], forward: false, reverse: false }
      building.set(key, record)
    }
    record.edgeIndexes.push(edgeIndex)
    record.linkTypes.add(edge.link_type)
    if (sourceIndex === a) record.forward = true
    else record.reverse = true
    hasIncoming[targetIndex] = 1
  })

  const records = [...building.values()].sort((x, y) => x.a - y.a || x.b - y.b)
  const links: GraphLink[] = records.map((record) => ({
    source: nodeIds[record.a],
    target: nodeIds[record.b],
    linkTypes: [...record.linkTypes].sort(),
    edgeIndexes: [...record.edgeIndexes].sort((m, n) => m - n),
    forward: record.forward,
    reverse: record.reverse,
  }))

  const adj: Neighbour[][] = nodeIds.map(() => [])
  records.forEach((record, linkIndex) => {
    adj[record.a].push({ to: record.b, link: linkIndex })
    adj[record.b].push({ to: record.a, link: linkIndex })
  })
  for (const list of adj) list.sort((x, y) => x.to - y.to)

  const out: Neighbour[][] = nodeIds.map(() => [])
  const into: Neighbour[][] = nodeIds.map(() => [])
  records.forEach((record, linkIndex) => {
    if (record.forward) {
      out[record.a].push({ to: record.b, link: linkIndex })
      into[record.b].push({ to: record.a, link: linkIndex })
    }
    if (record.reverse) {
      out[record.b].push({ to: record.a, link: linkIndex })
      into[record.a].push({ to: record.b, link: linkIndex })
    }
  })
  for (const list of out) list.sort((x, y) => x.to - y.to)
  for (const list of into) list.sort((x, y) => x.to - y.to)

  anomalies.duplicateLinks = links
    .filter((link) => link.edgeIndexes.length > 1)
    .map((link) => ({
      source: link.source,
      target: link.target,
      edgeIndexes: link.edgeIndexes,
    }))
  anomalies.isolatedDeviceIds = nodeIds.filter((_, i) => adj[i].length === 0)

  const zones = input.zones ?? {}
  return {
    nodeIds,
    devices,
    indexOf,
    links,
    adj,
    out,
    into,
    hasIncoming,
    anomalies,
    zoneLabel: (zoneId: string) => zones[zoneId]?.label ?? zoneId,
  }
}

// ---------------------------------------------------------------------------
// Depth first search, iterative
// ---------------------------------------------------------------------------

interface Dfs {
  /** Discovery order. A component occupies a contiguous stretch of it. */
  order: Int32Array
  disc: Int32Array
  size: Int32Array
  componentOf: Int32Array
  componentRanges: Array<{ start: number; end: number }>
  /** For each node, the children whose subtree it alone holds on. */
  apChildren: Map<number, number[]>
  bridgeAt: Array<{ link: number; child: number }>
}

/**
 * Tarjan, with an explicit stack.
 *
 * Recursive is shorter and dies on this data: a topology drawn as a long chain
 * of closets recurses once per device, and the browser stack gives out well
 * before an interesting graph does. The tests walk a twenty thousand device
 * ring for exactly this reason.
 *
 * The subtree of a DFS child occupies a contiguous run of discovery order
 * starting at its own discovery time, which is what lets the callers below name
 * the devices in a fragment without a fresh traversal per cut vertex.
 */
function runDfs(g: Indexed): Dfs {
  const n = g.nodeIds.length
  const disc = new Int32Array(n).fill(-1)
  const low = new Int32Array(n)
  const size = new Int32Array(n).fill(1)
  const parent = new Int32Array(n).fill(-1)
  const parentLink = new Int32Array(n).fill(-1)
  const componentOf = new Int32Array(n).fill(-1)
  const order = new Int32Array(n)
  const stackNode = new Int32Array(n)
  const stackEdge = new Int32Array(n)
  const apChildren = new Map<number, number[]>()
  const bridgeAt: Array<{ link: number; child: number }> = []
  const componentRanges: Array<{ start: number; end: number }> = []
  let timer = 0

  for (let root = 0; root < n; root += 1) {
    if (disc[root] !== -1) continue
    const componentId = componentRanges.length
    const start = timer
    disc[root] = timer
    low[root] = timer
    order[timer] = root
    componentOf[root] = componentId
    timer += 1
    let top = 0
    stackNode[0] = root
    stackEdge[0] = 0

    while (top >= 0) {
      const v = stackNode[top]
      const neighbours = g.adj[v]
      const cursor = stackEdge[top]
      if (cursor < neighbours.length) {
        stackEdge[top] = cursor + 1
        const { to: w, link } = neighbours[cursor]
        // The graph is simple by construction, so one skip of the link we
        // arrived on is exactly the right amount of parent skipping.
        if (link === parentLink[v]) continue
        if (disc[w] === -1) {
          parent[w] = v
          parentLink[w] = link
          disc[w] = timer
          low[w] = timer
          order[timer] = w
          componentOf[w] = componentId
          timer += 1
          top += 1
          stackNode[top] = w
          stackEdge[top] = 0
        } else if (disc[w] < low[v]) {
          low[v] = disc[w]
        }
        continue
      }
      top -= 1
      const p = parent[v]
      if (p === -1) continue
      size[p] += size[v]
      if (low[v] < low[p]) low[p] = low[v]
      if (low[v] >= disc[p]) {
        const list = apChildren.get(p)
        if (list) list.push(v)
        else apChildren.set(p, [v])
      }
      if (low[v] > disc[p]) bridgeAt.push({ link: parentLink[v], child: v })
    }
    componentRanges.push({ start, end: timer })
  }

  return { order, disc, size, componentOf, componentRanges, apChildren, bridgeAt }
}

// ---------------------------------------------------------------------------
// Shared shaping
// ---------------------------------------------------------------------------

function toFragment(g: Indexed, nodes: number[]): Fragment {
  const sorted = [...nodes].sort((a, b) => a - b)
  return { count: sorted.length, deviceIds: sorted.map((i) => g.nodeIds[i]) }
}

/**
 * Largest first; on a tie the piece holding the lowest device id survives.
 *
 * Something has to break the tie, and the alternative is an answer that depends
 * on traversal order, which is the same as no answer at all.
 */
function orderFragments(parts: Fragment[]): Fragment[] {
  return [...parts].sort(
    (a, b) => b.count - a.count || a.deviceIds[0].localeCompare(b.deviceIds[0]),
  )
}

function tallyBy(
  g: Indexed,
  deviceIds: readonly DeviceId[],
  keyOf: (device: Device) => string,
  labelOf: (key: string) => string,
): Tally[] {
  const totals = new Map<string, number>()
  for (const device of g.devices) {
    const key = keyOf(device)
    totals.set(key, (totals.get(key) ?? 0) + 1)
  }
  const hit = new Map<string, DeviceId[]>()
  for (const id of deviceIds) {
    const device = g.devices[g.indexOf.get(id) as number]
    const key = keyOf(device)
    const list = hit.get(key)
    if (list) list.push(id)
    else hit.set(key, [id])
  }
  return [...hit.entries()]
    .map(([key, ids]) => ({
      key,
      label: labelOf(key),
      count: ids.length,
      total: totals.get(key) ?? ids.length,
      deviceIds: [...ids].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function tallies(g: Indexed, deviceIds: readonly DeviceId[]): { byType: Tally[]; byZone: Tally[] } {
  return {
    byType: tallyBy(g, deviceIds, (d) => d.type, (key) => key),
    byZone: tallyBy(g, deviceIds, (d) => d.zone, (key) => g.zoneLabel(key)),
  }
}

function labelOf(g: Indexed, id: DeviceId): string {
  const at = g.indexOf.get(id)
  return at === undefined ? id : g.devices[at].label
}

// ---------------------------------------------------------------------------
// buildGraph and roots
// ---------------------------------------------------------------------------

/** The normalized graph, its components, its roots and everything wrong with it. */
export function buildGraph(input: GraphInput): Graph {
  const g = index(input)
  const dfs = runDfs(g)
  const components = orderFragments(
    dfs.componentRanges.map((range) => {
      const nodes: number[] = []
      for (let i = range.start; i < range.end; i += 1) nodes.push(dfs.order[i])
      return toFragment(g, nodes)
    }),
  )
  return {
    nodeIds: g.nodeIds,
    links: g.links,
    components,
    rootIds: rootsOf(g, dfs),
    anomalies: g.anomalies,
  }
}

/**
 * Where reachability is measured from when the caller does not say.
 *
 * A device no recorded edge points at is an entry point of the drawing: in the
 * sample that is `internet`, and every other device hangs off it. A component
 * where every device has something pointing at it, a ring being the obvious
 * case, would otherwise have no root at all and read as entirely unreachable,
 * so it gets its lowest id as a representative. The rule is arbitrary but it is
 * stated, stable, and reported back on every result.
 */
function rootsOf(g: Indexed, dfs: Dfs): DeviceId[] {
  const roots: number[] = []
  const covered = new Set<number>()
  for (let i = 0; i < g.nodeIds.length; i += 1) {
    if (!g.hasIncoming[i]) {
      roots.push(i)
      covered.add(dfs.componentOf[i])
    }
  }
  dfs.componentRanges.forEach((range, componentId) => {
    if (covered.has(componentId)) return
    let lowest = dfs.order[range.start]
    for (let i = range.start; i < range.end; i += 1) {
      if (dfs.order[i] < lowest) lowest = dfs.order[i]
    }
    roots.push(lowest)
  })
  return roots.sort((a, b) => a - b).map((i) => g.nodeIds[i])
}

export function derivedRootIds(input: GraphInput): DeviceId[] {
  const g = index(input)
  return rootsOf(g, runDfs(g))
}

// ---------------------------------------------------------------------------
// articulationPoints
// ---------------------------------------------------------------------------

/**
 * The devices whose removal breaks the graph into more pieces than it was in,
 * each with the devices that end up on the wrong side of the break.
 *
 * "Wrong side" is structural: the largest surviving piece is taken to be the
 * one that keeps talking, and everything else is severed. That is a statement
 * about the shape of the graph and nothing else. When the question is instead
 * "what stops reaching the operators", root the answer somewhere specific with
 * `blastRadius`, which takes the roots as an argument and reports them back.
 *
 * Ordered by damage, then by id: the reader wants the worst one first.
 *
 * Cost note: naming the severed devices of every cut vertex is quadratic in
 * the worst case, a long chain being that case, because each finding lists
 * most of the graph. That is inherent to answering with evidence rather than
 * with a count, and it is nothing at the site sizes here.
 */
export function articulationPoints(input: GraphInput): ArticulationPoint[] {
  const g = index(input)
  const dfs = runDfs(g)
  const stamp = new Int32Array(g.nodeIds.length).fill(-1)
  let version = 0
  const found: ArticulationPoint[] = []

  for (const [v, children] of dfs.apChildren) {
    version += 1
    const parts: number[][] = []
    let claimed = 0
    // Sorted so the fragment list does not depend on the order children
    // happened to finish in.
    for (const child of [...children].sort((a, b) => a - b)) {
      const start = dfs.disc[child]
      const end = start + dfs.size[child]
      const part: number[] = []
      for (let i = start; i < end; i += 1) {
        const node = dfs.order[i]
        part.push(node)
        stamp[node] = version
      }
      claimed += part.length
      parts.push(part)
    }
    const range = dfs.componentRanges[dfs.componentOf[v]]
    const restCount = range.end - range.start - 1 - claimed
    if (restCount > 0) {
      const rest: number[] = []
      for (let i = range.start; i < range.end; i += 1) {
        const node = dfs.order[i]
        if (node === v || stamp[node] === version) continue
        rest.push(node)
      }
      parts.push(rest)
    }
    // One piece means the graph did not fall apart: a leaf, or a root with a
    // single child. Not a cut vertex.
    if (parts.length < 2) continue

    const fragments = orderFragments(parts.map((part) => toFragment(g, part)))
    const retained = fragments[0]
    const severedDeviceIds = fragments
      .slice(1)
      .flatMap((fragment) => fragment.deviceIds)
      .sort()
    const severed = tallies(g, severedDeviceIds)
    found.push({
      deviceId: g.nodeIds[v],
      label: g.devices[v].label,
      fragments,
      retainedCount: retained.count,
      retainedDeviceIds: retained.deviceIds,
      severedCount: severedDeviceIds.length,
      severedDeviceIds,
      severedByType: severed.byType,
      severedByZone: severed.byZone,
    })
  }

  return found.sort(
    (a, b) => b.severedCount - a.severedCount || a.deviceId.localeCompare(b.deviceId),
  )
}

// ---------------------------------------------------------------------------
// bridges
// ---------------------------------------------------------------------------

/**
 * The links whose removal breaks the graph, each with both halves named.
 *
 * Two raw edges recording the same pair of devices are one link here, so a
 * doubled record is not read as redundancy. That is deliberate: the bundle
 * describes an adjacency, not a cable count, and treating a duplicated row as a
 * second physical path would quietly delete a single point of failure from the
 * report. The duplicate is reported under `anomalies` instead.
 */
export function bridges(input: GraphInput): Bridge[] {
  const g = index(input)
  const dfs = runDfs(g)
  const found: Bridge[] = []

  for (const { link, child } of dfs.bridgeAt) {
    const range = dfs.componentRanges[dfs.componentOf[child]]
    const start = dfs.disc[child]
    const end = start + dfs.size[child]
    const near: number[] = []
    const far: number[] = []
    for (let i = range.start; i < range.end; i += 1) {
      const node = dfs.order[i]
      if (i >= start && i < end) near.push(node)
      else far.push(node)
    }
    const ordered = orderFragments([toFragment(g, near), toFragment(g, far)])
    const sides: [Fragment, Fragment] = [ordered[0], ordered[1]]
    const record = g.links[link]
    const severed = tallies(g, sides[1].deviceIds)
    found.push({
      source: record.source,
      target: record.target,
      sourceLabel: labelOf(g, record.source),
      targetLabel: labelOf(g, record.target),
      linkTypes: record.linkTypes,
      edgeIndexes: record.edgeIndexes,
      sides,
      retainedCount: sides[0].count,
      retainedDeviceIds: sides[0].deviceIds,
      severedCount: sides[1].count,
      severedDeviceIds: sides[1].deviceIds,
      severedByType: severed.byType,
      severedByZone: severed.byZone,
    })
  }

  return found.sort(
    (a, b) =>
      b.severedCount - a.severedCount ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target),
  )
}

// ---------------------------------------------------------------------------
// blastRadius
// ---------------------------------------------------------------------------

function reachableFrom(g: Indexed, roots: readonly number[], banned: number): Uint8Array {
  const seen = new Uint8Array(g.nodeIds.length)
  const queue: number[] = []
  for (const root of roots) {
    if (root === banned || seen[root]) continue
    seen[root] = 1
    queue.push(root)
  }
  for (let head = 0; head < queue.length; head += 1) {
    const v = queue[head]
    for (const { to } of g.adj[v]) {
      if (to === banned || seen[to]) continue
      seen[to] = 1
      queue.push(to)
    }
  }
  return seen
}

/**
 * What stops being reachable from the roots if this one device is gone.
 *
 * The what-if, and only a what-if about the drawing: it removes a node from a
 * graph and counts what the remaining edges no longer join. It says nothing
 * about whether the device will fail, how likely that is, or what would happen
 * to anything the topology does not record.
 */
export function blastRadius(
  input: GraphInput,
  deviceId: DeviceId,
  options: BlastRadiusOptions = {},
): BlastRadiusReport {
  const g = index(input)
  const dfs = runDfs(g)

  const unknownRootIds: DeviceId[] = []
  let rootIds: DeviceId[]
  let rootsFrom: 'derived' | 'supplied'
  if (options.rootIds) {
    rootsFrom = 'supplied'
    const known = new Set<DeviceId>()
    for (const id of options.rootIds) {
      if (g.indexOf.has(id)) known.add(id)
      else unknownRootIds.push(id)
    }
    rootIds = [...known].sort()
  } else {
    rootsFrom = 'derived'
    rootIds = rootsOf(g, dfs)
  }
  const rootIndexes = rootIds.map((id) => g.indexOf.get(id) as number)
  const unknownSorted = [...new Set(unknownRootIds)].sort()

  const target = g.indexOf.get(deviceId)
  if (target === undefined) {
    return {
      deviceId,
      label: deviceId,
      exists: false,
      rootIds,
      rootsFrom,
      unknownRootIds: unknownSorted,
      reachableBeforeCount: 0,
      reachableAfterCount: 0,
      unreachableCount: 0,
      unreachableDeviceIds: [],
      byType: [],
      byZone: [],
      removedWasReachable: false,
      alreadyUnreachableDeviceIds: [],
    }
  }

  const before = reachableFrom(g, rootIndexes, -1)
  const after = reachableFrom(g, rootIndexes, target)
  const unreachableDeviceIds: DeviceId[] = []
  const alreadyUnreachableDeviceIds: DeviceId[] = []
  let beforeCount = 0
  let afterCount = 0
  for (let i = 0; i < g.nodeIds.length; i += 1) {
    if (before[i]) beforeCount += 1
    if (after[i]) afterCount += 1
    if (i === target) continue
    if (!before[i]) alreadyUnreachableDeviceIds.push(g.nodeIds[i])
    else if (!after[i]) unreachableDeviceIds.push(g.nodeIds[i])
  }

  return {
    deviceId,
    label: g.devices[target].label,
    exists: true,
    rootIds,
    rootsFrom,
    unknownRootIds: unknownSorted,
    reachableBeforeCount: beforeCount,
    reachableAfterCount: afterCount,
    unreachableCount: unreachableDeviceIds.length,
    unreachableDeviceIds,
    ...tallies(g, unreachableDeviceIds),
    removedWasReachable: before[target] === 1,
    alreadyUnreachableDeviceIds,
  }
}

// ---------------------------------------------------------------------------
// tracePaths
// ---------------------------------------------------------------------------

function hopOf(g: Indexed, from: number, to: number, link: number): TraceHop {
  const record = g.links[link]
  const fromIsSource = g.nodeIds[from] === record.source
  const withRecorded = fromIsSource ? record.forward : record.reverse
  const againstRecorded = fromIsSource ? record.reverse : record.forward
  return {
    source: g.nodeIds[from],
    target: g.nodeIds[to],
    linkTypes: record.linkTypes,
    edgeIndexes: record.edgeIndexes,
    along: withRecorded && againstRecorded ? 'both' : withRecorded ? 'forward' : 'reverse',
  }
}

/** Hops from every node to the nearest sink, over the reversed adjacency. */
function distanceToSinks(
  nodeCount: number,
  reverse: Neighbour[][],
  sinks: readonly number[],
): Int32Array {
  const dist = new Int32Array(nodeCount).fill(-1)
  const queue: number[] = []
  for (const sink of sinks) {
    if (dist[sink] !== -1) continue
    dist[sink] = 0
    queue.push(sink)
  }
  for (let head = 0; head < queue.length; head += 1) {
    const v = queue[head]
    for (const { to } of reverse[v]) {
      if (dist[to] !== -1) continue
      dist[to] = dist[v] + 1
      queue.push(to)
    }
  }
  return dist
}

/**
 * Every simple path from a set of sources to a set of sinks, and, separately
 * and exactly, which sources reach a sink at all.
 *
 * The two answers are computed differently on purpose. Enumeration is capped,
 * so the path list is a sample whenever a cap bites. Reachability is a breadth
 * first search per source, is not capped, and comes with a shortest path as its
 * witness, so "this sensor reaches no operator workstation" is a claim about
 * the graph rather than a claim about how long the search was allowed to run.
 * Reporting reachability out of the enumeration would have turned a hit cap
 * into a false negative, which on this question is the worst possible failure.
 *
 * Paths come back shortest first: enumeration deepens one hop at a time, so
 * when the cap bites what is kept is the shortest paths and not an arbitrary
 * handful.
 */
export function tracePaths(
  input: GraphInput,
  fromIds: readonly DeviceId[],
  toIds: readonly DeviceId[],
  options: TraceOptions = {},
): TraceReport {
  const g = index(input)
  const direction: TraceDirection = options.direction ?? 'either'
  const limits = {
    maxPaths: options.maxPaths ?? TRACE_DEFAULTS.maxPaths,
    maxPathsPerSource: options.maxPathsPerSource ?? TRACE_DEFAULTS.maxPathsPerSource,
    maxHops: options.maxHops ?? TRACE_DEFAULTS.maxHops,
    maxSteps: options.maxSteps ?? TRACE_DEFAULTS.maxSteps,
  }

  const resolve = (ids: readonly DeviceId[]) => {
    const known = new Set<DeviceId>()
    const unknown = new Set<DeviceId>()
    for (const id of ids) {
      if (g.indexOf.has(id)) known.add(id)
      else unknown.add(id)
    }
    return { known: [...known].sort(), unknown: [...unknown].sort() }
  }
  const from = resolve(fromIds)
  const to = resolve(toIds)

  const forward = direction === 'recorded' ? g.out : g.adj
  const backward = direction === 'recorded' ? g.into : g.adj
  const sourceIndexes = from.known.map((id) => g.indexOf.get(id) as number)
  const sinkIndexes = to.known.map((id) => g.indexOf.get(id) as number)
  const isSink = new Uint8Array(g.nodeIds.length)
  for (const sink of sinkIndexes) isSink[sink] = 1
  const distToSink = distanceToSinks(g.nodeIds.length, backward, sinkIndexes)

  const reasons = new Set<TruncationReason>()
  const paths: TracePath[] = []
  const sources: SourceReach[] = []
  const reachedSinks = new Set<DeviceId>()
  let steps = 0
  let stopAll = false

  for (const source of sourceIndexes) {
    // Exact reachability, whatever the enumeration below is allowed to do.
    const dist = new Int32Array(g.nodeIds.length).fill(-1)
    const pred = new Int32Array(g.nodeIds.length).fill(-1)
    dist[source] = 0
    const queue = [source]
    for (let head = 0; head < queue.length; head += 1) {
      const v = queue[head]
      for (const { to: w } of forward[v]) {
        if (dist[w] !== -1) continue
        dist[w] = dist[v] + 1
        pred[w] = v
        queue.push(w)
      }
    }
    let nearest = -1
    const reachedSinkIds: DeviceId[] = []
    const unreachedSinkIds: DeviceId[] = []
    for (const sink of sinkIndexes) {
      if (dist[sink] === -1) {
        unreachedSinkIds.push(g.nodeIds[sink])
        continue
      }
      reachedSinkIds.push(g.nodeIds[sink])
      reachedSinks.add(g.nodeIds[sink])
      if (dist[sink] > limits.maxHops) reasons.add('hop-cap')
      if (nearest === -1 || dist[sink] < dist[nearest]) nearest = sink
    }
    let witness: DeviceId[] | null = null
    if (nearest !== -1) {
      const walk: DeviceId[] = []
      for (let at = nearest; at !== -1; at = pred[at]) walk.push(g.nodeIds[at])
      witness = walk.reverse()
    }

    // Enumeration. Iterative deepening: one pass per hop budget, emitting only
    // paths of exactly that length, so nothing is emitted twice and the caps
    // keep the short paths rather than whichever the search stumbled on first.
    let emitted = 0
    const nodeStack = new Int32Array(limits.maxHops + 1)
    const linkStack = new Int32Array(limits.maxHops + 1)
    const cursorStack = new Int32Array(limits.maxHops + 1)
    const onPath = new Uint8Array(g.nodeIds.length)
    let stopSource = false

    const emit = (depth: number) => {
      if (paths.length >= limits.maxPaths) {
        reasons.add('path-cap')
        stopAll = true
        return
      }
      if (emitted >= limits.maxPathsPerSource) {
        reasons.add('source-path-cap')
        stopSource = true
        return
      }
      const deviceIds: DeviceId[] = []
      const hops: TraceHop[] = []
      for (let i = 0; i <= depth; i += 1) {
        deviceIds.push(g.nodeIds[nodeStack[i]])
        if (i > 0) hops.push(hopOf(g, nodeStack[i - 1], nodeStack[i], linkStack[i]))
      }
      paths.push({
        fromId: deviceIds[0],
        toId: deviceIds[deviceIds.length - 1],
        deviceIds,
        hopCount: depth,
        hops,
      })
      emitted += 1
    }

    for (let budget = 0; budget <= limits.maxHops && !stopSource && !stopAll; budget += 1) {
      // Nothing of this length can land on a sink, so do not walk it.
      if (distToSink[source] === -1 || distToSink[source] > budget) continue
      let top = 0
      nodeStack[0] = source
      cursorStack[0] = 0
      onPath[source] = 1
      if (budget === 0 && isSink[source]) emit(0)

      while (top >= 0 && !stopSource && !stopAll) {
        steps += 1
        if (steps > limits.maxSteps) {
          reasons.add('step-cap')
          stopAll = true
          break
        }
        const v = nodeStack[top]
        if (top === budget) {
          onPath[v] = 0
          top -= 1
          continue
        }
        const list = forward[v]
        const cursor = cursorStack[top]
        if (cursor >= list.length) {
          onPath[v] = 0
          top -= 1
          continue
        }
        cursorStack[top] = cursor + 1
        const { to: w, link } = list[cursor]
        if (onPath[w]) continue
        const remaining = budget - top - 1
        if (distToSink[w] === -1 || distToSink[w] > remaining) continue
        top += 1
        nodeStack[top] = w
        linkStack[top] = link
        cursorStack[top] = 0
        onPath[w] = 1
        if (top === budget && isSink[w]) emit(top)
      }
      // The stack unwinds without clearing when a cap stops it mid walk.
      onPath.fill(0)
    }

    sources.push({
      deviceId: g.nodeIds[source],
      label: g.devices[source].label,
      reaches: reachedSinkIds.length > 0,
      reachedSinkIds,
      unreachedSinkIds,
      shortestHops: nearest === -1 ? null : dist[nearest],
      witness,
      pathCount: emitted,
    })
  }

  paths.sort(
    (a, b) =>
      a.fromId.localeCompare(b.fromId) ||
      a.toId.localeCompare(b.toId) ||
      a.hopCount - b.hopCount ||
      a.deviceIds.join('>').localeCompare(b.deviceIds.join('>')),
  )

  const truncationReasons = [...reasons].sort()
  return {
    fromIds: from.known,
    toIds: to.known,
    unknownFromIds: from.unknown,
    unknownToIds: to.unknown,
    direction,
    limits,
    truncated: truncationReasons.length > 0,
    truncationReasons,
    paths,
    sources,
    reachedSinkIds: [...reachedSinks].sort(),
    unreachedSinkIds: to.known.filter((id) => !reachedSinks.has(id)),
    unreachedSourceIds: sources.filter((s) => !s.reaches).map((s) => s.deviceId),
  }
}
