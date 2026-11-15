import { describe, expect, it } from 'vitest'

import { MIN_MARKING_FONT_PX, stampMarking } from '../png'

/**
 * The longest band the app arms today: the notice for unmarked local data,
 * with the unsaved-reviews note beside it.
 */
const LONG_BAND =
  'MARKING NOT STATED IN THE LOADED FILES · Includes 1 unsaved review, not yet exported to a file'

/** Width per character, as a share of the font size: a bold sans-serif's average. */
const CHAR_EM = 0.6

const pxOf = (font: string): number => Number(/(\d+)px/.exec(font)?.[1])
const measured = (text: string, font: string): number => text.length * pxOf(font) * CHAR_EM

interface Drawn {
  text: string
  y: number
  font: string
}

/**
 * The fake context the other PNG tests use, with a measureText that is
 * proportional to the character count and the current font size.
 */
function fakeCanvas() {
  const drawn: Drawn[] = []
  const images: number[] = []
  const context = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    fillRect: () => {},
    fillText: (text: string, _x: number, y: number) => drawn.push({ text, y, font: context.font }),
    drawImage: (_image: unknown, _x: number, y: number) => images.push(y),
    measureText: (text: string) => ({ width: measured(text, context.font) }),
  }
  const blank = (width: number, height: number) => ({ width, height, getContext: () => context })
  return { drawn, images, blank }
}

function stamp(width: number, marking: string) {
  const { drawn, images, blank } = fakeCanvas()
  const capture = blank(width, 300)
  const stamped = stampMarking(capture, marking, '#000000', blank)
  const band = (stamped.height - capture.height) / 2
  // Half the band height on each side, as stampMarking leaves it.
  const room = width - 2 * Math.round(Math.max(28, Math.round(width * 0.035)) / 2)
  return { drawn, images, band, room, stamped }
}

describe('fitting the marking band to the capture', () => {
  it('keeps the size it always had for a short marking on a wide capture', () => {
    // A 1600 px capture has a 56 px band, and the marking is half of that.
    const { drawn, band } = stamp(1600, 'TEST MARKING')
    expect(band).toBe(56)
    expect(drawn.map((d) => [d.text, d.font])).toEqual([
      ['TEST MARKING', 'bold 28px sans-serif'],
      ['TEST MARKING', 'bold 28px sans-serif'],
    ])
    expect(drawn.map((d) => d.y)).toEqual([28, 300 + 56 + 28])
  })

  it('shrinks a long band until it fits inside the side padding', () => {
    // At the usual 18 px the long band runs to 1026 px on a 1000 px capture.
    const { drawn, band, room } = stamp(1000, LONG_BAND)
    expect(band).toBe(35)
    expect(drawn).toHaveLength(2)
    for (const { text, font } of drawn) {
      expect(text).toBe(LONG_BAND)
      expect(pxOf(font)).toBeLessThan(18)
      expect(pxOf(font)).toBeGreaterThanOrEqual(MIN_MARKING_FONT_PX)
      expect(measured(text, font)).toBeLessThanOrEqual(room)
    }
  })

  it('takes the largest size that fits, not merely one that does', () => {
    const { drawn, room } = stamp(1000, LONG_BAND)
    const px = pxOf(drawn[0].font)
    expect(LONG_BAND.length * (px + 1) * CHAR_EM).toBeGreaterThan(room)
  })

  it('wraps at the floor, and grows the band, rather than clip a word', () => {
    // At the floor the long band is 684 px; a 400 px capture leaves 372.
    const { drawn, images, band, room, stamped } = stamp(400, LONG_BAND)
    expect(band).toBeGreaterThan(28)
    expect(images).toEqual([band])
    for (const { text, font } of drawn) {
      expect(pxOf(font)).toBe(MIN_MARKING_FONT_PX)
      expect(measured(text, font)).toBeLessThanOrEqual(room)
    }
    // Every word, once above the capture and once below, in order.
    const top = drawn.filter((d) => d.y < band)
    const bottom = drawn.filter((d) => d.y > stamped.height - band)
    expect(top.length).toBeGreaterThan(1)
    expect(top.map((d) => d.text).join(' ')).toBe(LONG_BAND)
    expect(bottom.map((d) => d.text)).toEqual(top.map((d) => d.text))
    expect(top.length + bottom.length).toBe(drawn.length)
  })

  it('breaks a word too long for one line rather than run it off the edge', () => {
    const word = 'X'.repeat(80)
    const { drawn, band, room } = stamp(400, word)
    const top = drawn.filter((d) => d.y < band)
    expect(top.map((d) => d.text).join('')).toBe(word)
    for (const { text, font } of drawn) expect(measured(text, font)).toBeLessThanOrEqual(room)
  })
})
