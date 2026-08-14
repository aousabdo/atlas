import { expect, test, type Page } from '@playwright/test'

import { expectFreshBuild } from './atlas'
import { startPagesHost, type PagesHost } from './pages-host'

/**
 * A shared link has to open the thing it points at.
 *
 * The app uses real routes, so /network?site=... is a URL a reader pastes into
 * a message. GitHub Pages serves static files: it looks for a file called
 * `network`, finds none, and answers 404. Every view except the root is
 * therefore a dead link the day Pages is enabled, which is also the day
 * somebody first shares one.
 *
 * These tests run against e2e/pages-host.ts, not the preview server, because
 * the preview server rewrites unmatched paths to index.html on its own and
 * would report a pass no matter what the build contains. See that file.
 *
 * They assert the URL the browser ends up on, not that some file exists. The
 * two failure modes are different and only the landing URL separates them: a
 * host that serves nothing leaves the reader on an error page, and a fallback
 * that bounces through the root leaves them on a working app showing the wrong
 * view, which is the one that looks fine in a screenshot.
 */

let host: PagesHost

test.beforeAll(async () => {
  host = await startPagesHost('dist')
})

test.afterAll(async () => {
  await host.close()
})

/** Ids from the seeded sample bundles; see scripts/seed-data.mjs. */
const SITE = 'northgate'
const DEVICE = 'cloud_tak_server'
const SYSTEM = 'orbit'

/**
 * Follow a link the way a reader would, and say where they actually ended up.
 *
 * The order of these three checks is the point. `#root` is in the served
 * document itself, so counting it settles instantly and separates "the host
 * answered with something that is not the app" from every other failure
 * without a thirty-second wait for a selector. Then the app is allowed to
 * finish booting, because a fallback that redirects does so during boot and an
 * address read before that would still show the shared URL. Only then is the
 * landing URL worth asserting.
 */
async function follow(page: Page, target: string): Promise<void> {
  await page.goto(host.url + target)

  const path = new URL(host.url + target).pathname
  // Without this the test could pass because a file happened to sit at that
  // path, which would prove nothing about the fallback.
  expect(
    host.fallbacks,
    `the host found a file at ${path}, so this request never exercised the ` +
      'missing-file path that a static host takes',
  ).toContain(path)

  expect(
    await page.locator('#root').count(),
    `${path} was answered with something that is not the application. A ` +
      'static host finds no file at that path, and whatever it served in ' +
      'place of one is not this app, so the link is dead.',
  ).toBe(1)

  await page.waitForSelector('html[data-atlas-ready="true"]', { timeout: 20_000 })

  expect(
    page.url(),
    'the reader did not land on the link they followed. The app opened, so ' +
      'the host served something, but the address moved: a fallback that ' +
      'bounces through the root and loses the route is no better than a 404.',
  ).toBe(host.url + target)

  await expectFreshBuild(page)
}

test('a deep link into a view opens that view, at the URL that was shared', async ({
  page,
}) => {
  await follow(page, `/network?site=${SITE}&focus=${DEVICE}`)

  await expect(page.getByRole('heading', { name: /Network Topology/i })).toBeVisible()
  // The heading alone renders over a failure card too, so make the view show a
  // piece of its own content. This device belongs to the site named in the
  // query, so drawing it also proves ?site= reached the view.
  await expect(page.locator(`[data-testid="device-${DEVICE}"]`)).toBeVisible()
})

test('the query string and the hash both survive the round trip', async ({ page }) => {
  // The palette and the tabs both link with a query, and the reference tab
  // addresses its sections by anchor, so a fallback that keeps the path and
  // drops either of these still breaks the links the app itself hands out.
  await follow(page, `/map?focus=${SYSTEM}#deep-link`)

  // Read them back through the browser too: page.url() is Playwright's copy,
  // and the app resolves ?focus= from window.location.
  expect(await page.evaluate(() => window.location.search)).toBe(`?focus=${SYSTEM}`)
  expect(await page.evaluate(() => window.location.hash)).toBe('#deep-link')

  await expect(page.getByRole('heading', { name: /Orientation Map/i })).toBeVisible()
  // ?focus= opens the ancestor chain of the named system, so this node is only
  // laid out if the query survived as far as the view.
  await expect(page.locator(`[data-testid="leaf-${SYSTEM}"]`)).toBeVisible()
})

test('a route the app does not have gets the app saying so, not the host', async ({
  page,
}) => {
  await follow(page, '/nonsense')

  await expect(page.getByRole('heading', { name: /Page not found/i })).toBeVisible()
  // The tabs are still there, so the reader has somewhere to go.
  await expect(page.getByRole('tab', { name: 'Orientation Map' })).toBeVisible()
})

test('the root still resolves from its own file and opens the default view', async ({
  page,
}) => {
  const response = await page.goto(`${host.url}/`)

  expect(response?.status(), 'the root is a real file and must not 404').toBe(200)
  expect(host.fallbacks, 'the root was answered by the fallback').not.toContain('/')
  await expectFreshBuild(page)
  // The only redirect in the app: / lands on the first view. It fires on the
  // root path and nowhere else, which is why the deep links above are expected
  // to stay where they were pointed.
  await expect(page).toHaveURL(`${host.url}/reference`)
})
