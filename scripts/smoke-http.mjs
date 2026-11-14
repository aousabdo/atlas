#!/usr/bin/env node
/**
 * Prove a running ATLAS server behaves the way the hosted app needs it to.
 *
 * Pointed at a base URL and nothing else, so the same checks run against the
 * container on a laptop (`docker run`), against the chart in a throwaway kind
 * cluster (scripts/kind-smoke.sh, through a port-forward), and later against
 * the real cluster's ingress. What it asserts is the contract in the technical
 * plan's Deployment section, as observable from a client:
 *
 *   - a health endpoint the cluster can probe, which nothing caches
 *   - every view is a real route: a deep link answers 200 with the application
 *     document, at the URL that was asked for, with no redirect, so the query
 *     a shared link carries is never rewritten (the hash never leaves the
 *     browser at all)
 *   - hashed assets cache forever; everything else revalidates, so a new
 *     deploy shows up on the next page load
 *   - a missing asset or data file is a real 404, never the application
 *     document dressed up as JavaScript or JSON
 *   - the data served is the invented sample bundle
 *   - the response headers GitHub Pages could not set: framing refused,
 *     sniffing off, no referrer, no server version
 *
 * The deep links are the same ones e2e/deep-link.spec.ts follows on the Pages
 * host. That spec drives a browser because Pages answers a deep link with
 * 404.html and a 404 status, which only a browser renders past. Here the
 * server knows about routes, so the document and the status are checked
 * directly. See docs/kubernetes.md for why the two hosts differ on the status.
 *
 *   node scripts/smoke-http.mjs <base-url> [--build <expected build id>]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SAMPLE_SLUG = JSON.parse(
  readFileSync(join(REPO, 'fixtures', 'synthetic', 'project.json'), 'utf-8'),
).slug

/** Ids from the seeded sample bundle, the same ones the deep-link spec uses. */
export const DEEP_LINKS = [
  '/network?site=northgate&focus=cloud_tak_server',
  '/map?focus=orbit',
  '/lossiness',
  '/reference',
  // Deeper than any route, and a route the app does not have. Both must get
  // the application, which then says "Page not found" itself.
  '/reference/deeper/than/any/route',
  '/nonsense',
]

const IMMUTABLE = /\bmax-age=31536000\b.*\bimmutable\b|\bimmutable\b.*\bmax-age=31536000\b/
const REVALIDATE = /\bno-cache\b/

async function get(base, path, init = {}) {
  const response = await fetch(new URL(path, base), { redirect: 'manual', ...init })
  const body = Buffer.from(await response.arrayBuffer())
  return {
    status: response.status,
    header: (name) => response.headers.get(name) ?? '',
    body,
    text: () => body.toString('utf-8'),
  }
}

/**
 * Run every check against `base` and return one result per check. Never
 * throws for a failed expectation, so a run reports everything that is wrong
 * at once rather than the first thing.
 */
