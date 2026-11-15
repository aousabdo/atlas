/**
 * The container files, checked for the drift that would not show up in a
 * smoke test until it was too late to matter.
 *
 * The image's behaviour is proven by running it (scripts/smoke-http.mjs, in
 * CI and in kind). These cases cover what a working image can still get
 * wrong quietly: a build that diverges from the one GitHub Pages ships, a Node
 * version that is not the one CI tests, a base image that changes under a tag,
 * and a build context that lets public/data back in.
 *
 * Run with: npm run test:container
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

const dockerfile = read('Dockerfile')
const dockerignore = read('.dockerignore')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))

/** Default value of a Dockerfile ARG, or undefined. */
function argDefault(name) {
  return dockerfile.match(new RegExp(`^ARG ${name}=(\\S+)`, 'm'))?.[1]
}

test('the image builds with the Node major version CI tests with', () => {
  const nvmrc = read('.nvmrc').trim()
  const image = argDefault('NODE_IMAGE')
  assert.ok(image, 'no ARG NODE_IMAGE default in the Dockerfile')
  const major = image.match(/^node:(\d+)[.-]/)?.[1]
  assert.equal(major, nvmrc, `Dockerfile builds on ${image}, .nvmrc says ${nvmrc}`)
})

test('every base image is pinned by digest, not only by tag', () => {
  // A tag moves when upstream republishes it, so a tag alone is a rebuild that
  // can ship different bytes from the same commit, and an SBOM that describes
  // an image nobody can reproduce.
  for (const name of ['NODE_IMAGE', 'NGINX_IMAGE']) {
    const image = argDefault(name)
    assert.ok(image, `no ARG ${name} default in the Dockerfile`)
    assert.match(image, /:[\w.-]+@sha256:[0-9a-f]{64}$/, `${name} is ${image}`)
  }
  const froms = dockerfile.match(/^FROM .+$/gm) ?? []
  assert.ok(froms.length >= 2, 'expected a multi-stage build')
  for (const from of froms) {
    assert.match(from, /\$\{(NODE|NGINX)_IMAGE\}/, `${from} does not use a pinned ARG`)
  }
})

test('the image runs the same build GitHub Pages ships, minus only the git-based guard', () => {
  // The data guard reads `git ls-files`, and an image build has no .git. It
  // runs on the tree in CI's data job instead, and the image gets its own
  // byte-for-byte check of what it actually carries. Everything else must be
  // the one script, so the two builds cannot drift apart.
  const { scripts } = JSON.parse(read('package.json'))
  assert.equal(scripts.build, 'node scripts/check-no-real-data.mjs && npm run build:dist')
  assert.match(dockerfile, /npm run build:dist/)
  assert.doesNotMatch(dockerfile, /\bvite build\b|\btsc\b/, 'the Dockerfile re-spells the build')
})

test('the image seeds the sample inside the build and checks what it built', () => {
  assert.match(dockerfile, /node scripts\/seed-data\.mjs/)
  assert.match(dockerfile, /node scripts\/check-image-data\.mjs dist/)
})

test('the final stage runs as a numeric, non-root user', () => {
  // Numeric, because runAsNonRoot can only verify a uid, not a name.
  const users = dockerfile.match(/^USER (\S+)$/gm) ?? []
  const last = users.at(-1)?.split(' ')[1]
  assert.ok(last, 'no USER in the Dockerfile')
  const uid = last.split(':')[0]
  assert.match(uid, /^\d+$/, `final USER is "${last}"`)
  assert.notEqual(Number(uid), 0, 'final USER is root')
})

test('the build context is an allowlist that keeps public/data out', () => {
  assert.equal(dockerignore[0], '*', '.dockerignore must start by excluding everything')
  const reincluded = dockerignore.filter((line) => line.startsWith('!'))
  for (const line of reincluded) {
    assert.doesNotMatch(line, /^!\/?public\/data/, `${line} re-admits the bundle directory`)
    assert.doesNotMatch(line, /^!\*\*?$/, `${line} re-admits everything`)
  }
  // public/ is needed (favicon), so the bundle inside it must be excluded
  // again, after the line that let public/ in.
  const publicAt = dockerignore.indexOf('!public/')
  const dataAt = dockerignore.indexOf('public/data/')
  assert.ok(publicAt >= 0, 'public/ is not in the context, so the favicon would be missing')
  assert.ok(dataAt > publicAt, 'public/data/ must be excluded after !public/ re-admits public/')
  for (const pattern of ['**/*.xlsx', '**/*.xlsm', '**/*.xls', '**/*.gexf', '**/*.graphml', '**/.env', '**/.env.*']) {
    assert.ok(dockerignore.includes(pattern), `.dockerignore does not exclude ${pattern}`)
  }
})
