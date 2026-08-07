#!/usr/bin/env node
/**
 * Build the self-contained single-file HTML deliverable.
 *
 * ATLAS's actual users are DHS people who may be on networks that cannot reach
 * atlas.analyticadss.com. A URL they cannot open is worthless to them, so the
 * hosted app is the editor and this file is the deliverable: one HTML file you
 * can email or hand over on a stick, with every asset and every data bundle
 * inlined.
 *
 * Reads dist/ (so run `npm run build` first) and writes dist-standalone/atlas.html.
 *
 * StaticProvider checks window.__ATLAS_DATA__ before fetching, which is what
 * lets the same application code run both online and from a file:// URL.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'

// Defaults to the single-chunk standalone build; see vite.config.ts for why a
// split-chunk build cannot be inlined into one file.
const DIST = process.argv[2] ?? 'dist-standalone-build'
const DATA = join(DIST, 'data')
const OUT_DIR = 'dist-standalone'
const OUT = join(OUT_DIR, 'atlas.html')

if (!existsSync(DIST)) {
  console.error(`No ${DIST}/. Run \`ATLAS_STANDALONE=1 vite build\` first.`)
  process.exit(1)
}

const MIME = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
}

function dataUri(path) {
  const ext = extname(path)
  const mime = MIME[ext] ?? 'application/octet-stream'
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`
}

/**
 * Inline every url(...) in a stylesheet as a data: URI.
 *
 * References are resolved against the stylesheet's own directory, not the
 * output root: with base './' Vite emits `url(./inter-....woff2)` relative to
 * the CSS file, and resolving those from the root silently finds nothing.
 * Unresolved references are fatal rather than passed through, because a font
 * that 404s on an air-gapped machine is exactly the failure this build exists
 * to prevent.
 */
