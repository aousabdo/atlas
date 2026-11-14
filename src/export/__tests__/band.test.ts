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

const pdf = vi.hoisted(() => ({ log: [] as string[] }))

vi.mock('jspdf', () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } }
    addPage() { pdf.log.push('page') }
    addImage() { pdf.log.push('image') }
    setFontSize() {}
    setTextColor() {}
    text(text: string) { pdf.log.push(`text:${text}`) }
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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '', font: '', textAlign: '', textBaseline: '',
      fillRect: () => {}, drawImage: () => {}, fillText,
    } as never)
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
