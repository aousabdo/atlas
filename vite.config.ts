import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

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

export default defineConfig({
  base: standalone ? './' : base,
  plugins: [react(), tailwindcss(), stampBuild],
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
