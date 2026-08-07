/**
 * A guard nobody has watched fail is not a guard, so most of these tests plant
 * a violation and assert the check rejects it. The clean-tree case is here too,
 * but on its own it would pass just as well against a check that does nothing.
 *
 * Everything runs against throwaway git repos in a temp directory, never
 * against this one: the real tree is mid-purge and changes under the suite, and
 * a test that asserts about the repo it lives in tells you when someone else
 * edited a file, not whether the guard works.
 *
 * THE NAMES AND PHRASES BELOW ARE INVENTED, AND INVENTED ABOUT A DIFFERENT
 * SUBJECT. The reference data is a counter-UAS traceability matrix, so the
 * fixtures here describe a coastal ferry terminal instead: berths, sailings and
 * gangways. Nothing in this file is a paraphrase of anything in the real
 * material, because a paraphrase of a controlled gap statement is still that
 * gap statement. Writing real ones here would reproduce, in the test file, the
 * exact disclosure that scripts/check-no-real-data.mjs is built to avoid, and
 * rule 4 now runs against this file, so it would also fail the suite.
 *
 * Each defect closed in the guard has at least one test here that fails against
 * the version before it. Those are marked `defect N:`.
 *
 * Run with: npm run test:data
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import {
  SELF_EXEMPT,
  EXPECTED_BINARIES,
  PUBLIC_VOCABULARY,
  scanText,
  scanPath,
  harvestNames,
  buildNameMatchers,
  readWorkbookStrings,
} from '../check-no-real-data.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'check-no-real-data.mjs')
const HOOK = join(ROOT, '.githooks', 'pre-commit')
const temps = []

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

function write(root, path, body) {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, body)
}

/** A git repo with `files` staged. Nothing is committed unless a test asks. */
function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-guard-'))
  temps.push(root)
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: root })
  // The ambient global hooksPath would otherwise run this machine's own hooks
  // inside the fixture, which has nothing to do with what is under test.
  for (const [key, value] of [
    ['user.email', 'test@example.invalid'],
    ['user.name', 'Guard Test'],
    ['commit.gpgsign', 'false'],
    ['core.hooksPath', join(root, '.nohooks')],
  ]) {
    execFileSync('git', ['config', key, value], { cwd: root })
  }
  for (const [path, body] of Object.entries(files)) write(root, path, body)
  execFileSync('git', ['add', '-A'], { cwd: root })
  return root
}

function run(root, args = [], env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: root,
    encoding: 'utf-8',
    // ATLAS_SOURCE_REPO leaks in from the developer's shell otherwise, and the
    // structural-only cases would quietly stop testing what they claim to.
    env: { ...process.env, ATLAS_SOURCE_REPO: '', ...env },
  })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

/** A tree that is entirely within the synthetic vocabulary. */
const CLEAN = {
  'src/app.ts': [
    "export const WAN = '192.0.2.0/24'",
    "export const CORE = '198.51.100.0/24'",
    "export const SENSOR = '203.0.113.0/24'",
    "export const CLOSET = '172.31.4.0/24'",
    "export const MASK = '255.255.255.0'",
    "export const MARKING = 'UNCLASSIFIED//SAMPLE'",
  ].join('\n'),
  'playwright.config.ts': "export default { use: { baseURL: 'http://127.0.0.1:4173' } }",
  'docs/why.md': [
    '# Why the sample bundle is marked the way it is',
    '',
    'The real bundle was FOUO. This one is not, and the marking says so, because',
    'a reader must not mistake the sample for the real thing. Discussing CUI',
    'markings in prose has to stay possible or the subject becomes unwritable.',
  ].join('\n'),
}

// ---------------------------------------------------------------------------
// A stand-in reference repo
// ---------------------------------------------------------------------------

/**
 * The smallest zip a reader can walk: deflated entries, then a central
 * directory, then an end-of-central-directory record. This exists so the
 * workbook harvest can be tested without adding a spreadsheet dependency to a
 * guard that deliberately has none, and it is also the test of the guard's own
 * zip reader, which parses the central directory rather than the stream of
 * local headers.
 */
function zipFile(entries) {
  const parts = []
  const central = []
  let offset = 0
  for (const [name, body] of entries) {
    const nameBuf = Buffer.from(name, 'utf-8')
    const data = Buffer.from(body, 'utf-8')
    const comp = deflateRawSync(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(comp.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)

    parts.push(local, nameBuf, comp)
    central.push(cd, nameBuf)
    offset += 30 + nameBuf.length + comp.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cdBuf, eocd])
}

const sharedStrings = (values) =>
  `<?xml version="1.0"?><sst count="${values.length}">` +
  values
    .map((v) => `<si><t>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`)
    .join('') +
  '</sst>'

/**
 * The analytic content the harvest has to learn, in the shapes it really has.
 * All invented, and about ferry operations rather than anything in the
 * reference material.
 */
