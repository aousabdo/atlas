/**
 * Multi-page PDF of a panel.
 *
 * Phase 1 renders client-side, so this is a raster capture sliced across
 * pages. Phase 2 replaces it with a real vector PDF via Playwright against the
 * running app, which is why nothing here is worth optimising.
 */
import { jsPDF } from 'jspdf'

import { elementToPngBlob } from './png'

const MARGIN_PT = 36

export interface PdfOptions {
  background: string
  omitSelector?: string
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
  const blob = await elementToPngBlob(element, options)
  const dataUrl = await blobToDataUrl(blob)

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
