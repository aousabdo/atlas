import type {
  Glossary,
  Project,
  Requirement,
  System,
  Topology,
} from '../types/atlas'

export type ResultKind =
  | 'view'
  | 'site'
  | 'system'
  | 'device'
  | 'zone'
  | 'acronym'
  | 'requirement'

/** Heading shown above a group, and the word a reader uses for the thing. */
export const KIND_LABEL: Record<ResultKind, string> = {
  view: 'Views',
  site: 'Sites',
  system: 'Systems',
  device: 'Devices',
  zone: 'Zones',
  acronym: 'Acronyms',
  requirement: 'Requirements',
}

export interface SearchItem {
  /** Unique across the index. Two sites may use the same device id. */
  key: string
  kind: ResultKind
  /** The name on the row. */
  label: string
  /** The identifier a reader can type or paste. Prose rows have none. */
  code: string | null
  /** Where it lives, on the second line of the row. */
  detail: string
  /**
   * Route, query and hash for choosing this row.
   *
   * Every one of these is a convention the app already reads, not a new one:
   * the map takes ?focus=<system id>, the topology takes ?site=<site id> on its
   * own for a whole site and ?site=<site id> with
   * ?focus=<comma separated device ids>, and the reference tab addresses its
   * sections by the anchors its own section nav links to. The acronym table
   * and the requirements chart take no per-row selection from the URL today,
   * so those rows land on the view that holds them; when either grows one,
   * this is the only line that changes.
   */
  to: string
  /**
   * Everything else worth matching, already lowercased: addresses, prose,
   * acronym expansions, owner groups. Matched at the weakest tier, so a hit
   * buried in a description can never outrank a hit on a name.
   */
  extra: string
}

export interface IndexInput {
  views: ReadonlyArray<{ path: string; label: string }>
  systems: System[]
  glossary: Glossary
  requirements: Requirement[]
  project: Project
  /** One per site the project lists. */
  topologies: Topology[]
}

function joinDetail(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => !!part && part.trim() !== '').join(' · ')
}

/** Encoded per id, so a label that carries punctuation cannot break the link. */
function focusParam(ids: string[]): string {
  return ids.map((id) => encodeURIComponent(id)).join(',')
}

/**
 * Everything the app knows, flattened into rows the palette can rank.
 *
 * Built from whatever the provider handed back, so a locally loaded workbook
 * is searched exactly like the sample bundle.
 */