const WORKBOOK_GAP = 'Berth allocation is reconciled by spreadsheet after each sailing'
const WORKBOOK_OWNER = 'Harbour Authority (pending berth transfer)'
const TOOL_RISK = 'gangway telemetry is re-keyed by hand'
const TOOL_CROSSWALK = 'No common passenger manifest between ticketing and boarding'
const JSON_PHRASE = 'Tide-dependent departures are confirmed by radio and not recorded'
const SITE_LABEL = 'Kestrel Point Ferry Terminal'

/**
 * A stand-in for the reference repo, in the layout the harvester reads. The
 * point is that the guard learns from here rather than from its own source, so
 * a real repo yields real content and no repo yields none.
 */
function makeSourceRepo() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-source-'))
  temps.push(root)

  write(
    root,
    'traceability/mindmap/system_device_map.json',
    JSON.stringify({
      default_site: 'kestrelpoint',
      sites: {
        kestrelpoint: {
          label: SITE_LABEL,
          mappings: { marlin: { devices: [] }, qad: { devices: [] } },
          not_deployed_at_site: { plumbline: 'not present' },
        },
      },
      pending_review: { marrowbone: [] },
    }),
  )
  write(root, 'traceability/mindmap/overrides.json', JSON.stringify({ node_order: ['marlin'] }))

  // The traceability matrix itself. This is the file the first version of the
  // harvest never opened.
  writeFileSync(
    join(root, 'traceability/mindmap/Traceability_Matrix_TEST.xlsx'),
    zipFile([
      [
        'xl/sharedStrings.xml',
        sharedStrings([
          'Capability Gap/Requirement',
          WORKBOOK_GAP,
          WORKBOOK_OWNER,
          'BRTS',
          'Confirmed',
        ]),
      ],
    ]),
  )

  // The generated tool, with the analytic blocks inlined next to a stand-in for
  // the megabyte of vendor code that surrounds them in the real one.
  write(
    root,
    'traceability/mindmap/cuas_tool_v6.html',
    [
      '<!DOCTYPE html><html><body><script>',
      'var vendorMinified={label:"x",status:"ok",forEach:function(){}};',
      `var CROSSWALK = ${JSON.stringify([
        { orig: TOOL_CROSSWALK, sys: 'Marlin, Tidewatch', current: ['BRTS'], status: 'Split out' },
      ])};`,
      `var METHODOLOGY = ${JSON.stringify({ high_keywords: [TOOL_RISK], low_keywords: [] })};`,
      `GLOSSARY = ${JSON.stringify({ acr: 'BRTS', meaning: 'Berth Reservation and Ticketing System' })};`,
      '</script></body></html>',
    ].join('\n'),
  )

  // Free-standing JSON elsewhere under traceability/.
  write(
    root,
    'traceability/docs/notes.json',
    JSON.stringify({ caveats: [JSON_PHRASE], owner: 'Harbour Authority' }),
  )

  write(
    root,
    'kestrelpoint/kestrelpoint_network.json',
    JSON.stringify({
      graph: { name: `Network Architecture: Ravensbourne Freight Yard (Kestrel Point)` },
      zones: { yard_net: { label: 'Ravensbourne Yard Net' }, wan: { label: 'WAN / Internet' } },
      nodes: [
        { id: 'marlin_gw', label: 'Marlin Border Gateway' },
        { id: 'internet', label: 'Internet' },
      ],
    }),
  )
  return root
}

let cachedSource = null
const sourceRepo = () => (cachedSource ??= makeSourceRepo())

// ---------------------------------------------------------------------------
// It fails on planted violations
// ---------------------------------------------------------------------------

test('rejects a real-looking address outside the documentation ranges', () => {
  const repo = makeRepo({ ...CLEAN, 'src/site.json': '{ "subnet": "9.9.9.0/27" }' })
  const { code, out } = run(repo)
  assert.equal(code, 1, out)
  assert.match(out, /src\/site\.json:1: address -> 9\.9\.9\.0\/27/)
})

test('rejects every private range the sample bundle is not assigned', () => {
  for (const addr of ['10.44.203.7', '192.168.240.9', '172.19.88.4', '9.8.7.65/29']) {
    assert.deepEqual(
      scanText(`{ "ip": "${addr}" }`).map((f) => f.rule),
      ['address'],
      `${addr} should be a finding`,
    )
  }
})

test('rejects a control marking used as a value', () => {
  const repo = makeRepo({ ...CLEAN, 'src/meta.json': '{\n  "classification": "FOUO"\n}' })
  const { code, out } = run(repo)
  assert.equal(code, 1, out)
  assert.match(out, /src\/meta\.json:2: marking -> FOUO/)
})

