import { expect, test } from '@playwright/test'

import { maskColor, preloadFonts, settle } from './atlas'
import { TABS, THEMES } from './shots'

/**
 * Visual regression, because TypeScript cannot catch a broken radial layout.
 *
 * A tree that lays out with every node stacked at the origin typechecks,
 * passes every unit test that asserts finite coordinates, and is obviously
 * wrong to a human at a glance. Screenshots close that gap.
 *
 * What they cannot do is prove a number is right or a control still exists, so
 * anything nameable is asserted against the DOM below rather than left to the
 * pixels.
 */

test.beforeEach(async ({ page }) => {
  await preloadFonts(page)
})

for (const tab of TABS) {
  for (const theme of THEMES) {
    test(`${tab.name} renders in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.addInitScript((t) => {
        localStorage.setItem('atlas-theme', t)
      }, theme)
      await page.goto(tab.path)
      await settle(page, tab)

      // The theme is part of what this shot is for, so prove it applied. A
      // broken toggle would otherwise make both baselines dark, and a refresh
      // would enshrine that without a word.
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      await expect(page).toHaveScreenshot(`${tab.name}-${theme}.png`, {
        fullPage: true,
        // The commit, the build time and the snapshot dates change on every
        // ingest run. Masking the values rather than the cards around them
        // keeps a layout regression in the provenance block visible; the
        // values are asserted in src/tabs/reference/__tests__/.
        mask: [page.locator('[data-volatile]')],
        maskColor: await maskColor(page),
      })
    })
  }
}

test('the two themes are actually different', async ({ page }) => {
  const bg = async (theme: 'dark' | 'light') => {
    await page.addInitScript((t) => {
      localStorage.setItem('atlas-theme', t)
    }, theme)
    await page.goto('/reference')
    await settle(page, TABS[0])
    return page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(),
    )
  }
  // Guards a theme toggle that silently ignores its argument. With both
  // baselines rendered dark, every light screenshot would still pass.
  expect(await bg('dark')).not.toBe(await bg('light'))
})

/**
 * Spread is read from the layout transform, not from the screen box.
 *
 * getBoundingClientRect folds the zoom into the answer, so a graph that laid
 * out correctly but fitted at k = 0.1 reads as collapsed, and a collapsed graph
 * at high zoom reads as fine. The translate is what the layout produced.
 */
async function worldSpread(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<number> {
  return page.evaluate((sel) => {
    const xs = [...document.querySelectorAll(sel)].map((node) => {
      const match = /translate\((-?[\d.]+),/.exec(node.getAttribute('transform') ?? '')
      return match ? Number(match[1]) : NaN
    })
    if (xs.length < 2 || xs.some(Number.isNaN)) return -1
    return Math.max(...xs) - Math.min(...xs)
  }, selector)
}

test('the orientation map draws its nodes away from the origin', async ({ page }) => {
  await page.goto('/map')
  await settle(page, TABS[4])
  // The specific failure this guards: a layout bug that returns 0,0 for every
  // node still typechecks and still has finite coordinates.
  expect(await worldSpread(page, '[data-testid^="leaf-"]')).toBeGreaterThan(600)
})

test('the network graph draws its devices away from the origin', async ({ page }) => {
  await page.goto('/network')
  await settle(page, TABS[3])
  // LAYOUT_CANVAS is 1200 wide, so a healthy layout uses most of it.
  expect(await worldSpread(page, '[data-testid^="device-"]')).toBeGreaterThan(600)
})

test('no tab emits NaN or Infinity into the DOM', async ({ page }) => {
  for (const tab of TABS) {
    await page.goto(tab.path)
    await settle(page, tab)
    const html = await page.content()
    expect(html, `${tab.name} has non-finite geometry`).not.toMatch(/NaN|Infinity/)
  }
})

test('no tab logs an error, throws, or fails a request', async ({ page }) => {
  const problems: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`)
  })
  // console.error is only one of the ways this app can fail. An uncaught throw
  // renders the error boundary, and a data bundle that 404s renders LoadFailed,
  // and neither of those logs anything the old listener recognised.
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`))
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`)
  })
  for (const tab of TABS) {
    await page.goto(tab.path)
    await settle(page, tab)
    // Asserted inside the loop so the failure names the tab that caused it.
    expect(problems, `${tab.name}: ${problems.join(' | ')}`).toEqual([])
  }
})

