import { useState } from 'react'

import type {
  DeviceDependency,
  RootChoiceOption,
  RootSet,
  Sensitivity,
  SiteDependencies,
  TriageGroup,
  Verdict,
  VerdictChange,
} from '../../lib/dependency'
import type { DeviceId, Topology } from '../../types/atlas'
import { describeDependency, describeIntegrations, listOf, summarizeDependency, worstStrandedRisk, type Namers } from './dependencyWords'
import { DeviceLinks, Disclosure } from './ResiliencePanel'
import { RootBadgeChip, RootSelect, rootPhrase } from './roots'

const RISK_INK: Record<string, string> = {
  high: 'text-risk-high-ink',
  medium: 'text-risk-medium-ink',
  low: 'text-risk-low-ink',
}

const GROUP_TITLE: Record<TriageGroup, string> = {
  'load-bearing': 'Load-bearing',
  'cuts-devices-off': 'Cuts devices off',
  'nothing-loses-path': 'Nothing loses its path',
  'one-link': 'Hangs off one link',
  'not-assessed': 'Not assessed',
}

const GROUP_LEAD: Record<TriageGroup, string> = {
  'load-bearing':
    'Removing any one of these strands a realized system, cuts part of one off, breaks a documented integration, or cuts a POSITION off from every system.',
  'cuts-devices-off': 'Removing it leaves devices with no path to a root, but every realized system keeps one.',
  'nothing-loses-path':
    'Every other device keeps a path to a root without it. Some of these are a second way round for something else.',
  'one-link':
    'One cable or radio link each, so nothing passes through it. If it is not infrastructure, it is a mapping nobody has written.',
  'not-assessed': 'No verdict, for the reason each one gives.',
}

/**
 * What rests on the devices no system claims.
 *
 * The risk overlay paints an unclaimed device grey, as if it carried no risk.
 * This sorts every such device by what its loss would do, on the drawing,
 * measured from the root set printed at the top. The groups are facts about
 * the drawing, not a priority, so a device is listed by name within its group.
 */
