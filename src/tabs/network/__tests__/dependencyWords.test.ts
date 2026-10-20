import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveRoots, siteDependencies } from '../../../lib/dependency'
import type { CoverageMatrix, LinkSet, System, Topology } from '../../../types/atlas'
import { describeDependency, describeIntegrations, restsOnSentence, summarizeDependency, type Namers } from '../dependencyWords'

const FIXTURES = join(process.cwd(), 'fixtures', 'synthetic')
const read = <T,>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T
const SYSTEMS = read<System[]>('systems.json')
const COVERAGE = read<CoverageMatrix>('coverage.json')
const NORTHGATE = read<Topology>('sites/northgate.json')
const LINKS = read<LinkSet>('links.json')

const deps = siteDependencies(
  { topology: NORTHGATE, site: COVERAGE.sites.northgate, systems: SYSTEMS, links: LINKS.current },
  resolveRoots(NORTHGATE, COVERAGE.sites.northgate, { source: 'declared' }),
)
const declared: Namers = {
  nameOf: (id) => SYSTEMS.find((s) => s.id === id)?.name ?? id,
  riskOf: (id) => SYSTEMS.find((s) => s.id === id)?.risk ?? 'low',
  labelOf: (id) => NORTHGATE.devices.find((d) => d.id === id)?.label ?? id,
  positionWord: (count) => (count === 1 ? 'decision position' : 'decision positions'),
}
const dep = (id: string) => deps.byDevice.get(id)!

describe('the sentences about what rests on a device', () => {
  it('counts a partial loss against every device the system runs on', () => {
    expect(describeDependency(dep('core_router'), declared, 7)).toContain(
      'Cuts part of UAS Common Picture off: 2 of its 3 devices lose their path (Mission COP Application and Government Cloud Tenancy). Mobile Unit Displays keeps its path.',
    )
  })

  it('says when the system also runs on the removed device, and counts it in', () => {
    expect(describeDependency(dep('gov_cloud'), declared, 7)).toContain(
      'Cuts part of UAS Common Picture off: 1 of its 3 devices loses its path (Mission COP Application). Mobile Unit Displays keeps its path. It also runs on this device.',
    )
    const fps = describeDependency(dep('mcv_switch'), declared, 7).find((l) => l.startsWith('Cuts part of FPS Relay'))
    expect(fps).toMatch(/^Cuts part of FPS Relay off: \d of its 5 devices /)
    expect(fps).toMatch(/It also runs on this device\.$/)
  })

  it('names the stranded systems and the positions cut off', () => {
    expect(describeDependency(dep('field_house_switch'), declared, 7)).toEqual([
      'Strands Bastion Effector: every device it runs on loses its path.',
      'Cuts Field House Operator Display, a decision position, off from every other device a system runs on.',
    ])
    expect(summarizeDependency(dep('field_house_switch'), declared)).toBe(
      'strands Bastion Effector (high) · cuts 1 decision position off',
    )
  })

  it('never calls a root a decision position unless it was declared one', () => {
    const typeRoots = siteDependencies(
      { topology: NORTHGATE, site: COVERAGE.sites.northgate, systems: SYSTEMS, links: LINKS.current },
      resolveRoots(NORTHGATE, COVERAGE.sites.northgate, { source: 'type', deviceType: 'endpoint' }),
    )
    const byType: Namers = { ...declared, positionWord: (c) => (c === 1 ? 'root' : 'roots') }
    const lines = describeDependency(typeRoots.byDevice.get('ops_net_switch')!, byType, 10)
    expect(lines.join(' ')).not.toMatch(/decision position/)
    expect(lines.join(' ')).toMatch(/Cuts \d+ roots off from every other device a system runs on/)
  })

  it('says the integrations a device breaks hold whatever the roots', () => {
    expect(describeIntegrations(dep('core_switch'), declared)[0]).toMatch(
      /^Breaks 3 documented integrations: .*\. This holds whatever the roots\.$/,
    )
  })

  it('tells a device named only outside the matrix that no realized system runs on it', () => {
    const phrase = 'the 7 declared decision positions'
    expect(restsOnSentence(dep('field_house_switch'), declared, phrase, { claimed: false, listedNotRealized: false }))
      .toBe('No system lists this device, but on the drawing its loss strands Bastion Effector (high) and cuts Field House Operator Display off from every system, measured from the 7 declared decision positions. See If this device is removed.')
    expect(restsOnSentence(dep('field_house_switch'), declared, phrase, { claimed: false, listedNotRealized: true }))
      .toMatch(/^No realized system runs on this device \(the mappings above name no system the matrix carries, or no hardware\), but on the drawing its loss strands/)
    expect(restsOnSentence(dep('gov_cloud'), declared, phrase, { claimed: true, listedNotRealized: false }))
      .toBe('Its loss also strands Event Relay Server (medium), measured from the 7 declared decision positions.')
  })
})
