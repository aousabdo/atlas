import { expect, test, type Locator, type Page } from '@playwright/test'

import { preloadFonts, settle } from './atlas'
import { TABS } from './shots'

/**
 * The network sidebar, on the machines this is read on.
 *
 * jsdom reports every element as 0x0 and never lays anything out, so nothing in
 * the unit suite can see a section that renders below the bottom edge of its
 * own container. This is that assertion, and it is the one that was missing
 * when the resilience analysis shipped unreachable: four fixed blocks totalling
 * 801px, a fifth flexible one after them, and `overflow-hidden` on the box that
 * held all of it. On a 1280x720 laptop the analysis and the device record were
 * laid out from y=805 down, off the bottom of a container that could not
 * scroll, with no scrollbar to say anything was missing.
 *
 * Wheel gestures, never `scrollTop`. Chrome honours a programmatic scroll on an
 * `overflow: hidden` box, so a test that assigns scrollTop passes against
 * exactly the build that a reader cannot scroll at all. The mouse is the only
 * witness that tells the two apart.
 */

const NETWORK = TABS[3]

/** Real laptops, at the sizes a browser actually leaves for the document. */
const LAPTOPS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
]

const SECTIONS = [
  { name: 'the site name', find: (page: Page) => page.getByText('Northgate Sports Campus').first() },
  { name: 'the device filter', find: (page: Page) => page.getByLabel('Filter devices') },
  { name: 'the zone list', find: (page: Page) => page.getByRole('region', { name: 'Zones' }) },
  {
    name: 'the chokepoint finding',
    find: (page: Page) =>
      page.getByRole('region', { name: 'Resilience' }).getByRole('button', {
        name: /Single points of failure/,
      }),
  },
  {
    name: 'the reach question',
    find: (page: Page) =>
      page.getByRole('region', { name: 'Resilience' }).getByRole('button', { name: /^Reach/ }),
  },
  {
    name: 'the device record',
    find: (page: Page) => page.getByRole('region', { name: 'Device detail' }),
  },
]

/**
 * Wheel over the panel until the target is on screen, or give up.
 *
 * Bounded rather than open ended: the point of the test is that a reader gets
 * there, and a reader who has to spin the wheel forty times has not.
 */
async function wheelTo(page: Page, panel: Locator, target: Locator): Promise<void> {
  const box = await panel.boundingBox()
  expect(box, 'the topology panel is not laid out').not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2

  for (const direction of [1, -1]) {
    for (let step = 0; step < 20; step += 1) {
      if (await target.isVisible()) {
        const inView = await target.evaluate(
          (element) =>
            new Promise<number>((resolve) => {
              const observer = new IntersectionObserver((entries) => {
                observer.disconnect()
                resolve(entries[0].intersectionRatio)
              })
              observer.observe(element)
            }),
        )
        if (inView > 0) return
      }
      await page.mouse.move(x, y)
      await page.mouse.wheel(0, direction * 120)
    }
    // Nothing found going down; wind back up and try the other way, so a
    // section above the current position counts as reachable too.
  }
}

test.beforeEach(async ({ page }) => {
  await preloadFonts(page)
})

for (const laptop of LAPTOPS) {
  test(`every topology panel section is reachable at ${laptop.name}`, async ({ page }) => {
    await page.setViewportSize({ width: laptop.width, height: laptop.height })
    await page.goto(NETWORK.path)
    await settle(page, NETWORK)

    const panel = page.getByTestId('topology-panel')
    await expect(panel).toBeVisible()

    // A device is selected first because the record at the foot of the column
    // is the section most likely to be pushed out of reach, and empty it is
    // shorter than it will ever be in use.
    await page
      .getByRole('region', { name: 'Devices' })
      .getByRole('button', { name: /Core Switch/ })
      .first()
      .click()

    for (const section of SECTIONS) {
      const target = section.find(page)
      await wheelTo(page, panel, target)
      await expect(target, `${section.name} cannot be reached at ${laptop.name}`).toBeInViewport()
    }
  })
}