test('rejects a marking in the other shapes it turns up in', () => {
  const shapes = [
    'classification: FOUO',
    "meta.marking = 'UNCLASSIFIED//FOUO'",
    'system,owner,CUI',
    'expect(meta.classification).toBe(`FOUO`)',
  ]
  for (const line of shapes) {
    assert.equal(scanText(line).length, 1, `no finding for: ${line}`)
  }
})

test('rejects any tracked file under public/data', () => {
  const repo = makeRepo({ ...CLEAN, 'public/data/systems.json': '[]' })
  const { code, out } = run(repo)
  assert.equal(code, 1, out)
  assert.match(out, /public\/data\/systems\.json:0: tracked-bundle/)
})

test('rejects a bundle file even when its contents are innocent', () => {
  // The rule is about the path, not the payload: a clean-looking file today is
  // a regenerated real one tomorrow, and the directory is a build output.
  const repo = makeRepo({ ...CLEAN, 'public/data/manifest.json': '{ "bundle_version": "1" }' })
  assert.equal(run(repo).code, 1)
})

test('the staged mode rejects a staged violation', () => {
  const repo = makeRepo(CLEAN)
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo })
  write(repo, 'src/added.json', '{ "ip": "9.9.9.129" }')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  const { code, out } = run(repo, ['--staged'], { ATLAS_SOURCE_REPO: sourceRepo() })
  assert.equal(code, 1, out)
  assert.match(out, /src\/added\.json:1: address -> 9\.9\.9\.129/)
})

/**
 * The hook is the copy of the check that runs when someone is about to make the
 * mistake, so it is worth proving it actually blocks a commit rather than
 * merely printing something. The fixture installs it the same way a developer
 * does, with core.hooksPath, which is also what makes the setup step visible:
 * without that config line git ignores the file entirely.
 */
