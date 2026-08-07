/**
 * Which site a topology file describes.
 *
 * WHY THIS IS ITS OWN MODULE, AND WHY IT IS HERE RATHER THAN IN THE PARSER
 *
 * The site id is the join key into the system to device map and the curation
 * overrides. Get it wrong and nothing errors: the site loads with its devices
 * and no coverage at all, which reads on screen as a finding ("nothing is
 * mapped at this site") when it is really a file naming mismatch. Producing a
 * confident wrong answer is the failure this tool exists to prevent, so the
 * resolution has to be visible and correctable rather than silent.
 *
 * That requirement is what fixes the location. The load panel has to show the
 * resolved id BEFORE the load commits, which means resolving before the
 * provider parses anything. If LocalFileProvider also resolved, the two could
 * disagree and the preview would be a lie. So resolution is a pure function
 * over already-parsed JSON plus a file name, living outside both: the panel
 * calls it to fill an editable field, and the provider keeps its existing
 * contract of being handed a record already keyed by site id. Whatever the
 * analyst confirmed in the panel is what the provider is given, always.
 */

/** Where a resolved id came from, in the order the resolver tries them. */
export type SiteIdSource = 'declared' | 'graph-name' | 'file-name'

export interface ResolvedSiteId {
  /** The slug to key the map with. */
  id: string
  source: SiteIdSource
  /** The text the slug was made from, so the panel can show its working. */
  from: string
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * The file name, as the original implementation did it.
 *
 * Kept as the last resort rather than deleted. It is right whenever the file
 * was named for its site, which is often, and it is the only source available
 * when a file declares nothing and carries no usable title.
 */
export function siteIdFromFileName(name: string): string {
  return slugify(
    name.replace(/\.[^.]+$/, '').replace(/[\s_-](network|topology|graph)$/i, ''),
  )
}

/**
 * Words that describe the document rather than the place.
 *
 * A title made only of these has no site in it, and slugging it anyway would
 * hand back a confident id that matches no mapping key. Better to fall through
 * to the file name and let the analyst see and fix the guess.
 */
const DOCUMENT_WORDS = new Set([
  'architecture', 'as', 'assessment', 'baseline', 'current', 'deployed',
  'diagram', 'draft', 'final', 'full', 'graph', 'infrastructure', 'is',
  'layout', 'map', 'network', 'overview', 'site', 'sites', 'system',
  'systems', 'topology', 'v1', 'v2', 'v3', 'version',
])

/** More words than this is a sentence, not a place. */
const MAX_SEGMENT_WORDS = 4

function usableSlug(text: string): string | null {
  const slug = slugify(text)
  if (!slug || !/[a-z]/.test(slug)) return null
  const words = slug.split('_')
  if (words.length > MAX_SEGMENT_WORDS) return null
  if (words.every((w) => DOCUMENT_WORDS.has(w))) return null
  return slug
}

/**
 * The site named inside a human-written title.
 *
 * Real titles put the place last, either in a trailing parenthetical or after
 * a dash or colon. The parenthetical is tried first because when both are
 * present the parenthetical is the more specific of the two.
 *
 * A title with no parenthetical and no separator yields nothing at all. The
 * separator is the evidence that the tail is a distinct thing rather than the
 * end of a sentence, and without it the "trailing segment" is just the whole
 * document title.
 */
function fromGraphName(name: string): { id: string; from: string } | null {
  const parenthetical = [...name.matchAll(/\(([^()]+)\)/g)].pop()?.[1]
  if (parenthetical) {
    const slug = usableSlug(parenthetical)
    if (slug) return { id: slug, from: parenthetical.trim() }
  }
  const segments = name
    .replace(/\([^()]*\)/g, '')
    .split(/\s+[—–-]\s+|:\s+|\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length < 2) return null
  const last = segments[segments.length - 1]
  const slug = usableSlug(last)
  return slug ? { id: slug, from: last } : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringAt(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Resolve in a fixed, stated order:
 *
 *   1. an explicit site_id, at the top level or inside graph
 *   2. the site named in graph.name, if a segment of it yields a usable slug
 *   3. the file name
 *
 * None of these is reliable enough to act on unseen, which is why the caller
 * shows the answer and lets the analyst change it.
 */
export function resolveSiteId(
  raw: unknown,
  fileName: string,
  /**
   * Site keys a system to device map or overrides file declares, when one has
   * been picked. These outrank the ordering below, because they are the only
   * evidence in the room about which slug the data actually joins on.
   */
  declaredIds: readonly string[] = [],
): ResolvedSiteId {
  const root = asRecord(raw)
  const graph = asRecord(root?.graph)

  const candidates: ResolvedSiteId[] = []

  const stated = stringAt(root, 'site_id') ?? stringAt(graph, 'site_id')
  if (stated) {
    const slug = slugify(stated)
    if (slug) candidates.push({ id: slug, source: 'declared', from: stated })
  }

  const graphName = stringAt(graph, 'name')
  if (graphName) {
    const found = fromGraphName(graphName)
    if (found) candidates.push({ id: found.id, source: 'graph-name', from: found.from })
  }

  candidates.push({ id: siteIdFromFileName(fileName), source: 'file-name', from: fileName })

  // A candidate that matches a declared key wins outright, whatever its rank.
  //
  // Ranking the title above the file name broke the app's own generated
  // inputs: northgate.json is titled "Northgate Sports Campus", which slugs to
  // northgate_sports_campus, while the map keys it northgate. The file name was
  // right and got overruled, so the canonical path grew two mismatch warnings
  // and made the analyst hand-correct every load. A title is what a human wrote
  // in a header; a declared key is what the data joins on, and when the two
  // disagree the data wins.
  if (declaredIds.length) {
    const declared = new Set(declaredIds)
    const match = candidates.find((c) => declared.has(c.id))
    if (match) return match
  }

  return candidates[0]
}

/** Human wording for where an id came from, used in the panel. */
export const SITE_ID_SOURCE_LABEL: Record<SiteIdSource, string> = {
  declared: 'stated in the file',
  'graph-name': 'read from the title',
  'file-name': 'guessed from the file name',
}

/**
 * The site keys a system to device map or an overrides file declares.
 *
 * Sorted and de-duplicated so the panel can compare against it and, when a
 * topology resolves to an id that is not in it, say which ids were expected.
 * A file that declares no sites contributes nothing; it must not be read as
 * "no sites exist".
 */
export function declaredSiteIds(raw: unknown): string[] {
  const root = asRecord(raw)
  if (!root) return []
  const ids = new Set<string>()
  const sites = asRecord(root.sites)
  if (sites) for (const id of Object.keys(sites)) if (id.trim()) ids.add(id.trim())
  const fallback = stringAt(root, 'default_site')
  if (fallback) ids.add(fallback)
  return [...ids].sort()
}
