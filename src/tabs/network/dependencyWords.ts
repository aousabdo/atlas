import type { DeviceDependency, SystemEffect } from '../../lib/dependency'
import type { DeviceId, RiskLevel, SystemId } from '../../types/atlas'

/**
 * What rests on a device, in words: one builder for the triage rows, the
 * per-device block and the device detail, so one verdict reads one way.
 *
 * The verbs are fixed: a device "strands" a system, "cuts part of" one,
 * "breaks" an integration. Never "will fail", "critical" or "likely": the
 * drawing shows what can reach, not what does.
 */
export interface Namers {
  nameOf: (id: SystemId) => string
  riskOf: (id: SystemId) => RiskLevel
  labelOf: (id: DeviceId) => string
  /**
   * What to call a root: "decision position" only when the site declared it
   * one, "root" otherwise. A printer is an endpoint, not a decision position.
   */
  positionWord: (count: number) => string
}

export function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

type Stranded = Extract<SystemEffect, { kind: 'stranded' }>
type Partial = Extract<SystemEffect, { kind: 'partial' }>

export const strandedOf = (d: DeviceDependency) =>
  d.systems.filter((s): s is Stranded => s.kind === 'stranded')
export const partialOf = (d: DeviceDependency) =>
  d.systems.filter((s): s is Partial => s.kind === 'partial')
export const breaksOf = (d: DeviceDependency) => d.integrations.filter((i) => i.kind === 'breaks')
export const losesEndOf = (d: DeviceDependency) => d.integrations.filter((i) => i.kind === 'loses-end')

const RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }

/** The worst risk among the systems a device strands, for the ink of its row. */
export function worstStrandedRisk(d: DeviceDependency, riskOf: Namers['riskOf']): RiskLevel | null {
  const risks = strandedOf(d).map((s) => riskOf(s.systemId))
  if (risks.length === 0) return null
  return risks.reduce((a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a))
}

/**
 * The one-line summary under a triage row:
 * "strands Bastion Effector (high) · cuts 1 decision position off".
 */
export function summarizeDependency(d: DeviceDependency, n: Namers): string {
  const facts: string[] = []
  const stranded = strandedOf(d)
  const partial = partialOf(d)
  const breaks = breaksOf(d)
  const positions = d.positionsCutOff
  if (stranded.length === 1) {
    const s = stranded[0]!
    facts.push(`strands ${n.nameOf(s.systemId)} (${n.riskOf(s.systemId)})`)
  } else if (stranded.length > 1) {
    facts.push(`strands ${stranded.length} systems`)
  }
  if (partial.length === 1) facts.push(`cuts part of ${n.nameOf(partial[0]!.systemId)} off`)
  else if (partial.length > 1) facts.push(`cuts part of ${partial.length} systems off`)
  if (breaks.length > 0) facts.push(`breaks ${breaks.length} ${plural(breaks.length, 'integration', 'integrations')}`)
  if (positions.length > 0) {
    facts.push(
      facts.length === 0 && positions.length === 1
        ? `cuts ${n.labelOf(positions[0]!)} off from every system`
        : `cuts ${positions.length} ${n.positionWord(positions.length)} off`,
    )
  }
  if (facts.length === 0 && (d.blast?.unreachableCount ?? 0) > 0) {
    const count = d.blast!.unreachableCount
    facts.push(`cuts off ${count}, none a system's hardware`)
  }
  return facts.join(' · ')
}

/**
 * The full account of a device, one sentence per fact, for the "What rests
 * on it" block. `rootCount` is the number of usable roots, for the line a root
 * gets ("measured from the other 6").
 */
export function describeDependency(d: DeviceDependency, n: Namers, rootCount: number): string[] {
  const lines: string[] = []
  if (d.notAssessed === 'only-root') {
    lines.push('This device is the only root, so removing it leaves nothing to measure from. No verdict on systems.')
  } else if (d.notAssessed === 'vlan-only') {
    lines.push('This device is joined only by VLAN links, so the drawing does not show what rests on it.')
  } else if (d.notAssessed === 'no-roots') {
    lines.push('No root here has a cable or radio link, so nothing is measured and nothing is called safe.')
  } else {
    if (d.isRoot) lines.push(`This device is one of the roots; measured from the other ${rootCount - 1}.`)
    const stranded = strandedOf(d)
    const own = stranded.filter((s) => !s.alsoRunsHere)
    const shared = stranded.filter((s) => s.alsoRunsHere)
    if (own.length > 0) {
      lines.push(
        `Strands ${listOf(own.map((s) => n.nameOf(s.systemId)))}: every device ${own.length === 1 ? 'it runs' : 'each runs'} on loses its path.`,
      )
    }
    for (const s of shared) {
      lines.push(`Strands ${n.nameOf(s.systemId)}, which also runs on this device: every other device it runs on loses its path.`)
    }
    for (const p of partialOf(d)) {
      // Counted against every device the system runs on, so the number can be
      // checked against the mapping by hand; this device and any device that
      // had no path to begin with are said separately.
      const lost = p.lostDeviceIds.length
      const kept = p.keptDeviceIds.map(n.labelOf)
      const already = p.deviceCount - lost - p.keptDeviceIds.length - (p.alsoRunsHere ? 1 : 0)
      lines.push(
        [
          `Cuts part of ${n.nameOf(p.systemId)} off: ${lost} of its ${p.deviceCount} devices ${lost === 1 ? 'loses its path' : 'lose their path'} (${listOf(p.lostDeviceIds.map(n.labelOf))}).`,
          `${listOf(kept)} ${kept.length === 1 ? 'keeps its path' : 'keep theirs'}.`,
          ...(p.alsoRunsHere ? ['It also runs on this device.'] : []),
          ...(already > 0 ? [`${already} had no path to begin with.`] : []),
        ].join(' '),
      )
    }
    for (const s of d.systems.filter((x) => x.kind === 'runs-only-here')) {
      lines.push(`Runs ${n.nameOf(s.systemId)}, on this device only. That is this device's own risk, not a dependency.`)
    }
    if (d.positionsCutOff.length === 1) {
      lines.push(`Cuts ${n.labelOf(d.positionsCutOff[0]!)}, a ${n.positionWord(1)}, off from every other device a system runs on.`)
    } else if (d.positionsCutOff.length > 1) {
      lines.push(
        `Cuts ${d.positionsCutOff.length} ${n.positionWord(d.positionsCutOff.length)} off from every other device a system runs on: ${listOf(d.positionsCutOff.map(n.labelOf))}.`,
      )
    }
    if (d.systems.filter((s) => s.kind !== 'runs-only-here').length === 0) {
      lines.push('No realized system loses its path.')
    }
  }
  return lines
}

