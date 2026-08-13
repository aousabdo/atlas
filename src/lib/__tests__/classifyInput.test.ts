import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { LocalFileProvider } from '../../data/LocalFileProvider'
import { classifyInput, inspectFile, SLOT_LABEL } from '../classifyInput'

/**
 * Every fixture here is invented.
 *
 * The reference bundle is controlled material in a read-only repo. What this
 * module needs from it is the SHAPE of each file, which keys exist, and a key
 * name is not content. So the tests carry key names and nothing else: no
 * device, no site, no phrase, no marking from the real data appears below.
 */

function shape(json: unknown, name = 'fixture.json') {
  return { name, json }
}

function jsonFile(value: unknown, name: string): File {
  return new File([JSON.stringify(value)], name, { type: 'application/json' })
}

/** A workbook written here, because the reference one is controlled material. */
function fixtureWorkbook(name = 'fixture-book.xlsx'): File {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['Project/System', 'Owner Organization'],
      ['Fixture Widget One', 'Fixture Org'],
    ]),
    'Matrix',
  )
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['original', 'system', 'current', 'status'],
      ['Fixture original one', 'Fixture Widget One', 'Fixture Widget One', 'Kept'],
    ]),
    'original_to_current_crosswalk',
  )
  return new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], name)
}

/**
 * A File that claims a size it does not have.
 *
 * Allocating 60 MB to prove the cap is enforced would make the suite slow for
 * no extra confidence: the cap reads file.size, so overriding file.size is the
 * whole of the input. The bytes underneath stay a real workbook, which is what
 * makes the test fail when the cap is skipped.
 */
