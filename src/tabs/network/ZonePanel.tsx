import type { Zone } from '../../types/atlas'
import { zoneColor } from './zones'

export interface ZonePanelProps {
  zones: Record<string, Zone>
  counts: Record<string, number>
  total: number
  /** Null means every zone is shown. */
  activeZone: string | null
  onSelect: (zoneId: string | null) => void
  /** Pointer or focus on a row lights that zone up without committing to it. */
  onPreview?: (zoneId: string | null) => void
}

function buttonClass(active: boolean, muted: boolean): string {
  return [
    'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm',
    active ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink',
    muted ? 'opacity-40' : '',
  ].join(' ')
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  )
}

/**
 * Isolating a zone mutes the rest of the graph rather than removing it, so a
 * zone is always read against the fabric it hangs off.
 */
export function ZonePanel({
  zones,
  counts,
  total,
  activeZone,
  onSelect,
  onPreview,
}: ZonePanelProps) {
  const entries = Object.entries(zones)
  const order = entries.map(([id]) => id)

  return (
    <section aria-label="Zones" className="px-3 py-2">
      <h2 className="mb-1.5 text-[10px] font-semibold tracking-widest text-muted-3 uppercase">
        Zones
      </h2>
      <ul className="flex flex-col gap-px">
        <li>
          <button
            type="button"
            aria-pressed={activeZone === null}
            onClick={() => onSelect(null)}
            className={buttonClass(activeZone === null, false)}
          >
            <Dot color="var(--color-accent-ink)" />
            <span className="min-w-0 flex-1 truncate">All zones</span>
            <span className="tabular text-xs text-muted-3">{total}</span>
          </button>
        </li>
        {entries.map(([id, zone]) => (
          <li key={id}>
            <button
              type="button"
              aria-pressed={activeZone === id}
              onClick={() => onSelect(activeZone === id ? null : id)}
              onPointerEnter={() => onPreview?.(id)}
              onPointerLeave={() => onPreview?.(null)}
              onFocus={() => onPreview?.(id)}
              onBlur={() => onPreview?.(null)}
              className={buttonClass(activeZone === id, activeZone !== null && activeZone !== id)}
              title={zone.description ?? undefined}
            >
              <Dot color={zoneColor(id, order)} />
              <span className="min-w-0 flex-1 truncate" title={zone.label}>
                {zone.label}
              </span>
              <span className="tabular text-xs text-muted-3">{counts[id] ?? 0}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
