import type { CoverageMatrix, RiskLevel, SiteId, System } from '../../types/atlas'

const RANK: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 }

/**
 * Node colours for the risk overlay.
 *
 * The -leaf tokens, not the chrome risk tokens: these are fills and strokes on
 * a dark canvas rather than text on a panel, and they are the same three
 * values the orientation map already uses for the same question.
 */
export const RISK_COLOR: Record<RiskLevel, string> = {
  high: 'var(--node-risk-high-leaf)',
  medium: 'var(--node-risk-medium-leaf)',
  low: 'var(--node-risk-low-leaf)',
}

/** Devices no system claims. Distinct from low risk, which is a judgement. */
export const UNMAPPED_COLOR = 'var(--color-muted-3)'

/**
 * Each device's aggregate risk: the worst risk of any system mapped to it.
 *
 * A device is infrastructure that several systems ride on, so the honest
 * summary is the maximum rather than an average, and a device no mapping names
 * is absent from the map rather than present at low risk.
 */
export function deviceRisks(
  coverage: CoverageMatrix,
  systems: readonly System[],
  siteId: SiteId,
): Map<string, RiskLevel> {
  const out = new Map<string, RiskLevel>()
  const site = coverage.sites[siteId]
  if (!site) return out

  const riskOf = new Map(systems.map((system) => [system.id, system.risk]))
  for (const [systemId, mapping] of Object.entries(site.mappings)) {
    const risk = riskOf.get(systemId)
    if (!risk) continue
    for (const deviceId of mapping.devices) {
      const current = out.get(deviceId)
      if (!current || RANK[risk] > RANK[current]) out.set(deviceId, risk)
    }
  }
  return out
}

/** Colour for one device under the overlay. */
export function riskColor(risk: RiskLevel | undefined): string {
  return risk ? RISK_COLOR[risk] : UNMAPPED_COLOR
}
