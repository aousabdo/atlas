import { defineConfig } from '@playwright/test'

import { buildId, renderEnv } from './e2e/env'

const CI = !!process.env.CI

// Minted before the config object is built, so the value is already in
// process.env when Playwright forks the web server and the workers. See
// e2e/env.ts for why the whole chain hangs off this.
const BUILD_ID = buildId()

/**
 * scripts/falsify.mjs replaces the server command so it can serve a build the
 * run did not produce. That is the only honest way to prove the stale-build
 * assertion fails when it should. It weakens the harness, so it is refused
 * unless the falsifier is the caller, and never honoured in CI.
 */
const override = process.env.ATLAS_FALSIFY_SERVER_CMD
if (override && (process.env.ATLAS_FALSIFY !== '1' || CI)) {
  throw new Error(
    'ATLAS_FALSIFY_SERVER_CMD is only honoured by scripts/falsify.mjs, and never in CI.',
  )
}

const SERVE =
  override ??
  // Port 0 lets the OS pick. A fixed port could collide with a developer's own
  // preview, and the failure mode of a fixed port is either an abort before any
  // test runs or, if the probe misses, a run against somebody else's bytes.
  'npm run build && npm run preview -- --host 127.0.0.1 --port 0 --strictPort'

export default defineConfig({
  testDir: './e2e',
  forbidOnly: CI,
  // A retry converts a flake into a pass and hides it. If a test is unstable
  // that is a defect in the test, and this suite exists to surface defects.
  retries: 0,

  /**
   * Never write a baseline as a side effect of running the suite.
   *
   * The default, "missing", writes the file and fails once; the next run then
   * passes against a baseline nobody has looked at. "none" makes a missing
   * baseline a hard failure that writes nothing. A deliberate
   * `--update-snapshots=all` on the command line still overrides this.
   */
  updateSnapshots: 'none',

  // One directory per rendering environment. Dropping the platform entirely
  // would let a linux run half-match a darwin file; welding it onto the
  // filename made the mismatch look like a missing snapshot. See e2e/env.ts.
  snapshotPathTemplate: `{testDir}/__screenshots__/${renderEnv()}/{arg}{ext}`,

  expect: {
    toHaveScreenshot: {
      /**
       * Both numbers are measured, not guessed.
       *
       * An absolute cap, never a ratio: as a ratio, tolerance scaled with page
       * height, so on the 1440x8256 reference tab 1% licensed 118,886 pixels
       * of unreviewed change, which is more than a whole toolbar.
       *
       * The threshold matters more than the cap on a dark, low-contrast UI.
       * Deleting one button from the map toolbar registers as 245 different
       * pixels at Playwright's default threshold of 0.2, and as 3,395 at 0.01,
       * because most of the change is dim grey moving over dark blue and the
       * default writes that off as noise. At 0.2 that regression passed even
       * with the cap at zero, which is how a reworked toolbar survived a
       * baseline refresh in the first place.
       *
       * Noise at 0.01 is genuinely zero here: three consecutive full runs and
       * two rebuilds produced byte-identical captures with the cap at 0.
       *
       * The cap was 100 for a while, on the strength of one measurement:
       * deleting a control from MapToolbar moves 3,395 pixels at this
       * threshold, so 100 read as harmless headroom 34x below the smallest real
       * regression. MapToolbar is also the single surface with a DOM inventory
       * test standing behind it, so it was the least representative thing that
       * could have been calibrated against. ViewStrip is an inline-grid: taking
       * its only action away empties a cell and reflows nothing else, and the
       * same class of regression there moves 33 pixels dark and 35 light. Under
       * 100 that shipped. Over a noise floor of zero, headroom buys nothing and
       * licenses exactly this.
       */
      maxDiffPixels: 0,
      threshold: 0.01,
      // Here rather than per call, so a new screenshot cannot be added without
      // them.
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  use: {
    // Captured from the preview's own startup line by webServer.wait below.
    // Undefined in the runner process and set by the time a worker re-reads
    // this config, which is when it is needed.
    baseURL: process.env.ATLAS_E2E_URL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    // Nothing formats a date at render time today, but TrendView sorts snapshot
    // labels with localeCompare, so a differing locale or timezone is free to
    // move a baseline later.
    timezoneId: 'UTC',
    locale: 'en-US',
    // The app kills every animation and transition under this query
    // (src/styles/index.css), so the page settles by its own rule rather than
    // by Playwright patching it from the outside. page.emulateMedia in the
    // spec only sets colorScheme, so the two compose.
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /identity\.setup\.ts/,
    },
    {
      name: 'app',
      // standalone.spec.ts drives dist-standalone/atlas.html from a file:// URL
      // and has its own config, which builds that file inside the run.
      // Collected here it validated whichever single-file build happened to be
      // lying around, and failed outright in CI where none is built yet.
      testIgnore: [/standalone\./, /identity\.setup\.ts/],
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: SERVE,
    /**
     * Vite prints its url only once it is listening, so this is the readiness
     * signal and the port discovery in one. Playwright uppercases the named
     * group into process.env, so ATLAS_E2E_URL is set before any worker forks.
     * Control characters are stripped before matching, so FORCE_COLOR is fine.
     */
    wait: { stdout: /Local:[^\n]*?(?<atlas_e2e_url>http:\/\/127\.0\.0\.1:\d+)/ },
    // Without this a tsc failure is an exit code and nothing else: `tsc
    // --noEmit` writes its diagnostics to stdout, which defaults to "ignore".
    stdout: 'pipe',
    // A reused server means a reused console buffer, and stale errors then read
    // as fresh ones. Always start clean.
    reuseExistingServer: false,
    env: { ATLAS_BUILD_ID: BUILD_ID },
    timeout: 240_000,
  },
})