test('the pre-commit hook blocks a commit that carries a violation', () => {
  const repo = makeRepo(CLEAN)
  for (const dir of ['.githooks', 'scripts']) mkdirSync(join(repo, dir), { recursive: true })
  copyFileSync(HOOK, join(repo, '.githooks', 'pre-commit'))
  copyFileSync(SCRIPT, join(repo, 'scripts', 'check-no-real-data.mjs'))
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repo })
  execFileSync('git', ['add', '-A'], { cwd: repo })
  const env = { ...process.env, ATLAS_SOURCE_REPO: sourceRepo() }

  const clean = spawnSync('git', ['commit', '-qm', 'base'], { cwd: repo, encoding: 'utf-8', env })
  assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`)

  write(repo, 'src/leak.json', '{ "classification": "FOUO", "ip": "10.44.203.7" }\n')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  const blocked = spawnSync('git', ['commit', '-qm', 'leak'], { cwd: repo, encoding: 'utf-8', env })
  assert.notEqual(blocked.status, 0, 'the commit was allowed through')
  assert.match(`${blocked.stdout}${blocked.stderr}`, /src\/leak\.json:1: marking -> FOUO/)

  // And the commit really did not happen.
  const log = execFileSync('git', ['log', '--oneline'], { cwd: repo, encoding: 'utf-8' })
  assert.equal(log.trim().split('\n').length, 1)
})

// ---------------------------------------------------------------------------
// It passes on things that only look like violations
// ---------------------------------------------------------------------------

test('accepts a tree that stays inside the synthetic vocabulary', () => {
  const { code, out } = run(makeRepo(CLEAN))
  assert.equal(code, 0, out)
  assert.match(out, /Data check passed/)
  assert.match(out, /structural rules only/)
})

test('accepts the .gitkeep that holds the generated directory open', () => {
  const repo = makeRepo({ ...CLEAN, 'public/data/.gitkeep': '' })
  assert.equal(run(repo).code, 0)
})

test('accepts version numbers that are shaped like addresses', () => {
  const lines = [
    'const image = "playwright:v1.62.1-noble"',
    '"version": "1.62.1.4"',
    'const parts = [1, 2, 3, 4]',
    'schema 1.2.3.4.5 supersedes the old one',
    'xlsx@0.20.3.1',
  ]
  for (const line of lines) {
    assert.deepEqual(scanText(line), [], `false positive on: ${line}`)
  }
})

test('accepts loopback, netmasks and the documentation ranges', () => {
  const lines = [
    'http://127.0.0.1:4173',
    'server.listen("0.0.0.0")',
    '"netmask": "255.255.255.128"',
    '"wan": "192.0.2.14/24"',
    '"core": "198.51.100.7"',
    '"sensor": "203.0.113.200/24"',
    '"closet": "172.31.9.9/16"',
  ]
  for (const line of lines) {
    assert.deepEqual(scanText(line), [], `false positive on: ${line}`)
  }
})

test('accepts prose that discusses markings without carrying one', () => {
  const lines = [
    'The real bundle was FOUO and this one is not.',
    'gated on the open CUI marking question',
    '"""FOUO is on both files and the old tool never displayed it.',
    'assert marking == "UNCLASSIFIED//SAMPLE"',
  ]
  for (const line of lines) {
    assert.deepEqual(scanText(line), [], `false positive on: ${line}`)
  }
})

// ---------------------------------------------------------------------------
// defect 1: the harvest was aimed at the wrong file
//
// It read the network topology JSON, so it learned device labels and subnets
// and never learned a single sentence of the analytic content. A clean scan
// therefore meant nothing: every identifier in the shipped bundle had been
// renamed and every gap statement, owner clause and risk phrase had not.
// ---------------------------------------------------------------------------

test('defect 1: harvests whole gap statements from the traceability workbook', () => {
  const { phrases } = harvestNames(sourceRepo())
  assert.ok(
    phrases.has(WORKBOOK_GAP.toLowerCase()),
    'the workbook was not read at all; this is the file the old harvest never opened',
  )
  assert.ok(phrases.has(WORKBOOK_OWNER.toLowerCase()), 'owner clauses must be harvested too')
})

test('defect 1: harvests the crosswalk and the risk keywords from the generated tool', () => {
  const { phrases, acronyms } = harvestNames(sourceRepo())
  assert.ok(phrases.has(TOOL_CROSSWALK.toLowerCase()), 'capability-gap statement not harvested')
  assert.ok(phrases.has(TOOL_RISK.toLowerCase()), 'risk-keyword entry not harvested')
  assert.ok(
    phrases.has('berth reservation and ticketing system'),
    'the acronym expansion that decodes a rename was not harvested',
  )
  assert.ok(acronyms.has('BRTS'), 'system acronyms must be harvested')
})

test('defect 1: harvests JSON anywhere under traceability/, not just two known files', () => {
  const { phrases } = harvestNames(sourceRepo())
  assert.ok(phrases.has(JSON_PHRASE.toLowerCase()))
})

test('defect 1: a gap statement copied into the tree is a finding', () => {
  const repo = makeRepo({ ...CLEAN, 'src/copy.ts': `export const note = '${WORKBOOK_GAP}'\n` })

  // Without the reference repo this is invisible, which is the honest limit
  // that rule 4 has and CI inherits.
  assert.equal(run(repo).code, 0)

  const { code, out } = run(repo, [], { ATLAS_SOURCE_REPO: sourceRepo() })
  assert.equal(code, 1, out)
  assert.match(out, /src\/copy\.ts:1: name -> Berth allocation is reconciled/)
})

test('defect 1: still learns the device and zone labels it always did', () => {
  const { terms } = harvestNames(sourceRepo())
  for (const expected of ['kestrelpoint', 'marlin', 'marlin_gw', 'marrowbone', 'ravensbourne']) {
    assert.ok(terms.has(expected), `expected to harvest ${expected}`)
  }
  // Generic vocabulary must not become a rule, or the guard fires on ordinary
  // English and gets switched off.
  for (const generic of ['internet', 'wan', 'network', 'gateway', 'site']) {
    assert.ok(!terms.has(generic), `${generic} should not be a term`)
  }
})

test('defect 1: reads a workbook without a spreadsheet dependency', () => {
  const path = join(sourceRepo(), 'traceability/mindmap/Traceability_Matrix_TEST.xlsx')
  const cells = readWorkbookStrings(path)
  assert.ok(cells.includes(WORKBOOK_GAP))
  // A file that is not a zip must return nothing rather than throw, or one
  // stray artifact in the reference tree takes the whole guard down.
  assert.deepEqual(readWorkbookStrings(join(sourceRepo(), 'traceability/docs/notes.json')), [])
})

// ---------------------------------------------------------------------------
// defect 2: rule 4 had no automated coverage anywhere
//
// CI deliberately did not set ATLAS_SOURCE_REPO, the name rules skipped in
// silence, and a green tick read as coverage for a rule that had never run.
// The honest answer is a hook that fails closed and a check that says out loud
// what it did not do.
// ---------------------------------------------------------------------------

test('defect 2: --staged refuses to run at all without the reference repo', () => {
  const repo = makeRepo(CLEAN)
  const { code, out } = run(repo, ['--staged'])
  assert.equal(code, 1, 'a commit was allowed to proceed with rule 4 unrun')
  assert.match(out, /REFUSED/)
  assert.match(out, /ATLAS_SOURCE_REPO/)
})

test('defect 2: the hook blocks a clean commit when the reference repo is unset', () => {
  const repo = makeRepo(CLEAN)
  for (const dir of ['.githooks', 'scripts']) mkdirSync(join(repo, dir), { recursive: true })
  copyFileSync(HOOK, join(repo, '.githooks', 'pre-commit'))
  copyFileSync(SCRIPT, join(repo, 'scripts', 'check-no-real-data.mjs'))
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repo })
  execFileSync('git', ['add', '-A'], { cwd: repo })

  const env = { ...process.env, ATLAS_SOURCE_REPO: '' }
  const blocked = spawnSync('git', ['commit', '-qm', 'base'], { cwd: repo, encoding: 'utf-8', env })
  assert.notEqual(blocked.status, 0, 'the hook let a commit through with rule 4 unrun')
  assert.match(`${blocked.stdout}${blocked.stderr}`, /ATLAS_SOURCE_REPO/)

  // The same commit succeeds once the reference repo is in reach, so the hook
  // is a gate and not a wall.
  const allowed = spawnSync('git', ['commit', '-qm', 'base'], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, ATLAS_SOURCE_REPO: sourceRepo() },
  })
  assert.equal(allowed.status, 0, `${allowed.stdout}${allowed.stderr}`)
})

test('defect 2: a tree-wide run without the reference repo says rule 4 did not run', () => {
  // This is the exact text CI greps for. A pass that does not say which rules
  // it ran is the thing that read as coverage for two months.
  const { code, out } = run(makeRepo(CLEAN))
  assert.equal(code, 0, out)
  assert.match(out, /structural rules only/)
  assert.match(out, /rule 4 did NOT run/)
  assert.match(out, /NOT checked/)
})

test('defect 2: says which rules it actually ran, so a silent downgrade is visible', () => {
  const clean = makeRepo(CLEAN)
  assert.match(run(clean).out, /structural rules only/)
  const withNames = run(clean, [], { ATLAS_SOURCE_REPO: sourceRepo() })
  assert.match(withNames.out, /structural and name rules/)
  assert.doesNotMatch(withNames.out, /did NOT run/)
})

test('refuses to run rather than silently skip when the source path is wrong', () => {
  const repo = makeRepo(CLEAN)
  const { code, out } = run(repo, [], { ATLAS_SOURCE_REPO: join(tmpdir(), 'atlas-not-here') })
  assert.equal(code, 1)
  assert.match(out, /does not exist/)
})

test('refuses to run when the source path holds no reference data', () => {
  const empty = mkdtempSync(join(tmpdir(), 'atlas-empty-'))
  temps.push(empty)
  const { code, out } = run(makeRepo(CLEAN), [], { ATLAS_SOURCE_REPO: empty })
  assert.equal(code, 1)
  assert.match(out, /no reference data/)
})

// ---------------------------------------------------------------------------
// defect 3: binaries were skipped wholesale
//
// Every rule read text, and every tracked binary was skipped before any rule
// saw it, so the committed PNG baselines were invisible to all of them. They
// render the risk-keyword table and the gap statements as pixels. They cannot
// be scanned, so they are acknowledged: anything else that is binary fails.
// ---------------------------------------------------------------------------

const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]).toString('binary')

test('defect 3: an unexpected tracked binary is a finding', () => {
  const repo = makeRepo({ ...CLEAN, 'docs/exported.pdf': BINARY })
  const { code, out } = run(repo)
  assert.equal(code, 1, out)
  assert.match(out, /docs\/exported\.pdf:0: unexpected-binary/)
})

test('defect 3: a workbook slipped into the tree cannot hide behind being binary', () => {
  // The real failure mode. A workbook is binary, so under the old rule it was
  // skipped before any rule looked at it.
  const repo = makeRepo({ ...CLEAN, 'fixtures/matrix.xlsx': BINARY })
  assert.equal(run(repo).code, 1)
})

test('defect 3: the known visual baselines are accepted', () => {
  const files = { ...CLEAN }
  for (const view of ['analytics', 'lossiness', 'map', 'network', 'reference']) {
    for (const theme of ['light', 'dark']) {
      files[`e2e/__screenshots__/darwin-arm64/${view}-${theme}.png`] = BINARY
    }
  }
  const { code, out } = run(makeRepo(files))
  assert.equal(code, 0, out)
})

test('defect 3: a new baseline for a new rendering environment is accepted', () => {
  const repo = makeRepo({
    ...CLEAN,
    'e2e/__screenshots__/linux-x64-noble-pw1.62.1/network-dark.png': BINARY,
  })
  assert.equal(run(repo).code, 0)
})

test('defect 3: a novel image in the baseline directory is still a finding', () => {
  // The allowlist enumerates the five views and the two themes rather than
  // opening the directory, so a screenshot of something new cannot arrive by
  // being put in the right folder.
  const repo = makeRepo({
    ...CLEAN,
    'e2e/__screenshots__/darwin-arm64/matrix-detail-dark.png': BINARY,
  })
  const { code, out } = run(repo)
  assert.equal(code, 1, out)
  assert.match(out, /matrix-detail-dark\.png:0: unexpected-binary/)
})

test('defect 3: the expected-artifacts list is asserted by value', () => {
  // Widening this is how "a new binary cannot arrive unnoticed" stops being
  // true, so it costs a visible edit in a diff.
  assert.equal(EXPECTED_BINARIES.length, 1)
  assert.match('e2e/__screenshots__/darwin-arm64/map-light.png', EXPECTED_BINARIES[0])
  assert.doesNotMatch('e2e/__screenshots__/darwin-arm64/map-light.jpg', EXPECTED_BINARIES[0])
  assert.doesNotMatch('src/assets/logo.png', EXPECTED_BINARIES[0])
})

// ---------------------------------------------------------------------------
// defect 4: `+++ /dev/null` nulled the diff parser
//
// The parser took the current filename from the diff's `+++` header. An added
// line whose own text begins with `++ /dev/null` renders as `+++ /dev/null`,
// which the header branch read as a deletion and used to set the current file
// to null, silently dropping every added line after it in that file.
// ---------------------------------------------------------------------------

test('defect 4: a staged line rendering as +++ /dev/null does not disable the hook', () => {
  const repo = makeRepo(CLEAN)
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo })
  write(
    repo,
    'src/spoof.json',
    ['++ /dev/null', '{ "ip": "10.44.203.7" }', '{ "classification": "FOUO" }'].join('\n'),
  )
  execFileSync('git', ['add', '-A'], { cwd: repo })

  const { code, out } = run(repo, ['--staged'], { ATLAS_SOURCE_REPO: sourceRepo() })
  assert.equal(code, 1, `everything after the spoofed header was dropped:\n${out}`)
  assert.match(out, /src\/spoof\.json:2: address -> 10\.44\.203\.7/)
  assert.match(out, /src\/spoof\.json:3: marking -> FOUO/)
})

test('defect 4: a line rendering as --- /dev/null does not disable it either', () => {
  const repo = makeRepo(CLEAN)
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo })
  write(repo, 'src/spoof2.json', ['-- /dev/null', '@@ -0,0 +0,0 @@', '"ip": "9.8.7.6"'].join('\n'))
  execFileSync('git', ['add', '-A'], { cwd: repo })

  const { code, out } = run(repo, ['--staged'], { ATLAS_SOURCE_REPO: sourceRepo() })
  assert.equal(code, 1, out)
  assert.match(out, /src\/spoof2\.json:3: address -> 9\.8\.7\.6/)
})

test('defect 4: the real header for a deleted file is still not scanned as content', () => {
  const repo = makeRepo({ ...CLEAN, 'src/goes.json': '{ "ok": true }\n' })
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo })
  execFileSync('git', ['rm', '-q', 'src/goes.json'], { cwd: repo })
  const { code, out } = run(repo, ['--staged'], { ATLAS_SOURCE_REPO: sourceRepo() })
  assert.equal(code, 0, out)
})

// ---------------------------------------------------------------------------
// defect 5: the whitespace-collapse pass was dead twice over
//
// It de-duplicated on `f.value`, a field no finding has, so `seen` held one
// `undefined` and the first collapsed hit suppressed every later one. And in
// --staged mode the caller handed it one line at a time, so there was never
// anything to collapse.
// ---------------------------------------------------------------------------

test('defect 5: finds a phrase a formatter has wrapped across two lines', () => {
  const matchers = buildNameMatchers(harvestNames(sourceRepo()))
  const wrapped = 'const note =\n  "Berth allocation is reconciled by\n   spreadsheet after each sailing"'
  const hits = scanText(wrapped, matchers)
  assert.equal(hits.length, 1, `expected the wrapped phrase to be found: ${JSON.stringify(hits)}`)
  assert.equal(hits[0].note, 'found only with whitespace collapsed')
})

test('defect 5: reports every collapsed hit, not just the first', () => {
  // With de-duplication keyed on a field that does not exist, `seen` contained
  // a single undefined and swallowed all but one finding.
  const matchers = buildNameMatchers(harvestNames(sourceRepo()))
  const text = [
    'a = "Berth allocation is reconciled by',
    '  spreadsheet after each sailing"',
    'b = "No common passenger manifest between',
    '  ticketing and boarding"',
  ].join('\n')
  const collapsed = scanText(text, matchers).filter((f) => f.note)
  assert.equal(collapsed.length, 2, `only ${collapsed.length} collapsed hit(s) reported`)
})

test('defect 5: does not double-report a phrase that already matched on one line', () => {
  const matchers = buildNameMatchers(harvestNames(sourceRepo()))
  const hits = scanText(`x = "${WORKBOOK_GAP}"`, matchers)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].note, undefined)
})

test('defect 5: the collapse pass runs in --staged mode too', () => {
  const repo = makeRepo(CLEAN)
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo })
  write(
    repo,
    'src/wrapped.ts',
    'export const note =\n  "Berth allocation is reconciled by\n   spreadsheet after each sailing"\n',
  )
  execFileSync('git', ['add', '-A'], { cwd: repo })

  const { code, out } = run(repo, ['--staged'], { ATLAS_SOURCE_REPO: sourceRepo() })
  assert.equal(code, 1, `the staged scan never had a whole file to collapse:\n${out}`)
  assert.match(out, /whitespace collapsed/)
})

// ---------------------------------------------------------------------------
// defect 6: SELF_EXEMPT was an unscanned write-anything channel
//
// The two guard files were skipped before any rule ran, so anything at all
// could be written into them and no rule would ever see it. Three real system
// ids were sitting in a comment in the guard's own source because of it. The
// exemption now covers the structural rules only: rule 4 is never waived.
// ---------------------------------------------------------------------------

test('defect 6: a real name in the guard\'s own source is a finding', () => {
  const planted = `// harvested from ${'kestrelpoint'}, one of the reference sites\n`
  const repo = makeRepo({ ...CLEAN, 'scripts/check-no-real-data.mjs': planted })
  const { code, out } = run(repo, [], { ATLAS_SOURCE_REPO: sourceRepo() })
  assert.equal(code, 1, `the guard cannot write names into itself unseen:\n${out}`)
  assert.match(out, /scripts\/check-no-real-data\.mjs:1: name -> kestrelpoint/)
})

