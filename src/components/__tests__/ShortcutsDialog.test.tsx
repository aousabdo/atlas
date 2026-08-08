import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ShortcutsDialog, type ShortcutGroup } from '../ShortcutsDialog'

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    rows: [
      { keys: ['⌘K', 'Ctrl K'], description: 'Search everything' },
      { keys: ['?'], description: 'Show or hide this dialog' },
    ],
  },
]

/**
 * A page with something behind the dialog worth landing on, because the defect
 * is that Tab landed on it: a link and a button, both outside the card.
 */
function open() {
  const onClose = vi.fn()
  const user = userEvent.setup()
  const page = (close: () => void) => (
    <>
      <a href="/reference">Reference</a>
      <button type="button">Load data</button>
      <ShortcutsDialog groups={GROUPS} onClose={close} />
    </>
  )
  const { rerender } = render(page(onClose))
  return { user, onClose, again: (close: () => void) => rerender(page(close)) }
}

describe('ShortcutsDialog', () => {
  it('opens with Close focused, so Escape and Enter both have an owner', async () => {
    open()
    expect(await screen.findByRole('button', { name: /close shortcuts/i })).toHaveFocus()
  })

  it('keeps Tab inside the card, which is what aria-modal claims', async () => {
    const { user } = open()
    const dialog = screen.getByRole('dialog', { name: /keyboard shortcuts/i })
    for (let press = 0; press < 4; press += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    // Named rather than merely "inside": these are the two the presses used to
    // reach, one of which opens a second dialog over this one.
    expect(screen.getByRole('link', { name: 'Reference' })).not.toHaveFocus()
    expect(screen.getByRole('button', { name: 'Load data' })).not.toHaveFocus()
  })

  it('does not pull focus back when the shell re-renders around it', () => {
    const { again } = open()
    const close = screen.getByRole('button', { name: /close shortcuts/i })
    close.blur()
    // A fresh onClose identity is what every render of the shell hands it, and
    // it used to re-run the effect that focuses Close. In a browser that is
    // what stole the caret back out of the search box opened from here.
    again(() => undefined)
    expect(close).not.toHaveFocus()
  })
})
