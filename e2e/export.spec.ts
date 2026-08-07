import { expect, test } from '@playwright/test'

/**
 * Export, exercised in a real browser.
 *
 * html2canvas and jsPDF cannot run under jsdom, so the component tests can
 * only prove that a failure surfaces. Until this suite existed the export code
 * had never actually executed, and untested export code is worth very little.
 */
test.describe('export', () => {
  test('saves a PNG of the current view', async ({ page }) => {
    await page.goto('/lossiness')
    await page.getByRole('heading', { name: /Lossiness/i }).first().waitFor()
    await page.waitForTimeout(1200)

    const download = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('button', { name: 'PNG' }).click()
    const file = await download

    expect(file.suggestedFilename()).toMatch(/^atlas-lossiness-\d{4}-\d{2}-\d{2}\.png$/)
    const path = await file.path()
    expect(path).toBeTruthy()

    const { readFileSync } = await import('node:fs')
    const bytes = readFileSync(path!)
    // PNG magic number, so this is a real image and not an empty blob.
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(bytes.length).toBeGreaterThan(10_000)
  })

  test('saves a PDF of the current view', async ({ page }) => {
    await page.goto('/reference')
    await page.getByRole('heading', { name: /Reference & Methodology/i }).first().waitFor()
    await page.waitForTimeout(1200)

    const download = page.waitForEvent('download', { timeout: 90_000 })
    await page.getByRole('button', { name: 'PDF' }).click()
    const file = await download

    expect(file.suggestedFilename()).toMatch(/^atlas-reference-\d{4}-\d{2}-\d{2}\.pdf$/)
    const { readFileSync } = await import('node:fs')
    const bytes = readFileSync((await file.path())!)
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(10_000)
  })

  test('keeps its own buttons out of the capture', async ({ page }) => {
    await page.goto('/analytics')
    await page.getByRole('heading', { name: /Analytics/i }).first().waitFor()
    // The omit marker is what html2canvas keys off; if it moves, the export
    // starts including the export controls and nobody notices for a release.
    const marked = page.locator('[data-export-omit]')
    await expect(marked).toHaveCount(1)
    await expect(marked.getByRole('button', { name: 'PNG' })).toBeVisible()
  })

  test('reports a failure rather than appearing to succeed', async ({ page }) => {
    await page.goto('/reference')
    await page.getByRole('heading', { name: /Reference & Methodology/i }).first().waitFor()
    // Break the capture and confirm the UI says so instead of going quiet.
    await page.evaluate(() => {
      const main = document.querySelector('main')
      main?.parentElement?.removeChild(main)
    })
    await page.getByRole('button', { name: 'PNG' }).click()
    await expect(page.getByRole('alert')).toContainText(/Export failed|Nothing to export/i)
  })
})
