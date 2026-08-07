import type { RiskLevel, Severity } from '../types/atlas'

const SEVERITY_STYLE: Record<Severity, string> = {
  ok: 'bg-sev-ok/15 text-sev-ok',
  watch: 'bg-sev-watch/15 text-sev-watch',
  critical: 'bg-sev-critical/15 text-sev-critical',
}

const RISK_STYLE: Record<RiskLevel, string> = {
  high: 'bg-risk-high/15 text-risk-high-ink',
  medium: 'bg-risk-medium/15 text-risk-medium-ink',
  low: 'bg-risk-low/15 text-risk-low-ink',
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return (
    <span
      className={`rounded px-2 py-px text-xs font-medium ${SEVERITY_STYLE[severity]}`}
    >
      {severity}
    </span>
  )
}

export function RiskPill({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`rounded px-2 py-px text-xs font-medium ${RISK_STYLE[risk]}`}>
      {risk}
    </span>
  )
}
