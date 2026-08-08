import { describe, expect, it } from 'vitest'

import type {
  Glossary,
  Project,
  Requirement,
  System,
  Topology,
} from '../../types/atlas'
import { buildIndex, groupByKind, search, type SearchItem } from '../search'

const VIEWS = [
  { path: '/reference', label: 'Reference & Methodology' },
  { path: '/analytics', label: 'Analytics' },
  { path: '/lossiness', label: 'Lossiness' },
  { path: '/network', label: 'Network Topology' },
  { path: '/map', label: 'Orientation Map' },
]

function system(over: Partial<System> & Pick<System, 'id' | 'name'>): System {
  return {
    label: over.name,
    category: 'Deployed asset record',
    owner_group_id: 'ops',
    owner_group: 'Operations Group',
    color_key: 'ops',
    confirmed: true,
    risk: 'low',
    risk_source: 'explicit',
    detail: '',
    integrations_prose: '',
    ...over,
  }
}

function topology(over: Partial<Topology> & Pick<Topology, 'site_id'>): Topology {
  return {
    meta: {
      label: 'Harbour Yard',
      name: 'harbour',
      description: '',
      classification: 'UNCLASSIFIED//SAMPLE',
      version: '1',
      updated: '2026-01-01',
      device_count: 0,
      edge_count: 0,
    },
    zones: {},
    devices: [],
    edges: [],
    ...over,
  }
}

function project(over: Partial<Project> = {}): Project {
  return {
    slug: 'fixture',
    name: 'Fixture Architecture',
    baseline_date: '2026-01-01',
    source_label: 'Fixture Matrix',
    default_site: 'harbour',
    sites: [
      {
        id: 'harbour',
        label: 'Harbour Yard',
        classification: 'UNCLASSIFIED//SAMPLE',
        device_count: 0,
        edge_count: 0,
        updated: '2026-01-01',
      },
    ],
    ...over,
  }
}

function glossary(over: Partial<Glossary> = {}): Glossary {
  return {
    confidence_intro: '',
    out_of_scope: [],
    methodology_extras: {
      risk_caveat: '',
      mapping_confidence_scale: '',
      soft_ownership_note: '',
    },
    acronyms: [],
    ...over,
  }
}

interface FixtureOver {
  systems?: System[]
  topologies?: Topology[]
  requirements?: Requirement[]
  acronyms?: Glossary['acronyms']
  project?: Project
}

function index(over: FixtureOver = {}): SearchItem[] {
  return buildIndex({
    views: VIEWS,
    systems: over.systems ?? [],
    glossary: glossary({ acronyms: over.acronyms ?? [] }),
    requirements: over.requirements ?? [],
    project: over.project ?? project(),
    topologies: over.topologies ?? [],
  })
}

const labels = (items: SearchItem[]) => items.map((item) => item.label)

