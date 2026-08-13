import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'

import App from '../../App'
import { LocalFileProvider, type LocalFileInputs } from '../../data/LocalFileProvider'
import { StaticProvider } from '../../data/StaticProvider'
import { resolveSiteId } from '../../lib/siteId'
import {
  OVERRIDES_MARKERS, sampleTemplates, TemplateDownloads,
} from '../TemplateDownloads'

/**
 * The CLI that writes the same sample inputs for the contract suite, run as it
 * ships rather than imported. It reads and writes the filesystem at module
 * scope, so it has no types here and no place in a browser bundle; running it
 * is both the honest way to compare against it and a check that it still runs.
 */
function writeSampleInputs(directory: string): string {
  execFileSync(process.execPath, ['scripts/make-sample-workbook.mjs', directory], {
    cwd: process.cwd(),
    stdio: 'pipe',
  })
  return directory
}

/**
 * Which inputs the loader takes, and which of them it can do without.
 *
 * Typed as a total map over LocalFileInputs, so adding, renaming or removing an
 * input slot fails to compile here until this table is updated, and the doc
 * test below then fails until docs/data-inputs.md is updated too. That is the
 * whole point: the doc is the only description of these files anybody reads,
 * and a description nothing checks is wrong within a month.
 */
const REQUIRED_BY_CODE: Record<keyof LocalFileInputs, boolean> = {
  matrix: true,
  overrides: false,
  glossary: false,
  systemDeviceMap: false,
  topologies: false,
}

const DOC = join(process.cwd(), 'docs', 'data-inputs.md')

/**
 * The doc's own summary table, read as data.
 *
 * Row shape: | anything | `key` | required or optional | ... | what breaks |
 */
function docRows(): Array<{ key: string; required: boolean; breaks: string }> {
  const text = readFileSync(DOC, 'utf-8')
  const rows: Array<{ key: string; required: boolean; breaks: string }> = []
  for (const line of text.split('\n')) {
    const match = /^\|[^|]+\|\s*`(\w+)`\s*\|\s*(required|optional)\s*\|(.*)\|\s*$/.exec(
      line,
    )
    if (!match) continue
    const cells = match[3].split('|')
    rows.push({
      key: match[1],
      required: match[2] === 'required',
      breaks: (cells[cells.length - 1] ?? '').trim(),
    })
  }
  return rows
}

const sampleProvider = () => new StaticProvider('/data')

async function templateFiles(): Promise<Map<string, File>> {
  const templates = await sampleTemplates(sampleProvider())
  const files = new Map<string, File>()
  for (const template of templates) {
    files.set(template.name, new File([await template.build()], template.name))
  }
  return files
}

/** Every template, arranged the way LocalFileProvider takes them. */
async function templateInputs(): Promise<LocalFileInputs> {
  const templates = await sampleTemplates(sampleProvider())
  const inputs: Partial<LocalFileInputs> & { topologies: Record<string, File> } = {
    topologies: {},
  }
  for (const template of templates) {
    const file = new File([await template.build()], template.name)
    if (template.slot === 'topologies') inputs.topologies[template.siteId ?? ''] = file
    else inputs[template.slot] = file as never
  }
  return inputs as LocalFileInputs
}

