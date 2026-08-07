/**
 * PNG snapshot of a panel.
 *
 * Rebuilt rather than ported. The previous implementation reached into
 * iframe.contentDocument because the network graph lived in a separate
 * document; there are no iframes here, so this is just a capture of a node
 * the caller names.
 *
 * html2canvas-pro rather than html2canvas: Tailwind 4 emits
 * color-mix(in oklab, ...) for every opacity modifier, and html2canvas 1.4.1
 * predates modern colour functions and throws on the first one it meets. The
 * fork is API-compatible and parses them.
 */
import html2canvas from 'html2canvas-pro'

export interface PngOptions {
  /** Painted behind the capture, since the page background is not in the node. */
  background: string
  /** Elements matching this selector are omitted, e.g. the export button itself. */
  omitSelector?: string
  /** Overrides the armed marking. Omit it and the armed one is used. */
  marking?: string | null
}

/**
 * The control marking every export carries, held here rather than passed in.
 *
 * A marking that each caller has to remember to thread through is a marking
 * that the next export path ships without. This module is the one the other
 * two export modules already depend on, so it is where the register lives.
 * Nothing reads it from storage and nothing writes it there: it is armed by
 * the load path and dies with the tab.
 */
let armedMarking: string | null = null

export function setExportMarking(marking: string | null): void {
  armedMarking = marking && marking.trim() ? marking.trim() : null
}

export function getExportMarking(): string | null {
  return armedMarking
}

/** Height of one marking band, as a share of the capture width. */
const BAND_RATIO = 0.035
const MIN_BAND_PX = 28

interface Context2dLike {
  fillStyle: string
  font: string
  textAlign: string
  textBaseline: string
  fillRect: (x: number, y: number, width: number, height: number) => void
  fillText: (text: string, x: number, y: number) => void
  drawImage: (image: never, x: number, y: number) => void
}

export interface CanvasLike {
  width: number
  height: number
  getContext: (id: '2d') => Context2dLike | null
}

function blankCanvas(width: number, height: number): CanvasLike {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas as unknown as CanvasLike
}

/**
 * Burns the marking into the image itself, above and below the capture.
 *
 * Drawn onto the pixels rather than added as metadata, because metadata is
 * stripped by every paste into a document and a marking that survives being
 * pasted is the only kind worth having. Two bands so a crop of either half
 * still carries it.
 *
 * The blank-canvas factory is a parameter so the geometry can be tested
 * without a canvas implementation; jsdom has none.
 */
export function stampMarking<T extends CanvasLike>(
  capture: T,
  marking: string | null,
  background: string,
  blank: (width: number, height: number) => T = blankCanvas as (w: number, h: number) => T,
): T {
  if (!marking) return capture
  const band = Math.max(MIN_BAND_PX, Math.round(capture.width * BAND_RATIO))
  const stamped = blank(capture.width, capture.height + band * 2)
  const context = stamped.getContext('2d')
  if (!context) return capture

  context.fillStyle = background
  context.fillRect(0, 0, stamped.width, stamped.height)
  context.drawImage(capture as never, 0, band)

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, stamped.width, band)
  context.fillRect(0, stamped.height - band, stamped.width, band)
  context.fillStyle = '#b3341f'
  context.font = `bold ${Math.round(band * 0.5)}px sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(marking, stamped.width / 2, band / 2)
  context.fillText(marking, stamped.width / 2, stamped.height - band / 2)
  return stamped
}

export async function elementToPngBlob(
  element: HTMLElement,
  options: PngOptions,
): Promise<Blob> {
  const captured = await html2canvas(element, {
    backgroundColor: options.background,
    scale: window.devicePixelRatio || 2,
    logging: false,
    useCORS: false,
    ignoreElements: options.omitSelector
      ? (el) => el.matches?.(options.omitSelector as string) ?? false
      : undefined,
  })
  const marking = options.marking === undefined ? armedMarking : options.marking
  const canvas = stampMarking(
    captured as unknown as CanvasLike, marking, options.background,
  ) as unknown as HTMLCanvasElement
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas produced no blob'))),
      'image/png',
    )
  })
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** `atlas-<view>-<yyyy-mm-dd>.<ext>` */
export function exportFilename(view: string, ext: string, now = new Date()): string {
  return `atlas-${view}-${now.toISOString().slice(0, 10)}.${ext}`
}
