import { defineConfig } from '@playwright/test'

/**
 * The deep-link and boot checks, in a real browser, against a running image.
 *
 * scripts/smoke-http.mjs proves what the container answers. It cannot prove
 * the application boots under those answers: that the module scripts load
 * with the content types nginx gives them, that the response headers the
 * container adds (framing, sniffing, referrer, permissions) do not trip the
 * page's own CSP or the export code, and that nothing the page does reaches
 * past its own origin. That takes a browser.
 *
 * No webServer: the server is the image, started by whoever runs this (the
 * Image workflow, or scripts/kind-smoke.sh through a port-forward). Both
 * variables are required, so a run cannot quietly point at a dev server, or
 * at a stale container whose build id nobody checked.
 *
 *   ATLAS_CONTAINER_URL=http://127.0.0.1:8080 ATLAS_BUILD_ID=<commit> \
 *     npx playwright test --config playwright.container.config.ts
 */
const url = process.env.ATLAS_CONTAINER_URL
if (!url) {
  throw new Error('ATLAS_CONTAINER_URL is not set: name the running image to test.')
}
if (!process.env.ATLAS_BUILD_ID) {
  throw new Error(
    'ATLAS_BUILD_ID is not set. It must be the build id the image was built with, ' +
      'so the run proves which image it looked at.',
  )
}

export default defineConfig({
  testDir: './e2e',
  testMatch: /container\.spec\.ts/,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL: url,
    viewport: { width: 1440, height: 900 },
    timezoneId: 'UTC',
    locale: 'en-US',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },
  metadata: { buildId: process.env.ATLAS_BUILD_ID },
})
