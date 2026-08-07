import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import type { AtlasDataProvider } from './provider'
import { StaticProvider } from './StaticProvider'

export const ProviderContext = createContext<AtlasDataProvider | null>(null)

export function useProvider(): AtlasDataProvider {
  const provider = useContext(ProviderContext)
  if (!provider) {
    throw new Error('useProvider must be used inside a ProviderContext.Provider')
  }
  return provider
}

/**
 * Holds whichever provider is active. Swapping to a locally loaded file is a
 * setState, which is the whole point of the contract: the tabs never learn
 * where their data came from.
 */
export function AtlasProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<AtlasDataProvider>(() => new StaticProvider())
  const value = useMemo(() => ({ provider, setProvider }), [provider])
  return (
    <ProviderSwitchContext.Provider value={value}>
      <ProviderContext.Provider value={provider}>{children}</ProviderContext.Provider>
    </ProviderSwitchContext.Provider>
  )
}

interface ProviderSwitch {
  provider: AtlasDataProvider
  setProvider: (p: AtlasDataProvider) => void
}

export const ProviderSwitchContext = createContext<ProviderSwitch | null>(null)

export function useProviderSwitch(): ProviderSwitch {
  const value = useContext(ProviderSwitchContext)
  if (!value) throw new Error('useProviderSwitch must be used inside AtlasProvider')
  return value
}
