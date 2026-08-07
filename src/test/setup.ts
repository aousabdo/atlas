import '@testing-library/jest-dom/vitest'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { vi } from 'vitest'

const DATA_DIR = join(process.cwd(), 'public', 'data')

/**
 * Serve the committed bundles through a stubbed fetch.
 *
 * This exercises the real StaticProvider code path — URL construction,
 * response handling, error mapping — rather than reaching around it to the
 * filesystem, and it means every component test runs against the real data
 * rather than a fixture that can drift from it.
 */
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

/** jsdom has no ResizeObserver; the viz components need one to exist. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

/**
 * jsdom does not implement Blob.arrayBuffer() or Blob.text(), which every
 * browser has shipped since 2019 and which LocalFileProvider uses to read the
 * analyst's file. Polyfill rather than contort the production code around a
 * test-environment gap.
 */
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsText(this)
    })
  }
}

/**
 * jsdom has no PointerEvent, so Testing Library falls back to a bare Event and
 * clientX/clientY/button never reach the handler. Pan and drag then look
 * broken in tests while working in every browser. MouseEvent already carries
 * the coordinate fields; this just adds the pointer identity on top.
 */
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    readonly isPrimary: boolean

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
      this.pointerType = params.pointerType ?? 'mouse'
      this.isPrimary = params.isPrimary ?? true
    }
  }
  vi.stubGlobal('PointerEvent', PointerEventPolyfill)
}

/** jsdom implements neither, and both are called on pointer capture. */
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture() {}
  Element.prototype.releasePointerCapture = function releasePointerCapture() {}
}
