import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'

import { setExportMarking } from '../export/png'
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

/** Which dataset is on screen, in the words the banner and the exports use. */
export interface DataSource {
  kind: 'sample' | 'local'
  /** The sample bundle, or the name of the file the analyst chose. */
  label: string
  /** Control marking read from the loaded files; null when they state none. */
  marking: string | null
}

export const SAMPLE_SOURCE: DataSource = {
  kind: 'sample',
  label: 'Sample data',
  marking: null,
}

/**
 * What is shown when local data carries no marking.
 *
 * Not a blank. A blank reads as "unclassified", which is a claim about someone
 * else's data that this tool has no basis to make; the honest statement is
 * that the files did not say.
 */
export const UNMARKED_NOTICE = 'MARKING NOT STATED IN THE LOADED FILES'

/**
 * The marking the loaded data carries.
 *
 * project.json may carry one for the whole project, and each site topology
 * carries its own, which reaches us through the site summaries. Distinct
 * values are all shown: a reader is entitled to know the loaded set is mixed
 * rather than being handed whichever one happened to sort first.
 */
export async function readMarking(provider: AtlasDataProvider): Promise<string | null> {
  const project = await provider.getProject()
  const whole = (project as { classification?: string }).classification
  const markings = new Set<string>()
  if (whole?.trim()) markings.add(whole.trim())
  for (const site of project.sites) {
    if (site.classification?.trim()) markings.add(site.classification.trim())
  }
  if (!markings.size) return null
  return [...markings].sort().join(' / ')
}

interface ProviderSwitch {
  provider: AtlasDataProvider
  source: DataSource
  /** Take a provider only once it has parsed successfully. */
  adopt: (provider: AtlasDataProvider, source: DataSource) => void
  useSampleData: () => void
}

export const ProviderSwitchContext = createContext<ProviderSwitch | null>(null)

export function useProviderSwitch(): ProviderSwitch {
  const value = useContext(ProviderSwitchContext)
  if (!value) throw new Error('useProviderSwitch must be used inside AtlasProvider')
  return value
}

/**
 * Holds whichever provider is active. Swapping to a locally loaded file is a
 * setState, which is the whole point of the contract: the tabs never learn
 * where their data came from.
 *
 * Provider and source move together in one state object, so there is no render
 * in which the banner describes a dataset other than the one the tabs are
 * reading. Nothing here is written to storage of any kind, so a reload lands
 * on the sample and the analyst's file is gone with the tab.
 */
export function AtlasProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ provider: AtlasDataProvider; source: DataSource }>(
    () => ({ provider: new StaticProvider(), source: SAMPLE_SOURCE }),
  )

  const adopt = useCallback((provider: AtlasDataProvider, source: DataSource) => {
    setState({ provider, source })
  }, [])

  const useSampleData = useCallback(() => {
    setState({ provider: new StaticProvider(), source: SAMPLE_SOURCE })
  }, [])

  // The exports read the marking from a module-level register rather than
  // taking it as an argument, so a future export path cannot ship unmarked by
  // forgetting to thread it through. This is the one place that sets it.
  useEffect(() => {
    const { kind, marking } = state.source
    setExportMarking(kind === 'local' ? marking ?? UNMARKED_NOTICE : null)
  }, [state.source])

  const value = useMemo(
    () => ({ provider: state.provider, source: state.source, adopt, useSampleData }),
    [state, adopt, useSampleData],
  )

  return (
    <ProviderSwitchContext.Provider value={value}>
      <ProviderContext.Provider value={state.provider}>{children}</ProviderContext.Provider>
    </ProviderSwitchContext.Provider>
  )
}