function claimingSize(file: File, size: number): File {
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('classifying a workbook', () => {
  it('places the one with a Matrix sheet, and says that is why', () => {
    const result = classifyInput({
      name: 'fixture-book.xlsx',
      sheets: ['Matrix', 'summary', 'original_to_current_crosswalk'],
    })
    expect(result.kind).toBe('matrix')
    expect(result.confidence).toBe('certain')
    expect(result.reason).toMatch(/matrix sheet/i)
  })

  it('is unsure about a workbook with no Matrix sheet, rather than silent', () => {
    // Still the matrix slot: nothing else in the set is a workbook, and the
    // parser's own error is more use to the analyst than being told to choose
    // a file they already chose.
    const result = classifyInput({ name: 'fixture-book.xlsx', sheets: ['Sheet1'] })
    expect(result.kind).toBe('matrix')
    expect(result.confidence).not.toBe('certain')
    expect(result.reason).toMatch(/no sheet named matrix/i)
  })

  it('keeps an unopenable workbook in the matrix slot so the parser can say why', () => {
    const result = classifyInput({ name: 'fixture-book.xlsx', unreadable: true })
    expect(result.kind).toBe('matrix')
    expect(result.confidence).toBe('unsure')
    expect(result.reason).toMatch(/would not open/i)
  })
})

describe('classifying the JSON files', () => {
  it('knows the glossary by its acronyms array', () => {
    const result = classifyInput(shape({ acronyms: [], out_of_scope: [] }))
    expect(result.kind).toBe('glossary')
    expect(result.confidence).toBe('certain')
    expect(result.reason).toMatch(/acronyms array/i)
  })

  it('knows the system to device map by sites with mappings inside', () => {
    const result = classifyInput(
      shape({
        default_site: 'fixture_one',
        sites: { fixture_one: { label: '', mappings: {}, unclaimed_devices: {} } },
      }),
    )
    expect(result.kind).toBe('systemDeviceMap')
    expect(result.confidence).toBe('certain')
    expect(result.reason).toMatch(/keyed by site/i)
    expect(result.reason).toMatch(/mappings/i)
  })

  it('is less sure about sites that carry no mappings at all', () => {
    const result = classifyInput(shape({ sites: { fixture_one: { label: '' } } }))
    expect(result.kind).toBe('systemDeviceMap')
    expect(result.confidence).toBe('likely')
  })

  it('knows a site topology by nodes, edges and a graph block', () => {
    const result = classifyInput(
      shape({ graph: { name: '' }, zones: {}, nodes: [], edges: [] }),
    )
    expect(result.kind).toBe('topology')
    expect(result.confidence).toBe('certain')
    expect(result.reason).toMatch(/nodes and edges/i)
    expect(result.reason).toMatch(/graph block/i)
  })

  it('refuses a node list keyed devices, and says which spelling loads', () => {
    // It used to take this as a spelling of nodes. It is not one: see the
    // agreement test below, which drives the loader rather than restating it.
    const result = classifyInput(shape({ graph: {}, devices: [], edges: [] }))
    expect(result.kind).toBeNull()
    expect(result.reason).toMatch(/devices and edges/i)
    expect(result.reason).toMatch(/nodes/)
  })

  it('still places a topology with no graph block, and says the block is missing', () => {
    const result = classifyInput(shape({ nodes: [], edges: [] }))
    expect(result.kind).toBe('topology')
    expect(result.confidence).toBe('likely')
    expect(result.reason).toMatch(/no graph block/i)
  })

  it('knows the overrides by its curation keys, and names the ones it found', () => {
    const result = classifyInput(shape({ cross_links: [], suppress_links: [] }))
    expect(result.kind).toBe('overrides')
    expect(result.confidence).toBe('certain')
    expect(result.reason).toMatch(/cross_links/)
    expect(result.reason).toMatch(/suppress_links/)
  })

  it('takes a single curation key, less surely', () => {
    const result = classifyInput(shape({ risk_overrides: {} }))
    expect(result.kind).toBe('overrides')
    expect(result.confidence).toBe('likely')
  })
})

describe('what it refuses to guess', () => {
  it('places nothing when no key is one it knows', () => {
    const result = classifyInput(shape({ title: '', rows: [] }, 'fixture-notes.json'))
    expect(result.kind).toBeNull()
    expect(result.reason).toMatch(/no key/i)
  })

  it('places nothing for a JSON array, whatever it is a list of', () => {
    expect(classifyInput(shape([{ id: '' }])).kind).toBeNull()
  })

  it('says a file would not parse rather than pretending it is empty', () => {
    const result = classifyInput({ name: 'fixture-broken.json', unreadable: true })
    expect(result.kind).toBeNull()
    expect(result.reason).toMatch(/not.*read as json/i)
  })

  it('places nothing for a file that is neither a workbook nor JSON', () => {
    const result = classifyInput({ name: 'fixture-notes.txt' })
    expect(result.kind).toBeNull()
    expect(result.reason).toMatch(/neither a workbook nor json/i)
  })
})

describe('it reads keys, never values', () => {
  it('classifies an empty glossary exactly as it classifies a full one', () => {
    const empty = classifyInput(shape({ acronyms: [] }))
    const full = classifyInput(shape({ acronyms: [{ abbr: 'XX', full: 'Fixture Thing' }] }))
    expect(full).toEqual(empty)
  })

  it('classifies a topology whose contents are meaningless', () => {
    const result = classifyInput(shape({ graph: {}, nodes: [1, 2, 3], edges: ['nonsense'] }))
    expect(result.kind).toBe('topology')
  })
})

describe('the stated order, when a file carries two markers', () => {
  it('reads a graph plus nodes and edges as a topology before anything else', () => {
    // Topology is the most specific test in the set, three keys rather than
    // one, so it is tried first and a file carrying a stray acronyms array
    // alongside a real topology still loads as a topology.
    const result = classifyInput(shape({ graph: {}, nodes: [], edges: [], acronyms: [] }))
    expect(result.kind).toBe('topology')
  })

  it('prefers sites with mappings to a bare curation key', () => {
    const result = classifyInput(
      shape({ sites: { a: { mappings: {} } }, node_order: {} }),
    )
    expect(result.kind).toBe('systemDeviceMap')
  })
})

describe('reading a real File into a shape', () => {
  it('reads a workbook down to its sheet names', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['a']]), 'Matrix')
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const found = await inspectFile(new File([bytes], 'fixture-book.xlsx'))
    expect(found.sheets).toContain('Matrix')
    expect(classifyInput(found).kind).toBe('matrix')
  })

  it('parses a JSON file', async () => {
    const file = new File([JSON.stringify({ acronyms: [] })], 'fixture-glossary.json')
    expect(classifyInput(await inspectFile(file)).kind).toBe('glossary')
  })

  it('marks a JSON file that will not parse as unreadable', async () => {
    const found = await inspectFile(new File(['{oops'], 'fixture-broken.json'))
    expect(found.unreadable).toBe(true)
    expect(classifyInput(found).kind).toBeNull()
  })

  it('does not try to read a file that is neither', async () => {
    const found = await inspectFile(new File(['hello'], 'fixture-notes.txt'))
    expect(found.unreadable).toBeFalsy()
    expect(found.json).toBeUndefined()
    expect(found.sheets).toBeUndefined()
  })
})

