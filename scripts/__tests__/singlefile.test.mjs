/**
 * The single-file build is the air-gapped deliverable, so these gates are
 * about one thing: it must need nothing from the network.
 *
 * Run with: npm run test:standalone (after npm run build:standalone)
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const html = readFileSync('dist-standalone/atlas.html', 'utf-8')

/**
 * These assertions are only worth anything against the file the caller just
 * built. atlas.html is gitignored, so an old one lying around from a previous
 * session would otherwise be certified as if it were current.
 */
test('is the file this run built', { skip: !process.env.ATLAS_BUILD_ID }, () => {
  const stamp = html.match(/<meta name="atlas-build" content="([^"]+)"/)
  assert.ok(stamp, 'no atlas-build stamp in atlas.html')
  assert.equal(
    stamp[1],
    process.env.ATLAS_BUILD_ID,
    'dist-standalone/atlas.html predates this run',
  )
})

test('is a single file with no remote src or href', () => {
  const remote = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/g) ?? []
  assert.deepEqual(remote, [], `found remote references: ${remote.join(', ')}`)
})

test('has no relative asset references left to resolve', () => {
  const rel = html.match(/(?:src|href)\s*=\s*["']\.?\/assets\/[^"']+/g) ?? []
  assert.deepEqual(rel, [])
})

test('inlines the fonts rather than linking them', () => {
  assert.ok(!/url\(\s*["']?[^"')]*\.woff2/.test(html.replace(/url\("data:[^"]*"\)/g, '')),
    'a woff2 is still referenced by path')
  assert.match(html, /data:font\/woff2;base64,/)
})

test('inlines the favicon rather than leaving a path to fetch', () => {
  assert.match(html, /rel="icon"[^>]*href="data:image\/svg\+xml/)
  const paths = html.match(/(?:src|href)\s*=\s*["']\/[^"']+/g) ?? []
  assert.deepEqual(paths, [], `absolute paths remain: ${paths.join(', ')}`)
})

test('embeds the data bundles', () => {
  assert.match(html, /__ATLAS_DATA__/)
  assert.match(html, /"bundle_version"/)
})

test('carries the full dataset', () => {
  const match = html.match(/window\.__ATLAS_DATA__\s*=\s*(\{[\s\S]*?\});<\/script>/)
  assert.ok(match, 'no embedded data block')
  const data = JSON.parse(match[1].replace(/\\u003c/g, '<'))
  assert.equal(data['systems.json'].length, 32, '32 systems')
  assert.equal(data['sites/northgate.json'].devices.length, 71, '71 Northgate devices')
  assert.equal(data['sites/westfield.json'].devices.length, 8, '8 Westfield devices')
  assert.equal(data['crosswalk.json'].length, 11, '11 requirements')
  assert.equal(data['lossiness.json'].dimensions.length, 7, 'seven dimensions')
})

test('does not let bundle content close the host script tag', () => {
  const block = html.match(/window\.__ATLAS_DATA__\s*=\s*[\s\S]*?;<\/script>/)[0]
  const inner = block.slice(0, -'</script>'.length)
  assert.ok(!/<\/script/i.test(inner), 'raw </script> inside the data block')
})

test('stays small enough to email', () => {
  const bytes = Buffer.byteLength(html)
  assert.ok(bytes < 20 * 1024 * 1024, `${(bytes / 1024 / 1024).toFixed(1)} MB`)
})
