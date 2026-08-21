import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ProviderContext } from '../../../data/ProviderContext'
import { AtlasDataError, type AtlasDataProvider } from '../../../data/provider'
import { StaticProvider } from '../../../data/StaticProvider'
import { LossinessTab } from '../LossinessTab'

/**
 * The empty state belongs to an empty history and to nothing else.
 *
 * TrendView says "No snapshots yet ... This bundle carries none, so there is
 * nothing to compare." That sentence is only true if the snapshots the
 * manifest indexes actually loaded. It used not to be: the provider caught
 * every failed snapshot fetch and filtered it out, so a dead network reached
 * this component as [] and was reported to the analyst as a fact about their
 * bundle.
 *
 * These render the whole tab rather than TrendView alone, because the fix is a
 * division of labour between two components and only the pair shows it: the
 * provider raises, the tab renders LoadFailed, and the empty state is never
 * reached at all.
 */

/** The real provider for everything except the one answer under test. */
function providerWith(
  getSnapshots: AtlasDataProvider['getSnapshots'],
): AtlasDataProvider {
  const real = new StaticProvider('/data')
  return Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
    getSnapshots,
  }) as AtlasDataProvider
}

function renderTab(provider: AtlasDataProvider) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ProviderContext.Provider value={provider}>
        <LossinessTab />
      </ProviderContext.Provider>
    </MemoryRouter>,
  )
}

describe('a failed snapshot load is never shown as an empty history', () => {
  it('renders the load failure, not "no snapshots yet"', async () => {
    renderTab(
      providerWith(async () => {
        throw new AtlasDataError(
          '1 of 1 snapshot(s) the manifest indexes could not be loaded: 2026-08-05',
          undefined,
          'snapshots/2026-08-05.json',
        )
      }),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load/i)
    expect(alert).toHaveTextContent(/2026-08-05/)
    expect(screen.queryByText(/no snapshots yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/this bundle carries none/i)).not.toBeInTheDocument()
  })

  it('keeps the empty state for a history that is genuinely empty', async () => {
    renderTab(providerWith(async () => []))

    expect(await screen.findByText(/no snapshots yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
