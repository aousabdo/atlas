import { expect, test } from '@playwright/test'

import { STANDALONE } from './atlas'
import { buildId } from './env'

/**
 * The offline guarantee, tested rather than claimed.
 *
 * Loads the single-file build from a file:// URL with every network request
 * aborted, so anything the page still needs from the network fails hard. The
 * previous tool asserted this in its README while loading five assets from
 * CDNs, and that claim had already been shown to stakeholders.
 *
 * The file is built by the "build" project this one depends on, so it is
 * always the deliverable this run produced.
 */

test.describe('single-file standalone build', () => {
  test.beforeEach(async ({ page }) => {
    // Block the network, but only the network: a `**://**` pattern also
    // matches the file:// navigation and aborts the page load itself.
    await page.route('http://**', (route) => route.abort())
    await page.route('https://**', (route) => route.abort())
  })

  test('is the deliverable this run built', async ({ page }) => {
    await page.goto(STANDALONE)
    const served = await page.locator('meta[name="atlas-build"]').getAttribute('content')
    expect(served, 'atlas.html predates this run').toBe(buildId())
  })

  test('renders every tab from a file URL with the network cut', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(STANDALONE)

    // The router uses real paths; from file:// the app still boots at its
    // default view, which is the reference tab.
    await expect(
      page.getByRole('heading', { name: /Reference & Methodology/i }).first(),
    ).toBeVisible({ timeout: 15_000 })

    for (const name of ['Analytics', 'Lossiness', 'Network Topology', 'Orientation Map']) {
      await page.getByRole('tab', { name }).click()
      await expect(page.getByRole('heading', { name }).first()).toBeVisible({
        timeout: 15_000,
      })
    }

    expect(errors, `console errors offline: ${errors.join(' | ')}`).toEqual([])
  })

  test('serves its data from the inlined bundles', async ({ page }) => {
    await page.goto(STANDALONE)
    const counts = await page.evaluate(() => {
      const data = (window as unknown as { __ATLAS_DATA__?: Record<string, unknown> })
        .__ATLAS_DATA__
      if (!data) return null
      return {
        systems: (data['systems.json'] as unknown[]).length,
        requirements: (data['crosswalk.json'] as unknown[]).length,
        dimensions: (data['lossiness.json'] as { dimensions: unknown[] }).dimensions.length,
      }
    })
    expect(counts).toEqual({ systems: 32, requirements: 11, dimensions: 7 })
  })

  test('uses a font it actually shipped, not a system fallback', async ({ page }) => {
    await page.goto(STANDALONE)
    await page.getByRole('heading').first().waitFor()
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready
      return document.fonts.size > 0
    })
    expect(loaded).toBe(true)
  })
})
