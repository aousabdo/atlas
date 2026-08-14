import { copyFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Logger, type Plugin } from 'vite'

// Served from the root of its own domain (see public/CNAME). ATLAS_BASE lets a
// subpath deploy (e.g. the bare github.io project URL) work without an edit.
const base = process.env.ATLAS_BASE ?? '/'

/**
 * Identity of this build, stamped into the document head.
 *
 * The visual suite mints a fresh ATLAS_BUILD_ID per run and then asserts the
 * page in the browser carries it. Without that, nothing tied the bytes under
 * test to the build the run had just produced, and a run could compare a stale
 * page against stale baselines and agree with itself.
 *
 * A meta tag rather than an inline script, because script-src is 'self' with
 * no unsafe-inline (see index.html) and the single-file build recomputes
 * script hashes. A meta tag is inert: no URL for check-offline.mjs to flag, no
 * pixels for a baseline to notice.
 */
const buildId =
  process.env.ATLAS_BUILD_ID ??
  process.env.GITHUB_SHA ??
  `local-${Date.now().toString(36)}`

const stampBuild: Plugin = {
  name: 'atlas-build-stamp',
  transformIndexHtml: {
    order: 'post',
    handler: (html) => ({
      html,
      tags: [
        {
          tag: 'meta',
          attrs: { name: 'atlas-build', content: buildId },
          injectTo: 'head',
        },
      ],
    }),
  },
}

/**
 * The standalone build must be one chunk.
 *
 * Split chunks are right for the hosted app: d3 and the export libraries are
 * large and change rarely, so a separate vendor chunk survives app-code
 * deploys. But the entry module then imports its siblings by path, and a
 * page opened from file:// cannot load them — the browser treats each as a
 * cross-origin request from a null origin and blocks it. So the single-file
 * deliverable is built separately, with everything in one module.
 */
const standalone = process.env.ATLAS_STANDALONE === '1'

/**
 * The document a static host serves when the path names no file.
 *
 * Every view is a real route, so /network is a URL a reader shares. A static
 * host has no file called `network`, so it answers 404 and the link is dead.
 * GitHub Pages, S3 and most of the others answer a miss with 404.html when the
 * site ships one, which is the hook this uses.
 *
 * It is a byte copy of index.html, not a redirector. The usual trick encodes
 * the requested path into a query string, bounces through the root and puts it
 * back with history.replaceState, which costs an inline script the CSP would
 * have to be relaxed or hashed for, a round trip through a route that
 * redirects to /reference, and hand-written re-encoding of the query and hash
 * that a shared link depends on. Serving the application document at the
 * requested URL loses none of that, because nothing moves: the browser never
 * leaves the URL it was given, the router reads it exactly as it would on any
 * server, and the hash never reaches the host in the first place.
 *
 * Assets survive the depth because base is absolute (/assets/..., /data/...),
 * so the same document works at any path. The response keeps its 404 status,
 * which is honest, because the file really is not there, and browsers render
 * the body regardless.
 *
 * Not emitted for the standalone build: it is opened from file://, uses
 * HashRouter, and has no host to answer anything.
 */
function staticHostFallback(): Plugin {
  let outDir = 'dist'
  let logger: Logger

  return {
    name: 'atlas-static-host-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      logger = config.logger
    },
    // writeBundle, not generateBundle: index.html is emitted by another
    // plugin's generateBundle, and reading it after everything is on disk is
    // the only ordering that cannot be wrong about which bytes it copied.
    writeBundle() {
      const index = join(outDir, 'index.html')
      if (!existsSync(index)) {
        // Shipping a build whose deep links are dead is worse than not
        // shipping one, so this is fatal rather than a warning.
        throw new Error(
          `atlas-static-host-fallback: no ${index} to copy, so the build would ` +
            'ship with no 404 document and every route but the root would be a ' +
            'dead link on a static host.',
        )
      }
      copyFileSync(index, join(outDir, '404.html'))
      logger.info('404.html written, so deep links resolve on a static host.')
    },
  }
}

export default defineConfig({
  base: standalone ? './' : base,
  plugins: [
    react(),
    tailwindcss(),
    stampBuild,
    ...(standalone ? [] : [staticHostFallback()]),
  ],
  build: {
    target: 'es2022',
    outDir: standalone ? 'dist-standalone-build' : 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: standalone
        ? { inlineDynamicImports: true }
        : {
            manualChunks: {
              viz: ['d3', 'd3-sankey'],
              exporters: ['html2canvas-pro', 'jspdf'],
              sheets: ['xlsx'],
            },
          },
    },
  },
})
