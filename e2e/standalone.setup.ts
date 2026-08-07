import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { STANDALONE } from './atlas'
import { buildId } from './env'

/**
 * Build the deliverable this run is about to test.
 *
 * dist-standalone/atlas.html is gitignored, so on a clean checkout it does not
 * exist and on a developer's machine it is whatever was built last. Reading it
 * off disk and calling the result a pass is the same staleness defect as
 * testing a stale preview, applied to the artifact that actually ships to
 * air-gapped users.
 *
 * Building it here, inside the run, and then checking the stamp means
 * atlas.html can never be older than the tests certifying it.
 */
test('the standalone deliverable is the one this run built', async ({ page }) => {
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { stdio: 'inherit', env: process.env })

  run('npm', ['run', 'build:standalone'])

  await page.goto(STANDALONE)
  const served = await page.locator('meta[name="atlas-build"]').getAttribute('content')
  expect(
    served,
    'atlas.html is not the file this run built. Something else wrote it, or the ' +
      'build stamp did not survive scripts/build-singlefile.mjs.',
  ).toBe(buildId())
})