export function buildIndex(input: IndexInput): SearchItem[] {
  const items: SearchItem[] = []

  for (const view of input.views) {
    items.push({
      key: `view:${view.path}`,
      kind: 'view',
      label: view.label,
      code: null,
      detail: 'View',
      to: view.path,
      extra: view.path.replace('/', '').toLowerCase(),
    })
  }

  for (const system of input.systems) {
    items.push({
      key: `system:${system.id}`,
      kind: 'system',
      label: system.name,
      code: system.id,
      detail: joinDetail([system.owner_group, system.category]),
      to: `/map?focus=${encodeURIComponent(system.id)}`,
      extra: [
        system.label,
        system.owner_group,
        system.owner_group_id,
        system.category,
        system.risk,
        system.detail,
        system.integrations_prose,
      ]
        .join(' ')
        .toLowerCase(),
    })
  }

  const siteLabel = new Map(input.project.sites.map((site) => [site.id, site.label]))
  const deviceCount = new Map(
    input.topologies.map((topology) => [topology.site_id, topology.devices.length]),
  )

  // A site is a thing a reader names out loud, so it is a thing they can type.
  // Without these rows the one facet every device row displays was the one
  // facet nothing could match.
  for (const site of input.project.sites) {
    // From the topology that was indexed where there is one, so the row cannot
    // promise a number the site does not have.
    const devices = deviceCount.get(site.id) ?? site.device_count
    items.push({
      key: `site:${site.id}`,
      kind: 'site',
      label: site.label,
      code: site.id,
      detail: joinDetail([
        `${devices} ${devices === 1 ? 'device' : 'devices'}`,
        site.classification,
      ]),
      to: `/network?site=${encodeURIComponent(site.id)}`,
      extra: site.classification.toLowerCase(),
    })
  }

  for (const topology of input.topologies) {
    const site = topology.site_id
    const label = siteLabel.get(site) ?? topology.meta.label
    const zoneLabel = (zone: string) => topology.zones[zone]?.label ?? zone
    // Everything under a site answers to the name of the site, at the weakest
    // tier: "westfield" should return the eight devices whose rows all print
    // Westfield Proving Ground, and should still put the site itself first.
    const at = `${label} ${site}`.toLowerCase()

    for (const device of topology.devices) {
      items.push({
        key: `device:${site}:${device.id}`,
        kind: 'device',
        label: device.label,
        code: device.id,
        detail: joinDetail([label, zoneLabel(device.zone), device.type, device.ip]),
        to: `/network?site=${encodeURIComponent(site)}&focus=${encodeURIComponent(device.id)}`,
        extra: [
          device.ip,
          device.subnet,
          device.description,
          device.type,
          zoneLabel(device.zone),
          at,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      })
    }

    for (const [zoneId, zone] of Object.entries(topology.zones)) {
      const devices = topology.devices.filter((device) => device.zone === zoneId)
      const focus = focusParam(devices.map((device) => device.id))
      items.push({
        key: `zone:${site}:${zoneId}`,
        kind: 'zone',
        label: zone.label,
        code: zoneId,
        // The count is the length of the list in the link below, so the row
        // cannot claim a number the jump does not deliver.
        detail: joinDetail([label, `${devices.length} devices`]),
        to: focus
          ? `/network?site=${encodeURIComponent(site)}&focus=${focus}`
          : `/network?site=${encodeURIComponent(site)}`,
        extra: `${zone.description ?? ''} ${at}`.trim().toLowerCase(),
      })
    }
  }

  for (const acronym of input.glossary.acronyms) {
    items.push({
      key: `acronym:${acronym.acr}`,
      kind: 'acronym',
      label: acronym.acr,
      code: acronym.acr,
      detail: acronym.meaning,
      to: '/reference#acronyms',
      extra: acronym.meaning.toLowerCase(),
    })
  }

  for (const requirement of input.requirements) {
    items.push({
      key: `requirement:${requirement.sys}:${requirement.orig}`,
      kind: 'requirement',
      label: requirement.orig,
      code: null,
      detail: joinDetail([`Baseline ${requirement.sys}`, requirement.status]),
      to: '/analytics',
      extra: [requirement.sys, requirement.status, ...requirement.current]
        .join(' ')
        .toLowerCase(),
    })
  }

  return items
}

/**
 * The ranking rule, highest first:
 *
 *   1. the query is the identifier            (system id, device id, acronym)
 *   2. the query is the name
 *   3. the identifier starts with the query
 *   4. the name starts with the query
 *   5. a word inside the name starts with the query
 *   6. the identifier or the name contains the query anywhere
 *   7. anything else indexed contains it      (address, prose, expansion)
 *
 * An exact id beats a prefix beats a substring, which is the whole point: a
 * reader who types a device id gets that device, not the six rows whose
 * description happens to mention it. Zero means no match; a zero-scoring row
 * is dropped rather than shown at the bottom, because a list that always has
 * results teaches people not to read it.
 */
export const SCORE = {
  exactCode: 600,
  exactLabel: 500,
  prefixCode: 400,
  prefixLabel: 300,
  wordPrefixLabel: 200,
  substring: 100,
  extra: 50,
} as const

const WORD_SPLIT = /[^a-z0-9]+/

export function scoreItem(item: SearchItem, query: string): number {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0

  const label = item.label.toLowerCase()
  const code = item.code?.toLowerCase() ?? null

  if (code === needle) return SCORE.exactCode
  if (label === needle) return SCORE.exactLabel
  if (code?.startsWith(needle)) return SCORE.prefixCode
  if (label.startsWith(needle)) return SCORE.prefixLabel
  if (label.split(WORD_SPLIT).some((word) => word.startsWith(needle))) {
    return SCORE.wordPrefixLabel
  }
  if (label.includes(needle) || code?.includes(needle)) return SCORE.substring
  if (item.extra.includes(needle)) return SCORE.extra
  return 0
}

/** Group order for ties. Concrete entities first; prose last. */
const KIND_RANK: Record<ResultKind, number> = {
  view: 0,
  site: 1,
  system: 2,
  device: 3,
  zone: 4,
  acronym: 5,
  requirement: 6,
}

/**
 * Ranked matches, every one of them.
 *
 * Ties break on the shorter label, then on kind, then alphabetically, then on
 * the key, so the same query always produces the same list in the same order.
 * The caller decides how many to show and says so when it shows fewer.
 */
export function search(index: SearchItem[], query: string): SearchItem[] {
  // An empty box offers the views. Listing four hundred rows nobody asked for
  // would bury them.
  if (query.trim() === '') return index.filter((item) => item.kind === 'view')

  const scored: Array<{ item: SearchItem; score: number }> = []
  for (const item of index) {
    const score = scoreItem(item, query)
    if (score > 0) scored.push({ item, score })
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (a.item.label.length !== b.item.label.length) {
      return a.item.label.length - b.item.label.length
    }
    if (a.item.kind !== b.item.kind) return KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind]
    const byLabel = a.item.label.localeCompare(b.item.label)
    return byLabel !== 0 ? byLabel : a.item.key.localeCompare(b.item.key)
  })

  return scored.map((entry) => entry.item)
}

export interface ResultGroup {
  kind: ResultKind
  title: string
  items: SearchItem[]
}

/**
 * The same rows, grouped by kind for display.
 *
 * "trestle" can be a system and a device, and a reader needs to know which one
 * they are about to jump to. Groups appear in the order their best match
 * appears in the ranked list, so the first row on screen is still the top hit.
 */
export function groupByKind(results: SearchItem[]): ResultGroup[] {
  const groups = new Map<ResultKind, ResultGroup>()
  for (const item of results) {
    const existing = groups.get(item.kind)
    if (existing) existing.items.push(item)
    else groups.set(item.kind, { kind: item.kind, title: KIND_LABEL[item.kind], items: [item] })
  }
  return [...groups.values()]
}
