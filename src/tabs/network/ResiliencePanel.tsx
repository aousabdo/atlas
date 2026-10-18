import { useEffect, useMemo, useState } from 'react'

import {
  articulationPoints,
  blastRadius,
  buildGraph,
  tracePaths,
  type ArticulationPoint,
  type BlastRadiusReport,
  type Graph,
  type SourceReach,
  type Tally,
  type TraceReport,
} from '../../lib/graph'
import { useWork } from '../../lib/ready'
import type { DeviceId, Topology } from '../../types/atlas'
import { nodeStyle } from './NetworkLegend'

/**
 * What the graph is being asked to draw instead of the current state.
 *
 * This is a union rather than a pair of booleans because the two views compete
 * for the same encoding on the canvas, and a screen that is showing a removal
 * and a path at once is showing neither.
 */
export type GraphOverlay =
  | {
      kind: 'what-if'
      /**
       * The device being removed. Pinned to the selection: change the selection
       * and the what-if is gone.
       *
       * Deliberately not a member of `deviceIds`. It is neither present nor
       * stranded, so the canvas gives it a treatment of its own rather than
       * drawing it lit and fully wired to the very devices it just stranded.
       */
      deviceId: DeviceId
      label: string
      /**
       * What loses its path, and nothing else. One mark on the canvas per
       * device counted in the banner, so a reader counting marks arrives at
       * the number they were told.
       */
      deviceIds: DeviceId[]
      severedCount: number
      /** Where reachability was measured from, in words. */
      rootLabel: string
    }
  | {
      kind: 'path'
      deviceIds: DeviceId[]
      fromLabel: string
      toLabel: string
      hopCount: number
    }

export interface ResiliencePanelProps {
  topology: Topology
  selectedId: string | null
  onSelect: (deviceId: string) => void
  /** Null when the canvas is showing the current state. */
  overlay: GraphOverlay | null
  onOverlay: (overlay: GraphOverlay | null) => void
}

// ---------------------------------------------------------------------------
// Computation, off the render path
// ---------------------------------------------------------------------------

export interface Resilience {
  /** False until the effect below has run, which is not the same as "empty". */
  ready: boolean
  graph: Graph | null
  spofs: ArticulationPoint[]
  spofIds: ReadonlySet<DeviceId>
}

interface Structure {
  graph: Graph
  spofs: ArticulationPoint[]
  spofIds: Set<DeviceId>
}

/**
 * Keyed by the topology object itself, so a site switch or a locally loaded
 * bundle is a miss and recomputes, while a remount of the same data is a hit.
 * A WeakMap rather than an LRU because the entry dies with the bundle it
 * describes and nothing here should keep a topology alive.
 */
const STRUCTURES = new WeakMap<Topology, Structure>()
const BLASTS = new WeakMap<Topology, Map<string, BlastRadiusReport>>()
const TRACES = new WeakMap<Topology, Map<string, TraceReport>>()

const NO_RESILIENCE: Resilience = {
  ready: false,
  graph: null,
  spofs: [],
  spofIds: new Set<DeviceId>(),
}

function structureOf(topology: Topology): Structure {
  const hit = STRUCTURES.get(topology)
  if (hit) return hit
  const spofs = articulationPoints(topology)
  const value: Structure = {
    graph: buildGraph(topology),
    spofs,
    spofIds: new Set(spofs.map((spof) => spof.deviceId)),
  }
  STRUCTURES.set(topology, value)
  return value
}

function bucket<T>(store: WeakMap<Topology, Map<string, T>>, topology: Topology): Map<string, T> {
  const hit = store.get(topology)
  if (hit) return hit
  const made = new Map<string, T>()
  store.set(topology, made)
  return made
}

function rootIdsOfKind(topology: Topology, kind: string): DeviceId[] {
  return topology.devices.filter((device) => device.type === kind).map((device) => device.id)
}

