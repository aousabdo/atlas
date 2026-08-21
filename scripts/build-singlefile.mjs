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
 * Split a CSS declaration value on its top-level commas.
 *
 * A naive split would cut inside url(...) and format(...), and once data: URIs
 * are in play their base64 can be arbitrary, so the parens and quotes have to
 * be tracked rather than assumed away.
 */
function splitTopLevel(value) {
  const parts = []
  let depth = 0
  let start = 0
  let quote = null
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '(') {
      depth += 1
    } else if (ch === ')') {
      depth -= 1
    } else if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, i))
      start = i + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

const CSS_URL = /url\(\s*["']?([^"')]+)["']?\s*\)/i

function refOf(part) {
  const m = part.match(CSS_URL)
  return m ? m[1] : null
}

/**
 * Which font format one entry of a `src:` list offers.
 *
 * The format() hint is authoritative when it is there, which for fontsource it
 * always is. The fallbacks matter anyway: Vite inlines the smallest subsets as
 * data: URIs before this build ever sees them, so a reference is not reliably
 * a filename with an extension on the end.
 */
function sourceFormat(part) {
  const hint = part.match(/format\(\s*["']?([^"')]+)["']?\s*\)/i)
  if (hint) return hint[1].toLowerCase()
  const ref = refOf(part)
  if (!ref) return null
  const mime = ref.match(/^data:font\/([a-z0-9]+)/i)
  if (mime) return mime[1].toLowerCase()
  const ext = ref.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)
  return ext ? ext[1].toLowerCase() : null
}

/**
 * Where a declaration value ends, counting parens and quotes rather than
 * stopping at the first ';'.
 *
 * A data: URI carries its own semicolon, as in `data:font/woff2;base64,...`, so a
 * `[^;}]+` value match ends four characters in and reports a one-entry src
 * list for a face that has two. That is not hypothetical: six faces in this
 * stylesheet are already inlined by Vite before the build starts, and they are
 * exactly the ones a naive scan leaves alone.
 */
function findValueEnd(css, start) {
  let depth = 0
  let quote = null
  for (let i = start; i < css.length; i += 1) {
    const ch = css[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (depth === 0 && (ch === ';' || ch === '}')) return i
  }
  return css.length
}

/**
 * Drop the legacy WOFF fallback from any @font-face that also offers WOFF2.
 *
 * fontsource emits every face twice:
 *   src: url(./inter-latin-400-normal.woff2) format("woff2"),
 *        url(./inter-latin-400-normal.woff)  format("woff")
 * On a hosted site that costs nothing, because a browser downloads the first
 * source it understands and never asks for the second. Inlined, both halves
 * are in the file whether or not anything reads them: 810 KB of a 3.51 MB
 * deliverable, 22.6% of what gets emailed to the people this build exists for.
 *
 * Nothing that can run this bundle needs the fallback. The app is compiled to
 * es2022; WOFF2 shipped in Chrome 36, Firefox 39, Edge 14 and Safari 10, all
 * older than that target and none of them able to parse the output.
 *
 * The fallback is removed only when a WOFF2 source survives in the SAME src
 * descriptor, so a face that ships WOFF alone keeps it and no face is ever
 * left with nothing to load. The point is to drop bytes no browser reads, not
 * to drop a font: this build exists to make the offline file work, and an
 * unstyled deliverable would be a worse one, not a smaller one.
 */
function dropWoffFallbacks(css) {
  const SRC = /(?:^|[{;\s])src\s*:\s*/gi
  let dropped = 0
  let out = ''
  let cursor = 0
  let match
  while ((match = SRC.exec(css)) !== null) {
    const valueStart = match.index + match[0].length
    const valueEnd = findValueEnd(css, valueStart)
    SRC.lastIndex = valueEnd
    const parts = splitTopLevel(css.slice(valueStart, valueEnd))
    if (parts.length < 2) continue
    if (!parts.some((p) => sourceFormat(p) === 'woff2')) continue
    const kept = parts.filter((p) => sourceFormat(p) !== 'woff')
    if (!kept.length || kept.length === parts.length) continue
    dropped += parts.length - kept.length
    out += css.slice(cursor, valueStart) + kept.join(',').trim()
    cursor = valueEnd
  }
  out += css.slice(cursor)
  return { css: out, dropped }
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

// Stylesheets first, so their fonts are already data: URIs. The WOFF
// fallbacks are dropped before that, not after, so their bytes are never read
// off disk and never base64'd in the first place.
let woffFallbacksDropped = 0
html = html.replace(
  /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/g,
  (match, href) => {
    const file = join(DIST, href.replace(/^\//, ''))
    if (!existsSync(file)) return match
    const { css, dropped } = dropWoffFallbacks(readFileSync(file, 'utf-8'))
    woffFallbacksDropped += dropped
    return `<style>\n${inlineCssAssets(css, dirname(file))}\n</style>`
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
//
// This deliberately does NOT touch $. The $ substitution patterns are not a
// hazard of the payload, they are a hazard of String.prototype.replace, so
// they are dealt with at the one place that calls it, immediately below.
// Escaping them here would corrupt the data for real.
const payload = JSON.stringify(bundles)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029')

// A no-op replace would emit a file with no __ATLAS_DATA__ at all, which
// StaticProvider answers by falling back to fetch: dead on file://.
if (!html.includes('</head>')) {
  console.error(`No </head> in ${join(DIST, 'index.html')} to inject the data before.`)
  console.error('Refusing to emit a standalone file that would fetch its bundles at runtime.')
  process.exit(1)
}

// A replacer FUNCTION, not a replacement string, and this is load bearing.
// With a string, replace() expands $&, $`, $' and $$ INSIDE the payload, so
// prose an analyst typed into any bundle field rewrites the output:
//   "reconciled $& adjusted"  ->  "reconciled </head> adjusted"   (exit 0)
//   "cost $$ total"           ->  "cost $ total"                  (exit 0)
//   "after $' tail"           ->  the rest of the document spliced into the
//                                 string literal, so the inline script is a
//                                 SyntaxError, __ATLAS_DATA__ is undefined,
//                                 and every tab falls back to a fetch that
//                                 file:// cannot serve.
// None of that is visible to the script-tag balance guard at the end of this
// file, which looks only for <script, </script, <!-- and -->. The function
// form passes the replacement through untouched. Every other rewrite here
// uses one, for exactly this reason.
html = html.replace(
  '</head>',
  () => `<script>window.__ATLAS_DATA__ = ${payload};</script>\n</head>`,
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

// Replacer functions again, never replacement strings. A base64 sha256 has no
// $ in its alphabet so today's hashes are safe either way, but the rule in this
// file is that nothing computed is ever handed to replace() as a string.
html = html.replace(CSP_META, (match, open, quote, policy) => {
  const updated = policy
    .replace(/script-src [^;]+/, () => `script-src 'self' ${scriptHashes.join(' ')}`)
    // The page is opened from file://, which is an opaque origin: 'self'
    // matches nothing, so data: and blob: have to be named explicitly.
    .replace(/img-src [^;]+/, () => "img-src 'self' data: blob:")
    .replace(/font-src [^;]+/, () => "font-src 'self' data:")
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
  `Wrote ${OUT} — ${(bytes / 1024 / 1024).toFixed(2)} MB, ${bundleCount} data bundle(s) inlined, ` +
    `${woffFallbacksDropped} WOFF fallback(s) dropped.`,
)
