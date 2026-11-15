import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadCsv, markedCsv } from '../csv'
import { elementToPdf } from '../pdf'
import { elementToPngBlob, getExportBand, setExportEditsNote, setExportMarking } from '../png'

/**
 * The band every export carries: the marking, and beside it a note while
 * reviews made in this tab are not yet in a file.
 *
 * A made-up marking throughout. scripts/check-no-real-data.mjs refuses a real
 * one written as a value.
 */
const NOTE = 'Includes 1 unsaved review, not yet exported to a file'
const BAND = `TEST MARKING · ${NOTE}`

const pdf = vi.hoisted(() => ({
  log: [] as string[],
  /** Every line drawn, where, and whether it fits the width it was split to. */
  drawn: [] as { text: string; x: number; y: number; size: number }[],
}))

/** Helvetica averages about half an em a character, which is all the fake needs. */
const fits = (text: string, size: number, width: number) => text.length * size * 0.5 <= width

vi.mock('jspdf', () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } }
    size = 16
    addPage() { pdf.log.push('page') }
    addImage() { pdf.log.push('image') }
    setFontSize(size: number) { this.size = size }
    setTextColor() {}
    /** Word by word at the current size, as jsPDF splits. */
    splitTextToSize(text: string, width: number) {
      const lines: string[] = []
      let line = ''
      for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word
        if (line && next.length * this.size * 0.5 > width) {
          lines.push(line)
          line = word
        } else {
          line = next
        }
      }
      return [...lines, line]
    }
    text(text: string, x: number, y: number) {
      pdf.log.push(`text:${text}`)
      pdf.drawn.push({ text, x, y, size: this.size })
    }
    save() {}
  },
}))

/**
 * jsdom has no canvas. The capture stands in for html2canvas's: 540 wide
 * fills a letter page's usable width at scale 1, and 1000 tall runs onto a
 * second page.
 */
vi.mock('html2canvas-pro', () => ({
  default: async () => ({
    width: 540,
    height: 1000,
    getContext: () => null,
    toBlob: (done: BlobCallback) => done(new Blob(['png'], { type: 'image/png' })),
  }),
}))

/** jsdom never loads an image, so its onload would never fire. */
class LoadedImage {
  width = 540
  height = 1000
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

afterEach(() => {
  setExportMarking(null)
  setExportEditsNote(null)
  vi.restoreAllMocks()
})

describe('the export band', () => {
  it('puts the unsaved-reviews note beside the marking', () => {
    setExportMarking('TEST MARKING')
    setExportEditsNote(NOTE)
    expect(getExportBand()).toBe(BAND)
  })

  it('is the note alone when nothing states a marking', () => {
    setExportEditsNote(NOTE)
    expect(getExportBand()).toBe(NOTE)
  })

  it('is the marking alone when every review is in a file', () => {
    setExportMarking('TEST MARKING')
    expect(getExportBand()).toBe('TEST MARKING')
  })

  it('is nothing when there is neither', () => {
    expect(getExportBand()).toBeNull()
  })
})

describe('the band in each export', () => {
  let RealImage: typeof Image

  beforeEach(() => {
    pdf.log = []
    pdf.drawn = []
    RealImage = globalThis.Image
    globalThis.Image = LoadedImage as unknown as typeof Image
    setExportMarking('TEST MARKING')
    setExportEditsNote(NOTE)
  })

  afterEach(() => {
    globalThis.Image = RealImage
  })

  it('stamps every PDF page, top and bottom', async () => {
    await elementToPdf(document.createElement('div'), 'view.pdf', { background: '#ffffff' })
    expect(pdf.log).toEqual([
      'image', `text:${BAND}`, `text:${BAND}`,
      'page', 'image', `text:${BAND}`, `text:${BAND}`,
    ])
  })

  it('draws a band that fits the page exactly where it always has', async () => {
    await elementToPdf(document.createElement('div'), 'view.pdf', { background: '#ffffff' })
    expect(pdf.drawn.slice(0, 2)).toEqual([
      { text: BAND, x: 306, y: 18, size: 9 },
      { text: BAND, x: 306, y: 783, size: 9 },
    ])
  })

  it('wraps a band too wide for the page, top and bottom, and never clips it', async () => {
    // Letter is 612pt wide; less the two 36pt margins, a line has 540pt.
    const long = `${Array(12).fill('TEST LONG MARKING').join(' ')} · ${NOTE}`
    expect(fits(long, 9, 540)).toBe(false)
    await elementToPdf(document.createElement('div'), 'view.pdf', {
      background: '#ffffff', marking: long,
    })

    const page = pdf.drawn.slice(0, pdf.drawn.length / 2)
    expect(page.length).toBeGreaterThanOrEqual(4)
    const top = page.filter((line) => line.y < 396)
    const bottom = page.filter((line) => line.y > 396)
    for (const half of [top, bottom]) {
      expect(half.map((line) => line.text).join(' ')).toBe(long)
      for (const line of half) {
        expect(fits(line.text, line.size, 540)).toBe(true)
        expect(line.x).toBe(306)
      }
    }
    // Every line on the page, the top block reading down and the bottom block up to the edge.
    expect(top[0].y).toBe(18)
    expect(bottom[bottom.length - 1].y).toBe(783)
    for (const half of [top, bottom]) {
      const ys = half.map((line) => line.y)
      expect(ys).toEqual([...ys].sort((a, b) => a - b))
    }
    expect(Math.max(...top.map((line) => line.y))).toBeLessThan(Math.min(...bottom.map((line) => line.y)))
  })

  it('still lets an explicit marking win on the PDF', async () => {
    await elementToPdf(document.createElement('div'), 'view.pdf', {
      background: '#ffffff', marking: 'TEST OTHER',
    })
    expect(pdf.log.filter((entry) => entry.startsWith('text:'))).toEqual(
      Array(4).fill('text:TEST OTHER'),
    )
  })

  it('burns the band into a PNG, above and below', async () => {
    const fillText = vi.fn()
    const context = {
      fillStyle: '', font: '', textAlign: '', textBaseline: '',
      fillRect: () => {}, drawImage: () => {}, fillText,
      // Proportional to the characters and the font size, as png.test.ts measures.
      measureText: (text: string) => ({
        width: text.length * Number(/(\d+)px/.exec(context.font)?.[1]) * 0.6,
      }),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done(new Blob()))

    await elementToPngBlob(document.createElement('div'), { background: '#ffffff' })
    expect(fillText.mock.calls.map((call) => call[0])).toEqual([BAND, BAND])
  })

  it('opens a marked CSV with the band', () => {
    expect(markedCsv([{ id: 'a' }], ['id']).split('\n')[0]).toBe(`"${BAND}"`)
  })

  it('opens and closes a downloaded CSV with the band', async () => {
    let saved: Blob | null = null
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        saved = blob
        return 'blob:csv'
      },
      revokeObjectURL: () => {},
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      downloadCsv('view.csv', 'id\n"a"')
      const lines = (await (saved as unknown as Blob).text()).split('\n')
      expect(lines[0]).toBe(`"${BAND}"`)
      expect(lines[lines.length - 1]).toBe(`"${BAND}"`)
    } finally {
      delete (URL as Partial<typeof URL>).createObjectURL
      delete (URL as Partial<typeof URL>).revokeObjectURL
    }
  })
})