function blastOf(topology: Topology, deviceId: string, rootKind: string): BlastRadiusReport {
  const store = bucket(BLASTS, topology)
  const key = `${rootKind}|${deviceId}`
  const hit = store.get(key)
  if (hit) return hit
  const value = rootKind
    ? blastRadius(topology, deviceId, { rootIds: rootIdsOfKind(topology, rootKind) })
    : blastRadius(topology, deviceId)
  store.set(key, value)
  return value
}

function traceOf(topology: Topology, fromType: string, toType: string): TraceReport {
  const store = bucket(TRACES, topology)
  const key = `${fromType}|${toType}`
  const hit = store.get(key)
  if (hit) return hit
  const idsOf = (type: string) =>
    topology.devices.filter((device) => device.type === type).map((device) => device.id)
  // Both caps at zero on purpose. This panel reports which sources reach a sink
  // and shows one shortest path as the evidence, and both of those come from
  // the uncapped breadth first search rather than from path enumeration. Paying
  // for a couple of hundred enumerated paths nothing renders would be waste.
  const value = tracePaths(topology, idsOf(fromType), idsOf(toType), {
    maxPaths: 0,
    maxHops: 0,
  })
  store.set(key, value)
  return value
}

/**
 * The whole-topology analysis, computed after the first paint rather than
 * during it.
 *
 * Cut vertices and their evidence are cheap at site scale and quadratic in the
 * worst case, which is exactly the shape of thing that should not sit between a
 * reader and their first frame. `useWork` keeps the page marked not-ready until
 * the answer lands, so a screenshot cannot catch the pending state.
 */
export function useResilience(topology: Topology): Resilience {
  const [state, setState] = useState<{ for: Topology; value: Structure } | null>(null)

  useEffect(() => {
    setState({ for: topology, value: structureOf(topology) })
  }, [topology])

  const value = state && state.for === topology ? state.value : null
  useWork(value === null)
  return value ? { ready: true, ...value } : NO_RESILIENCE
}

function useBlastRadius(
  topology: Topology,
  deviceId: string | null,
  rootKind: string,
): BlastRadiusReport | null {
  const [state, setState] = useState<{
    for: Topology
    deviceId: string
    rootKind: string
    value: BlastRadiusReport
  } | null>(null)

  useEffect(() => {
    if (!deviceId) return
    setState({ for: topology, deviceId, rootKind, value: blastOf(topology, deviceId, rootKind) })
  }, [topology, deviceId, rootKind])

  if (!deviceId) return null
  const fresh =
    state !== null &&
    state.for === topology &&
    state.deviceId === deviceId &&
    state.rootKind === rootKind
  return fresh ? state.value : null
}

function useTrace(topology: Topology, fromType: string, toType: string): TraceReport | null {
  const [state, setState] = useState<{
    for: Topology
    fromType: string
    toType: string
    value: TraceReport
  } | null>(null)

  useEffect(() => {
    if (!fromType || !toType) return
    setState({ for: topology, fromType, toType, value: traceOf(topology, fromType, toType) })
  }, [topology, fromType, toType])

  if (!fromType || !toType) return null
  const fresh =
    state !== null &&
    state.for === topology &&
    state.fromType === fromType &&
    state.toType === toType
  return fresh ? state.value : null
}

// ---------------------------------------------------------------------------
// Shared bits of chrome
// ---------------------------------------------------------------------------

/** How many findings are listed before the reader has to ask for the rest. */
const PREVIEW = 5

/**
 * A device type as prose. The raw `type` key is the handle everywhere the value
 * is used, and the legend's word for it is what the reader has already learnt,
 * so the key stays in the select values and the word goes in the sentences.
 */
function kindWord(type: string, count = 1): string {
  const word = nodeStyle(type).label.toLowerCase()
  return count === 1 ? word : `${word}s`
}

function tallyText(tallies: Tally[], nameOf: (tally: Tally) => string = (t) => t.label): string {
  return tallies.map((tally) => `${nameOf(tally)} ${tally.count} of ${tally.total}`).join(' · ')
}

const byTypeName = (tally: Tally) => kindWord(tally.key, tally.count)

