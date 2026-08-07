import type { Locator, Page } from '@playwright/test'

export interface Tab {
  path: string
  name: string
  heading: RegExp
  /**
   * Something only this tab's own content can produce.
   *
   * A LoadFailed card renders where the content should be and photographs
   * perfectly well, so "the heading is present" is not evidence the view drew
   * anything. Each tab has to show a piece of itself before a screenshot of it
   * is worth keeping.
   */
  proof: (page: Page) => Locator
}

export const TABS: Tab[] = [
  {
    path: '/reference',
    name: 'reference',
    heading: /Reference & Methodology/i,
    proof: (page) => page.getByRole('table', { name: 'Bundle counts' }),
  },
  {
    path: '/analytics',
    name: 'analytics',
    heading: /Analytics/i,
    proof: (page) => page.locator('[data-side="requirement"]').first(),
  },
  {
    path: '/lossiness',
    name: 'lossiness',
    heading: /Lossiness/i,
    proof: (page) => page.locator('#attrition-heading'),
  },
  {
    path: '/network',
    name: 'network',
    heading: /Network Topology/i,
    proof: (page) => page.locator('[data-testid^="device-"]').first(),
  },
  {
    path: '/map',
    name: 'map',
    heading: /Orientation Map/i,
    proof: (page) => page.locator('[data-testid^="leaf-"]').first(),
  },
]

export const THEMES = ['dark', 'light'] as const

/**
 * The complete baseline inventory, and the only place it is written down.
 *
 * identity.setup.ts compares this against the files on disk in both
 * directions. A baseline with no test is an orphan that nobody will ever
 * notice has gone stale; a test with no baseline used to be written silently
 * and trusted by the next run.
 */
export const SHOTS: string[] = TABS.flatMap((tab) =>
  THEMES.map((theme) => `${tab.name}-${theme}.png`),
)
