/**
 * The single-file build is the air-gapped deliverable, so these gates are
 * about one thing: it must need nothing from the network.
 *
 * Run with: npm run test:standalone (after npm run build:standalone)
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

const html = readFileSync('dist-standalone/atlas.html', 'utf-8')

const BUILDER = resolve('scripts/build-singlefile.mjs')

/**
 * Run the builder over a synthetic dist and return the file it wrote.
 *
 * Most of this file asserts about the real deliverable. The tests at the end
 * assert about what the builder does to CONTENT, which needs inputs the real
 * dataset does not and must not contain, so the fixture is small and every
 * byte of it is invented here.
 *
 * The builder writes dist-standalone/atlas.html relative to its own cwd, so it
 * is spawned with cwd set to the temp tree. Running it in process, or from the
 * repo root, would overwrite the deliverable the rest of this file is reading.
 */
function buildSynthetic(bundle, { css, noHead = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-singlefile-'))
  try {
    mkdirSync(join(dir, 'synth/assets'), { recursive: true })
    mkdirSync(join(dir, 'synth/data'), { recursive: true })
    writeFileSync(
      join(dir, 'synth/index.html'),
      [
        '<!doctype html>',
        '<html lang="en"><head>',
        '<meta charset="UTF-8" />',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; ' +
          "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
          "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'\" />",
        '<link rel="icon" type="image/svg+xml" href="./favicon.svg" />',
        '<title>fixture</title>',
        '<script type="module" crossorigin src="./assets/app.js"></script>',
        '<link rel="stylesheet" crossorigin href="./assets/app.css">',
        '</head><body><div id="root"></div></body></html>',
      ]
        .join('\n')
        // For the case where there is no anchor to inject the data before.
        .replace('</head>', () => (noHead ? '' : '</head>')),
    )
    writeFileSync(join(dir, 'synth/assets/app.js'), 'export const ok = 1\n')
    writeFileSync(
      join(dir, 'synth/assets/app.css'),
      css ??
        '@font-face{font-family:Fixture;src:url(./demo.woff2)format("woff2"),' +
          'url(./demo.woff)format("woff")}',
    )
    // Not real fonts. The builder only base64s whatever bytes are there, and a
    // recognisable string makes a wrong inline obvious in a failure message.
    writeFileSync(join(dir, 'synth/assets/demo.woff2'), 'fixture-woff2-bytes')
    writeFileSync(join(dir, 'synth/assets/demo.woff'), 'fixture-woff-fallback-bytes')
    writeFileSync(
      join(dir, 'synth/favicon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
    )
    writeFileSync(join(dir, 'synth/data/demo.json'), JSON.stringify(bundle))
    execFileSync(process.execPath, [BUILDER, 'synth'], { cwd: dir, stdio: 'pipe' })
    return readFileSync(join(dir, 'dist-standalone/atlas.html'), 'utf-8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function embeddedData(built) {
  const match = built.match(/window\.__ATLAS_DATA__\s*=\s*(\{[\s\S]*?\});<\/script>/)
  assert.ok(match, 'no embedded data block')
  return JSON.parse(match[1].replace(/\\u003c/g, '<'))
}

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

/**
 * The WOFF half of every fontsource @font-face was 810 KB of a 3.51 MB file,
 * 22.6% of the deliverable, and no browser that can run an es2022 bundle ever
 * reads it: it takes the first source it understands, which is the WOFF2.
 * Hosted, the second source costs nothing because it is never requested.
 * Inlined, it ships whether anything reads it or not.
 */
test('carries no legacy woff fallback', () => {
  const woff = html.match(/data:font\/woff;base64,/g) ?? []
  assert.deepEqual(
    woff,
    [],
    `${woff.length} legacy WOFF face(s) inlined; every one is dead weight in an email`,
  )
})

test('still carries the woff2 the fallback was standing behind', () => {
  const faces = html.match(/data:font\/woff2;base64,/g) ?? []
  assert.ok(faces.length > 0, 'no font is inlined at all')
})

/**
 * The injection used to be `html.replace('</head>', \`...${payload}...\`)`, a
 * string replacement, which expands $&, $\`, $' and $$ inside the payload. So
 * an analyst's own prose rewrote the deliverable:
 *
 *   "reconciled $& adjusted"  ->  "reconciled </head> adjusted", build exit 0
 *   "cost $$ total"           ->  "cost $ total",                build exit 0
 *   "after $' tail"           ->  the rest of the document spliced into the
 *                                 string literal, so the inline script is a
 *                                 SyntaxError, __ATLAS_DATA__ is undefined,
 *                                 StaticProvider falls back to fetch, and
 *                                 every tab is dead on file://
 *
 * The script-tag balance guard cannot see any of it: it looks for <script,
 * </script, <!-- and -->, and none of these produce one.
 */
test('a bundle value that reads like a $ substitution survives the injection', () => {
  const values = {
    matched: 'reconciled $& adjusted',
    before: 'before $` after',
    after: "after $' tail",
    literal: 'cost $$ total',
    every: "$& $` $' $$ and $0 $1 $<name>",
  }
  const data = embeddedData(buildSynthetic({ bundle_version: 'fixture-dollars', ...values }))
  for (const [key, value] of Object.entries(values)) {
    assert.equal(data['demo.json'][key], value, `${key} was rewritten on the way in`)
  }
})

test('drops the woff fallback but keeps the woff2 in the same face', () => {
  const built = buildSynthetic({ bundle_version: 'fixture-fonts' })
  assert.match(built, /data:font\/woff2;base64,/)
  assert.ok(!/data:font\/woff;base64,/.test(built), 'the woff fallback was inlined anyway')
  assert.ok(!/format\("woff"\)/.test(built), 'a woff source is still listed in src')
})

/**
 * The saving must never cost a face its only source. A stylesheet offering
 * WOFF alone keeps it, because dropping that would be an unstyled deliverable
 * rather than a smaller one.
 */
test('a face offering only woff keeps it', () => {
  const built = buildSynthetic(
    { bundle_version: 'fixture-solo' },
    { css: '@font-face{font-family:Solo;src:url(./demo.woff)format("woff")}' },
  )
  assert.match(built, /data:font\/woff;base64,/)
})

/**
 * Injecting nothing is the same failure as injecting something corrupt: the
 * provider falls back to fetch and the file is dead offline. A dist whose
 * index.html has no </head> to anchor on must stop the build, not produce a
 * quietly dataless file.
 */
test('refuses to emit a file with no data block', () => {
  assert.throws(
    () => buildSynthetic({ bundle_version: 'fixture-nohead' }, { noHead: true }),
    (err) => String(err.stderr ?? '').includes('</head>'),
  )
})
