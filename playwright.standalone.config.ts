import { defineConfig } from '@playwright/test'

import { buildId } from './e2e/env'

// Same chain as the hosted suite: mint the id here so the standalone build
// launched from e2e/standalone.setup.ts inherits it and vite can stamp it.
const BUILD_ID = buildId()

/**
 * The standalone build is opened from a file:// URL, so it needs no server.
 *
 * A separate config rather than a project in the main one, because
 * Playwright's webServer is global: pointing the visual suite at a dev server
 * would also make the offline test depend on one, which is exactly the
 * coupling this suite exists to disprove.
 *
 * Run: npm run e2e:standalone. The build happens inside the run, in the setup
 * project, so there is no "after npm run build:standalone" step to forget and
 * no way to certify a file older than the run certifying it.
 */
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: { viewport: { width: 1440, height: 900 } },
  projects: [
    { name: 'build', testMatch: /standalone\.setup\.ts/ },
    {
      name: 'offline',
      testMatch: /standalone\.spec\.ts/,
      dependencies: ['build'],
    },
  ],
  metadata: { buildId: BUILD_ID },
})