/** The integration lines, which hold whatever the roots. */
export function describeIntegrations(d: DeviceDependency, n: Namers): string[] {
  const lines: string[] = []
  const pair = (from: SystemId, to: SystemId) => `${n.nameOf(from)} – ${n.nameOf(to)}`
  const breaks = breaksOf(d)
  if (breaks.length > 0) {
    lines.push(
      `Breaks ${breaks.length} documented ${plural(breaks.length, 'integration', 'integrations')}: ${listOf(breaks.map((i) => pair(i.link.from, i.link.to)))}. This holds whatever the roots.`,
    )
    for (const i of breaks) {
      if (i.endsKeepRoots) {
        lines.push(`${pair(i.link.from, i.link.to)}: both ends still reach a ${n.positionWord(1)}; they no longer reach each other.`)
      } else if (i.after.kind === 'logical-only') {
        lines.push(`${pair(i.link.from, i.link.to)}: only a VLAN is drawn between them now.`)
      }
    }
  }
  const losesEnd = losesEndOf(d)
  if (losesEnd.length > 0) {
    const ends = new Set(
      losesEnd.flatMap((i) => (i.after.kind === 'unchecked' ? i.after.reasons.map((r) => r.systemId) : [])),
    )
    lines.push(
      `Loses an end of ${losesEnd.length} documented ${plural(losesEnd.length, 'integration', 'integrations')}: ${listOf([...ends].map(n.nameOf))} ${ends.size === 1 ? 'runs' : 'run'} only on this device.`,
    )
  }
  return lines
}

/**
 * The device detail's sentence about what rests on a device, or null when
 * nothing does. For a device no system lists, it replaces the stock "expected
 * to be unclaimed" line, which is wrong for a switch the effector depends on.
 * For a claimed device it names only the systems its loss strands that do not
 * run on it, which is what the dashed ring marks.
 */
export function restsOnSentence(
  d: DeviceDependency,
  n: Namers,
  phrase: string,
  { claimed, listedNotRealized }: { claimed: boolean; listedNotRealized: boolean },
): string | null {
  if (d.notAssessed) return null
  const stranded = strandedOf(d).filter((s) => !s.alsoRunsHere)
  const strandedWords = stranded.map((s) => `${n.nameOf(s.systemId)} (${n.riskOf(s.systemId)})`)
  if (claimed) {
    return stranded.length > 0
      ? `Its loss also strands ${listOf(strandedWords)}, measured from ${phrase}.`
      : null
  }
  const parts: string[] = []
  if (stranded.length > 0) parts.push(`strands ${listOf(strandedWords)}`)
  const partial = partialOf(d)
  if (partial.length > 0) parts.push(`cuts part of ${listOf(partial.map((p) => n.nameOf(p.systemId)))} off`)
  const breaks = breaksOf(d)
  if (breaks.length > 0) {
    parts.push(`breaks ${breaks.length} documented ${plural(breaks.length, 'integration', 'integrations')}`)
  }
  if (d.positionsCutOff.length === 1) parts.push(`cuts ${n.labelOf(d.positionsCutOff[0]!)} off from every system`)
  else if (d.positionsCutOff.length > 1) {
    parts.push(`cuts ${d.positionsCutOff.length} ${n.positionWord(d.positionsCutOff.length)} off from every system`)
  }
  if (parts.length === 0) return null
  const lead = listedNotRealized
    ? 'No realized system runs on this device (the mappings above name no system the matrix carries, or no hardware)'
    : 'No system lists this device'
  return `${lead}, but on the drawing its loss ${listOf(parts)}, measured from ${phrase}. See If this device is removed.`
}