/** "3, 2 and 1" rather than "3 and 2 and 1". */
function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function Disclosure({
  open,
  onToggle,
  title,
  note,
  badge,
}: {
  open: boolean
  onToggle: () => void
  title: string
  note?: string
  badge?: string
}) {
  return (
    <h2>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-baseline gap-2 rounded py-1 text-left hover:bg-surface-2"
      >
        <span aria-hidden="true" className="w-3 shrink-0 text-muted-3">
          {open ? '−' : '+'}
        </span>
        <span className="flex-1 text-[10px] font-semibold tracking-widest text-muted uppercase">
          {title}
          {note && <span className="block normal-case tracking-normal text-muted-3">{note}</span>}
        </span>
        {badge && <span className="tabular shrink-0 text-xs text-ink">{badge}</span>}
      </button>
    </h2>
  )
}

/** Named devices, each one a way into its own record. This is the drill through. */
/** A count with its devices one click away, so the number is never bare. */
function NamedCount({
  ids,
  text,
  labelOf,
  onSelect,
}: {
  ids: readonly DeviceId[]
  text: string
  labelOf: (id: DeviceId) => string
  onSelect: (id: DeviceId) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <p className="mt-1 text-xs text-muted-3">
        {text}{' '}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((on) => !on)}
          className="rounded px-1 text-accent-ink hover:bg-surface-2"
        >
          {open ? 'Hide them' : `Name the ${ids.length}`}
        </button>
      </p>
      {open && <DeviceLinks ids={ids} labelOf={labelOf} onSelect={onSelect} />}
    </>
  )
}

