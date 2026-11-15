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
  /** Overrides the armed band. Omit it and the armed one is used. */
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

/**
 * The line that rides beside the marking while reviews made in this tab are
 * not yet in a file.
 *
 * A figure that rests on edits nobody has saved must say so wherever it goes,
 * and the edits banner sits outside the panel every export captures. So the
 * note is held here, armed by the curation layer as it changes the edits, and
 * stamped wherever the marking is.
 */
let editsNote: string | null = null

export function setExportEditsNote(note: string | null): void {
  editsNote = note && note.trim() ? note.trim() : null
}

/** The marking and the edits note, as one line: what every export stamps. */
export function getExportBand(): string | null {
  return [armedMarking, editsNote].filter(Boolean).join(' · ') || null
}

/** Height of one marking band, as a share of the capture width. */
const BAND_RATIO = 0.035
const MIN_BAND_PX = 28
/** The marking's size when it fits, as a share of the band height. */
const FONT_RATIO = 0.5
/**
 * The smallest size the marking is drawn at, in pixels.
 *
 * Below it a control marking stops being reliably legible. A band that still
 * does not fit at this size wraps onto more lines, and the band grows to hold
 * them, rather than shrinking further or losing the words that run off.
 */
export const MIN_MARKING_FONT_PX = 12
/** Line spacing of a wrapped band, as a multiple of the font size. */
const LINE_RATIO = 1.25

interface Context2dLike {
  fillStyle: string
  font: string
  textAlign: string
  textBaseline: string
  fillRect: (x: number, y: number, width: number, height: number) => void
  fillText: (text: string, x: number, y: number) => void
  drawImage: (image: never, x: number, y: number) => void
  measureText: (text: string) => { width: number }
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

const markingFont = (px: number) => `bold ${px}px sans-serif`

/** Greedy by words; a word wider than a line on its own is broken where it must be. */
function wrapToFit(text: string, fits: (line: string) => boolean): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const joined = line ? `${line} ${word}` : word
    if (fits(joined)) {
      line = joined
      continue
    }
    if (line) lines.push(line)
    let rest = word
    while (rest.length > 1 && !fits(rest)) {
      let cut = rest.length - 1
      while (cut > 1 && !fits(rest.slice(0, cut))) cut -= 1
      lines.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    line = rest
  }
  if (line) lines.push(line)
  return lines
}

interface BandLayout {
  /** Height of each of the two bands. */
  height: number
  font: number
  lines: string[]
  lineHeight: number
}

/**
 * The largest size, down to the floor, at which the band text fits between
 * the side padding on one line. Past the floor it wraps instead.
 */
function layoutBand(context: Context2dLike, text: string, width: number): BandLayout {
  const band = Math.max(MIN_BAND_PX, Math.round(width * BAND_RATIO))
  const padding = Math.round(band / 2)
  const room = Math.max(1, width - padding * 2)
  const widthAt = (line: string, px: number) => {
    context.font = markingFont(px)
    return context.measureText(line).width
  }

  let font = Math.round(band * FONT_RATIO)
  const natural = widthAt(text, font)
  if (natural > room) font = Math.max(MIN_MARKING_FONT_PX, Math.floor((font * room) / natural))
  while (font > MIN_MARKING_FONT_PX && widthAt(text, font) > room) font -= 1
  const lineHeight = Math.ceil(font * LINE_RATIO)
  if (widthAt(text, font) <= room) return { height: band, font, lines: [text], lineHeight }

  const lines = wrapToFit(text, (line) => widthAt(line, font) <= room)
  return { height: Math.max(band, lines.length * lineHeight + padding), font, lines, lineHeight }
}

/**
 * Burns the marking into the image itself, above and below the capture.
 *
 * Drawn onto the pixels rather than added as metadata, because metadata is
 * stripped by every paste into a document and a marking that survives being
 * pasted is the only kind worth having. Two bands so a crop of either half
 * still carries it.
 *
 * Fitted to the capture's width, never clipped: a long band on a narrow
 * capture is drawn smaller, and past MIN_MARKING_FONT_PX on more lines.
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
  const stamped = blank(capture.width, capture.height)
  const context = stamped.getContext('2d')
  if (!context) return capture

  const layout = layoutBand(context, marking, capture.width)
  const band = layout.height
  // Sized once the band is known. Resizing a canvas clears it, and nothing is
  // drawn on it yet.
  stamped.height = capture.height + band * 2

  context.fillStyle = background
  context.fillRect(0, 0, stamped.width, stamped.height)
  context.drawImage(capture as never, 0, band)

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, stamped.width, band)
  context.fillRect(0, stamped.height - band, stamped.width, band)
  context.fillStyle = '#b3341f'
  context.font = markingFont(layout.font)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const first = (band - layout.lines.length * layout.lineHeight) / 2 + layout.lineHeight / 2
  layout.lines.forEach((line, index) => {
    const y = first + index * layout.lineHeight
    context.fillText(line, stamped.width / 2, y)
    context.fillText(line, stamped.width / 2, stamped.height - band + y)
  })
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
  const marking = options.marking === undefined ? getExportBand() : options.marking
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
