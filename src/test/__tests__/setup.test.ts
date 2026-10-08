import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The suite reads the committed sample, not public/data. public/data is where
 * an analyst builds the real bundle, and the suite used to seed it before every
 * run so it had something to read, which deleted that bundle without a word.
 * CI runs the suite before anything seeds public/data, so a test that goes
 * back to reading it fails there rather than passing on a stale copy.
 */
describe('the stubbed fetch', () => {
  it('serves fixtures/synthetic', async () => {
    const committed = readFileSync(
      join(process.cwd(), 'fixtures', 'synthetic', 'project.json'),
      'utf-8',
    )
    const response = await fetch('/data/project.json')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(committed)
  })
})
