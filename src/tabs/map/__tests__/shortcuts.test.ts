import { describe, expect, it } from 'vitest'

import { mapAction } from '../shortcuts'

/** A KeyboardEvent-shaped literal, so these cases read as the key that was hit. */
function press(
  key: string,
  extra: { target?: EventTarget | null; meta?: boolean; ctrl?: boolean; alt?: boolean } = {},
) {
  return {
    key,
    metaKey: extra.meta ?? false,
    ctrlKey: extra.ctrl ?? false,
    altKey: extra.alt ?? false,
    target: extra.target ?? null,
  }
}

describe('map keyboard shortcuts', () => {
  it('binds fit, centre, risk and clear', () => {
    expect(mapAction(press('f'))).toBe('fit')
    expect(mapAction(press('F'))).toBe('fit')
    expect(mapAction(press('c'))).toBe('centre')
    expect(mapAction(press('C'))).toBe('centre')
    expect(mapAction(press('r'))).toBe('risk')
    expect(mapAction(press('R'))).toBe('risk')
    expect(mapAction(press('Escape'))).toBe('clear')
  })

  it('leaves every other key alone', () => {
    // The shell owns 1 to 5, ? and A, and the map has no view modes of its own
    // to justify taking the digits back the way the topology does.
    for (const key of ['1', '5', '?', 'a', 'e', 'l', '\\', '/', 'Enter', ' ']) {
      expect(mapAction(press(key))).toBeNull()
    }
  })

  it('does not fire on a modified key, which belongs to the browser', () => {
    expect(mapAction(press('f', { meta: true }))).toBeNull()
    expect(mapAction(press('f', { ctrl: true }))).toBeNull()
    expect(mapAction(press('f', { alt: true }))).toBeNull()
  })

  it('never steals a keystroke aimed at a text field', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const rich = document.createElement('div')
    rich.contentEditable = 'true'
    // jsdom does not implement isContentEditable, so state it directly.
    Object.defineProperty(rich, 'isContentEditable', { value: true })

    for (const target of [input, textarea, select, rich]) {
      expect(mapAction(press('f', { target }))).toBeNull()
      expect(mapAction(press('r', { target }))).toBeNull()
    }
  })
})