describe('the classifier and the loader agree on how a topology is keyed', () => {
  it('places the spelling the loader reads, and refuses the one it does not', async () => {
    // Drives the real loader rather than restating its rule. The defect was a
    // confident wrong answer: a file keyed devices was placed as a Site
    // topology at CERTAIN, loaded with no error, and the tab then reported no
    // devices recorded for the site. Whichever side moves, one of these
    // assertions fails and the two have to be brought back into line.
    const zones = { zone_a: { label: 'Zone A' } }
    const device = { id: 'dev_one', label: 'Device one', zone: 'zone_a', type: 'server' }
    const keyedNodes = { graph: {}, zones, nodes: [device], edges: [] }
    const keyedDevices = { graph: {}, zones, devices: [device], edges: [] }

    const provider = new LocalFileProvider()
    await provider.load({
      matrix: fixtureWorkbook(),
      topologies: {
        keyed_nodes: jsonFile(keyedNodes, 'fixture-one.json'),
        keyed_devices: jsonFile(keyedDevices, 'fixture-two.json'),
      },
    })
    expect((await provider.getTopology('keyed_nodes')).devices).toHaveLength(1)
    // The whole defect in one assertion: this file loads, and loads empty.
    expect((await provider.getTopology('keyed_devices')).devices).toHaveLength(0)

    expect(classifyInput(shape(keyedNodes)).kind).toBe('topology')
    expect(classifyInput(shape(keyedDevices)).kind).toBeNull()
  })
})

describe('a workbook is opened through the upload hardening, or not at all', () => {
  it('refuses an HTML document named .xlsx instead of parsing it as a sheet', async () => {
    // SheetJS has an HTML reader, so this used to open, sort as the matrix and
    // read as an ordinary workbook. The generated network graphs are stored
    // XSS by construction, which is exactly why HTML is refused outright.
    const html = '<html><body><table><tr><td>Fixture</td></tr></table></body></html>'
    const found = await inspectFile(new File([html], 'fixture-page.xlsx'))

    expect(found.sheets).toBeUndefined()
    expect(found.unreadable).toBe(true)
    expect(found.refusal).toMatch(/zip signature/i)
    expect(classifyInput(found).confidence).toBe('unsure')
    expect(classifyInput(found).reason).toMatch(/zip signature/i)
  })

  it('refuses a workbook past the size cap before a byte reaches the parser', async () => {
    // Real bytes underneath, so nothing but the cap can refuse it.
    const found = await inspectFile(claimingSize(fixtureWorkbook(), 60 * 1024 * 1024))

    expect(found.sheets).toBeUndefined()
    expect(found.unreadable).toBe(true)
    expect(found.refusal).toMatch(/too large/i)
    expect(classifyInput(found).reason).toMatch(/too large/i)
  })

  it('still opens a workbook that passes the gate', async () => {
    const found = await inspectFile(fixtureWorkbook())
    expect(found.sheets).toContain('Matrix')
    expect(found.refusal).toBeUndefined()
    expect(classifyInput(found).confidence).toBe('certain')
  })

  it('quotes the refusal rather than shrugging at every workbook alike', async () => {
    const broken = await inspectFile(new File(['not a spreadsheet'], 'fixture-broken.xlsx'))
    const oversize = await inspectFile(claimingSize(fixtureWorkbook(), 60 * 1024 * 1024))
    expect(classifyInput(broken).reason).not.toBe(classifyInput(oversize).reason)
    // The file name is already the row's first column, so it is not repeated.
    expect(classifyInput(broken).reason).not.toMatch(/fixture-broken\.xlsx/)
  })
})

describe('the labels the panel shows', () => {
  it('names every slot a file can be sorted into', () => {
    expect(Object.keys(SLOT_LABEL).sort()).toEqual(
      ['glossary', 'matrix', 'overrides', 'systemDeviceMap', 'topology'].sort(),
    )
    for (const label of Object.values(SLOT_LABEL)) expect(label).not.toBe('')
  })
})
