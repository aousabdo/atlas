import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { buildId, renderEnv } from './env'
import { SHOTS } from './shots'

/**
 * The gate every other project depends on.
 *
 * Two things have to be true before a single screenshot is taken or rewritten:
 * the page in the browser is the build this run produced, and the baselines
 * this environment is supposed to compare against are all present. Both used
 * to be assumed. A run that assumed them compared a stale page to stale
 * baselines and reported "21 passed".
 *
 * Because the app projects declare `dependencies: ['setup']`, a failure here
 * stops the run outright. Even `--update-snapshots=all` cannot then write a
 * baseline from a page nobody has proven is the right one.
 */

test('the page under test is the build this run produced', async ({ page, baseURL }) => {
  expect(process.env.ATLAS_BUILD_ID, 'the runner did not stamp a build id').toBeTruthy()
  expect(
    baseURL,
    'no server url was captured from the web server. The preview did not print ' +
      'a Local: line, so nothing knows which port to test.',
  ).toBeTruthy()

  const response = await page.goto('/')
  expect(response?.status(), 'the preview server did not serve the app').toBe(200)

  const served = await page.locator('meta[name="atlas-build"]').getAttribute('content')
  expect(
    served,
    'the served page carries a different build id than this run produced. ' +
      'Either a server from another run is answering, or the build did not rerun.',
  ).toBe(buildId())
})

test('every baseline this environment compares against exists', ({}, testInfo) => {
  // Playwright's default layout, which the suite no longer uses. Left in place
  // it is 4.6MB of files that look authoritative, are compared by nothing, and
  // would be resurrected by any run that reverted snapshotPathTemplate.
  const legacy = join(testInfo.project.testDir, 'visual.spec.ts-snapshots')
  expect(
    existsSync(legacy),
    `${legacy} is the pre-environment baseline layout and nothing reads it. Delete it.`,
  ).toBe(false)

  const env = renderEnv()
  const dir = join(testInfo.project.testDir, '__screenshots__', env)
  const actual = existsSync(dir)
    ? readdirSync(dir).filter((file) => file.endsWith('.png'))
    : []

  const orphans = actual.filter((file) => !SHOTS.includes(file))
  expect(
    orphans,
    `baselines with no test behind them in ${dir}. Nothing compares these, so ` +
      'nobody will notice when they go stale. Delete them or restore the test.',
  ).toEqual([])

  // A refresh run is allowed to start from nothing; that is how a new
  // environment is bootstrapped. Every other run must have the full set,
  // because a missing baseline is the failure mode this project exists to stop.
  if (testInfo.config.updateSnapshots !== 'none') return

  const missing = SHOTS.filter((file) => !actual.includes(file))
  expect(
    missing,
    `no baseline for rendering environment "${env}" at ${dir}.\n` +
      'Screenshots are not portable between font stacks and Chromium builds, so ' +
      'each environment carries its own set. To produce them, run the CI ' +
      '"Refresh visual baselines" workflow (Actions -> CI -> Run workflow, with ' +
      'refresh_baselines checked), download the refreshed-baselines artifact, ' +
      'unzip it over e2e/__screenshots__/, and review the diff before committing.',
  ).toEqual([])
})