/**
 * Control inventory, because a missing button is a handful of pixels.
 *
 * This is the regression the stale baselines hid: both graph tabs had their
 * toolbars reworked and the screenshots agreed with themselves anyway. A list
 * of accessible names cannot be absorbed by a pixel tolerance.
 *
 * Every control group on the two graph tabs is listed, not just the one that
 * happened to get a test first. Covering MapToolbar alone is what let a control
 * be deleted from either ViewStrip with the whole suite still green: the map
 * strip moved 183 pixels, which the screenshots caught, and the network strip
 * moved 33, which nothing caught. The strips are the surface most likely to
 * lose a control silently, being a grid where a removed cell reflows nothing.
 */
const TOOLBARS = [
  {
    tab: TABS[4],
    role: 'toolbar' as const,
    name: 'Map controls',
    controls: ['Links', 'Clean', 'Grid', 'Desired', 'Risk View', 'Reset', 'Expand All'],
  },
  {
    tab: TABS[4],
    role: 'toolbar' as const,
    name: 'View controls',
    controls: [
      'Zoom out',
      'Zoom in',
      'Smaller boxes',
      'Larger boxes',
      'Smaller labels',
      'Larger labels',
      'Fit',
      'Centre',
    ],
  },
  {
    tab: TABS[3],
    role: 'toolbar' as const,
    name: 'View controls',
    controls: [
      'Zoom out',
      'Zoom in',
      'Smaller nodes',
      'Larger nodes',
      'Smaller labels',
      'Larger labels',
      'Fit',
    ],
  },
  {
    // Already a named group in the app; nothing had ever read it back.
    tab: TABS[3],
    role: 'group' as const,
    name: 'View mode',
    controls: ['Force', 'Zones', 'Tree'],
  },
]

/**
 * The accessible name of every button in a group, in order.
 *
 * Not the inner text. Two of every three buttons in a ViewStrip are a bare
 * minus or plus sign, so its visible text reads "- + - + - + Fit" and a deleted
 * stepper looks exactly like a deleted action. The aria-label is what is
 * announced and what is actually being inventoried; where there is none, as in
 * MapToolbar, the name is the text and the two agree.
 */
async function controlNames(scope: import('@playwright/test').Locator): Promise<string[]> {
  return scope
    .getByRole('button')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim()),
    )
}

for (const bar of TOOLBARS) {
  // The tab is in the title because both graph tabs have a strip called "View
  // controls", and a duplicate test title is a test nobody can name in a
  // failure report or grep for from scripts/falsify.mjs.
  test(`${bar.tab.name}: ${bar.name} still carries every control`, async ({ page }) => {
    await page.goto(bar.tab.path)
    await settle(page, bar.tab)
    const group = page.getByRole(bar.role, { name: bar.name })
    // One match, or the assertion below is reading whichever came first.
    await expect(group).toHaveCount(1)
    expect(await controlNames(group)).toEqual(bar.controls)
  })
}

/**
 * Figures on screen must equal figures in the bundle.
 *
 * A formatting or filter change that keeps the layout identical is invisible to
 * any pixel threshold worth shipping, and these are the numbers that end up on
 * a briefing slide.
 */
test('the map stat tiles agree with the manifest', async ({ page, baseURL }) => {
  const manifest = await (await page.request.get(`${baseURL}/data/manifest.json`)).json()
  await page.goto('/map')
  await settle(page, TABS[4])

  // Each tile is a labelled group whose first line is the figure. Exact
  // matching matters: "Confirmed" is a substring of "Unconfirmed".
  const read = async (label: string) =>
    Number(
      (
        await page.getByRole('group', { name: label, exact: true }).innerText()
      ).split('\n')[0],
    )

  expect(await read('Systems')).toBe(manifest.counts.systems)
  expect(await read('Confirmed')).toBe(manifest.counts.confirmed)
  expect(await read('Unconfirmed')).toBe(manifest.counts.unconfirmed)
  expect(await read('Links')).toBe(manifest.counts.links)
})
