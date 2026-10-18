/**
 * Documented vs wired: the integrations the documents record, checked against
 * one site's drawing.
 *
 * The matrix says two systems exchange data. The coverage map says which
 * devices each system runs on at a site. The topology says how those devices
 * are cabled. This is the first place the three meet, and it answers a narrow
 * question: is there a way, on the drawing, for that integration to run here?
 *
 * A cable or radio path between the two systems' hardware is evidence that the
 * integration can run at the site. It is not evidence that it does. Nothing
 * here reads a port, a protocol or a firewall rule, and the wording on screen
 * has to stay inside that.
 *
 * Paths are counted on the physical links, as everywhere else in this tool: a
 * VLAN rides on cable that is drawn separately, so a VLAN between the two is
 * reported as such and never as a path.
 */
import { isRealizedMapping } from './coverage'
import { isLogicalLink } from './graph'
import type { CoverageSite, DeviceId, Link, SystemId, Topology } from '../types/atlas'

/** Why an integration cannot be checked at a site, one entry per end that fails. */
export type UncheckedReason =
  /** The site records that it looked and the system is not there. */
  | 'checked-absent'
  /** Mapped here, but with no hardware: client software or a plugin. */
  | 'software-only'
  /** The site's mapping file says nothing about the system at all. */
  | 'no-record'
  /** Mapped to devices, none of which the drawing has. */
  | 'not-in-drawing'

export type WiringVerdict =
  | {
      kind: 'wired'
      /** One shortest path on cable and radio, from a device of one end to one of the other. */
      path: DeviceId[]
      hops: number
      /**
       * Every device whose loss alone leaves no cable or radio path between
       * the two ends, in path order. Empty means a second way round exists.
       * Either end's own devices are never listed: they are the systems.
       */
      cutDeviceIds: DeviceId[]
    }
  | { kind: 'co-hosted'; sharedDeviceIds: DeviceId[] }
  /** Joined on the drawing only through a VLAN somewhere along the way. */
  | { kind: 'logical-only'; path: DeviceId[] }
  | { kind: 'no-path' }
  | { kind: 'unchecked'; reasons: Array<{ systemId: SystemId; reason: UncheckedReason }> }

export interface LinkWiring {
  link: Link
  verdict: WiringVerdict
}

type Adjacency = Map<DeviceId, DeviceId[]>

function adjacency(topology: Topology, physicalOnly: boolean): Adjacency {
  const adj: Adjacency = new Map(topology.devices.map((d) => [d.id, []]))
  for (const edge of topology.edges) {
    if (physicalOnly && isLogicalLink(edge.link_type)) continue
    if (!adj.has(edge.source) || !adj.has(edge.target)) continue
    adj.get(edge.source)!.push(edge.target)
    adj.get(edge.target)!.push(edge.source)
  }
  return adj
}

/**
 * Breadth first from every device of one end at once, so the path found is a
 * shortest one between the two ends rather than from one arbitrary device.
 */
function shortestPath(
  adj: Adjacency,
  from: readonly DeviceId[],
  to: ReadonlySet<DeviceId>,
  banned: DeviceId | null = null,
): DeviceId[] | null {
  const previous = new Map<DeviceId, DeviceId | null>()
  const queue: DeviceId[] = []
  for (const start of from) {
    if (start === banned || previous.has(start)) continue
    previous.set(start, null)
    queue.push(start)
  }
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head]!
    if (to.has(at)) {
      const path = [at]
      for (let step = previous.get(at); step; step = previous.get(step)) path.unshift(step)
      return path
    }
    for (const next of adj.get(at) ?? []) {
      if (next === banned || previous.has(next)) continue
      previous.set(next, at)
      queue.push(next)
    }
  }
  return null
}

/** Which devices of a system the drawing has, or why it has none to offer. */
function endpoint(
  systemId: SystemId,
  site: CoverageSite,
  inDrawing: ReadonlySet<DeviceId>,
  matrixIds: ReadonlySet<SystemId>,
): { devices: DeviceId[] } | { reason: UncheckedReason } {
  if (systemId in site.not_deployed_at_site) return { reason: 'checked-absent' }
  const mapping = site.mappings[systemId]
  if (!mapping) return { reason: 'no-record' }
  if (!isRealizedMapping(systemId, mapping, matrixIds)) return { reason: 'software-only' }
  const devices = mapping.devices.filter((id) => inDrawing.has(id))
  return devices.length > 0 ? { devices } : { reason: 'not-in-drawing' }
}

function verdictFor(
  link: Link,
  site: CoverageSite,
  physical: Adjacency,
  recorded: Adjacency,
  inDrawing: ReadonlySet<DeviceId>,
  matrixIds: ReadonlySet<SystemId>,
): WiringVerdict {
  const ends = [link.from, link.to].map((id) => ({
    id,
    at: endpoint(id, site, inDrawing, matrixIds),
  }))
  const reasons = ends.flatMap(({ id, at }) =>
    'reason' in at ? [{ systemId: id, reason: at.reason }] : [],
  )
  if (reasons.length > 0) return { kind: 'unchecked', reasons }

  const a = (ends[0]!.at as { devices: DeviceId[] }).devices
  const b = (ends[1]!.at as { devices: DeviceId[] }).devices
  const shared = a.filter((id) => b.includes(id))
  if (shared.length > 0) return { kind: 'co-hosted', sharedDeviceIds: shared.sort() }

  const targets = new Set(b)
  const path = shortestPath(physical, a, targets)
  if (path) {
    // A device whose loss separates the two ends lies on every path between
    // them, so it lies on this one: testing the interior of one shortest path
    // finds all of them, exactly.
    const cutDeviceIds = path
      .slice(1, -1)
      .filter((candidate) => shortestPath(physical, a, targets, candidate) === null)
    return { kind: 'wired', path, hops: path.length - 1, cutDeviceIds }
  }
  const logical = shortestPath(recorded, a, targets)
  return logical ? { kind: 'logical-only', path: logical } : { kind: 'no-path' }
}

/**
 * Every link checked against one site, in the order given.
 *
 * The caller decides whether the site has been reviewed at all: a site with
 * no mappings and no checked absences returns every link as unchecked with
 * "no-record", which is true but is not the headline. The panel says the site
 * is unreviewed instead of listing why each link could not be checked.
 */
export function wiringAtSite(
  links: readonly Link[],
  site: CoverageSite,
  topology: Topology,
  matrixIds: ReadonlySet<SystemId>,
): LinkWiring[] {
  const physical = adjacency(topology, true)
  const recorded = adjacency(topology, false)
  const inDrawing = new Set(topology.devices.map((d) => d.id))
  return links.map((link) => ({
    link,
    verdict: verdictFor(link, site, physical, recorded, inDrawing, matrixIds),
  }))
}