export function UnclaimedPanel({
  topology,
  deps,
  sensitivity,
  roots,
  rootOptions,
  onRootKey,
  namers,
  onSelect,
  onShow,
  siteLabel,
  reviewed,
}: {
  topology: Topology
  deps: SiteDependencies | null
  sensitivity: Sensitivity | null
  roots: RootSet
  rootOptions: readonly RootChoiceOption[]
  onRootKey: (key: string) => void
  namers: Namers
  onSelect: (id: DeviceId) => void
  onShow: (id: DeviceId) => void
  siteLabel: string
  /** Known before the dependencies land, so the root controls never flicker away. */
  reviewed: boolean
}) {
  const declaresPositions = rootOptions.some((o) => o.key === '@declared')
  const [open, setOpen] = useState(false)
  const [namedRoots, setNamedRoots] = useState(false)
  const [openId, setOpenId] = useState<DeviceId | null>(null)
  const [openGroups, setOpenGroups] = useState<Partial<Record<TriageGroup, boolean>>>({})
  const [openChanges, setOpenChanges] = useState(false)
  const { labelOf } = namers
  const phrase = rootPhrase(roots, labelOf)
  const total = topology.devices.length

  const triage = deps?.triage
  const badge = !deps
    ? undefined
    : triage!.status === 'not-reviewed'
      ? 'not reviewed'
      : triage!.status === 'no-roots'
        ? 'not measured'
        : triage!.status === 'measured'
          ? `${triage!.groups['load-bearing'].length} of ${triage!.population.length}`
          : undefined

  const rowFor = (id: DeviceId) => {
    const dep = deps!.byDevice.get(id)!
    const isOpen = openId === id
    const worst = worstStrandedRisk(dep, namers.riskOf)
    return (
      <li key={id}>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => {
            onSelect(id)
            setOpenId(isOpen ? null : id)
          }}
          className={[
            'w-full rounded px-1 py-1 text-left',
            isOpen ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2',
          ].join(' ')}
        >
          <span className="block truncate text-sm text-ink">{labelOf(id)}</span>
          <span className={`block text-xs ${worst ? RISK_INK[worst] : 'text-muted-3'}`}>
            {summarizeDependency(dep, namers)}
          </span>
        </button>
        {isOpen && <DependencyDetail dep={dep} namers={namers} roots={roots} onSelect={onSelect} onShow={onShow} />}
      </li>
    )
  }

  const nameList = (group: TriageGroup, ids: DeviceId[]) => {
    const isOpen = !!openGroups[group]
    return (
      <>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setOpenGroups((g) => ({ ...g, [group]: !isOpen }))}
          className="rounded px-1 text-xs text-accent-ink hover:bg-surface-2"
        >
          {isOpen ? 'Hide them' : `Name the ${ids.length}`}
        </button>
        {isOpen && (
          <ul className="mt-1 flex flex-col gap-px">
            {ids.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onSelect(id)}
                  className="w-full truncate rounded px-1 py-0.5 text-left text-xs text-muted hover:bg-surface-2 hover:text-ink"
                >
                  {labelOf(id)}
                  {roots.deviceIds.includes(id) ? ` · ${namers.positionWord(1)}` : ''}
                  {group === 'cuts-devices-off'
                    ? ` · cuts off ${deps!.byDevice.get(id)!.blast?.unreachableCount ?? 0}`
                    : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <section aria-label="Unclaimed devices" className="px-3 py-2">
      <Disclosure
        open={open}
        onToggle={() => setOpen((on) => !on)}
        title="Unclaimed devices"
        note="What rests on the devices no system claims"
        badge={badge}
      />

      {open && (
        <div className="mb-2 pl-5">
          {!reviewed ? (
            <p className="text-xs text-muted">
              Nobody has recorded which systems run at {siteLabel}, so its {total} devices read
              as unclaimed only because nobody has looked, and nothing can be said to rest on
              them. Not reviewed is not zero.
            </p>
          ) : (
            <>
              {/* 1. The root set, always first: every verdict below rests on it. */}
              <div className="text-xs text-muted">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <RootBadgeChip roots={roots} />
                  <span>Measured from {phrase}.</span>
                  {roots.deviceIds.length > 0 && (
                    <button
                      type="button"
                      aria-expanded={namedRoots}
                      onClick={() => setNamedRoots((on) => !on)}
                      className="rounded px-1 text-accent-ink hover:bg-surface-2"
                    >
                      {namedRoots ? 'Hide them' : 'Name them'}
                    </button>
                  )}
                </p>
                {namedRoots && (
                  <div className="mt-1">
                    <DeviceLinks ids={roots.deviceIds} labelOf={labelOf} onSelect={onSelect} />
                    {roots.assumedIds.length > 0 && (
                      <p className="mt-1 text-muted-3">
                        Marked as assumptions: {listOf(roots.assumedIds.map(labelOf))}.
                      </p>
                    )}
                    {roots.note && <p className="mt-1 text-muted-3">&ldquo;{roots.note}&rdquo;</p>}
                  </div>
                )}
                {roots.unknownIds.length > 0 && (
                  <p className="mt-1 text-risk-medium-ink">
                    Declared but not on this drawing: {listOf(roots.unknownIds)}.
                  </p>
                )}
                {roots.logicalOnlyIds.length > 0 && (
                  <p className="mt-1 text-muted-3">
                    Joined only by VLAN, so they seed nothing: {listOf(roots.logicalOnlyIds.map(labelOf))}.
                  </p>
                )}
                {roots.isolatedIds.length > 0 && (
                  <p className="mt-1 text-muted-3">
                    No link of any kind on the drawing, so they seed nothing: {listOf(roots.isolatedIds.map(labelOf))}.
                  </p>
                )}
                {!declaresPositions && roots.choice.source === 'derived' && (
                  <p className="mt-1 text-muted-3">
                    No decision positions are declared for this site, so reachability is measured
                    from the drawing&rsquo;s entry points. Add decision_roots for this site to the
                    device map to measure from where decisions are made.
                  </p>
                )}
                <RootSelect options={rootOptions} value={roots.key} onChange={onRootKey} />
              </div>

              {!deps ? (
                <p role="status" className="mt-2 text-xs text-muted">
                  Working out what rests on each device.
                </p>
              ) : triage!.status === 'no-realized-system' ? (
                <p className="mt-2 text-xs text-muted">
                  {siteLabel} records checked absences but no realized system, so there is
                  nothing for a device to strand.
                </p>
              ) : triage!.status === 'no-roots' ? (
                <p className="mt-2 text-xs text-muted">
                  None of {phrase} is on this drawing with a cable or radio link. Nothing is
                  measured, so nothing is called safe. Pick another root set above.
                </p>
              ) : triage!.status === 'nothing-unclaimed' ? (
                <p className="mt-2 text-xs text-muted">
                  Every device here carries a realized system, so there is nothing unclaimed to
                  sort.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-xs text-muted-3">
                    Each device is removed from the drawing on its own. Cable and radio only; a
                    VLAN is never a way round. A drawing shows what can reach, not what does.
                  </p>

                  {/* Systems no device can be charged with, named once. */}
                  {deps.standings
                    .filter((st) => st.status !== 'assessable')
                    .map((st) => (
                      <p key={st.systemId} className="mt-1 text-xs text-risk-medium-ink">
                        {st.status === 'never-reaches'
                          ? `${namers.nameOf(st.systemId)} has no path to ${phrase} before anything is removed (${listOf(st.deviceIds.map(labelOf))}), so it is never counted against a device.`
                          : `${namers.nameOf(st.systemId)} is joined only by VLAN links (${listOf(st.deviceIds.map(labelOf))}), so the drawing does not show what it rests on.`}
                      </p>
                    ))}
                  {deps.notInDrawing.length > 0 && (
                    <p className="mt-1 text-xs text-muted-3">
                      Realized here but on no device this drawing has: {listOf(deps.notInDrawing.map(namers.nameOf))}.
                    </p>
                  )}

                  {triage!.population.length !== triage!.listedUnclaimedIds.length && (
                    <p className="mt-1 text-xs text-muted-3">
                      {triage!.population.length} of {total} devices carry no realized system here.
                      The device map lists {triage!.listedUnclaimedIds.length} of them as
                      infrastructure
                      {triage!.notListed.length > 0
                        ? `; ${triage!.notListed.length === 1 ? 'the other is' : 'the others are'} ${listOf(
                            triage!.notListed.map((n) =>
                              n.namedBy.length > 0
                                ? `${labelOf(n.deviceId)}, named only by ${listOf(n.namedBy)}, which the systems matrix does not carry`
                                : labelOf(n.deviceId),
                            ),
                          )}`
                        : ''}
                      .
                    </p>
                  )}

                  {(['load-bearing', 'cuts-devices-off', 'nothing-loses-path', 'one-link', 'not-assessed'] as TriageGroup[]).map((group) => {
                    const ids = triage!.groups[group]
                    if (group === 'not-assessed' && ids.length === 0) return null
                    return (
                      <div key={group} className="mt-3">
                        <h3 className="text-[10px] font-semibold tracking-widest text-muted uppercase">
                          {GROUP_TITLE[group]} ({ids.length})
                        </h3>
                        <p className="mt-0.5 text-xs text-muted-3">
                          {GROUP_LEAD[group].replace('POSITION', namers.positionWord(1))}
                        </p>
                        {group === 'load-bearing' ? (
                          ids.length === 0 ? (
                            <p className="mt-1 text-xs text-muted">
                              None of the {triage!.population.length} devices no system claims
                              strands a system, cuts part of one off, breaks an integration or cuts
                              a decision position off on its own, measured from {phrase}.
                            </p>
                          ) : (
                            <ul className="mt-1 flex flex-col gap-px">{ids.map(rowFor)}</ul>
                          )
                        ) : group === 'not-assessed' ? (
                          <ul className="mt-1 flex flex-col gap-1">
                            {triage!.notAssessed.map(({ deviceId, reason }) => (
                              <li key={deviceId} className="text-xs text-muted">
                                {reason === 'only-root'
                                  ? `${labelOf(deviceId)} is the only root, so removing it leaves nothing to measure from.`
                                  : reason === 'not-reached'
                                    ? `${labelOf(deviceId)} is not reachable from ${phrase} on cable and radio to begin with, so nothing is measured through it.`
                                    : `${labelOf(deviceId)} is joined only by VLAN, so the drawing does not show what rests on it.`}
                              </li>
                            ))}
                          </ul>
                        ) : ids.length > 0 ? (
                          nameList(group, ids)
                        ) : null}
                      </div>
                    )
                  })}

                  <SensitivityBlock
                    sensitivity={sensitivity}
                    roots={roots}
                    namers={namers}
                    open={openChanges}
                    onToggle={() => setOpenChanges((on) => !on)}
                    onSelect={onSelect}
                    onRootKey={onRootKey}
                  />

                  <p className="mt-3 text-xs text-muted-3">
                    The groups are facts about the drawing, not a priority; within a group,
                    devices are listed by name.
                    {(() => {
                      const onRoot = deps.standings.filter((s) => s.onRootIds.length > 0)
                      return onRoot.length > 0
                        ? ` ${listOf(onRoot.map((s) => namers.nameOf(s.systemId)))} ${onRoot.length === 1 ? 'runs' : 'run'} on a decision position, so no other single loss can strand ${onRoot.length === 1 ? 'it' : 'them'}; a loss can still cut part of one off, and that is listed.`
                        : ''
                    })()}
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function DependencyDetail({
  dep,
  namers,
  roots,
  onSelect,
  onShow,
}: {
  dep: DeviceDependency
  namers: Namers
  roots: RootSet
  onSelect: (id: DeviceId) => void
  onShow: (id: DeviceId) => void
}) {
  const lines = [
    ...describeDependency(dep, namers, roots.deviceIds.length - roots.logicalOnlyIds.length),
    ...describeIntegrations(dep, namers),
  ]
  const lost = [...new Set(dep.systems.flatMap((s) => (s.kind === 'runs-only-here' ? [] : s.lostDeviceIds)))]
  return (
    <div className="mb-1 border-l border-line pl-2">
      <ul className="mt-1 flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line} className="text-xs text-muted">
            {line}
          </li>
        ))}
      </ul>
      {lost.length > 0 && (
        <>
          <p className="mt-1 text-xs text-muted-3">The systems&rsquo; devices that lose their path:</p>
          <DeviceLinks ids={lost} labelOf={namers.labelOf} onSelect={onSelect} />
        </>
      )}
      {(dep.blast?.unreachableCount ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => onShow(dep.deviceId)}
          className="mt-1 rounded border border-line px-2 py-0.5 text-xs text-muted hover:text-ink"
        >
          Show on graph
        </button>
      )}
    </div>
  )
}

function verdictWords(v: Verdict, namers: Namers): string {
  if (v.notAssessed) {
    return v.notAssessed === 'only-root'
      ? 'not assessed, as the only root'
      : v.notAssessed === 'not-reached'
        ? 'not assessed, as no root reaches it'
        : 'not assessed'
  }
  const parts: string[] = []
  if (v.stranded.length === 1) parts.push(`strands ${namers.nameOf(v.stranded[0]!)}`)
  else if (v.stranded.length > 1) parts.push(`strands ${v.stranded.length} systems`)
  if (v.partial.length > 0) {
    // The count of devices lost, so a change in the hardware cut off shows.
    const lost = v.partial.reduce((sum, p) => sum + p.lostDeviceIds.length, 0)
    const whose = v.partial.length === 1 ? namers.nameOf(v.partial[0]!.systemId) : `${v.partial.length} systems`
    parts.push(`cuts part of ${whose} off (${lost} ${lost === 1 ? 'device' : 'devices'})`)
  }
  if (v.positionsCutOff.length > 0) {
    const k = v.positionsCutOff.length
    parts.push(`cuts ${k} ${namers.positionWord(k)} off`)
  }
  if (parts.length > 0) return listOf(parts)
  return v.group === 'load-bearing' ? 'load-bearing' : v.group === 'cuts-devices-off' ? 'cuts devices off only' : 'strands none'
}

/** One row of the assumption check: what it says now, and without the assumptions. */
function changeWords(change: VerdictChange, namers: Namers): string {
  const shown = verdictWords(change.shown, namers)
  const without = verdictWords(change.without, namers)
  // Same words, different ids: say that the devices or positions differ.
  return shown === without
    ? `${shown}; without them, the same counts, but different ${change.shown.positionsCutOff.join() !== change.without.positionsCutOff.join() ? namers.positionWord(2) : 'devices'}.`
    : `${shown}; without them, ${without}.`
}

function SensitivityBlock({
  sensitivity,
  roots,
  namers,
  open,
  onToggle,
  onSelect,
  onRootKey,
}: {
  sensitivity: Sensitivity | null
  roots: RootSet
  namers: Namers
  open: boolean
  onToggle: () => void
  onSelect: (id: DeviceId) => void
  onRootKey: (key: string) => void
}) {
  if (roots.choice.source === 'declared-without-assumed') {
    return (
      <div className="mt-3">
        <h3 className="text-[10px] font-semibold tracking-widest text-muted uppercase">Assumptions</h3>
        <p className="mt-0.5 text-xs text-muted">
          Showing the verdicts without the positions marked as assumptions.{' '}
          <button
            type="button"
            onClick={() => onRootKey('@declared')}
            className="rounded px-1 text-accent-ink hover:bg-surface-2"
          >
            Back to the declared set
          </button>
        </p>
      </div>
    )
  }
  if (!sensitivity || sensitivity.status === 'not-applicable') return null
  const n = sensitivity.assumedIds.length
  return (
    <div className="mt-3">
      <h3 className="text-[10px] font-semibold tracking-widest text-muted uppercase">Assumptions</h3>
      {sensitivity.status === 'no-roots-left' ? (
        <p className="mt-0.5 text-xs text-muted">
          Every declared position is marked as an assumption, so there is nothing to compare
          against.
        </p>
      ) : sensitivity.status === 'alternative-unusable' ? (
        <p className="mt-0.5 text-xs text-muted">
          Without the {n} {n === 1 ? 'position' : 'positions'} marked as assumptions, none left
          has a cable or radio link ({listOf(sensitivity.unusableIds.map(namers.labelOf))}), so there
          is nothing to compare against.
        </p>
      ) : sensitivity.changes.length === 0 ? (
        <p className="mt-0.5 text-xs text-muted">
          No verdict here rests on the {n} {n === 1 ? 'position' : 'positions'} marked as
          assumptions.
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-muted">
            {sensitivity.changes.length} {sensitivity.changes.length === 1 ? "device's verdict rests" : "devices' verdicts rest"} on
            the {n} {n === 1 ? 'position' : 'positions'} marked as assumptions.{' '}
            <button
              type="button"
              aria-expanded={open}
              onClick={onToggle}
              className="rounded px-1 text-accent-ink hover:bg-surface-2"
            >
              {open ? 'Hide them' : `List the ${sensitivity.changes.length}`}
            </button>{' '}
            <button
              type="button"
              onClick={() => onRootKey('@declared-without-assumed')}
              className="rounded px-1 text-accent-ink hover:bg-surface-2"
            >
              Show without them
            </button>
          </p>
          {open && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {sensitivity.changes.map((change) => (
                <li key={change.deviceId} className="text-xs text-muted">
                  <button
                    type="button"
                    onClick={() => onSelect(change.deviceId)}
                    className="rounded text-left text-ink hover:text-accent-ink"
                  >
                    {namers.labelOf(change.deviceId)}
                  </button>
                  : {changeWords(change, namers)}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-muted-3">
            Integrations broken do not depend on the roots, so none changes here.
          </p>
        </>
      )}
    </div>
  )
}