test('defect 6: a real phrase in the test file is a finding', () => {
  const repo = makeRepo({
    ...CLEAN,
    'scripts/__tests__/no-real-data.test.mjs': `const fixture = '${WORKBOOK_GAP}'\n`,
  })
  const { code, out } = run(repo, [], { ATLAS_SOURCE_REPO: sourceRepo() })
  assert.equal(code, 1, out)
  assert.match(out, /no-real-data\.test\.mjs:1: name -> Berth allocation/)
})

test('defect 6: the exemption still covers the pattern tables it has to', () => {
  // These two files must be able to contain the marking strings they match on
  // and the addresses the fixtures plant, or the guard cannot be written.
  const planted = '{ "classification": "FOUO", "ip": "10.44.203.7" }\n'
  for (const file of SELF_EXEMPT) {
    const { code, out } = run(makeRepo({ ...CLEAN, [file]: planted }), [], {
      ATLAS_SOURCE_REPO: sourceRepo(),
    })
    assert.equal(code, 0, `${file} should be exempt from the structural rules:\n${out}`)
  }
  // And the same text one filename over is not exempt.
  assert.equal(run(makeRepo({ ...CLEAN, 'scripts/check-no-real-data-2.mjs': planted })).code, 1)
})

test('defect 6: exempts its own two files and nothing else', () => {
  // An exemption is a hole. This asserts the list by value so that widening it
  // is a visible decision in a diff rather than a one-word edit.
  assert.deepEqual(SELF_EXEMPT, [
    'scripts/check-no-real-data.mjs',
    'scripts/__tests__/no-real-data.test.mjs',
  ])
})

