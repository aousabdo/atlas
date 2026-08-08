import { expect, test } from '@playwright/test'

import { preloadFonts, settle } from './atlas'
import { TABS } from './shots'

/**
 * The things jsdom cannot see, in a browser that can.
 *
 * jsdom moves focus only when a test moves it, so a Tab press there proves the
 * app's own handler works and nothing about where the browser would have sent
 * the focus instead. And it computes no styles from a class, so no assertion
 * about a tone or a contrast ratio means anything until a real engine has
 * resolved the tokens. Both of those are asserted here; everything else about
 * these panels lives in the unit suite, where it is cheaper.
 */

const REFERENCE = TABS[0]
const ANALYTICS = TABS[1]

test.beforeEach(async ({ page }) => {
  await preloadFonts(page)
})

/** Whether the keyboard is still inside the named dialog. */
async function focusIsInside(
  page: import('@playwright/test').Page,
  name: string,
): Promise<boolean> {
  return page.evaluate((label) => {
    const dialog = document.querySelector(`[role="dialog"][aria-label="${label}"]`)
    const active = document.activeElement
    return !!dialog && !!active && dialog.contains(active)
  }, name)
}

test('Tab cannot leave the search dialog', async ({ page }) => {
  await page.goto(REFERENCE.path)
  await settle(page, REFERENCE)

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: 'Search everything' })).toBeVisible()

  // Two presses used to land on the nav link behind an opaque backdrop, and
  // six more on the button that opens a second dialog. aria-modal="true" told
  // a screen reader none of that was reachable.
  for (let press = 0; press < 10; press += 1) {
    await page.keyboard.press('Tab')
    expect(
      await focusIsInside(page, 'Search everything'),
      `focus left the palette after ${press + 1} presses`,
    ).toBe(true)
  }
  await page.keyboard.press('Shift+Tab')
  expect(await focusIsInside(page, 'Search everything')).toBe(true)
})

test('Tab cannot leave the shortcuts dialog', async ({ page }) => {
  await page.goto(REFERENCE.path)
  await settle(page, REFERENCE)

  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()

  for (let press = 0; press < 6; press += 1) {
    await page.keyboard.press('Tab')
    expect(
      await focusIsInside(page, 'Keyboard shortcuts'),
      `focus left the shortcuts dialog after ${press + 1} presses`,
    ).toBe(true)
  }
})

test('opening search from the shortcuts dialog leaves one modal', async ({ page }) => {
  await page.goto(REFERENCE.path)
  await settle(page, REFERENCE)

  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')

  await expect(page.getByRole('dialog', { name: 'Search everything' })).toBeVisible()
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(1)
  // The caret is in the palette, so the palette has to be the card on top.
  await expect(page.getByRole('combobox')).toBeFocused()
})

/** Both tones as the engine resolved them, plus whatever image sits over them. */
async function tone(page: import('@playwright/test').Page, selector: string) {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel)
    if (!element) return null
    const style = getComputedStyle(element)
    return {
      background: style.backgroundColor,
      image: style.backgroundImage,
      border: style.borderBottomWidth,
    }
  }, selector)
}

test('the matrix draws no tone the legend does not list', async ({ page }) => {
  await page.goto(ANALYTICS.path)
  await settle(page, ANALYTICS)

  const swatch = (index: number) =>
    `ul[aria-label="What each cell means"] li:nth-child(${index}) span`
  const recorded = await tone(page, swatch(1))
  const absent = await tone(page, swatch(2))
  const empty = await tone(page, swatch(3))

  // The legend stands for the grid only if it is painted the same way.
  expect(await tone(page, 'td[data-state="current"]')).toMatchObject({
    background: recorded!.background,
  })
  expect((await tone(page, 'td[data-state="missing"]'))!.image).toBe(absent!.image)
  expect(await tone(page, 'td[data-state="none"]')).toMatchObject({
    background: empty!.background,
  })

  // The diagonal used to be a fourth tone with no entry above and 1.26:1
  // against the third. Nothing is drawn there now, and the edge of the drawn
  // half is a border rather than a fill.
  const undrawn = await tone(page, 'td[data-half="undrawn"]')
  expect(undrawn!.image).toBe('none')
  for (const state of [recorded, absent, empty]) {
    expect(undrawn!.background).not.toBe(state!.background)
  }
  const diagonal = await tone(page, 'td[data-row="orbit"][data-col="orbit"]')
  expect(Number.parseFloat(diagonal!.border)).toBeGreaterThan(0)
})

test('the grid shows one mark per gap, which is the number in the sentence', async ({
  page,
}) => {
  await page.goto(ANALYTICS.path)
  await settle(page, ANALYTICS)

  const headline = await page
    .locator('p', { hasText: 'desired integrations have no recorded link' })
    .first()
    .innerText()
  const claimed = Number(/(\d+) of/.exec(headline)![1])
  expect(claimed).toBeGreaterThan(0)
  // Counted in the browser, which is where the reader counts them.
  await expect(page.locator('td[data-state="missing"]')).toHaveCount(claimed)
})