describe('the sample templates', () => {
  it('covers every input the loader takes', async () => {
    const templates = await sampleTemplates(sampleProvider())
    expect([...new Set(templates.map((t) => t.slot))].sort()).toEqual(
      Object.keys(REQUIRED_BY_CODE).sort(),
    )
  })

  it('names every file so a reader cannot mistake it for their own data', async () => {
    const templates = await sampleTemplates(sampleProvider())
    for (const template of templates) {
      expect(template.name).toMatch(/^atlas-sample-/)
    }
  })

  /**
   * A name is not a marking, because a name survives exactly one rename.
   *
   * atlas-sample-overrides.json used to be the exception here: its three
   * curation keys were the whole file, so nothing inside it said what it was,
   * and a copy that reached somebody as an attachment or under a new name was
   * indistinguishable from a real curator's overrides. Every other template
   * already carried its own evidence, so this asserts the rule rather than
   * patching the one file that broke it.
   *
   * The places checked are the ones a reader would actually open the file and
   * look at. The values are read out of the templates, never written here: the
   * repo may not carry a marking string even as a test constant.
   */
  it('says inside every JSON template that it is the sample', async () => {
    const templates = (await sampleTemplates(sampleProvider())).filter((t) =>
      t.name.endsWith('.json'),
    )
    expect(templates.length).toBeGreaterThan(3)

    for (const template of templates) {
      const raw = JSON.parse(await (await template.build()).text())
      const signals = [
        raw._comment, raw._version, raw.graph?.classification, raw.graph?.name,
      ]
      expect(
        signals.filter((s: unknown) => typeof s === 'string').join(' ').toLowerCase(),
        `${template.name} says nothing inside itself about being the sample`,
      ).toMatch(/sample/)
    }
  })

  /**
   * A topology template must not make the reader's first load turn on a guess.
   *
   * The site id is the join key into the system to device map, and getting it
   * wrong is the one failure that reports itself as a finding rather than as an
   * error. The templates therefore state it, and the panel's resolver has to
   * agree that it did.
   */
  it('states a site id the load panel resolves without guessing', async () => {
    const sites = (await sampleTemplates(sampleProvider())).filter(
      (t) => t.slot === 'topologies',
    )
    expect(sites.length).toBeGreaterThan(0)
    for (const template of sites) {
      const raw = JSON.parse(await (await template.build()).text())
      const resolved = resolveSiteId(raw, template.name)
      expect(resolved.id).toBe(template.siteId)
      expect(resolved.source).toBe('declared')
    }
  })

  /**
   * The point of a template: it has to be a file the loader actually accepts.
   * A shape that only looks right is worse than no template at all.
   */
  it('loads back through the local file provider', async () => {
    const provider = new LocalFileProvider()
    await provider.load(await templateInputs())

    const sample = sampleProvider()
    expect((await provider.getSystems()).length).toBe((await sample.getSystems()).length)
    expect((await provider.getLinks()).current.length).toBe(
      (await sample.getLinks()).current.length,
    )
    expect((await provider.getLinks()).desired.length).toBe(
      (await sample.getLinks()).desired.length,
    )
    expect((await provider.getGlossary()).acronyms.length).toBe(
      (await sample.getGlossary()).acronyms.length,
    )
    const coverage = await provider.getCoverage()
    expect(Object.keys(coverage.sites).sort()).toEqual(
      Object.keys((await sample.getCoverage()).sites).sort(),
    )
    expect((await provider.getProject()).sites.length).toBe(
      (await sample.getProject()).sites.length,
    )
  })

  /**
   * Two writers of the same files, pinned to each other.
   *
   * scripts/make-sample-workbook.mjs writes these for the contract suite and
   * cannot run in a browser; the component writes them in one. Either could be
   * edited alone, and then the file a reader downloads would stop being the
   * file the suite proves parseable. Comparing them is what makes that a red
   * test rather than a discovery months later.
   */
  it('matches what the sample workbook generator writes', async () => {
    const directory = writeSampleInputs(
      mkdtempSync(join(tmpdir(), 'atlas-template-check-')),
    )
    const onDisk = (...parts: string[]) =>
      JSON.parse(readFileSync(join(directory, ...parts), 'utf-8'))

    const files = await templateFiles()
    const parsed = async (name: string) =>
      JSON.parse(await (files.get(name) as File).text())

    // The overrides file is the second deliberate addition, alongside site_id
    // below. The CLI writes into a directory for the contract suite, which
    // never sees the file away from its path; a reader downloads one and
    // renames it. Everything outside the two marker keys must be identical.
    const overrides = await parsed('atlas-sample-overrides.json')
    expect(overrides._comment).toBe(OVERRIDES_MARKERS._comment)
    expect(overrides._version).toBe(OVERRIDES_MARKERS._version)
    delete overrides._comment
    delete overrides._version
    expect(overrides).toEqual(onDisk('overrides.json'))

    expect(await parsed('atlas-sample-glossary.json')).toEqual(onDisk('glossary.json'))
    expect(await parsed('atlas-sample-system-device-map.json')).toEqual(
      onDisk('system_device_map.json'),
    )

    for (const site of ['northgate', 'westfield']) {
      const template = await parsed(`atlas-sample-site-${site}.json`)
      // The one deliberate addition: the CLI omits site_id because a real
      // export carries none, and a template is worth more when it states the
      // join key outright. Everything else must be identical.
      expect(template.site_id).toBe(site)
      delete template.site_id
      expect(template).toEqual(onDisk('sites', `${site}.json`))
    }

    const sheetsOf = (book: XLSX.WorkBook) =>
      Object.fromEntries(
        book.SheetNames.map((name) => [
          name,
          XLSX.utils.sheet_to_json(book.Sheets[name], {
            header: 1,
            defval: null,
            blankrows: true,
          }),
        ]),
      )
    const fromCli = XLSX.read(readFileSync(join(directory, 'matrix.xlsx')), {
      type: 'buffer',
    })
    const fromBrowser = XLSX.read(
      await (files.get('atlas-sample-matrix.xlsx') as File).arrayBuffer(),
      { type: 'array' },
    )
    expect(fromBrowser.SheetNames).toEqual(fromCli.SheetNames)
    expect(sheetsOf(fromBrowser)).toEqual(sheetsOf(fromCli))
  })
})

