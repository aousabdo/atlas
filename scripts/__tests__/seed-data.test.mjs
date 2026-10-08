/**
 * seed-data.mjs empties public/data before it copies the sample in. public/data
 * is gitignored, and it is also where the README tells an analyst to build the
 * real bundle, so whatever the ingest wrote there exists nowhere else. Its
 * snapshots/ cannot be rebuilt even from the same inputs, because each one
 * records a build that has already happened. Most of these tests plant such a
 * bundle and assert the seed refuses to touch it.
 *
 * Every case runs in a throwaway repo in a temp directory: the script is copied
 * in beside a copy of the committed sample, because it finds both relative to
 * itself. Running it against this checkout would empty this checkout's
 * public/data, which is the bug.
 *
 * The other project here is invented, a coastal ferry terminal, for the same
 * reason as in no-real-data.test.mjs.
 *
 * Run with: npm run test:seed
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test, { after } from 'node:test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SAMPLE = join(ROOT, 'fixtures', 'synthetic')
const SAMPLE_SLUG = JSON.parse(readFileSync(join(SAMPLE, 'project.json'), 'utf-8')).slug
const temps = []

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

function write(root, path, body) {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, typeof body === 'string' ? body : JSON.stringify(body, null, 2))
}

/** A repo holding the seed script and the committed sample, and `files`. */
function makeRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-seed-'))
  temps.push(root)
  mkdirSync(join(root, 'scripts'))
  cpSync(join(ROOT, 'scripts', 'seed-data.mjs'), join(root, 'scripts', 'seed-data.mjs'))
  cpSync(SAMPLE, join(root, 'fixtures', 'synthetic'), { recursive: true })
  for (const [path, body] of Object.entries(files)) write(root, path, body)
  return root
}

function run(root, args = []) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'seed-data.mjs'), ...args], {
    cwd: root,
    encoding: 'utf-8',
  })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

/** Every file under `dir`, keyed by its path relative to it. */
function tree(dir) {
  const files = {}
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name)
      if (entry.isDirectory()) walk(full)
      else files[relative(dir, full)] = readFileSync(full, 'utf-8')
    }
  }
  walk(dir)
  return files
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'))

/** What the ingest leaves in public/data for a project other than the sample. */
const FERRY = {
  'public/data/project.json': { slug: 'coastal-ferry', name: 'Coastal Ferry Terminal' },
  'public/data/manifest.json': { bundle_version: 1, snapshots: ['2026-09-01', '2026-10-01'] },
  'public/data/sites/berth-north.json': { meta: { label: 'Berth North' } },
  'public/data/snapshots/2026-09-01.json': { label: '2026-09-01', project: 'coastal-ferry' },
  'public/data/snapshots/2026-10-01.json': { label: '2026-10-01', project: 'coastal-ferry' },
}

// ---------------------------------------------------------------------------
// What it still does
// ---------------------------------------------------------------------------

test('seeds a fresh clone, where public/data does not exist', () => {
  const repo = makeRepo()
  const { code, out } = run(repo)
  assert.equal(code, 0, out)
  assert.deepEqual(readJson(join(repo, 'public/data/project.json')), readJson(join(SAMPLE, 'project.json')))
  assert.ok(existsSync(join(repo, 'public/data/.gitkeep')))
})

test('reseeds over the sample, and drops a file the sample no longer has', () => {
  const repo = makeRepo()
  assert.equal(run(repo).code, 0)
  write(repo, 'public/data/sites/retired.json', { meta: { label: 'Retired' } })

  const { code, out } = run(repo)
  assert.equal(code, 0, out)
  assert.equal(existsSync(join(repo, 'public/data/sites/retired.json')), false)
})

test('reseeds over a sample seeded before snapshots carried a project', () => {
  const repo = makeRepo({
    'public/data/project.json': readJson(join(SAMPLE, 'project.json')),
    'public/data/snapshots/2026-08-05.json': { label: '2026-08-05' },
  })
  const { code, out } = run(repo)
  assert.equal(code, 0, out)
})

test('ignores the files a clone or the Finder leaves in an empty public/data', () => {
  const repo = makeRepo({ 'public/data/.gitkeep': '', 'public/data/.DS_Store': '' })
  const { code, out } = run(repo)
  assert.equal(code, 0, out)
  assert.deepEqual(readJson(join(repo, 'public/data/project.json')), readJson(join(SAMPLE, 'project.json')))
})

// ---------------------------------------------------------------------------
// What it refuses to throw away
// ---------------------------------------------------------------------------

test('refuses to empty a bundle built for another project, and leaves every file in place', () => {
  const repo = makeRepo(FERRY)
  const before = tree(join(repo, 'public/data'))

  const { code, out } = run(repo)
  assert.equal(code, 1, out)
  assert.deepEqual(tree(join(repo, 'public/data')), before)
  assert.match(out, /coastal-ferry/)
  assert.match(out, new RegExp(SAMPLE_SLUG))
  // The snapshots are what a rebuild cannot recreate, so they are named.
  assert.match(out, /2026-09-01/)
  assert.match(out, /2026-10-01/)
  assert.match(out, /--force/)
})

test('refuses when a snapshot belongs to another project, even beside the sample project.json', () => {
  const repo = makeRepo()
  assert.equal(run(repo).code, 0)
  write(repo, 'public/data/snapshots/2026-10-01.json', { label: '2026-10-01', project: 'coastal-ferry' })
  const before = tree(join(repo, 'public/data'))

  const { code, out } = run(repo)
  assert.equal(code, 1, out)
  assert.deepEqual(tree(join(repo, 'public/data')), before)
  assert.match(out, /2026-10-01/)
  assert.match(out, /coastal-ferry/)
})

test('refuses files with no project.json, since nothing says they are the sample', () => {
  const repo = makeRepo({
    'public/data/snapshots/2026-10-01.json': { label: '2026-10-01' },
  })
  const { code, out } = run(repo)
  assert.equal(code, 1, out)
  assert.ok(existsSync(join(repo, 'public/data/snapshots/2026-10-01.json')))
  assert.match(out, /project\.json/)
})

test('refuses a project.json that does not parse', () => {
  const repo = makeRepo({
    'public/data/project.json': '{ "slug": "coastal-',
    'public/data/snapshots/2026-10-01.json': { label: '2026-10-01' },
  })
  const { code, out } = run(repo)
  assert.equal(code, 1, out)
  assert.ok(existsSync(join(repo, 'public/data/snapshots/2026-10-01.json')))
})

test('--force discards another project\'s bundle, and says what it discarded', () => {
  const repo = makeRepo(FERRY)
  const { code, out } = run(repo, ['--force'])
  assert.equal(code, 0, out)
  assert.deepEqual(readJson(join(repo, 'public/data/project.json')), readJson(join(SAMPLE, 'project.json')))
  assert.equal(existsSync(join(repo, 'public/data/snapshots/2026-10-01.json')), false)
  assert.match(out, /coastal-ferry/)
  assert.match(out, /2026-09-01/)
  assert.match(out, /2026-10-01/)
})

// ---------------------------------------------------------------------------
// Who runs it
// ---------------------------------------------------------------------------

/**
 * npm test used to seed, through pretest, so running the suite after a real
 * ingest deleted the real bundle without a word. The unit suite reads
 * fixtures/synthetic directly now and has no reason to touch public/data.
 */
test('npm test does not seed public/data', () => {
  const { scripts } = readJson(join(ROOT, 'package.json'))
  for (const hook of ['pretest', 'test', 'posttest']) {
    assert.doesNotMatch(scripts[hook] ?? '', /seed-data/, `scripts.${hook} runs the seed`)
  }
})
