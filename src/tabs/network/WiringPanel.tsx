import { useMemo, useRef, useState, type ReactNode } from 'react'

import { isRealizedMapping, isReviewedSite, matrixIdSet } from '../../lib/coverage'
import { describeWired, UNCHECKED_REASON_TEXT, wiringAtSite, type LinkWiring } from '../../lib/wiring'
import type { CoverageMatrix, DeviceId, Link, System, Topology } from '../../types/atlas'
import { DeviceLinks, Disclosure, listOf, type GraphOverlay } from './ResiliencePanel'

/**
 * Documented vs wired, for the site on screen.
 *
 * The first view that joins the matrix to the network: each integration the
 * documents record, checked against the cabling between the two systems'
 * hardware here. It sits under the resilience analysis because it asks the
 * same kind of question of the same drawing, and a wired row lights its path
 * through the same overlay the reach tool uses.
 */
export function WiringPanel({
  topology,
  coverage,
  systems,
  links,
  onSelect,
  overlay,
  onOverlay,
}: {
  topology: Topology
  coverage: CoverageMatrix
  systems: System[]
  links: readonly Link[]
  onSelect: (deviceId: DeviceId) => void
  overlay: GraphOverlay | null
  onOverlay: (overlay: GraphOverlay | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [openUnchecked, setOpenUnchecked] = useState(false)
  const [openUnclaimedCuts, setOpenUnclaimedCuts] = useState(false)
  // The overlay this panel put up, so it only ever takes down its own and
  // never one the reach tool or a what-if is showing.
  const ownOverlay = useRef<GraphOverlay | null>(null)

  const site = coverage.sites[topology.site_id]
  const reviewed = isReviewedSite(site)

  const rows = useMemo(
    () => (site && reviewed ? wiringAtSite(links, site, topology, matrixIdSet(systems)) : []),
    [links, site, reviewed, topology, systems],
  )

  const names = useMemo(() => new Map(systems.map((s) => [s.id, s.name])), [systems])
  const nameOf = (id: string) => names.get(id) ?? id
  const labels = useMemo(
    () => new Map(topology.devices.map((d) => [d.id, d.label])),
    [topology.devices],
  )
  const labelOf = (id: DeviceId) => labels.get(id) ?? id
  const pair = (row: LinkWiring) => `${nameOf(row.link.from)} – ${nameOf(row.link.to)}`
  // Its place in the list, since the same pair may be recorded twice.
  const keyOf = (row: LinkWiring) => String(row.index)

  const of = (kind: LinkWiring['verdict']['kind']) => rows.filter((r) => r.verdict.kind === kind)
  const wired = of('wired')
  const cohosted = of('co-hosted')
  const logical = of('logical-only')
  const noPath = of('no-path')
  const unchecked = of('unchecked')
  // The devices wired integrations break on that no realized system claims:
  // the grey boxes the integrations rest on.
  const claimed = useMemo(() => {
    const ids = matrixIdSet(systems)
    return new Set(
      Object.entries(site?.mappings ?? {})
        .filter(([id, m]) => isRealizedMapping(id, m, ids))
        .flatMap(([, m]) => m.devices),
    )
  }, [site, systems])
  const unclaimedCutsOf = (row: LinkWiring) =>
    row.verdict.kind === 'wired' ? row.verdict.cutDeviceIds.filter((id) => !claimed.has(id)) : []
  const restingOnUnclaimed = wired.filter((row) => unclaimedCutsOf(row).length > 0)
  const unclaimedCuts = [...new Set(wired.flatMap(unclaimedCutsOf))].sort((a, b) =>
    labelOf(a).localeCompare(labelOf(b)),
  )
  const claimLabel = (id: DeviceId) => (claimed.has(id) ? labelOf(id) : `${labelOf(id)} · no system claims it`)

  const allFragile =
    wired.length > 0 &&
    wired.every(
      (r) =>
        r.verdict.kind === 'wired' && (r.verdict.cutDeviceIds.length > 0 || r.verdict.singleCable),
    )

  const summary = [
    `${wired.length} wired`,
    ...(cohosted.length ? [`${cohosted.length} on a shared device`] : []),
    ...(logical.length ? [`${logical.length} joined only by VLAN`] : []),
    ...(noPath.length ? [`${noPath.length} with no path drawn`] : []),
    ...(unchecked.length ? [`${unchecked.length} cannot be checked here`] : []),
  ].join(', ')

  const showPath = (row: LinkWiring, path: DeviceId[]) => {
    const shown: GraphOverlay = {
      kind: 'path',
      deviceIds: path,
      fromLabel: `${nameOf(row.link.from)} on ${labelOf(path[0]!)}`,
      toLabel: `${nameOf(row.link.to)} on ${labelOf(path[path.length - 1]!)}`,
      hopCount: path.length - 1,
    }
    ownOverlay.current = shown
    onOverlay(shown)
  }

  const clearOwnOverlay = () => {
    if (overlay !== null && overlay === ownOverlay.current) onOverlay(null)
    ownOverlay.current = null
  }

  const toggleRow = (row: LinkWiring, path: DeviceId[] | null) => {
    const key = keyOf(row)
    if (openKey === key) {
      setOpenKey(null)
      clearOwnOverlay()
      return
    }
    setOpenKey(key)
    // The overlay goes with the row that produced it: a row with no path of
    // its own takes down the previous row's.
    if (path) showPath(row, path)
    else clearOwnOverlay()
  }

  const rowButton = (row: LinkWiring, detail: string, path: DeviceId[] | null) => (
    <button
      type="button"
      aria-expanded={openKey === keyOf(row)}
      onClick={() => toggleRow(row, path)}
      title={pair(row)}
      className={[
        'w-full rounded px-1 py-1 text-left',
        openKey === keyOf(row) ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2',
      ].join(' ')}
    >
      <span className="block truncate text-sm text-ink">{pair(row)}</span>
      <span className="tabular block text-xs text-muted-3">{detail}</span>
    </button>
  )

  return (
    <section aria-label="Documented integrations" className="px-3 py-2">
      <Disclosure
        open={open}
        onToggle={() => setOpen((on) => !on)}
        title="Documented integrations"
        badge={String(links.length)}
      />

      {open && (
        <div className="mb-2 pl-5">
          {links.length === 0 ? (
            <p className="text-xs text-muted">
              The documents record no integrations, so there is nothing to check.
            </p>
          ) : !reviewed ? (
            <p className="text-xs text-muted">
              Nobody has recorded which systems run at {topology.meta.label}, so none
              of the {links.length} documented integrations can be checked against
              its drawing.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted">
                Each integration the documents record, checked against this drawing.
                A cable or radio path between the two systems&rsquo; hardware means
                the integration can run here, not that it does.
              </p>
              <p className="mt-1 text-xs text-ink">{summary}.</p>
              {allFragile && (
                <p className="mt-1 text-xs text-risk-medium-ink">
                  Every wired integration here breaks if one device or cable fails.
                </p>
              )}
              {restingOnUnclaimed.length > 0 && (
                <>
                  <p className="mt-1 text-xs text-muted">
                    {restingOnUnclaimed.length === wired.length
                      ? `${wired.length === 1 ? 'The wired integration rests' : `All ${wired.length} wired integrations rest`} on devices no system claims, ${unclaimedCuts.length} in all.`
                      : `${restingOnUnclaimed.length} of ${wired.length} wired integrations rest on at least one device no system claims (${unclaimedCuts.length} in all).`}{' '}
                    <button
                      type="button"
                      aria-expanded={openUnclaimedCuts}
                      onClick={() => setOpenUnclaimedCuts((on) => !on)}
                      className="rounded px-1 text-accent-ink hover:bg-surface-2"
                    >
                      {openUnclaimedCuts ? 'Hide them' : `Name the ${unclaimedCuts.length}`}
                    </button>
                  </p>
                  {openUnclaimedCuts && (
                    <DeviceLinks ids={unclaimedCuts} labelOf={labelOf} onSelect={onSelect} />
                  )}
                </>
              )}

              {wired.length > 0 && (
                <Group title={`Wired (${wired.length})`}>
                  {wired.map((row) => {
                    if (row.verdict.kind !== 'wired') return null
                    const { path, cutDeviceIds } = row.verdict
                    const cuts = cutDeviceIds.length
                    const detail = describeWired(row.verdict)
                    return (
                      <li key={keyOf(row)}>
                        {rowButton(row, detail, path)}
                        {openKey === keyOf(row) && (
                          <div className="mb-1 border-l border-line pl-2">
                            {cuts > 0 && (
                              <>
                                <p className="mt-1 text-xs text-muted-3">
                                  Breaks if any one of these fails:
                                </p>
                                <DeviceLinks ids={cutDeviceIds} labelOf={claimLabel} onSelect={onSelect} />
                              </>
                            )}
                            <p className="mt-1 text-xs text-muted-3">
                              One shortest path: {path.map(labelOf).join(' → ')}.
                            </p>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </Group>
              )}

              {cohosted.length > 0 && (
                <Group title={`On a shared device (${cohosted.length})`}>
                  {cohosted.map((row) =>
                    row.verdict.kind !== 'co-hosted' ? null : (
                      <li key={keyOf(row)}>
                        {rowButton(
                          row,
                          `both run on ${listOf(row.verdict.sharedDeviceIds.map(labelOf))}`,
                          null,
                        )}
                        {openKey === keyOf(row) && (
                          <div className="mb-1 border-l border-line pl-2">
                            <DeviceLinks
                              ids={row.verdict.sharedDeviceIds}
                              labelOf={labelOf}
                              onSelect={onSelect}
                            />
                          </div>
                        )}
                      </li>
                    ),
                  )}
                </Group>
              )}

              {logical.length > 0 && (
                <Group title={`Joined only by VLAN (${logical.length})`}>
                  {logical.map((row) =>
                    row.verdict.kind !== 'logical-only' ? null : (
                      <li key={keyOf(row)}>
                        {rowButton(
                          row,
                          'no cable or radio path is drawn, only a VLAN',
                          row.verdict.path,
                        )}
                      </li>
                    ),
                  )}
                </Group>
              )}

              {noPath.length > 0 && (
                <Group title={`No path drawn (${noPath.length})`}>
                  {noPath.map((row) => (
                    <li key={keyOf(row)} className="px-1 py-1 text-xs text-muted">
                      {pair(row)}. Nothing on the drawing joins their hardware.
                    </li>
                  ))}
                </Group>
              )}

              {unchecked.length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    aria-expanded={openUnchecked}
                    onClick={() => setOpenUnchecked((on) => !on)}
                    className="rounded px-1 text-xs text-accent-ink hover:bg-surface-2"
                  >
                    Cannot be checked here ({unchecked.length})
                  </button>
                  {openUnchecked && (
                    <ul className="mt-1 flex flex-col gap-1">
                      {unchecked.map((row) =>
                        row.verdict.kind !== 'unchecked' ? null : (
                          <li key={keyOf(row)} className="px-1 text-xs text-muted">
                            {pair(row)}.{' '}
                            <span className="text-muted-3">
                              {listOf(
                                row.verdict.reasons.map(
                                  (r) => `${nameOf(r.systemId)} ${UNCHECKED_REASON_TEXT[r.reason]}`,
                                ),
                              )}
                              .
                            </span>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-2">
      <p className="text-[10px] font-semibold tracking-widest text-muted uppercase">{title}</p>
      <ul className="mt-1 flex flex-col gap-px">{children}</ul>
    </div>
  )
}