describe('docs/data-inputs.md', () => {
  it('lists exactly the inputs the loader accepts, with the same required-ness', () => {
    const rows = docRows()
    expect(rows.length).toBeGreaterThan(0)
    expect(
      Object.fromEntries(rows.map((r) => [r.key, r.required])),
    ).toEqual(REQUIRED_BY_CODE)
  })

  it('says what breaks without each input', () => {
    for (const row of docRows()) {
      expect(row.breaks.length, `${row.key} has no consequence stated`).toBeGreaterThan(20)
    }
  })

  /**
   * The doc's claim about required-ness, put to the loader itself.
   *
   * A table saying "optional" is a promise that a load without that file
   * succeeds. Reading it off the type would only prove the type says so.
   */
  it('is right about which inputs may be left out', async () => {
    const inputs = await templateInputs()

    for (const row of docRows().filter((r) => !r.required)) {
      const without = { ...inputs }
      delete without[row.key as keyof LocalFileInputs]
      await expect(
        new LocalFileProvider().load(without),
        `${row.key} is documented as optional`,
      ).resolves.toBeUndefined()
    }

    for (const row of docRows().filter((r) => r.required)) {
      const without = { ...inputs }
      delete without[row.key as keyof LocalFileInputs]
      await expect(
        new LocalFileProvider().load(without),
        `${row.key} is documented as required`,
      ).rejects.toThrow()
    }
  })
})