function inlineCssAssets(css, cssDir) {
  const missing = []
  const out = css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (match, ref) => {
    if (/^(data:|https?:|#)/.test(ref)) return match
    const clean = ref.split(/[?#]/)[0]
    const candidates = clean.startsWith('/')
      ? [join(DIST, clean.slice(1))]
      : [resolve(cssDir, clean), join(DIST, clean)]
    const asset = candidates.find((c) => existsSync(c))
    if (!asset) {
      missing.push(ref)
      return match
    }
    return `url("${dataUri(asset)}")`
  })
  if (missing.length) {
    console.error(`Could not resolve ${missing.length} stylesheet asset(s):`)
    for (const m of [...new Set(missing)].slice(0, 5)) console.error(`  ${m}`)
    process.exit(1)
  }
  return out
}

/** Walk public/data and key every bundle by its path relative to data/. */
function collectBundles(dir, base = dir) {
  const out = {}
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) Object.assign(out, collectBundles(full, base))
    else if (extname(full) === '.json') {
      out[relative(base, full).split(/[\\/]/).join('/')] = JSON.parse(
        readFileSync(full, 'utf-8'),
      )
    }
  }
  return out
}

let html = readFileSync(join(DIST, 'index.html'), 'utf-8')

// Stylesheets first, so their fonts are already data: URIs.
html = html.replace(
  /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/g,
  (match, href) => {
    const file = join(DIST, href.replace(/^\//, ''))
    if (!existsSync(file)) return match
    return `<style>\n${inlineCssAssets(readFileSync(file, 'utf-8'), dirname(file))}\n</style>`
  },
)

// The data goes in before any script is inlined. Vite emits the module tag in
// <head>, and the bundle's own DOM code contains the literal string
// '<html ...><head></head>', so injecting afterwards anchors on that instead of
// the document's real head and buries the payload inside a string literal.
const bundles = collectBundles(DATA)
const bundleCount = Object.keys(bundles).length
if (!bundleCount) {
  console.error(`No JSON bundles under ${DATA}. Run the ingest first.`)
  process.exit(1)
}

// U+2028 and U+2029 are valid JSON but illegal raw in a JavaScript string
// literal. Every < becomes \u003c, which also covers the tokenizer sequences.
const payload = JSON.stringify(bundles)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029')

html = html.replace(
  '</head>',
  `<script>window.__ATLAS_DATA__ = ${payload};</script>\n</head>`,
)

/**
 * Make JavaScript safe to sit inside a <script> element.
 *
 * Escaping only </script> is not enough. The HTML tokenizer has a
 * script-data-escaped state that `<!--` enters and `<script` deepens, and in
 * that state a later </script> does not close the element: the rest of the
 * document is swallowed as script text. html2canvas-pro trips exactly this,
 * with a literal "<script><\/script>" in its DOM cloning path and two HTML
 * comment markers elsewhere.
 *
 * All four sequences appear inside string literals in minified bundles, where
 * \x3c and \x3e are the same characters to the JavaScript parser and inert to
 * the HTML one. This is the same transform bundlers apply to inline scripts.
 */
function escapeForInlineScript(code) {
  return code
    .replace(/<\/script/gi, '\\x3c/script')
    .replace(/<script/gi, '\\x3cscript')
    .replace(/<!--/g, '\\x3c!--')
    .replace(/-->/g, '--\\x3e')
}

// Module scripts. Order is preserved; the bundle is already dependency-ordered.
html = html.replace(
  /<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/g,
  (match, src) => {
    const file = join(DIST, src.replace(/^\//, ''))
    if (!existsSync(file)) return match
    return `<script type="module">\n${escapeForInlineScript(readFileSync(file, 'utf-8'))}\n</script>`
  },
)

// The favicon is a real request too. Left as a path it 404s from file://,
// which is a broken tab icon on exactly the machines this build is for.
html = html.replace(
  /<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["'][^>]*>/g,
  (match, href) => {
    if (/^data:/.test(href)) return match
    const file = join(DIST, href.replace(/^\//, ''))
    if (!existsSync(file)) return match
    return `<link rel="icon" type="image/svg+xml" href="${dataUri(file)}" />`
  },
)

// Any remaining modulepreload hints point at files that are now inlined.
html = html.replace(/<link[^>]*rel=["']modulepreload["'][^>]*>/g, '')


/**
 * Everything is inline now, which `script-src 'self'` forbids. Add a sha256
 * hash per inline script rather than relaxing to 'unsafe-inline': hashes
 * permit exactly these scripts and nothing else, and a CSP that lists hashes
 * makes browsers ignore 'unsafe-inline' entirely.
 */
const scriptHashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map(([, body]) => `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)

// The delimiter is captured and backreferenced rather than excluded by a
// character class: the policy itself is full of single quotes ('self', 'none'),
// so [^"']+ captures "default-src " and stops.
const CSP_META = /(<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=(["']))([\s\S]*?)\2/i

if (!CSP_META.test(html)) {
  console.error('No Content-Security-Policy meta tag found in dist/index.html.')
  console.error('Refusing to emit a standalone file whose scripts the CSP would block.')
  process.exit(1)
}

html = html.replace(CSP_META, (match, open, quote, policy) => {
  const updated = policy
    .replace(/script-src [^;]+/, `script-src 'self' ${scriptHashes.join(' ')}`)
    // The page is opened from file://, which is an opaque origin: 'self'
    // matches nothing, so data: and blob: have to be named explicitly.
    .replace(/img-src [^;]+/, "img-src 'self' data: blob:")
    .replace(/font-src [^;]+/, "font-src 'self' data:")
  return `${open}${updated}${quote}`
})

if (!html.includes('sha256-')) {
  console.error('CSP rewrite produced no script hashes; the standalone would not run.')
  process.exit(1)
}

/**
 * Every <script> must be closed by the very next </script>. If a sequence slips
 * through escapeForInlineScript, the tokenizer swallows the rest of the file
 * and the page renders blank with one confusing syntax error. Fail here rather
 * than shipping that.
 */
const openTags = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)]
const closeTags = [...html.matchAll(/<\/script>/g)].map((m) => m.index)
if (openTags.length !== closeTags.length) {
  console.error(
    `Unbalanced script tags: ${openTags.length} open, ${closeTags.length} close. ` +
      `A bundle sequence is escaping its element.`,
  )
  process.exit(1)
}
for (const [i, open] of openTags.entries()) {
  const body = html.slice(open.index + open[0].length, closeTags[i])
  const found = body.match(/<script|<\/script|<!--|-->/i)
  if (found) {
    console.error(
      `Script ${i + 1} (${open[0]}) contains a raw ${found[0]} at offset ${found.index}; ` +
        `it would not close.`,
    )
    console.error(`  ...${body.slice(Math.max(0, found.index - 80), found.index + 40)}...`)
    process.exit(1)
  }
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, html, 'utf-8')

const bytes = Buffer.byteLength(html)
console.log(
  `Wrote ${OUT} — ${(bytes / 1024 / 1024).toFixed(2)} MB, ${bundleCount} data bundle(s) inlined.`,
)
