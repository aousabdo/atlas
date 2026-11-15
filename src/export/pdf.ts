/**
 * Multi-page PDF of a panel.
 *
 * Phase 1 renders client-side, so this is a raster capture sliced across
 * pages. Phase 2 replaces it with a real vector PDF via Playwright against the
 * running app, which is why nothing here is worth optimising.
 */
import { jsPDF } from 'jspdf'

import { elementToPngBlob, getExportBand } from './png'

const MARGIN_PT = 36
const MARKING_PT = 9
/** jsPDF's own line height for a font size, so a wrapped band reads as one block. */
const LINE_HEIGHT = 1.15

export interface PdfOptions {
  background: string
  omitSelector?: string
  /** Overrides the armed band. Omit it and the armed one is used. */
  marking?: string | null
}

/** The subset of jsPDF this needs, so the stamping can be tested on its own. */
export interface MarkableDoc {
  setFontSize: (size: number) => void
  setTextColor: (color: string) => void
  text: (text: string, x: number, y: number, options?: { align?: string }) => void
  splitTextToSize: (text: string, maxWidth: number) => string[]
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } }
}

/**
 * Marks the page the document is currently on, top and bottom.
 *
 * Called after the image is placed, because the sliced capture overruns the
 * bottom margin on every page but the last and would otherwise cover it.
 *
 * Never clipped (R12, as the PNG band): a band wider than the page between its
 * margins wraps, the top block reading down from where one line has always
 * sat and the bottom block up to it. A band that fits is one line, drawn
 * exactly where it always was.
 */
export function stampPdfMarking(doc: MarkableDoc, marking: string | null): void {
  if (!marking) return
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  doc.setFontSize(MARKING_PT)
  doc.setTextColor('#b3341f')
  const lines = doc.splitTextToSize(marking, width - MARGIN_PT * 2)
  const step = MARKING_PT * LINE_HEIGHT
  const top = MARKING_PT * 2
  const bottom = height - MARKING_PT - (lines.length - 1) * step
  lines.forEach((line, index) => {
    doc.text(line, width / 2, top + index * step, { align: 'center' })
  })
  lines.forEach((line, index) => {
    doc.text(line, width / 2, bottom + index * step, { align: 'center' })
  })
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function elementToPdf(
  element: HTMLElement,
  filename: string,
  options: PdfOptions,
): Promise<void> {
  // The capture goes in unmarked and the marking is drawn per page: a band
  // burnt into the raster would appear once, in the middle of page two.
  const blob = await elementToPngBlob(element, { ...options, marking: null })
  const dataUrl = await blobToDataUrl(blob)
  const marking = options.marking === undefined ? getExportBand() : options.marking

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const usableWidth = pageWidth - MARGIN_PT * 2
  const usableHeight = pageHeight - MARGIN_PT * 2

  const image = await loadImage(dataUrl)
  const scale = usableWidth / image.width
  const scaledHeight = image.height * scale

  let offset = 0
  let page = 0
  while (offset < scaledHeight) {
    if (page > 0) doc.addPage()
    // Negative y walks the same image up the page, which is the slicing trick
    // that keeps a tall panel readable across pages.
    doc.addImage(
      dataUrl, 'PNG',
      MARGIN_PT, MARGIN_PT - offset,
      usableWidth, scaledHeight,
    )
    stampPdfMarking(doc as unknown as MarkableDoc, marking)
    offset += usableHeight
    page += 1
  }
  doc.save(filename)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not decode the captured image'))
    img.src = src
  })
}
