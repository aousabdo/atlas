import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { isCalendarDate } from '../src/curation/dates'
import { settle } from './atlas'
import { TABS } from './shots'

/**
 * A site walk, kept the only way the app keeps anything: in a file.
 *
 * The reviews live in this tab's memory. The loop the Site walk exists for is
 * record, export, load the export back, and read the same report, and no unit
 * test can walk it: jsdom has no downloads, no file inputs that hold real
 * files, and no navigation between views that keeps the session's edits. So
 * the whole of it runs here, through the same controls a reviewer uses.
 *
 * ingest/tests/test_curation_roundtrip.py is the other half: the file the
 * browser writes for this walk, read back by the Python ingest to the same
 * figures.
 */

const LOSSINESS = TABS.find((tab) => tab.name === 'lossiness')!
const ANALYTICS = TABS.find((tab) => tab.name === 'analytics')!

const MAP_FILE = 'atlas-sample-system-device-map.json'

/** SAMPLE_WALK (src/curation/__tests__/sampleWalk.ts), as a reviewer enters it. */
const WALK = [
  {
    system: 'Beacon',
    device: 'Gate Detection Sensor',
    grade: 'High (physically verified)',
    note: 'Gate sensor feeds the beacon',
  },
  {
    system: 'SCAN (Screening and Alerting Node)',
    device: 'Site Server',
    grade: 'Medium (strong inference)',
    note: 'Scan service on the site server',
  },
  {
    system: 'Trackwell Sensor AI',
    device: 'Range Laptop',
    grade: 'Low (best guess)',
    note: 'Trackwell client seen on the range laptop',
  },
]

async function review(page: Page, entry: (typeof WALK)[number]): Promise<void> {
  const row = page.getByRole('listitem', { name: entry.system, exact: true })
  await row.getByRole('button', { name: 'Review' }).click()
  const form = row.getByRole('form', { name: `Review ${entry.system}` })
  await form.getByRole('radio', { name: 'Found on devices' }).check()
  await form.getByRole('button', { name: /Proving Ground Site/ }).click()
  await form.getByRole('checkbox', { name: entry.device, exact: true }).check()
  await form.getByRole('radio', { name: entry.grade }).check()
  await form.getByRole('textbox', { name: 'Reviewer' }).fill('Site lead')
  await form.getByRole('textbox', { name: 'Note' }).fill(entry.note)
  await form.getByRole('button', { name: 'Save' }).click()
  // The form closes only once the curation layer took the review.
  await expect(form).toHaveCount(0)
  await expect(row.getByText('Edited')).toBeVisible()
}

/** The two figures the walk moves, read on their own tabs. */
async function expectWalkFigures(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Lossiness' }).click()
  await settle(page, LOSSINESS)
  const gap = page.getByRole('article', { name: 'Realization gap dimension' })
  await expect(gap).toContainText('13 of 30')
  await expect(gap).toContainText('43.3%')

  await page.getByRole('tab', { name: 'Analytics' }).click()
  await settle(page, ANALYTICS)
  const westfield = page.locator('li[data-site="westfield"]')
  await expect(westfield.getByText('3 / 30', { exact: true })).toBeVisible()
}

/** Saves the download a click starts, under the name the app gave it. */
async function saveDownload(page: Page, control: Locator, dir: string): Promise<string> {
  const started = page.waitForEvent('download')
  await control.click()
  const download = await started
  const path = join(dir, download.suggestedFilename())
  await download.saveAs(path)
  return path
}

test('the Westfield walk survives an export and a reload', async ({ page }, testInfo) => {
  // 1. Walk Westfield through the form.
  await page.goto('/walk')
  const summary = page.getByTestId('walk-summary')
  await expect(summary).toBeVisible()
  await page.getByRole('button', { name: /Westfield Proving Ground/ }).click()
  await expect(summary).toContainText('8 devices')
  await expect(summary).toContainText('0 of 30 realized')
  for (const entry of WALK) await review(page, entry)
  await expect(summary).toContainText('3 of 30 realized (0 when loaded)')

  // 2. The banner counts them as not yet in any file.
  const banner = page.getByRole('status', { name: 'Reviews' })
  await expect(banner).toContainText('3 unsaved reviews')

  // 3. The report recomputes from them across the app.
  await expectWalkFigures(page)

  // 4. Export them.
  const exported = await saveDownload(
    page,
    banner.getByRole('button', { name: 'Export' }),
    testInfo.outputPath('export'),
  )
  expect(exported.endsWith(MAP_FILE)).toBe(true)
  const map = JSON.parse(readFileSync(exported, 'utf-8'))
  expect(Object.keys(map.sites.westfield.mappings).sort()).toEqual(['beacon', 'scan', 'trackwell'])
  // The whole record the form wrote, not just that there is one: the device,
  // the grade, the note and the stamp, dated the day the review was saved.
  const beacon = map.sites.westfield.mappings.beacon
  expect(beacon).toEqual({
    devices: ['wf_gate_sensor'],
    confidence: 'high',
    note: WALK[0].note,
    reviewed_by: 'Site lead',
    reviewed_on: expect.any(String),
  })
  expect(isCalendarDate(beacon.reviewed_on), `reviewed_on ${beacon.reviewed_on}`).toBe(true)
  await expect(banner).toContainText(`3 reviews exported to ${MAP_FILE}`)

  // 5. Load the sample templates back, with the exported map in the map slot.
  await page.getByRole('button', { name: 'Load data' }).click()
  const dialog = page.getByRole('dialog', { name: 'Load your own data' })
  const templates = dialog.getByRole('group', { name: 'Sample files to start from' })
  const buttons = templates.getByRole('button')
  await expect(buttons).toHaveCount(6)
  const dir = testInfo.outputPath('templates')
  const saved = new Map<string, string>()
  for (const button of await buttons.all()) {
    const path = await saveDownload(page, button, dir)
    saved.set(basename(path), path)
  }
  const template = (name: string) => {
    const path = saved.get(name)
    expect(path, `the panel offered no ${name}`).toBeTruthy()
    return path!
  }

  await dialog.getByText('Place each file yourself').click()
  const slot = (name: string) => dialog.getByLabel(name, { exact: true })
  await slot('Traceability Matrix file').setInputFiles(template('atlas-sample-matrix.xlsx'))
  await slot('Curation overrides file').setInputFiles(template('atlas-sample-overrides.json'))
  await slot('Glossary file').setInputFiles(template('atlas-sample-glossary.json'))
  await slot('System to device map file').setInputFiles(exported)
  await slot('Site topology files').setInputFiles([
    template('atlas-sample-site-northgate.json'),
    template('atlas-sample-site-westfield.json'),
  ])

  // An export leaves nothing unsaved, so no prompt is expected here. One that
  // does come is accepted, and the figures below still have to hold.
  page.once('dialog', (prompt) => void prompt.accept())
  await dialog.getByRole('button', { name: 'Load', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  // 6. The loaded file reads to the same figures, with nothing left unsaved.
  await expectWalkFigures(page)
  await expect(banner).toHaveCount(0)
  await expect(page.getByText(/unsaved review/)).toHaveCount(0)
})