describe('buildIndex', () => {
  it('carries the five views so a tab is reachable by name', () => {
    const views = index().filter((item) => item.kind === 'view')
    expect(labels(views)).toEqual(VIEWS.map((view) => view.label))
    expect(views.map((item) => item.to)).toEqual(VIEWS.map((view) => view.path))
  })

  it('indexes every kind the app knows about', () => {
    const items = index({
      systems: [system({ id: 'trestle', name: 'Trestle Core' })],
      acronyms: [{ acr: 'CUAS', meaning: 'Counter-Unmanned Aircraft Systems' }],
      requirements: [
        { orig: 'No shared clock across the sensor field', sys: 'TRESTLE', current: ['Trestle Core'], status: 'Condensed' },
      ],
      topologies: [
        topology({
          site_id: 'harbour',
          zones: { quay: { label: 'Quay Edge' } },
          devices: [
            { id: 'quay_switch', label: 'Quay Switch', zone: 'quay', type: 'switch', ip: '172.31.10.5', subnet: null, description: null },
          ],
        }),
      ],
    })
    expect(new Set(items.map((item) => item.kind))).toEqual(
      new Set(['view', 'site', 'system', 'device', 'zone', 'acronym', 'requirement']),
    )
  })

  it('indexes the sites, which are the one facet every device row prints', async () => {
    const items = index({
      topologies: [
        topology({
          site_id: 'harbour',
          zones: { quay: { label: 'Quay Edge' } },
          devices: [
            { id: 'quay_switch', label: 'Quay Switch', zone: 'quay', type: 'switch', ip: null, subnet: null, description: null },
          ],
        }),
      ],
    })
    const site = items.find((item) => item.kind === 'site')!
    expect(site.label).toBe('Harbour Yard')
    expect(site.code).toBe('harbour')
    expect(site.to).toBe('/network?site=harbour')
    // The number on the row is the number of devices indexed under it, not a
    // second tally that can drift from them.
    expect(site.detail).toContain('1 device')
  })

  it('keeps two sites apart when they use the same device id', () => {
    const devices = [
      { id: 'gw', label: 'Uplink Gateway', zone: 'edge', type: 'gateway', ip: null, subnet: null, description: null },
    ]
    const items = index({
      project: project({
        sites: [
          { id: 'harbour', label: 'Harbour Yard', classification: 'UNCLASSIFIED//SAMPLE', device_count: 1, edge_count: 0, updated: '2026-01-01' },
          { id: 'quarry', label: 'Quarry Range', classification: 'UNCLASSIFIED//SAMPLE', device_count: 1, edge_count: 0, updated: '2026-01-01' },
        ],
      }),
      topologies: [
        topology({ site_id: 'harbour', zones: { edge: { label: 'Edge' } }, devices }),
        topology({
          site_id: 'quarry',
          meta: { ...topology({ site_id: 'quarry' }).meta, label: 'Quarry Range' },
          zones: { edge: { label: 'Edge' } },
          devices,
        }),
      ],
    })
    const found = search(items, 'uplink gateway')
    expect(found).toHaveLength(2)
    expect(new Set(found.map((item) => item.key)).size).toBe(2)
    expect(found.map((item) => item.to)).toEqual(
      expect.arrayContaining([
        '/network?site=harbour&focus=gw',
        '/network?site=quarry&focus=gw',
      ]),
    )
    // The site has to be on screen, or two identical rows are a coin toss.
    expect(found.some((item) => item.detail.includes('Quarry Range'))).toBe(true)
  })
})

describe('where a result goes', () => {
  const items = index({
    systems: [system({ id: 'trestle', name: 'Trestle Core' })],
    acronyms: [{ acr: 'CUAS', meaning: 'Counter-Unmanned Aircraft Systems' }],
    requirements: [
      { orig: 'No shared clock across the sensor field', sys: 'TRESTLE', current: [], status: "Didn't keep" },
    ],
    topologies: [
      topology({
        site_id: 'harbour',
        zones: { quay: { label: 'Quay Edge' } },
        devices: [
          { id: 'quay_switch', label: 'Quay Switch', zone: 'quay', type: 'switch', ip: '172.31.10.5', subnet: null, description: null },
          { id: 'quay_relay', label: 'Quay Relay', zone: 'quay', type: 'server', ip: null, subnet: null, description: null },
        ],
      }),
    ],
  })
  const to = (kind: SearchItem['kind']) =>
    items.find((item) => item.kind === kind)?.to

  it('sends a system to the map focus parameter the map already reads', () => {
    expect(to('system')).toBe('/map?focus=trestle')
  })

  it('sends a device to its own site and focus, which the topology already reads', () => {
    expect(to('device')).toBe('/network?site=harbour&focus=quay_switch')
  })

  it('sends a zone to the devices in it, since focus takes a list', () => {
    expect(to('zone')).toBe('/network?site=harbour&focus=quay_switch,quay_relay')
  })

  it('states the device count a zone will focus, and focuses exactly that many', () => {
    // No number without its evidence: the count on the row is the length of
    // the list in the link, not a separate tally that can drift from it.
    const zone = items.find((item) => item.kind === 'zone')!
    const focused = new URL(zone.to, 'http://x').searchParams.get('focus')!.split(',')
    expect(zone.detail).toContain(String(focused.length))
  })

  it('sends an acronym to the reference section that holds the table', () => {
    expect(to('acronym')).toBe('/reference#acronyms')
  })

  it('sends a requirement to the view that charts it', () => {
    expect(to('requirement')).toBe('/analytics')
  })
})

