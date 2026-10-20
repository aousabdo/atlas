import { useEffect, useState } from 'react'

import {
  rootKey,
  rootSensitivity,
  siteDependencies,
  type DependencyInput,
  type RootSet,
  type Sensitivity,
  type SiteDependencies,
} from '../../lib/dependency'
import { useWork } from '../../lib/ready'
import type { Topology } from '../../types/atlas'

interface Computed {
  deps: SiteDependencies
  sensitivity: Sensitivity
}

/**
 * Keyed by the topology object, then the root set, so a site switch or a
 * locally loaded bundle is a miss and a remount of the same data is a hit.
 * A WeakMap, so an entry dies with the bundle it describes.
 */
const CACHE = new WeakMap<Topology, Map<string, Computed>>()

function computeOnce(input: DependencyInput, roots: RootSet): Computed {
  let bucket = CACHE.get(input.topology)
  if (!bucket) {
    bucket = new Map()
    CACHE.set(input.topology, bucket)
  }
  const key = rootKey(roots.choice)
  const hit = bucket.get(key)
  if (hit) return hit
  const deps = siteDependencies(input, roots)
  const value = { deps, sensitivity: rootSensitivity(input, deps) }
  bucket.set(key, value)
  return value
}

/**
 * What rests on every device at this site, measured from one root set,
 * computed after the first paint rather than during it. useWork keeps the
 * page marked not-ready until it lands, so a screenshot cannot catch the
 * pending state.
 */
export function useDependencies(input: DependencyInput, roots: RootSet): Computed | null {
  const key = rootKey(roots.choice)
  const [state, setState] = useState<{ for: Topology; key: string; value: Computed } | null>(null)

  useEffect(() => {
    setState({ for: input.topology, key, value: computeOnce(input, roots) })
    // roots is derived from the key and the topology; input's parts are stable per site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.topology, input.site, input.systems, input.links, key])

  const fresh = state !== null && state.for === input.topology && state.key === key ? state.value : null
  useWork(fresh === null)
  return fresh
}
