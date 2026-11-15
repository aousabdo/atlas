import { expect, test, type Page } from '@playwright/test'

import { expectFreshBuild } from './atlas'

/**
 * A shared link, opened in a browser, against the container image.
 *
 * The same links as deep-link.spec.ts, which proves them on the GitHub Pages
 * host. There the host answers a deep link with 404.html; here the server
 * knows the views are routes and answers 200, so the response status is part
 * of what is asserted. Run with playwright.container.config.ts, which needs
 * the image's URL and the build id it was built with.
 *
 * Every test also watches the page for two things the container must never
 * cause: an error in the console (a header that trips the page's CSP, a module
 * refused for its content type) and a request to any origin but the image's
 * own. The hosted app makes no external calls at runtime, and this is where a
 * browser gets to say so.
 */

/** Ids from the seeded sample bundles; see scripts/seed-data.mjs. */
const SITE = 'northgate'
const DEVICE = 'cloud_tak_server'
const SYSTEM = 'orbit'

const errors: string[] = []
const elsewhere: string[] = []

test.beforeEach(async ({ page, baseURL }) => {
  errors.length = 0
  elsewhere.length = 0
  const origin = new URL(baseURL!).origin
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    // data: and blob: are the page's own memory (fonts, export canvases).
    if (url.protocol === 'data:' || url.protocol === 'blob:') return
    if (url.origin !== origin) elsewhere.push(request.url())
  })
})

test.afterEach(() => {
  expect(errors, 'the page logged errors under the container').toEqual([])
  expect(elsewhere, 'the page reached past its own origin').toEqual([])
})

/** Open a shared link and say where the reader ended up, as deep-link.spec.ts does. */
async function follow(page: Page, target: string): Promise<void> {
  const response = await page.goto(target)
  expect(response?.status(), `${target} must answer 200 from the container`).toBe(200)
  expect(await page.locator('#root').count()).toBe(1)
  await page.waitForSelector('html[data-atlas-ready="true"]', { timeout: 20_000 })
  expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(
    target,
  )
  await expectFreshBuild(page)
}

test('a deep link into a view opens that view, at the URL that was shared', async ({ page }) => {
  await follow(page, `/network?site=${SITE}&focus=${DEVICE}`)
  await expect(page.getByRole('heading', { name: /Network Topology/i })).toBeVisible()
  await expect(page.locator(`[data-testid="device-${DEVICE}"]`)).toBeVisible()
})

test('the query string and the hash both survive the round trip', async ({ page }) => {
  await follow(page, `/map?focus=${SYSTEM}#deep-link`)
  expect(await page.evaluate(() => window.location.search)).toBe(`?focus=${SYSTEM}`)
  expect(await page.evaluate(() => window.location.hash)).toBe('#deep-link')
  await expect(page.getByRole('heading', { name: /Orientation Map/i })).toBeVisible()
  await expect(page.locator(`[data-testid="leaf-${SYSTEM}"]`)).toBeVisible()
})

test('a route the app does not have gets the app saying so, not the server', async ({ page }) => {
  await follow(page, '/nonsense')
  await expect(page.getByRole('heading', { name: /Page not found/i })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Orientation Map' })).toBeVisible()
})

test('the root opens the default view, which renders the sample data', async ({ page, baseURL }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  await page.waitForSelector('html[data-atlas-ready="true"]', { timeout: 20_000 })
  await expectFreshBuild(page)
  await expect(page).toHaveURL(`${baseURL}/reference`)
  await expect(page.getByRole('alert'), 'the default view rendered a failure card').toHaveCount(0)
})