/**
 * The ranking rule, asserted rather than described. See the comment on
 * scoreItem in search.ts for the tiers themselves.
 */
describe('ranking', () => {
  const systems = [
    system({ id: 'trestle', name: 'Harbour Watch' }), // exact id
    system({ id: 'trestle-relay', name: 'Relay Node' }), // id prefix
    system({ id: 'nk1', name: 'Trestle Mesh' }), // name prefix
    system({ id: 'nk2', name: 'Coastal Trestle Watch' }), // word prefix inside the name
    system({ id: 'nk3', name: 'Subtrestle Bridge' }), // bare substring
    system({ id: 'nk4', name: 'Anchor Post', detail: 'Feeds the trestle pipeline' }), // prose only
  ]

  it('orders exact id, id prefix, name prefix, word prefix, substring, prose', () => {
    expect(labels(search(index({ systems }), 'trestle'))).toEqual([
      'Harbour Watch',
      'Relay Node',
      'Trestle Mesh',
      'Coastal Trestle Watch',
      'Subtrestle Bridge',
      'Anchor Post',
    ])
  })

  it('puts an exact id above an exact name on another row', () => {
    const found = search(
      index({
        systems: [
          system({ id: 'nk5', name: 'Trestle' }),
          system({ id: 'trestle', name: 'Harbour Watch' }),
        ],
      }),
      'trestle',
    )
    expect(labels(found)).toEqual(['Harbour Watch', 'Trestle'])
  })

  it('ignores case and surrounding space', () => {
    expect(labels(search(index({ systems }), '  TRESTLE  '))).toEqual(
      labels(search(index({ systems }), 'trestle')),
    )
  })

  it('breaks a tie the same way every time, shortest label first', () => {
    const found = search(
      index({
        systems: [
          system({ id: 'nk7', name: 'Quay Relay Bridge Node' }),
          system({ id: 'nk6', name: 'Quay Relay' }),
        ],
      }),
      'quay',
    )
    expect(labels(found)).toEqual(['Quay Relay', 'Quay Relay Bridge Node'])
  })

  it('finds a device by its address, below anything matching a name', () => {
    const items = index({
      systems: [system({ id: 'nk8', name: '172.31.10.5 Gateway Record' })],
      topologies: [
        topology({
          site_id: 'harbour',
          zones: { quay: { label: 'Quay Edge' } },
          devices: [
            { id: 'quay_switch', label: 'Quay Switch', zone: 'quay', type: 'switch', ip: '172.31.10.5', subnet: null, description: null },
          ],
        }),
      ],
    })
    expect(labels(search(items, '172.31.10.5'))).toEqual([
      '172.31.10.5 Gateway Record',
      'Quay Switch',
    ])
  })

  it('finds a site, and everything at it, by the name printed on every row', () => {
    // The defect: "which site was that switch at" is the question the palette
    // is for, the site is on every device row, and typing it returned nothing.
    const items = index({
      project: project({
        sites: [
          { id: 'quarry', label: 'Quarry Range', classification: 'UNCLASSIFIED//SAMPLE', device_count: 2, edge_count: 0, updated: '2026-01-01' },
        ],
      }),
      topologies: [
        topology({
          site_id: 'quarry',
          zones: { yard: { label: 'Yard' } },
          devices: [
            { id: 'yard_switch', label: 'Yard Switch', zone: 'yard', type: 'switch', ip: null, subnet: null, description: null },
            { id: 'yard_relay', label: 'Yard Relay', zone: 'yard', type: 'server', ip: null, subnet: null, description: null },
          ],
        }),
      ],
    })
    const found = search(items, 'quarry')
    // The site itself first, then everything the row for it stands over.
    expect(found[0].kind).toBe('site')
    expect(found.filter((item) => item.kind === 'device').map((item) => item.label).sort()).toEqual(
      ['Yard Relay', 'Yard Switch'],
    )
    expect(found.some((item) => item.kind === 'zone')).toBe(true)
    // Site id as well as site label: '/network?site=quarry' is what a reader
    // sees in the address bar.
    expect(search(items, 'Quarry Range')[0].to).toBe('/network?site=quarry')
  })

  it('ranks a device name above a device that only sits at the site named', () => {
    const items = index({
      project: project({
        sites: [
          { id: 'quarry', label: 'Quarry Range', classification: 'UNCLASSIFIED//SAMPLE', device_count: 2, edge_count: 0, updated: '2026-01-01' },
        ],
      }),
      topologies: [
        topology({
          site_id: 'quarry',
          zones: { yard: { label: 'Yard' } },
          devices: [
            { id: 'd1', label: 'Quarry Gate Sensor', zone: 'yard', type: 'sensor', ip: null, subnet: null, description: null },
            { id: 'd2', label: 'Range Laptop', zone: 'yard', type: 'laptop', ip: null, subnet: null, description: null },
          ],
        }),
      ],
    })
    const devices = search(items, 'quarry').filter((item) => item.kind === 'device')
    expect(labels(devices)).toEqual(['Quarry Gate Sensor', 'Range Laptop'])
  })

  it('finds an acronym by its expansion as well as by the acronym', () => {
    const items = index({
      acronyms: [{ acr: 'CUAS', meaning: 'Counter-Unmanned Aircraft Systems' }],
    })
    expect(labels(search(items, 'cuas'))).toEqual(['CUAS'])
    expect(labels(search(items, 'unmanned aircraft'))).toEqual(['CUAS'])
  })

  it('finds a requirement by its sentence and by its baseline system', () => {
    const requirement: Requirement = {
      orig: 'No shared clock across the sensor field',
      sys: 'TRESTLE',
      current: ['Trestle Core'],
      status: 'Condensed',
    }
    const items = index({ requirements: [requirement] })
    expect(search(items, 'shared clock')).toHaveLength(1)
    expect(search(items, 'trestle')).toHaveLength(1)
  })

  it('returns nothing rather than everything when nothing matches', () => {
    expect(search(index({ systems }), 'zzzz')).toEqual([])
  })

  it('offers the views alone until something is typed', () => {
    const found = search(index({ systems }), '')
    expect(labels(found)).toEqual(VIEWS.map((view) => view.label))
  })
})

