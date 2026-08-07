import { useEffect, useState } from 'react'

import { applyTheme, initialTheme, nextTheme, type Theme } from '../lib/theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => initialTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const target = nextTheme(theme)
  return (
    <button
      type="button"
      onClick={() => setTheme(target)}
      className="rounded border border-line px-2 py-1 text-sm text-muted hover:text-ink"
      aria-label={`Switch to ${target} theme`}
      title={`Switch to ${target} theme`}
    >
      {target === 'light' ? 'Light' : 'Dark'}
    </button>
  )
}
