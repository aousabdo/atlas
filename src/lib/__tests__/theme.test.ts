import { beforeEach, describe, expect, it } from 'vitest'

import { applyTheme, initialTheme, nextTheme } from '../theme'

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to dark when nothing is stored and the OS has no preference', () => {
    expect(initialTheme()).toBe('dark')
  })

  it('honours a stored preference over the OS', () => {
    localStorage.setItem('atlas-theme', 'light')
    expect(initialTheme()).toBe('light')
  })

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem('atlas-theme', 'chartreuse')
    expect(initialTheme()).toBe('dark')
  })

  it('stamps the root element so CSS can switch on it', () => {
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('persists the choice', () => {
    applyTheme('light')
    expect(localStorage.getItem('atlas-theme')).toBe('light')
  })

  it('toggles', () => {
    expect(nextTheme('dark')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
  })
})