describe('groupByKind', () => {
  it('groups results and names the kind, so a name that is two things reads', () => {
    const items = index({
      systems: [system({ id: 'trestle', name: 'Trestle Core' })],
      topologies: [
        topology({
          site_id: 'harbour',
          zones: { quay: { label: 'Quay Edge' } },
          devices: [
            { id: 'trestle_sensor', label: 'Trestle Sensor', zone: 'quay', type: 'sensor', ip: null, subnet: null, description: null },
          ],
        }),
      ],
    })
    const groups = groupByKind(search(items, 'trestle'))
    expect(groups.map((group) => group.title)).toEqual(['Systems', 'Devices'])
    expect(groups.flatMap((group) => group.items)).toHaveLength(2)
  })

  it('loses nothing and repeats nothing while regrouping the ranked list', () => {
    const items = index({
      systems: [system({ id: 'quay', name: 'Quay Core' }), system({ id: 'nk9', name: 'Quay Mesh' })],
      topologies: [
        topology({
          site_id: 'harbour',
          zones: { quay: { label: 'Quay Edge' } },
          devices: [
            { id: 'quay_switch', label: 'Quay Switch', zone: 'quay', type: 'switch', ip: null, subnet: null, description: null },
          ],
        }),
      ],
    })
    const ranked = search(items, 'quay')
    const grouped = groupByKind(ranked).flatMap((group) => group.items)
    expect(grouped.map((item) => item.key).sort()).toEqual(
      ranked.map((item) => item.key).sort(),
    )
  })

  it('leads with the group holding the best match, so Enter takes the top hit', () => {
    const items = index({
      systems: [system({ id: 'nk10', name: 'Quay Mesh' })],
      topologies: [
        topology({
          site_id: 'harbour',
          zones: { quay: { label: 'Quay Edge' } },
          devices: [
            { id: 'quay', label: 'Quay Switch', zone: 'quay', type: 'switch', ip: null, subnet: null, description: null },
          ],
        }),
      ],
    })
    const ranked = search(items, 'quay')
    const groups = groupByKind(ranked)
    expect(groups[0].items[0].key).toBe(ranked[0].key)
  })
})
