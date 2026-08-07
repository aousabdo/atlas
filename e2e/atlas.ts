import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, type Page } from '@playwright/test'

import { buildId } from './env'
import type { Tab } from './shots'

/**
 * The single-file deliverable, opened from disk.
 *
 * Lives here rather than in either standalone file because Playwright refuses
 * to let one test file import another, and both the build step and the offline
 * tests need the same path.
 */
export const STANDALONE = pathToFileURL(resolve('dist-standalone/atlas.html')).href

/**
 * Every face the app can use, requested up front.
 *
 * fontsource declares font-display: swap, so a capture taken before the woff2
 * decodes gets fallback metrics: different label widths, different wrap points,
 * a different diagram. The files are bundled, so asking for all six costs
 * nothing over the wire and removes the swap rather than racing it.
 * document.fonts.ready on its own only settles the faces the current render
 * happened to request.
 */
export const FACES = [
  '400 16px Inter',
  '500 16px Inter',
  '600 16px Inter',
  '700 16px Inter',
  '400 16px "JetBrains Mono"',
  '500 16px "JetBrains Mono"',
]

/** Install the font preload before any page script runs. */
export async function preloadFonts(page: Page): Promise<void> {
  await page.addInitScript((faces: string[]) => {
    const load = () =>
      Promise.all(faces.map((face) => document.fonts.load(face, 'ATLAS 0123456789')))
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => void load(), { once: true })
    } else {
      void load()
    }
  }, FACES)
}

/**
 * The one assertion the suite is not allowed to be wrong about.
 *
 * It may be wrong about pixels. It may not be wrong about which build it is
 * looking at. A stale preview, a server left over from another run, a `dist`
 * that predates the change under test: all of them show up here as a mismatched
 * stamp, before anything is compared or written.
 */
export async function expectFreshBuild(page: Page): Promise<void> {
  const served = await page.locator('meta[name="atlas-build"]').getAttribute('content')
  expect(
    served,
    'the page under test is not the build this run produced. The server is ' +
      'answering with different bytes than the build that just ran.',
  ).toBe(buildId())
}

/**
 * Wait for the view to stop moving, then prove it is worth photographing.
 *
 * The previous version waited on networkidle plus a flat 1500ms. Neither says
 * what it needs to: StaticProvider caches every bundle, so after the first tab
 * the network is idle immediately while a ResizeObserver has not yet delivered
 * a size and the graph is still at the identity transform. src/lib/ready.ts
 * publishes the fact directly.
 */
export async function settle(page: Page, tab: Tab): Promise<void> {
  await page.getByRole('heading', { name: tab.heading }).first().waitFor()

  // Force the swap before waiting on readiness, so the reflow it causes has
  // already happened by the time the page calls itself settled.
  await page.evaluate(async (faces: string[]) => {
    await Promise.all(faces.map((face) => document.fonts.load(face, 'ATLAS 0123456789')))
    await document.fonts.ready
  }, FACES)

  await expect(
    page.getByRole('alert'),
    `${tab.name} rendered a failure card where its content should be`,
  ).toHaveCount(0)
  await expect(tab.proof(page)).toBeVisible()

  await page.waitForSelector('html[data-atlas-ready="true"]', { timeout: 20_000 })
  await expectFreshBuild(page)
}

/**
 * The mask colour, read from the page's own tokens.
 *
 * Playwright's default is a hard-coded magenta, which is both a raw hex and
 * unreadable in a diff. Reading --color-surface-2 keeps the masked patches
 * legible in each theme without a literal colour anywhere in the repo.
 */
export async function maskColor(page: Page): Promise<string> {
  const value = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-surface-2').trim(),
  )
  expect(value, '--color-surface-2 did not resolve; the token set is broken').not.toBe('')
  return value
}