function DeviceLinks({
  ids,
  labelOf,
  onSelect,
}: {
  ids: readonly DeviceId[]
  labelOf: (id: DeviceId) => string
  onSelect: (id: DeviceId) => void
}) {
  return (
    <ul className="mt-1 flex flex-col gap-px">
      {ids.map((id) => (
        <li key={id}>
          <button
            type="button"
            onClick={() => onSelect(id)}
            className="w-full truncate rounded px-1 py-0.5 text-left text-xs text-muted hover:bg-surface-2 hover:text-ink"
          >
            {labelOf(id)}
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/**
 * Three questions the picture cannot answer on its own: which single devices
 * hold the site together, what a given one takes with it, and whether a
 * detection has any path at all to the people who act on it.
 *
 * It lives in the existing left panel rather than in a box of its own. The tab
 * already floats a toolbar, a view strip, a minimap and a legend over the
 * canvas, and a fifth floating thing would cost more canvas than the finding is
 * worth. The panel is also where every other list-and-drill-through in this tab
 * already lives, so the drill through from a count to the devices behind it
 * reads the same way as the zone list and the device list above it.
 */
export function ResiliencePanel({
  topology,
  selectedId,
  onSelect,
  overlay,
  onOverlay,
}: ResiliencePanelProps) {
  const resilience = useResilience(topology)
  const [openSpof, setOpenSpof] = useState(true)
  const [openReach, setOpenReach] = useState(false)
  const [allSpof, setAllSpof] = useState(false)
  const [openSpofId, setOpenSpofId] = useState<string | null>(null)
  const [rootKind, setRootKind] = useState('')
  const [openBlastList, setOpenBlastList] = useState(false)
  const [fromType, setFromType] = useState('')
  const [toType, setToType] = useState('')
  const [allReach, setAllReach] = useState(false)

  const blast = useBlastRadius(topology, selectedId, rootKind)
  const trace = useTrace(topology, fromType, toType)

  const labels = useMemo(
    () => new Map(topology.devices.map((device) => [device.id, device.label])),
    [topology.devices],
  )
  const labelOf = (id: DeviceId) => labels.get(id) ?? id

  const types = useMemo(() => {
    const counts = new Map<string, number>()
    for (const device of topology.devices) {
      counts.set(device.type, (counts.get(device.type) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [topology.devices])

  /**
   * The frame the blast radius was measured against, in one phrase.
   *
   * The count is meaningless without it: eight devices losing their path to the
   * demarc and eight losing it to the operator workstations are different
   * findings, and the reader has to be able to see which one they are reading.
   */
  const rootPhrase = !blast
    ? ''
    : rootKind
      ? `the ${blast.rootIds.length} ${kindWord(rootKind, blast.rootIds.length)}`
      : listOf([
          ...blast.rootIds.slice(0, 2).map(labelOf),
          ...(blast.rootIds.length > 2 ? [`${blast.rootIds.length - 2} more`] : []),
        ]) || 'nothing, because no device matches that choice'

  const total = topology.devices.length
  const { spofs, graph } = resilience
  // A device joined only by VLAN is a piece of its own on the physical links.
  // It is named once below rather than counted as a piece.
  const logicalOnly = graph?.anomalies.logicalOnlyDeviceIds ?? []
  const pieces = graph
    ? graph.components.filter(
        (piece) => !(piece.count === 1 && logicalOnly.includes(piece.deviceIds[0]!)),
      )
    : []
  const shownSpofs = allSpof ? spofs : spofs.slice(0, PREVIEW)

  return (
    <section aria-label="Resilience" className="px-3 py-2">
      {/* 1. What holds the site together. */}
      <Disclosure
        open={openSpof}
        onToggle={() => setOpenSpof((on) => !on)}
        title="Single points of failure"
        badge={resilience.ready ? String(spofs.length) : undefined}
      />

      {openSpof && (
        <div className="mb-2 pl-5">
          {!resilience.ready ? (
            <p role="status" className="text-xs text-muted">
              Working out what holds this site together.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted">
                Removing any one of these leaves part of the site with no path to
                the rest. Counted on the physical links, cable and radio, as
                recorded. A VLAN rides on those same links, so it is never a second
                way round.
              </p>

              {pieces.length > 1 && (
                <p className="mt-1 text-xs text-risk-medium-ink">
                  The physical links are already in {pieces.length} separate pieces
                  of {listOf(pieces.map((piece) => String(piece.count)))}. Each cut
                  below is measured inside its own piece.
                </p>
              )}

              {logicalOnly.length > 0 && (
                <p className="mt-1 text-xs text-muted-3">
                  {logicalOnly.length} {logicalOnly.length === 1 ? 'device is' : 'devices are'}{' '}
                  joined only by VLAN links, with no cable or radio link drawn to{' '}
                  {logicalOnly.length === 1 ? 'it' : 'them'}: {listOf(logicalOnly.map(labelOf))}.
                  The drawing does not show how they attach, so they are never
                  counted as cut off.
                </p>
              )}

              {spofs.length === 0 ? (
                <p className="mt-1 text-xs text-muted">
                  {graph && graph.links.length === 0
                    ? 'No cable or radio link is drawn at this site, so there is nothing to count.'
                    : logicalOnly.length > 0
                      ? 'No single point of failure among the devices with a cable or radio link. Each has a second way round in the physical links as recorded.'
                      : 'No single point of failure. Every device has a second way round in the physical links as recorded.'}
                </p>
              ) : (
                <ul className="mt-1 flex flex-col gap-px">
                  {shownSpofs.map((spof) => {
                    const open = openSpofId === spof.deviceId
                    return (
                      <li key={spof.deviceId}>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => {
                            setOpenSpofId(open ? null : spof.deviceId)
                            onSelect(spof.deviceId)
                          }}
                          className={[
                            'w-full rounded px-1 py-1 text-left',
                            open ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2',
                          ].join(' ')}
                        >
                          <span className="block truncate text-sm text-ink">{spof.label}</span>
                          <span className="tabular block text-xs text-risk-high-ink">
                            {spof.severedCount} of {total} cut off
                          </span>
                        </button>
                        {open && (
                          <div className="mb-1 border-l border-line pl-2">
                            <p className="mt-1 text-xs text-muted-3">
                              {tallyText(spof.severedByType, byTypeName)}
                            </p>
                            <p className="tabular mt-0.5 text-xs text-muted-3">
                              Largest remaining piece keeps {spof.retainedCount}.
                            </p>
                            <DeviceLinks
                              ids={spof.severedDeviceIds}
                              labelOf={labelOf}
                              onSelect={onSelect}
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {spofs.length > PREVIEW && (
                <button
                  type="button"
                  onClick={() => setAllSpof((on) => !on)}
                  className="mt-1 rounded px-1 py-0.5 text-xs text-accent-ink hover:bg-surface-2"
                >
                  {allSpof ? `Show the worst ${PREVIEW}` : `Show all ${spofs.length}`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* 2. What one device takes with it. Hung off the selection, which is
          where a reader already asks questions about a single device. */}
      {selectedId && (
        <div className="mt-2 border-t border-line pt-2">
          <h2 className="flex items-baseline gap-2 text-[10px] font-semibold tracking-widest uppercase">
            <span className="rounded border border-risk-medium px-1 text-risk-medium-ink">
              Hypothetical
            </span>
            <span className="text-muted">If this device is removed</span>
          </h2>

          {!blast ? (
            <p role="status" className="mt-1 text-xs text-muted">
              Working out what stops being reachable.
            </p>
          ) : !blast.exists ? (
            <p className="mt-1 text-xs text-muted">
              That device id is not in this topology, so there is nothing to remove.
            </p>
          ) : (
            <>
              <p className="mt-1 truncate text-sm text-ink">{blast.label}</p>

              <label className="mt-1 flex items-center gap-2 text-xs">
                <span className="shrink-0 text-muted-3">Reachable from</span>
                <select
                  aria-label="Reachable from"
                  value={rootKind}
                  onChange={(event) => {
                    setRootKind(event.target.value)
                    onOverlay(null)
                  }}
                  className="min-w-0 flex-1 rounded border border-line bg-bg px-1 py-0.5 text-xs text-ink"
                >
                  <option value="">Entry points in the drawing</option>
                  {types.map(([type, count]) => (
                    <option key={type} value={type}>
                      any {kindWord(type)} ({count})
                    </option>
                  ))}
                </select>
              </label>

              <p className="mt-1 text-xs text-muted-3">Measured from {rootPhrase}.</p>

              {blast.removedIsLogicalOnly ? (
                <p className="mt-1 text-xs text-muted">
                  This device is joined only by VLAN links, so removing it cuts no
                  cable or radio path.
                </p>
              ) : blast.rootIds.length > 0 &&
                blast.logicalOnlyRootIds.length === blast.rootIds.length ? (
                <p className="mt-1 text-xs text-muted">
                  Every starting point here is joined only by VLAN links, so on
                  cable and radio nothing is reachable from them. Pick another
                  starting point.
                </p>
              ) : blast.reachableBeforeCount === 0 ? (
                <p className="mt-1 text-xs text-muted">
                  Nothing was reachable from that starting point to begin with,
                  so this removal has nothing to cut.
                </p>
              ) : blast.unreachableCount === 0 ? (
                <p className="mt-1 text-xs text-muted">
                  {blast.removedWasReachable && blast.alreadyUnreachableDeviceIds.length === 0
                    ? 'Nothing loses its path. Every other device still has a route that does not run through this one.'
                    : 'Nothing loses its path because of this removal.'}
                </p>
              ) : (
                <>
                  <p className="tabular mt-1 text-sm text-risk-high-ink">
                    {blast.unreachableCount} of {total} lose their path
                  </p>
                  <p className="mt-0.5 text-xs text-muted-3">{tallyText(blast.byType, byTypeName)}</p>

                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-pressed={overlay?.kind === 'what-if'}
                      onClick={() =>
                        onOverlay(
                          overlay?.kind === 'what-if'
                            ? null
                            : {
                                kind: 'what-if',
                                deviceId: blast.deviceId,
                                label: blast.label,
                                deviceIds: [...blast.unreachableDeviceIds],
                                severedCount: blast.unreachableCount,
                                rootLabel: rootPhrase,
                              },
                        )
                      }
                      className={[
                        'rounded border px-2 py-0.5 text-xs',
                        overlay?.kind === 'what-if'
                          ? 'border-risk-medium bg-surface-2 text-risk-medium-ink'
                          : 'border-line text-muted hover:text-ink',
                      ].join(' ')}
                    >
                      Show on graph
                    </button>
                    <button
                      type="button"
                      aria-expanded={openBlastList}
                      onClick={() => setOpenBlastList((on) => !on)}
                      className="rounded px-1 py-0.5 text-xs text-accent-ink hover:bg-surface-2"
                    >
                      {openBlastList ? 'Hide them' : `Name the ${blast.unreachableCount}`}
                    </button>
                  </div>

                  {openBlastList && (
                    <DeviceLinks
                      ids={blast.unreachableDeviceIds}
                      labelOf={labelOf}
                      onSelect={onSelect}
                    />
                  )}
                </>
              )}

              {blast.alreadyUnreachableDeviceIds.length > 0 && (
                <NamedCount
                  ids={blast.alreadyUnreachableDeviceIds}
                  text={`${blast.alreadyUnreachableDeviceIds.length} were already cut off before this removal, so they are not counted above.`}
                  labelOf={labelOf}
                  onSelect={onSelect}
                />
              )}
              {blast.logicalOnlyDeviceIds.length > 0 && !blast.removedIsLogicalOnly && (
                <NamedCount
                  ids={blast.logicalOnlyDeviceIds}
                  text={`The ${blast.logicalOnlyDeviceIds.length} joined only by VLAN are left out, because the drawing does not show how they attach.`}
                  labelOf={labelOf}
                  onSelect={onSelect}
                />
              )}
              {!blast.removedWasReachable && (
                <p className="mt-1 text-xs text-muted-3">
                  This device is not itself reachable from those roots.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* 3. Whether a detection has a path to anyone who can act on it. */}
      <div className="mt-2 border-t border-line pt-1">
        <Disclosure
          open={openReach}
          onToggle={() => setOpenReach((on) => !on)}
          title="Reach"
          note="Does a detection get to a decision maker?"
        />

        {openReach && (
          <div className="pl-5">
            {/* A traced path is the evidence for one From/To pair. Change either
                end and the canvas is lighting the answer to a question nobody is
                asking any more, next to a panel answering a different one, so
                the overlay goes with the question that produced it. */}
            <label className="mt-1 flex items-center gap-2 text-xs">
              <span className="w-10 shrink-0 text-muted-3">From</span>
              <select
                aria-label="From device type"
                value={fromType}
                onChange={(event) => {
                  setFromType(event.target.value)
                  setAllReach(false)
                  onOverlay(null)
                }}
                className="min-w-0 flex-1 rounded border border-line bg-bg px-1 py-0.5 text-xs text-ink"
              >
                <option value="">pick a kind</option>
                {types.map(([type, count]) => (
                  <option key={type} value={type}>
                    {kindWord(type)} ({count})
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-1 flex items-center gap-2 text-xs">
              <span className="w-10 shrink-0 text-muted-3">To</span>
              <select
                aria-label="To device type"
                value={toType}
                onChange={(event) => {
                  setToType(event.target.value)
                  setAllReach(false)
                  onOverlay(null)
                }}
                className="min-w-0 flex-1 rounded border border-line bg-bg px-1 py-0.5 text-xs text-ink"
              >
                <option value="">pick a kind</option>
                {types.map(([type, count]) => (
                  <option key={type} value={type}>
                    {kindWord(type)} ({count})
                  </option>
                ))}
              </select>
            </label>

            {!fromType || !toType ? (
              <p className="mt-1 text-xs text-muted">
                Pick a source kind and a sink kind. Reach is read either way along
                a link, because the recorded source and target order is a drawing
                convention and not the direction a detection travels. It follows
                every recorded link, VLANs included, because a VLAN is how the data
                travels.
              </p>
            ) : !trace ? (
              <p role="status" className="mt-1 text-xs text-muted">
                Working out which of them reach one.
              </p>
            ) : (
              <ReachResult
                trace={trace}
                fromType={fromType}
                toType={toType}
                all={allReach}
                onAll={() => setAllReach((on) => !on)}
                labelOf={labelOf}
                onSelect={onSelect}
                onOverlay={onOverlay}
              />
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * The result, with the failures first.
 *
 * A list of successes with three failures buried in it is the shape that lets a
 * gap survive a review, so the sources that reach nothing get the top of the
 * block and their own colour, and the ones that do reach are folded away behind
 * a count that still opens onto the path proving each one.
 */
function ReachResult({
  trace,
  fromType,
  toType,
  all,
  onAll,
  labelOf,
  onSelect,
  onOverlay,
}: {
  trace: TraceReport
  fromType: string
  toType: string
  all: boolean
  onAll: () => void
  labelOf: (id: DeviceId) => string
  onSelect: (id: DeviceId) => void
  onOverlay: (overlay: GraphOverlay | null) => void
}) {
  const sources = trace.sources
  const unreached = sources.filter((source) => !source.reaches)
  const reached = sources.filter((source) => source.reaches)
  const farthest = reached.reduce<SourceReach | null>(
    (worst, source) =>
      worst === null || (source.shortestHops ?? 0) > (worst.shortestHops ?? 0) ? source : worst,
    null,
  )

  if (sources.length === 0) {
    return (
      <p className="mt-1 text-xs text-muted">
        No device of that kind is recorded at this site, so there is nothing to
        trace.
      </p>
    )
  }

  return (
    <>
      {unreached.length > 0 ? (
        <>
          <p className="tabular mt-1 text-sm text-risk-high-ink">
            {unreached.length} of {sources.length} {kindWord(fromType, sources.length)} reach no{' '}
            {kindWord(toType)}
          </p>
          <p className="text-xs text-muted-3">
            No path of any length, either way along a link.
          </p>
          <ul className="mt-1 flex flex-col gap-px">
            {unreached.map((source) => (
              <li key={source.deviceId}>
                <button
                  type="button"
                  onClick={() => onSelect(source.deviceId)}
                  className="w-full truncate rounded px-1 py-0.5 text-left text-xs text-ink hover:bg-surface-2"
                >
                  {source.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-sm text-ink">
          All {sources.length} {kindWord(fromType, sources.length)} reach at least one{' '}
          {kindWord(toType)}.
        </p>
      )}

      {farthest && (
        <p className="tabular mt-1 text-xs text-muted-3">
          Farthest that does reach: {farthest.label}, {farthest.shortestHops} hops.
        </p>
      )}

      {reached.length > 0 && (
        <button
          type="button"
          aria-expanded={all}
          onClick={onAll}
          className="mt-1 rounded px-1 py-0.5 text-xs text-accent-ink hover:bg-surface-2"
        >
          {all ? 'Hide the ones that reach' : `Show all ${reached.length} that reach`}
        </button>
      )}

      {all && (
        <ul className="mt-1 flex flex-col gap-1">
          {reached.map((source) => {
            const witness = source.witness
            return (
              <li key={source.deviceId} className="flex items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(source.deviceId)}
                  className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-xs text-muted hover:text-ink"
                >
                  {source.label}
                  <span className="tabular ml-1 text-muted-3">{source.shortestHops} hops</span>
                </button>
                {witness && (
                  <button
                    type="button"
                    title={witness.map(labelOf).join(' to ')}
                    onClick={() =>
                      onOverlay({
                        kind: 'path',
                        deviceIds: witness,
                        fromLabel: source.label,
                        toLabel: labelOf(witness[witness.length - 1]),
                        hopCount: source.shortestHops ?? 0,
                      })
                    }
                    className="shrink-0 rounded border border-line px-1 py-0.5 text-xs text-muted hover:text-ink"
                  >
                    Show path
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