describe('TemplateDownloads', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:sample-template')
  const revokeObjectURL = vi.fn()
  let clicked: Array<{ name: string; blob: Blob }> = []

  beforeEach(() => {
    clicked = []
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    const urls = new Map<string, Blob>()
    createObjectURL.mockImplementation((blob: Blob) => {
      const url = `blob:sample-template-${urls.size}`
      urls.set(url, blob)
      return url
    })
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      clicked.push({ name: this.download, blob: urls.get(this.href) as Blob })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (URL as Partial<typeof URL>).createObjectURL
    delete (URL as Partial<typeof URL>).revokeObjectURL
  })

  it('says the files are the sample rather than the loaded data', async () => {
    render(<TemplateDownloads provider={sampleProvider()} />)
    expect(
      await screen.findByText(/synthetic sample/i),
    ).toBeInTheDocument()
  })

  it('offers one download per template', async () => {
    render(<TemplateDownloads provider={sampleProvider()} />)
    const buttons = await screen.findAllByRole('button')
    const names = buttons.map((b) => b.textContent)
    expect(names.some((n) => n?.includes('atlas-sample-matrix.xlsx'))).toBe(true)
    expect(names.some((n) => n?.includes('atlas-sample-overrides.json'))).toBe(true)
    expect(names.some((n) => n?.includes('atlas-sample-glossary.json'))).toBe(true)
    expect(names.some((n) => n?.includes('atlas-sample-system-device-map.json'))).toBe(
      true,
    )
    expect(names.some((n) => n?.includes('atlas-sample-site-northgate.json'))).toBe(true)
  })

  it('downloads the file under its sample name and releases the object url', async () => {
    const user = userEvent.setup()
    render(<TemplateDownloads provider={sampleProvider()} />)

    const button = await screen.findByRole('button', {
      name: /atlas-sample-glossary\.json/,
    })
    await user.click(button)

    await waitFor(() => expect(clicked.length).toBe(1))
    expect(clicked[0].name).toBe('atlas-sample-glossary.json')
    const text = await clicked[0].blob.text()
    expect(JSON.parse(text).acronyms.length).toBeGreaterThan(0)
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(1))
  })

  it('reports a failure rather than doing nothing', async () => {
    const user = userEvent.setup()
    const broken = new StaticProvider('/data')
    render(<TemplateDownloads provider={broken} />)
    const button = await screen.findByRole('button', {
      name: /atlas-sample-glossary\.json/,
    })
    vi.spyOn(broken, 'getGlossary').mockRejectedValue(new Error('bundle unreachable'))
    await user.click(button)
    // A failed sample download is a status, not an alert: the load panel's
// alert channel belongs to the analyst's own data.
expect(await screen.findByRole('status')).toHaveTextContent(/bundle unreachable/)
  })

  /**
   * A background failure must not take the panel's alert region.
   *
   * This control lives inside the load panel, which already owns one alert for
   * the failures that stop a load. When the sample bundle could not be listed,
   * this used to raise a second alert, and a reader whose own load had just
   * been refused then had two alerts on screen, one of them about a file they
   * never asked for. Nothing they can do is blocked by it, so it is a status.
   */
  it('reports an unreadable bundle without seizing the panel alert region', async () => {
    const broken = new StaticProvider('/data')
    vi.spyOn(broken, 'getProject').mockRejectedValue(new Error('bundle unreachable'))
    render(<TemplateDownloads provider={broken} />)

    const notice = await screen.findByText(/bundle unreachable/)
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent(/loading your own files is unaffected/i)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

/**
 * Reachability, which is a different question from whether the component works.
 *
 * Every test above this point mounts TemplateDownloads directly, and every one
 * of them passed for as long as the component was rendered nowhere at all: 340
 * lines of tested code and no route to it. A test that mounts a component
 * cannot tell you anybody can get to it, so these two start where a reader
 * starts, at the button in the header, and never name the component.
 *
 * This is the second time the same failure has been found in this panel. The
 * first was LocalFileProvider, complete and tested and wired to nothing.
 */
describe('reaching the sample files the way a reader does', () => {
  const clicked: Array<{ name: string; blob: Blob }> = []

  beforeEach(() => {
    clicked.length = 0
    const urls = new Map<string, Blob>()
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        const url = `blob:panel-template-${urls.size}`
        urls.set(url, blob)
        return url
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      clicked.push({ name: this.download, blob: urls.get(this.href) as Blob })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (URL as Partial<typeof URL>).createObjectURL
    delete (URL as Partial<typeof URL>).revokeObjectURL
  })

  async function openLoadPanel() {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/reference']}>
        <App />
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: /load data/i }))
    const dialog = await screen.findByRole('dialog', { name: /load your own data/i })
    return { user, dialog }
  }

  it('offers a template for every input inside the panel itself', async () => {
    const { dialog } = await openLoadPanel()

    expect(within(dialog).getByText(/sample files to start from/i)).toBeInTheDocument()
    for (const name of [
      'atlas-sample-matrix.xlsx',
      'atlas-sample-overrides.json',
      'atlas-sample-glossary.json',
      'atlas-sample-system-device-map.json',
      'atlas-sample-site-northgate.json',
    ]) {
      expect(
        await within(dialog).findByRole('button', {
          name: new RegExp(name.replace(/\./g, '\\.')),
        }),
        `${name} is not offered anywhere in the load panel`,
      ).toBeInTheDocument()
    }
  })

  it('hands over a working file when one of them is clicked in the panel', async () => {
    const { user, dialog } = await openLoadPanel()

    await user.click(
      await within(dialog).findByRole('button', { name: /atlas-sample-matrix\.xlsx/ }),
    )
    await waitFor(() => expect(clicked.length).toBe(1))
    expect(clicked[0].name).toBe('atlas-sample-matrix.xlsx')

    // Not merely that a blob arrived: that what arrived is the workbook the
    // loader on the other side of this same panel would accept.
    const book = XLSX.read(await clicked[0].blob.arrayBuffer(), { type: 'array' })
    expect(book.SheetNames).toContain('Matrix')
  })
})

