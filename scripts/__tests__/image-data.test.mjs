/**
 * check-image-data.mjs is the data guard for what is inside the container
 * image, as opposed to what is in the repository.
 *
 * The repo guard reads `git ls-files`, so it can only ever say what is
 * committed. An image is built from a directory, and on a developer's machine
 * that directory's public/data is where the README tells an analyst to build
 * the real bundle. An image built there would carry it into a registry, which
 * is harder to spot and harder to claw back than a commit (technical plan,
 * risk 12). So the image is checked on its own terms: the web root's data/ has
 * to be the committed sample, byte for byte, and nothing else.
 *
 * Every case builds a throwaway web root in a temp directory. The other project
 * planted here is invented, a coastal ferry terminal, for the same reason as in
 * no-real-data.test.mjs.
 *
 * Run with: npm run test:image-data
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test, { after } from 'node:test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'check-image-data.mjs')
const SAMPLE = join(ROOT, 'fixtures', 'synthetic')
const temps = []

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

function write(root, path, body) {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, typeof body === 'string' ? body : JSON.stringify(body, null, 2))
}

/**
 * A web root shaped like the image's: the app document, its 404 copy, one
 * hashed asset, and the sample bundle under data/ the way `vite build` copies
 * public/ (including the empty .gitkeep seed-data.mjs leaves behind).
 */
function makeWebroot() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-image-'))
  temps.push(root)
  write(root, 'index.html', '<!doctype html><div id="root"></div>')
  write(root, '404.html', '<!doctype html><div id="root"></div>')
  write(root, 'assets/index-abc123.js', 'export {}')
  cpSync(SAMPLE, join(root, 'data'), { recursive: true })
  write(root, 'data/.gitkeep', '')
  return root
}

function check(root) {
  return spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf-8' })
}

test('a web root carrying exactly the sample passes, and says how much it compared', () => {
  const run = check(makeWebroot())
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /12 data file\(s\)/)
  assert.match(run.stdout, /byte for byte/)
})

test('a real bundle in place of the sample is refused, and named', () => {
  const root = makeWebroot()
  write(root, 'data/project.json', { slug: 'harbour-ferry', name: 'Harbour Ferry Terminal' })
  const run = check(root)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /data\/project\.json/)
  assert.match(run.stderr, /harbour-ferry/)
})

test('a sample file whose bytes changed is refused, even with the right slug', () => {
  // Byte equality is the rule, not the slug. A real bundle written over the
  // sample's project.json keeps the sample's slug if the writer copied it, and
  // the systems file is where the controlled content actually sits.
  const root = makeWebroot()
  const systems = JSON.parse(readFileSync(join(SAMPLE, 'systems.json'), 'utf-8'))
  write(root, 'data/systems.json', { ...systems, extra: 'not the sample' })
  const run = check(root)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /data\/systems\.json/)
  assert.match(run.stderr, /differs from fixtures\/synthetic/)
})

test('a file the sample does not have is refused', () => {
  const root = makeWebroot()
  write(root, 'data/sites/harbour.json', { id: 'harbour' })
  const run = check(root)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /data\/sites\/harbour\.json/)
  assert.match(run.stderr, /not in the sample/)
})

test('a snapshot the sample does not have is refused', () => {
  // The one part of a real bundle that cannot be rebuilt, and so the part most
  // likely to be copied around by hand.
  const root = makeWebroot()
  write(root, 'data/snapshots/2027-01-04.json', { project: 'harbour-ferry' })
  const run = check(root)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /data\/snapshots\/2027-01-04\.json/)
})

test('a sample file missing from the image is refused', () => {
  // Not a leak, but an image that would boot to a load-failure card, and the
  // same "is this the sample" question answered wrongly.
  const root = makeWebroot()
  rmSync(join(root, 'data', 'sites', 'westfield.json'))
  const run = check(root)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /data\/sites\/westfield\.json/)
  assert.match(run.stderr, /missing/)
})

test('a .gitkeep is tolerated only while it is empty', () => {
  const root = makeWebroot()
  write(root, 'data/.gitkeep', 'anything at all')
  const run = check(root)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /data\/\.gitkeep/)
})

test('no data directory at all is refused rather than passed', () => {
  // Nothing to compare is not the same as nothing wrong. An image whose layout
  // moved would otherwise pass this check forever while checking nothing.
  const root = makeWebroot()
  rmSync(join(root, 'data'), { recursive: true })
  const run = check(root)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /no data\/ directory/)
})

test('raw source material anywhere in the web root is refused', () => {
  // The same file types .gitignore keeps out of the repo, for the same reason:
  // a workbook or a graph export is the controlled material itself.
  for (const name of ['matrix.xlsx', 'assets/topology.graphml', 'nested/deep/export.gexf']) {
    const root = makeWebroot()
    write(root, name, 'raw')
    const run = check(root)
    assert.equal(run.status, 1, `${name} passed`)
    assert.match(run.stderr, new RegExp(name.replace(/[./]/g, '\\$&')))
  }
})

test('an environment file anywhere in the web root is refused', () => {
  // public/ is copied into the build output wholesale, so an .env dropped
  // there would be served to anyone who asked for it by name.
  for (const name of ['.env', 'assets/.env.local', 'data/sites/.env.production']) {
    const root = makeWebroot()
    write(root, name, 'TOKEN=decoy')
    const run = check(root)
    assert.equal(run.status, 1, `${name} passed`)
    assert.match(run.stderr, new RegExp(name.replace(/[./]/g, '\\$&')))
  }
})

test('a CNAME naming a host is refused, because the image is host-agnostic', () => {
  // public/CNAME is the GitHub Pages custom domain. The image runs wherever a
  // chart puts it, and the host is a chart value, so a file pinning one host
  // has no business in it.
  const root = makeWebroot()
  write(root, 'CNAME', 'atlas.example.test\n')
  const run = check(root)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /CNAME/)
})

test('a web root that does not exist is an error, not a pass', () => {
  const run = check(join(tmpdir(), 'atlas-image-does-not-exist'))
  assert.equal(run.status, 1)
  assert.match(run.stderr, /does not exist/)
})
