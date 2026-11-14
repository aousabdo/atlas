import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { CurationProvider } from '../curation/CurationContext'
import { ProviderContext, SAMPLE_SOURCE } from '../data/ProviderContext'
import { StaticProvider } from '../data/StaticProvider'

export interface RenderOptions {
  /** Initial route, for tabs that read query parameters (e.g. ?focus=). */
  route?: string
  /**
   * Serve the provider through the curation layer, as the app does, so the
   * UI can make reviews and read them back. The source is the sample's.
   */
  curation?: boolean
}

/** Renders against the real committed bundles, so tests assert on real data. */
export async function renderWithProvider(
  ui: ReactElement,
  options: RenderOptions = {},
) {
  const user = userEvent.setup()
  const provider = new StaticProvider('/data')
  const served = options.curation ? (
    <CurationProvider base={provider} source={SAMPLE_SOURCE}>{ui}</CurationProvider>
  ) : (
    <ProviderContext.Provider value={provider}>{ui}</ProviderContext.Provider>
  )
  const result = render(
    <MemoryRouter initialEntries={[options.route ?? '/']}>{served}</MemoryRouter>,
  )
  return { ...result, user, provider }
}