// ---------------------------------------------------------------------------
// The documented failure messages, against the strings the code can build
// ---------------------------------------------------------------------------

/**
 * Where a load can refuse: every file that builds a message a reader will see.
 *
 * AtlasDataError is deliberately absent. Those are read-time errors raised by a
 * provider that has already loaded, not load failures, and the doc section this
 * checks is about the load.
 */
const FAILURE_SOURCES = [
  join('src', 'data', 'localFileParse.ts'),
  join('src', 'data', 'LocalFileProvider.ts'),
  join('src', 'components', 'LoadDataPanel.tsx'),
]

/**
 * The call sites that build one.
 *
 * conflictMessage is neither thrown nor passed to setError: it is computed and
 * rendered into the same alert region as the rest, which makes it exactly as
 * visible to a reader and exactly as easy to leave undocumented.
 */
const FAILURE_ANCHORS = [
  /new LocalFileError\(/g,
  /setError\(/g,
  /const conflictMessage = useMemo\(/g,
]

/** Stands where the code interpolates a value. Never occurs in real source. */
const WILDCARD = '\u0001'

/** Past a quoted run, returning the index after the closing quote. */
function skipQuoted(source: string, at: number, quote: string): number {
  let i = at + 1
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }
    if (source[i] === quote) return i + 1
    i += 1
  }
  return i
}

/** Past a `${...}` gap, returning the index after its closing brace. */
function skipInterpolation(source: string, at: number): number {
  let depth = 0
  let i = at
  while (i < source.length) {
    const c = source[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipQuoted(source, i, c)
      continue
    }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return i
}

/** The literal text of a template, with each gap collapsed to a wildcard. */
function readTemplate(source: string, at: number): [string, number] {
  let out = ''
  let i = at + 1
  while (i < source.length) {
    if (source[i] === '\\') {
      out += source[i + 1] ?? ''
      i += 2
      continue
    }
    if (source[i] === '`') return [out, i + 1]
    if (source[i] === '$' && source[i + 1] === '{') {
      out += WILDCARD
      i = skipInterpolation(source, i + 1)
      continue
    }
    out += source[i]
    i += 1
  }
  return [out, i]
}

function readQuoted(source: string, at: number, quote: string): [string, number] {
  let out = ''
  let i = at + 1
  while (i < source.length) {
    if (source[i] === '\\') {
      out += source[i + 1] === 'n' ? '\n' : (source[i + 1] ?? '')
      i += 2
      continue
    }
    if (source[i] === quote) return [out, i + 1]
    out += source[i]
    i += 1
  }
  return [out, i]
}

/**
 * Every literal a call builds, concatenated in source order.
 *
 * The concatenation is the point: several of these messages are split across
 * two template literals to fit a line, and they are one sentence to a reader,
 * so they have to be one string here. `at` is the call's opening paren.
 */
function messageShape(source: string, at: number): string {
  let depth = 0
  let out = ''
  let i = at
  while (i < source.length) {
    const c = source[i]
    if (c === "'" || c === '"') {
      const [text, next] = readQuoted(source, i, c)
      out += text
      i = next
      continue
    }
    if (c === '`') {
      const [text, next] = readTemplate(source, i)
      out += text
      i = next
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      if (end === -1) break
      i = end
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i) + 2
      continue
    }
    if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) return out
    }
    i += 1
  }
  return out
}

