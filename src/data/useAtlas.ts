import { useCallback, useEffect, useState } from 'react'

import { useWork } from '../lib/ready'
import { useProvider } from './ProviderContext'
import { AtlasDataError, type AtlasDataProvider } from './provider'

/**
 * A discriminated union, so a component cannot read `data` without having
 * handled loading and failure. That is what keeps a failed fetch from
 * rendering as a zero.
 */
export type AtlasState<T> =
  | { status: 'loading' }
  | { status: 'failed'; error: AtlasDataError; retry: () => void }
  | { status: 'ready'; data: T }

export function useAtlas<T>(
  select: (provider: AtlasDataProvider) => Promise<T>,
  deps: unknown[] = [],
): AtlasState<T> {
  const provider = useProvider()
  const [state, setState] = useState<AtlasState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => setAttempt((a) => a + 1), [])

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    select(provider)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const wrapped =
          error instanceof AtlasDataError
            ? error
            : new AtlasDataError(
                error instanceof Error ? error.message : String(error),
                error,
              )
        setState({ status: 'failed', error: wrapped, retry })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, attempt, ...deps])

  // Holds data-atlas-ready off the document while any bundle is in flight, so
  // the visual suite waits on the app rather than on a fixed timeout.
  useWork(state.status === 'loading')

  return state
}