// ---------------------------------------------------------------------------
// defect 7: file and directory names were never scanned
//
// Only file bodies were read. The reference repo has workbook backups whose
// names spell out the system ids involved in each revision, and directories
// named for the sites they hold, so a path was a free channel.
// ---------------------------------------------------------------------------

test('defect 7: a filename carrying a real name is a finding', () => {
  const repo = makeRepo({ ...CLEAN, 'fixtures/kestrelpoint_backup.json': '{}\n' })
  const { code, out } = run(repo, [], { ATLAS_SOURCE_REPO: sourceRepo() })
  assert.equal(code, 1, `a path was a free channel:\n${out}`)
  assert.match(out, /path-name -> kestrelpoint/)
})

test('defect 7: a directory named for a real site is a finding', () => {
  const repo = makeRepo({ ...CLEAN, 'fixtures/kestrelpoint/notes.md': 'nothing here\n' })
  const { code, out } = run(repo, [], { ATLAS_SOURCE_REPO: sourceRepo() })
  assert.equal(code, 1, out)
  assert.match(out, /path-name -> kestrelpoint/)
})

test('defect 7: a phrase written with separators instead of spaces is a finding', () => {
  // A phrase harvested as "kestrel point ferry terminal" appears in a path as
  // `kestrel_point_ferry_terminal`, and neither form matches the other without
  // normalising separators.
  const matchers = buildNameMatchers(harvestNames(sourceRepo()))
  const hits = scanPath('docs/kestrel-point-ferry-terminal.md', matchers)
  assert.ok(hits.length >= 1, 'separator-written phrase not matched')
  assert.equal(hits[0].rule, 'path-name')
})

