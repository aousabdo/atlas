import { Link } from 'react-router-dom'

import { ProvenanceChip } from '../../components/ProvenanceChip'
import type { Confidence, Device, DeviceEdge, System, Zone } from '../../types/atlas'
import { linkStyle, nodeStyle } from './NetworkLegend'

export interface DeviceSystem {
  system: System | null
  systemId: string
  note: string
  confidence: Confidence
  /** False when the mapping names something the systems matrix does not carry. */
  inMatrix: boolean
}

export interface DeviceConnection {
  edge: DeviceEdge
  otherId: string
  otherLabel: string
  /** Which end this device is on, which is what the port fields are keyed to. */
  outgoing: boolean
}

export interface DeviceDetailProps {
  device: Device | null
  zone: Zone | undefined
  systems: DeviceSystem[]
  connections: DeviceConnection[]
  onSelect: (deviceId: string) => void
}

const CONFIDENCE_CLASS: Record<Confidence, string> = {
  high: 'text-risk-low-ink',
  medium: 'text-risk-medium-ink',
  low: 'text-risk-high-ink',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-24 shrink-0 text-muted-3">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{children}</dd>
    </div>
  )
}

/**
 * The device's own record plus the two things the network graph alone cannot
 * tell you: which systems the site claims it realizes, and what it is wired to.
 */
export function DeviceDetail({
  device,
  zone,
  systems,
  connections,
  onSelect,
}: DeviceDetailProps) {
  return (
    <section
      aria-label="Device detail"
      className="rounded border border-line bg-surface p-3"
    >
      {!device ? (
        <>
          <h2 className="text-sm font-semibold text-ink">Device detail</h2>
          <p className="mt-2 text-sm text-muted">
            Pick a device from the list or the graph to see its zone, addressing,
            mapped systems and connections.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-sm font-semibold text-ink">{device.label}</h2>
          <p className="mt-1 text-xs text-muted-3">{nodeStyle(device.type).label}</p>

          <dl className="mt-3 flex flex-col gap-1">
            <Field label="Zone">{zone?.label ?? device.zone}</Field>
            <Field label="Type">{device.type}</Field>
            <Field label="IP">
              {device.ip ? (
                <span className="tabular">{device.ip}</span>
              ) : (
                <span className="text-muted-3">Not recorded in the source diagrams</span>
              )}
            </Field>
            <Field label="Subnet">
              {device.subnet ? (
                <span className="tabular">{device.subnet}</span>
              ) : (
                <span className="text-muted-3">Not recorded</span>
              )}
            </Field>
            <Field label="Description">
              {device.description ?? (
                <span className="text-muted-3">No description in the source</span>
              )}
            </Field>
          </dl>

          <h3 className="mt-4 text-sm font-semibold text-ink">
            Implements
            <ProvenanceChip source="manual" />
          </h3>
          {systems.length === 0 ? (
            <p className="mt-1 text-sm text-muted">
              No system mapping recorded for this device. Infrastructure is
              expected to be unclaimed; anything else is a gap.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {systems.map((entry) => (
                <li key={entry.systemId} className="text-sm">
                  <Link
                    to={`/map?focus=${encodeURIComponent(entry.systemId)}`}
                    className="rounded border border-line bg-surface-2 px-2 py-1 text-accent-ink"
                  >
                    {entry.system?.name ?? entry.systemId}
                  </Link>
                  <span className={`ml-2 text-xs ${CONFIDENCE_CLASS[entry.confidence]}`}>
                    {entry.confidence} confidence
                  </span>
                  {!entry.inMatrix && (
                    <span className="ml-2 text-xs text-muted-3">not in the systems matrix</span>
                  )}
                  <p className="mt-1 text-xs text-muted">{entry.note}</p>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-4 text-sm font-semibold text-ink">
            Connections ({connections.length})
          </h3>
          {connections.length === 0 ? (
            <p className="mt-1 text-sm text-muted">
              No links recorded to this device in the source diagrams.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {connections.map((connection) => {
                const style = linkStyle(connection.edge.link_type)
                const port = connection.outgoing
                  ? connection.edge.port_source
                  : connection.edge.port_target
                return (
                  <li key={`${connection.edge.source}-${connection.edge.target}-${connection.otherId}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(connection.otherId)}
                      className="w-full rounded px-1 py-1 text-left text-sm text-muted hover:text-ink"
                    >
                      <span className="text-ink">{connection.otherLabel}</span>
                      <span className="ml-2 text-xs" style={{ color: style.color }}>
                        {style.label}
                      </span>
                      {connection.edge.label && (
                        <span className="ml-2 text-xs text-muted-3">{connection.edge.label}</span>
                      )}
                      {port && <span className="tabular ml-2 text-xs text-muted-3">{port}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
