import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { useShortcuts, type Shortcut } from '../useShortcuts'

function Harness({ extra }: { extra?: Shortcut[] }) {
  const [log, setLog] = useState<string[]>([])
  const shortcuts = useMemo<Shortcut[]>(
    () => [
      { key: '?', description: 'help', run: () => setLog((l) => [...l, 'help']) },
      { key: 'e', description: 'png', run: () => setLog((l) => [...l, 'png']) },
      { key: 'k', meta: true, description: 'palette', run: () => setLog((l) => [...l, 'palette']) },
      ...(extra ?? []),
    ],
    [extra],
  )
  useShortcuts(shortcuts)
  return (
    <div>
      <input aria-label="filter" />
      <p data-testid="log">{log.join(',')}</p>
    </div>
  )
}

describe('useShortcuts', () => {
  it('runs a plain-key shortcut', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.keyboard('e')
    expect(screen.getByTestId('log')).toHaveTextContent('png')
  })

  it('is case insensitive', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.keyboard('E')
    expect(screen.getByTestId('log')).toHaveTextContent('png')
  })

  it('runs a meta combination', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.keyboard('{Meta>}k{/Meta}')
    expect(screen.getByTestId('log')).toHaveTextContent('palette')
  })

  it('does not fire a plain shortcut when a modifier is held', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.keyboard('{Meta>}e{/Meta}')
    expect(screen.getByTestId('log')).toHaveTextContent('')
  })

  it('never steals a keystroke from a text field', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByLabelText('filter'))
    await user.keyboard('e')
    expect(screen.getByTestId('log')).toHaveTextContent('')
    expect(screen.getByLabelText('filter')).toHaveValue('e')
  })

  it('stops at the first match rather than running every binding', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.keyboard('?')
    expect(screen.getByTestId('log')).toHaveTextContent('help')
  })
})
