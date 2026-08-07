/**
 * Zone identity: the colour and the short name each zone is drawn with.
 *
 * The zone is the primary structure a reader navigates this topology by, so
 * every zone-derived element on the canvas (hull fill, hull stroke, hull
 * label, node stroke, node glyph, minimap dot, sidebar dot) reads the colour
 * from here. The site bundles carry a long label and no short one, and the
 * canvas has room for "FIELD HOUSE", not "Field House Distribution".
 */

/** Zone id to design token. Ids use underscores; the tokens use hyphens. */
const ZONE_TOKEN: Record<string, string> = {
  cloud: '--zone-cloud',
  wan: '--zone-wan',
  core: '--zone-core',
  field_house: '--zone-field-house',
  south_stand: '--zone-south-stand',
  annex_closet: '--zone-annex-closet',
  mgmt: '--zone-mgmt',
  sensor_net: '--zone-sensor-net',
  radio_net: '--zone-radio-net',
  ops_net: '--zone-ops-net',
  guest_net: '--zone-guest-net',
  mobile_unit: '--zone-mobile-unit',
  north_stand: '--zone-north-stand',
  perimeter: '--zone-perimeter',
}

/** The same fourteen tokens as a ring, for zones no site has named yet. */
const RING = Object.values(ZONE_TOKEN)

/**
 * A zone's colour, as a token reference.
 *
 * `order` is the site's zone list, which gives an unnamed zone (Westfield
 * has one) a stable colour rather than one that shuffles between renders.
 */
export function zoneColor(zoneId: string, order: readonly string[] = []): string {
  const named = ZONE_TOKEN[zoneId]
  if (named) return `var(${named})`
  const index = order.indexOf(zoneId)
  return `var(${RING[(index < 0 ? 0 : index) % RING.length]})`
}

const ZONE_SHORT: Record<string, string> = {
  cloud: 'CLOUD',
  wan: 'WAN',
  core: 'CORE',
  field_house: 'FIELD HOUSE',
  south_stand: 'SOUTH STAND',
  annex_closet: 'ANNEX',
  mgmt: 'MGMT',
  sensor_net: 'SENSOR',
  radio_net: 'RADIO',
  ops_net: 'OPS',
  guest_net: 'GUEST',
  mobile_unit: 'MOBILE',
  north_stand: 'NORTH STAND',
  perimeter: 'PERIMETER',
}

/** Short name for a hull label. Falls back to the id, which is already terse. */
export function zoneShort(zoneId: string): string {
  return ZONE_SHORT[zoneId] ?? zoneId.replace(/_/g, ' ').toUpperCase()
}

/**
 * Glyph drawn inside a device marker, carried from the original graph.
 *
 * Shape already carries the type; the glyph is what makes a node read as a
 * piece of equipment rather than a dot. Deliberately monochrome: a colour
 * emoji ignores the fill and would break the zone-colour encoding.
 */
const TYPE_GLYPH: Record<string, string> = {
  server: '▤',
  cloud: '☁',
  backbone: '═',
  router: '⊞',
  switch: '⊟',
  firewall: '⊘',
  sensor: '◉',
  radio: '◌',
  access_point: '≈',
  application: '▣',
  endpoint: '▯',
  vlan: '◇',
  gateway: '⊞',
  satellite_terminal: '◌',
}

export function typeGlyph(type: string): string {
  return TYPE_GLYPH[type] ?? '•'
}
