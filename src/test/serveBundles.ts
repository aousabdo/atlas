import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { vi } from 'vitest'

const DATA_DIR = join(process.cwd(), 'fixtures', 'synthetic')

/**
 * Serve the committed bundles through a stubbed fetch.
 *
 * This exercises the real StaticProvider code path — URL construction,
 * response handling, error mapping — rather than reaching around it to the
 * filesystem, and it means every component test runs against the real data
 * rather than a fixture that can drift from it.
 *
 * The setup file arms it once per file. A file that unstubs every global after
 * each test arms it again in the tests that read the sample.
 *
 * It reads fixtures/synthetic, not public/data. public/data is a copy of it
 * that only scripts/seed-data.mjs makes, and it is also where an analyst
 * builds the real bundle. When the suite read it, npm test had to seed it
 * first, and seeding deleted the real bundle, snapshots and all.
 */
export function serveBundles(): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const relative = url.replace(/^.*\/data\//, '')
    try {
      const body = readFileSync(join(DATA_DIR, relative), 'utf-8')
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