/** Wildcards dropped and whitespace collapsed, so both sides compare alike. */
function normalise(text: string): string {
  return text.split(WILDCARD).join('').replace(/\s+/g, ' ')
}

function codeMessages(): Array<{ file: string; shape: string }> {
  const out: Array<{ file: string; shape: string }> = []
  for (const file of FAILURE_SOURCES) {
    const source = readFileSync(join(process.cwd(), file), 'utf-8')
    for (const anchor of FAILURE_ANCHORS) {
      for (const match of source.matchAll(anchor)) {
        const shape = normalise(
          messageShape(source, (match.index ?? 0) + match[0].length - 1),
        )
        // setError(null) and setError(messageOf(cause)) build no literal at
        // all. The second one repeats the parser's own message, which these
        // tables already cover; neither is wording anybody could document.
        if (shape.trim()) out.push({ file, shape })
      }
    }
  }
  return out
}

/** The message column of every table under "When a load fails". */
function documentedMessages(): string[] {
  const text = readFileSync(DOC, 'utf-8')
  const at = text.indexOf('\n## When a load fails')
  expect(at, 'docs/data-inputs.md has no "When a load fails" section').toBeGreaterThan(0)
  const rows: string[] = []
  for (const line of text.slice(at).split('\n')) {
    const match = /^\|\s*`(.+?)`\s*\|\s*(.+?)\s*\|$/.exec(line)
    if (match) rows.push(match[1])
  }
  return rows
}

/**
 * Does a documented row describe this code shape?
 *
 * The doc writes `...` wherever the code interpolates a value, so the test is
 * that the row's literal fragments appear, in order, inside the code's. The
 * previous version of this suite compared slot names only, which is why five
 * wrong claims and a whole missing message survived in the page.
 */
function describes(documented: string, shape: string): boolean {
  const fragments = documented
    .split('...')
    .map((f) => f.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (!fragments.length) return false
  let at = 0
  for (const fragment of fragments) {
    const found = shape.indexOf(fragment, at)
    if (found === -1) return false
    at = found + fragment.length
  }
  return true
}

describe('the failure messages docs/data-inputs.md documents', () => {
  /**
   * The extractor itself, checked before anything is concluded from it.
   *
   * An anchor that quietly stopped matching would turn both directions below
   * green while proving nothing, which is the same shape of failure as a
   * finished feature nobody renders.
   */
  it('finds a message in every file that can refuse a load', () => {
    const found = codeMessages()
    expect(found.length).toBeGreaterThanOrEqual(17)
    for (const file of FAILURE_SOURCES) {
      expect(
        found.filter((m) => m.file === file).length,
        `no failure message was extracted from ${file}`,
      ).toBeGreaterThan(0)
    }
    // The one built by rendering rather than by throwing or by setError.
    expect(found.some((m) => m.shape.includes('More than one file claims'))).toBe(true)
  })

  it('documents every message the loader and the panel can build', () => {
    const documented = documentedMessages()
    for (const { file, shape } of codeMessages()) {
      expect(
        documented.some((row) => describes(row, shape)),
        `${file} can produce "${shape}", and no row of the failure tables in ` +
          'docs/data-inputs.md describes it. Add a row, or a reader meets a ' +
          'message the contract never mentions.',
      ).toBe(true)
    }
  })

  it('quotes no wording the code cannot produce', () => {
    const shapes = codeMessages().map((m) => m.shape)
    const documented = documentedMessages()
    expect(documented.length).toBeGreaterThanOrEqual(17)
    for (const row of documented) {
      expect(
        shapes.some((shape) => describes(row, shape)),
        `docs/data-inputs.md documents "${row}", which no code path builds. ` +
          'Either the message was reworded and the doc was not, or the row was ' +
          'invented.',
      ).toBe(true)
    }
  })
})
