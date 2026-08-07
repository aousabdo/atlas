import { describe, expect, it } from 'vitest'

import { declaredSiteIds, resolveSiteId, siteIdFromFileName } from '../siteId'

/**
 * Every name here is invented. The reference bundle is controlled material in
 * a read-only repo, so the shapes are copied and the content never is: a real
 * topology names the site inside a long human-written title, sometimes in a
 * trailing parenthetical, and carries no site_id field at all.
 */
describe('siteIdFromFileName', () => {
  it('drops a topology suffix', () => {
    expect(siteIdFromFileName('northgate_network.json')).toBe('northgate')
    expect(siteIdFromFileName('northgate-topology.json')).toBe('northgate')
    expect(siteIdFromFileName('northgate_graph.json')).toBe('northgate')
  })

  it('slugs whatever is left', () => {
    expect(siteIdFromFileName('Harbor Point Network.JSON')).toBe('harbor_point')
  })

  it('keeps a name it cannot improve, which is how it guesses wrong', () => {
    // The defect this module exists for: a file named for the export rather
    // than for the site. The file name simply has no site in it.
    expect(siteIdFromFileName('facility_network_full.json')).toBe('facility_network_full')
  })
})

describe('resolveSiteId', () => {
  it('takes a top level site_id first, because it was stated on purpose', () => {
    const resolved = resolveSiteId(
      { site_id: 'Harbor Point', graph: { name: 'Anything At All (Elsewhere)' } },
      'facility_network_full.json',
    )
    expect(resolved.id).toBe('harbor_point')
    expect(resolved.source).toBe('declared')
  })

  it('takes a site_id inside graph before reading the title', () => {
    const resolved = resolveSiteId(
      { graph: { site_id: 'harbor_point', name: 'Something Else (Elsewhere)' } },
      'facility_network_full.json',
    )
    expect(resolved.id).toBe('harbor_point')
    expect(resolved.source).toBe('declared')
  })

  it('reads the trailing parenthetical of the title when nothing is declared', () => {
    // The real shape: a long title whose last parenthetical names the site.
    const resolved = resolveSiteId(
      { graph: { name: 'X-Ray Facility Topology - Some Long Campus Name (Harbor Point)' } },
      'facility_network_full.json',
    )
    expect(resolved.id).toBe('harbor_point')
    expect(resolved.source).toBe('graph-name')
    expect(resolved.from).toBe('Harbor Point')
  })

  it('reads the trailing segment of the title when there is no parenthetical', () => {
    const resolved = resolveSiteId(
      { graph: { name: 'X-Ray Facility Topology - Harbor Point' } },
      'harbor_point_network.json',
    )
    expect(resolved.id).toBe('harbor_point')
    expect(resolved.source).toBe('graph-name')
  })

  it('refuses an undivided title, because the whole title is not a site', () => {
    // No parenthetical and no separator means there is no trailing segment to
    // read, only a document title. Slugging it would invent a site.
    const resolved = resolveSiteId(
      { graph: { name: 'Facility Network Topology' } },
      'harbor_point_network.json',
    )
    expect(resolved.id).toBe('harbor_point')
    expect(resolved.source).toBe('file-name')
  })

  it('refuses a trailing segment that names the document rather than a place', () => {
    const resolved = resolveSiteId(
      { graph: { name: 'Some Campus - Network Topology' } },
      'harbor_point_network.json',
    )
    expect(resolved.id).toBe('harbor_point')
    expect(resolved.source).toBe('file-name')
  })

  it('refuses a trailing segment too long to be a site name', () => {
    const resolved = resolveSiteId(
      { graph: { name: 'Facility Topology - A Trailing Run Of Far Too Many Words' } },
      'harbor_point_network.json',
    )
    expect(resolved.source).toBe('file-name')
  })

  it('falls back to the file name when there is no graph at all', () => {
    const resolved = resolveSiteId({}, 'harbor_point_network.json')
    expect(resolved.id).toBe('harbor_point')
    expect(resolved.source).toBe('file-name')
    expect(resolved.from).toBe('harbor_point_network.json')
  })

  it('falls back to the file name when the file is not an object', () => {
    expect(resolveSiteId(null, 'harbor_point_network.json').id).toBe('harbor_point')
    expect(resolveSiteId('nonsense', 'harbor_point_network.json').source).toBe('file-name')
  })
})

describe('declaredSiteIds', () => {
  it('reads the site keys a system to device map declares', () => {
    expect(
      declaredSiteIds({
        default_site: 'harbor_point',
        sites: { harbor_point: {}, northgate: {} },
      }),
    ).toEqual(['harbor_point', 'northgate'])
  })

  it('counts a default site that has no block of its own', () => {
    expect(declaredSiteIds({ default_site: 'northgate' })).toEqual(['northgate'])
  })

  it('says nothing rather than guessing when a file declares no sites', () => {
    expect(declaredSiteIds({ cross_links: [] })).toEqual([])
    expect(declaredSiteIds(null)).toEqual([])
  })
})
