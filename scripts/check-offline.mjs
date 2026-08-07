#!/usr/bin/env node
/**
 * Assert the built output loads nothing from the network.
 *
 * "Works offline and air-gapped" was claimed of the previous tool and was not
 * true: D3, html2canvas, jsPDF and two Google Fonts stylesheets all came from
 * CDNs at page open. A claim like that only counts if something enforces it,
 * so this runs in CI on every push.
 *
 * It looks for remote URLs in positions that actually cause a fetch — element
 * src/href, CSS url(), ES module specifiers, fetch/XHR calls — rather than
 * grepping for the substring "https://". React and React Router both embed
 * documentation links in error message strings; those are inert text and
 * flagging them would train everyone to ignore this check.
 *
 * Usage: node scripts/check-offline.mjs [distDir]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const DIST = process.argv[2] ?? 'dist'
const REMOTE = String.raw`(?:https?:)?//[a-zA-Z0-9.-]+`

const PATTERNS = [
  { name: 'element src', re: new RegExp(String.raw`\bsrc\s*=\s*["'](${REMOTE})`, 'gi') },
  { name: 'element href', re: new RegExp(String.raw`\bhref\s*=\s*["'](${REMOTE})`, 'gi') },
  { name: 'CSS url()', re: new RegExp(String.raw`url\(\s*["']?(${REMOTE})`, 'gi') },
  { name: 'CSS @import', re: new RegExp(String.raw`@import\s+["'](${REMOTE})`, 'gi') },
  { name: 'module import', re: new RegExp(String.raw`\bfrom\s*["'](${REMOTE})`, 'gi') },
  { name: 'dynamic import', re: new RegExp(String.raw`\bimport\(\s*["'](${REMOTE})`, 'gi') },
  { name: 'fetch', re: new RegExp(String.raw`\bfetch\(\s*["'](${REMOTE})`, 'gi') },
  { name: 'XHR open', re: new RegExp(String.raw`\.open\(\s*["'][A-Z]+["']\s*,\s*["'](${REMOTE})`, 'gi') },
  { name: 'importScripts', re: new RegExp(String.raw`importScripts\(\s*["'](${REMOTE})`, 'gi') },
]

/** Namespace URLs are identifiers, never fetched. */
const ALLOWED_HOSTS = new Set(['www.w3.org', 'schema.org'])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (['.html', '.js', '.css', '.mjs'].includes(extname(full))) out.push(full)
  }
  return out
}

function hostOf(url) {
  return url.replace(/^(?:https?:)?\/\//, '').split(/[/?#]/)[0]
}

let failures = 0
let scanned = 0

for (const file of walk(DIST)) {
  scanned += 1
  const text = readFileSync(file, 'utf-8')
  for (const { name, re } of PATTERNS) {
    for (const match of text.matchAll(re)) {
      const url = match[1]
      if (ALLOWED_HOSTS.has(hostOf(url))) continue
      failures += 1
      console.error(`  ✗ ${file}: ${name} -> ${url}`)
    }
  }
}

if (failures) {
  console.error(
    `\nBUILD FAIL — ${failures} remote asset reference(s) in ${DIST}.\n` +
      `ATLAS is delivered to air-gapped networks. Anything fetched at runtime ` +
      `is a blank panel for the users who matter most.`,
  )
  process.exit(1)
}

console.log(
  `Offline check passed — ${scanned} built file(s), no remote asset references.`,
)
