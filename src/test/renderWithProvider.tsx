import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { ProviderContext } from '../data/ProviderContext'
import { StaticProvider } from '../data/StaticProvider'

export interface RenderOptions {
  /** Initial route, for tabs that read query parameters (e.g. ?focus=). */
  route?: string
}

/** Renders against the real committed bundles, so tests assert on real data. */
export async function renderWithProvider(
  ui: ReactElement,
  options: RenderOptions = {},
) {
  const user = userEvent.setup()
  const provider = new StaticProvider('/data')
  const result = render(
    <MemoryRouter initialEntries={[options.route ?? '/']}>
      <ProviderContext.Provider value={provider}>{ui}</ProviderContext.Provider>
    </MemoryRouter>,
  )
  return { ...result, user, provider }
}
