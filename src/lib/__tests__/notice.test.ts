import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { NOTICE_POINTS, NOTICE_SHORT, noticeMarkdown } from '../notice'

const ROOT = join(__dirname, '..', '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8')

describe('the handling notice', () => {
  it('disclaims rather than prohibits, and says who decides', () => {
    // The stance is the point. A notice that told people never to load
    // controlled data would make the whole local path decorative and push them
    // towards retyping or a tool that really does upload.
    const all = [NOTICE_SHORT, ...NOTICE_POINTS].join(' ').toLowerCase()
    expect(all).toContain('your determination')
    expect(all).toContain('not accredited')
    expect(all).not.toMatch(/\bmust not (load|upload)\b/)
  })

  it('names every exposure that is not the parsing', () => {
    // Parsing staying in the tab is the easy half. These are the ways data
    // leaves anyway, and a notice that omits them is worse than none.
    const all = NOTICE_POINTS.join(' ').toLowerCase()
    for (const exposure of ['export', 'extension', 'publicly readable', 'warranty']) {
      expect(all, `the notice never mentions ${exposure}`).toContain(exposure)
    }
  })

  it('has not drifted from the documents that quote it', () => {
    // The generator writes these; this fails if someone edited a document by
    // hand, or edited notice.ts and forgot to run `npm run notice`.
    for (const doc of ['README.md', 'docs/data-inputs.md']) {
      expect(read(doc), `${doc} is stale`).toContain(noticeMarkdown())
    }
  })
})