export async function smoke(base, { build } = {}) {
  const results = []
  const check = async (name, fn) => {
    try {
      const problem = await fn()
      results.push({ name, ok: !problem, detail: problem || '' })
    } catch (error) {
      results.push({ name, ok: false, detail: `request failed: ${error.message}` })
    }
  }

  await check('health endpoint answers 200 "ok" and is never cached', async () => {
    const r = await get(base, '/healthz')
    if (r.status !== 200) return `status ${r.status}`
    if (r.text().trim() !== 'ok') return `body ${JSON.stringify(r.text().slice(0, 80))}`
    if (!/\bno-store\b/.test(r.header('cache-control'))) {
      return `cache-control "${r.header('cache-control')}" lacks no-store`
    }
  })

  const index = await get(base, '/index.html').catch(() => null)
  const document = index?.text() ?? ''

  await check('the application document is served and revalidated on every load', async () => {
    if (!index) return 'GET /index.html failed'
    if (index.status !== 200) return `/index.html status ${index.status}`
    if (!index.header('content-type').startsWith('text/html')) {
      return `content-type "${index.header('content-type')}"`
    }
    if (!document.includes('<div id="root"></div>')) return 'no <div id="root"> in /index.html'
    if (!REVALIDATE.test(index.header('cache-control'))) {
      return `cache-control "${index.header('cache-control')}" lacks no-cache`
    }
  })

  await check('the document carries the build id it was built with', async () => {
    const stamp = document.match(/<meta name="atlas-build" content="([^"]+)"/)?.[1]
    if (!stamp) return 'no atlas-build meta tag in /index.html'
    if (build && stamp !== build) return `atlas-build is "${stamp}", expected "${build}"`
  })

  await check('the root serves the application document', async () => {
    const r = await get(base, '/')
    if (r.status !== 200) return `status ${r.status}`
    if (!r.body.equals(index?.body ?? Buffer.alloc(0))) return 'body differs from /index.html'
    if (!REVALIDATE.test(r.header('cache-control'))) {
      return `cache-control "${r.header('cache-control')}" lacks no-cache`
    }
  })

  for (const link of DEEP_LINKS) {
    await check(`deep link ${link} answers 200 with the application, in place`, async () => {
      const r = await get(base, link)
      if (r.status >= 300 && r.status < 400) {
        return `redirected (${r.status}) to ${r.header('location')}; the shared URL must not move`
      }
      if (r.status !== 200) return `status ${r.status}`
      if (!r.header('content-type').startsWith('text/html')) {
        return `content-type "${r.header('content-type')}"`
      }
      if (!r.body.equals(index?.body ?? Buffer.alloc(0))) return 'body is not the application document'
      if (!REVALIDATE.test(r.header('cache-control'))) {
        return `cache-control "${r.header('cache-control')}" lacks no-cache`
      }
    })
  }

  const script = document.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1]
  const style = document.match(/<link[^>]+href="(\/assets\/[^"]+\.css)"/)?.[1]

  await check('the entry script is a hashed asset, cached for a year, immutable', async () => {
    if (!script) return 'no /assets/*.js script tag in the document'
    const r = await get(base, script)
    if (r.status !== 200) return `${script} status ${r.status}`
    if (!/javascript/.test(r.header('content-type'))) {
      return `${script} content-type "${r.header('content-type')}"; a module script refuses anything else`
    }
    if (!IMMUTABLE.test(r.header('cache-control'))) {
      return `${script} cache-control "${r.header('cache-control')}"`
    }
  })

  await check('the stylesheet is a hashed asset, cached for a year, immutable', async () => {
    if (!style) return 'no /assets/*.css link in the document'
    const r = await get(base, style)
    if (r.status !== 200) return `${style} status ${r.status}`
    if (!r.header('content-type').startsWith('text/css')) {
      return `${style} content-type "${r.header('content-type')}"`
    }
    if (!IMMUTABLE.test(r.header('cache-control'))) {
      return `${style} cache-control "${r.header('cache-control')}"`
    }
  })

  await check('assets are compressed for a client that asks', async () => {
    if (!script) return 'no script to fetch'
    const r = await get(base, script, { headers: { 'accept-encoding': 'gzip' } })
    if (r.header('content-encoding') !== 'gzip') {
      return `content-encoding "${r.header('content-encoding')}"`
    }
  })

  await check('a missing asset is a 404, not the application and not cached for a year', async () => {
    const r = await get(base, '/assets/index-doesnotexist.js')
    if (r.status !== 404) return `status ${r.status}`
    if (/javascript/.test(r.header('content-type'))) return 'served as JavaScript'
    if (IMMUTABLE.test(r.header('cache-control'))) return 'the 404 is cached as immutable'
  })

  await check('the data bundle is the invented sample, revalidated on every load', async () => {
    const r = await get(base, '/data/project.json')
    if (r.status !== 200) return `status ${r.status}`
    if (!r.header('content-type').startsWith('application/json')) {
      return `content-type "${r.header('content-type')}"`
    }
    const slug = JSON.parse(r.text())?.slug
    if (slug !== SAMPLE_SLUG) return `project slug "${slug}", expected the sample's "${SAMPLE_SLUG}"`
    if (!REVALIDATE.test(r.header('cache-control'))) {
      return `cache-control "${r.header('cache-control')}" lacks no-cache`
    }
  })

  await check('the data manifest parses', async () => {
    const r = await get(base, '/data/manifest.json')
    if (r.status !== 200) return `status ${r.status}`
    JSON.parse(r.text())
  })

  await check('a missing data file is a 404, not the application document', async () => {
    const r = await get(base, '/data/no-such-file.json')
    if (r.status !== 404) return `status ${r.status}`
  })

  await check('no directory is listed', async () => {
    for (const path of ['/data/', '/data/sites/', '/assets/']) {
      const r = await get(base, path)
      if (r.status === 200) return `${path} answered 200`
    }
  })

  await check('framing, sniffing and referrers are refused in headers', async () => {
    const r = await get(base, '/network?site=northgate')
    const problems = []
    if (!/frame-ancestors 'none'/.test(r.header('content-security-policy'))) {
      problems.push(`content-security-policy "${r.header('content-security-policy')}"`)
    }
    if (r.header('x-frame-options').toUpperCase() !== 'DENY') {
      problems.push(`x-frame-options "${r.header('x-frame-options')}"`)
    }
    if (r.header('x-content-type-options') !== 'nosniff') {
      problems.push(`x-content-type-options "${r.header('x-content-type-options')}"`)
    }
    if (r.header('referrer-policy') !== 'no-referrer') {
      problems.push(`referrer-policy "${r.header('referrer-policy')}"`)
    }
    return problems.join('; ')
  })

  await check('the security headers survive onto assets and data, not only the document', async () => {
    for (const path of [script ?? '/index.html', '/data/project.json']) {
      const r = await get(base, path)
      if (r.header('x-content-type-options') !== 'nosniff') return `${path} lacks nosniff`
    }
  })

  await check('the server does not announce its version', async () => {
    const r = await get(base, '/')
    if (/\d+\.\d+/.test(r.header('server'))) return `server "${r.header('server')}"`
  })

  return results
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const base = args.find((a) => !a.startsWith('--'))
  const at = args.indexOf('--build')
  const build = at >= 0 ? args[at + 1] : undefined
  if (!base) {
    console.error('usage: node scripts/smoke-http.mjs <base-url> [--build <id>]')
    process.exit(2)
  }

  const results = await smoke(base, { build })
  for (const r of results) {
    console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`)
  }
  const failed = results.filter((r) => !r.ok).length
  if (failed) {
    console.error(`\nSMOKE FAILED against ${base}: ${failed} of ${results.length} check(s).`)
    process.exit(1)
  }
  console.log(`\nSmoke passed against ${base}: ${results.length} check(s).`)
}
