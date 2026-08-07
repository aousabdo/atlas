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
}

export async function elementToPngBlob(
  element: HTMLElement,
  options: PngOptions,
): Promise<Blob> {
  const canvas = await html2canvas(element, {
    backgroundColor: options.background,
    scale: window.devicePixelRatio || 2,
    logging: false,
    useCORS: false,
    ignoreElements: options.omitSelector
      ? (el) => el.matches?.(options.omitSelector as string) ?? false
      : undefined,
  })
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