test('defect 7: a control marking in a filename is a finding', () => {
  const repo = makeRepo({ ...CLEAN, 'docs/briefing_FOUO.md': 'nothing here\n' })
  const { code, out } = run(repo)
  assert.equal(code, 1, out)
  assert.match(out, /path-marking -> FOUO/)
})

test('defect 7: ordinary paths in this repo do not fire', () => {
  const matchers = buildNameMatchers(harvestNames(sourceRepo()))
  for (const path of [
    'src/tabs/network/NetworkTab.tsx',
    'scripts/check-no-real-data.mjs',
    'e2e/__screenshots__/darwin-arm64/map-light.png',
    'package-lock.json',
  ]) {
    assert.deepEqual(scanPath(path, matchers), [], `false positive on: ${path}`)
  }
})

// ---------------------------------------------------------------------------
// defect 8: PUBLIC_VOCABULARY leaked the site
//
// It carried six ordinary words that, as a set, described one location: the
// kind of venue the real site is, plus the kinds of business its buildings are
// named after. The list therefore identified the site more precisely than the
// data it was guarding did, in the one file everybody reads. They were only
// there to stop the guard firing on synthetic labels that reused them, which is
// a reason to rename a label, not to widen the vocabulary.
//
// The words are not written out here either. They are derived from the real
// site label in the fixture-free way: any word that appears in the reference
// repo's own site label has no business also being permanently allowed.
// ---------------------------------------------------------------------------

