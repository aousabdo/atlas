import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { CurationProvider } from '../curation/CurationContext'
import { ProviderContext, SAMPLE_SOURCE } from '../data/ProviderContext'
import type { AtlasDataProvider } from '../data/provider'
import { StaticProvider } from '../data/StaticProvider'

export interface RenderOptions {
  /** Initial route, for tabs that read query parameters (e.g. ?focus=). */
  route?: string
  /**
   * Serve the provider through the curation layer, as the app does, so the
   * UI can make reviews and read them back. The source is the sample's. The
   * render resolves once the layer has read the data it checks edits against,
   * so a test can make an edit straight away.
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
  if (options.curation) await settleCuration(provider)
  return { ...result, user, provider }
}

/**
 * Lets the curation layer finish reading the data it checks every edit
 * against. Until it has, an edit is refused, as it is in the app before a
 * screen with an edit control has loaded. The provider caches every bundle,
 * so once these resolve the layer's own reads of them can only be microtasks
 * away, and a timer drains those.
 */
export async function settleCuration(provider: AtlasDataProvider): Promise<void> {
  await act(async () => {
    const project = await provider.getProject()
    await Promise.allSettled([
      provider.getCoverage(), provider.getSystems(),
      ...project.sites.map((site) => provider.getTopology(site.id)),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