test('defect 8: no venue-shaped word is permanently allowed', () => {
  // Spelled as character codes so this assertion does not reintroduce, in the
  // test file, the list it exists to keep out of the source file.
  const forbidden = [
    [115, 112, 111, 114, 116, 115],
    [99, 111, 109, 112, 108, 101, 120],
    [112, 97, 114, 107],
    [98, 97, 110, 107],
    [102, 105, 110, 97, 110, 99, 105, 97, 108],
    [102, 105, 101, 108, 100],
  ].map((codes) => String.fromCharCode(...codes))

  for (const word of forbidden) {
    assert.ok(
      !PUBLIC_VOCABULARY.has(word),
      'a venue-shaped word is back in PUBLIC_VOCABULARY; rename the synthetic label instead',
    )
  }
})

test('defect 8: a label built only from venue words is now a rule', () => {
  // This is the behaviour the six words bought. With all of them permanently
  // allowed, the "every word is public" bypass swallowed the whole label and no
  // rule was ever created for it, so a bundle could reuse it verbatim.
  const root = mkdtempSync(join(tmpdir(), 'atlas-venue-'))
  temps.push(root)
  write(
    root,
    'traceability/docs/venue.json',
    JSON.stringify({ label: 'Sports Complex Field Bank Park' }),
  )
  const { phrases } = harvestNames(root)
  assert.ok(
    phrases.has('sports complex field bank park'),
    'the all-public bypass still swallows a venue-shaped label',
  )
})

test('defect 8: the allowlist still covers the vocabulary it is meant to', () => {
  // The fix is not "empty the list". Generic network vocabulary still has to be
  // there or the guard fires on every architecture document ever written.
  for (const word of ['network', 'gateway', 'switch', 'sensor', 'perimeter', 'wan']) {
    assert.ok(PUBLIC_VOCABULARY.has(word), `${word} should still be public vocabulary`)
  }
})

// ---------------------------------------------------------------------------
// The matchers themselves
// ---------------------------------------------------------------------------

test('matches short ids only where they are quoted', () => {
  const matchers = buildNameMatchers(new Set(['qad', 'marlin']))
  assert.equal(scanText('{ "system": "qad" }', matchers).length, 1)
  // A bare three-letter word boundary is noise, not evidence.
  assert.equal(scanText('the qad of the matter', matchers).length, 0)
  assert.equal(scanText('a marlin swam past', matchers).length, 1)
})

test('matches multi-word labels as whole phrases', () => {
  const matchers = buildNameMatchers(harvestNames(sourceRepo()))
  const hits = scanText('label: "Marlin Border Gateway"', matchers).map((f) => f.text.toLowerCase())
  assert.ok(hits.includes('marlin border gateway'), `matched instead: ${hits.join(', ')}`)
  // A label built only from generic vocabulary produces no rule at all.
  assert.deepEqual(scanText('label: "Sensor Gateway"', matchers), [])
})

test('matches an acronym in capitals but not the ordinary word it collides with', () => {
  // Real systems are abbreviated the way this repo spells ordinary words, so
  // folding case turned a handful of them into rules that fired on unrelated
  // source files.
  const matchers = buildNameMatchers(harvestNames(sourceRepo()))
  assert.equal(scanText('const system = "BRTS"', matchers).length, 1)
  assert.equal(scanText('the brts of the matter', matchers).length, 0)
  // Quoted, a lower-cased id is data rather than prose, and is still caught.
  assert.equal(scanText('{ "system": "brts" }', matchers).length, 1)
})
