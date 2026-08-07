export interface MapToggles {
  links: boolean
  clean: boolean
  grid: boolean
  desired: boolean
  risk: boolean
}

/** Labels are verbatim from the tool being replaced; readers know them. */
const TOGGLES: { key: keyof MapToggles; label: string; hint: string }[] = [
  { key: 'links', label: 'Links', hint: 'Known integration links between systems' },
  { key: 'clean', label: 'Clean', hint: 'Route links as right angles instead of curves' },
  { key: 'grid', label: 'Grid', hint: 'Snap nodes to aligned columns. Auto-enables Clean' },
  { key: 'desired', label: 'Desired', hint: 'Desired, not yet built, integration links' },
  { key: 'risk', label: 'Risk View', hint: 'Recolour system nodes by risk level' },
]

export interface MapToolbarProps {
  toggles: MapToggles
  onToggle: (key: keyof MapToggles) => void
  onReset: () => void
  onExpandAll: () => void
}



const BUTTON = 'rounded border px-3 py-1 text-sm transition-colors'

export function MapToolbar({
  toggles, onToggle, onReset, onExpandAll,
}: MapToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Map controls"
      className="flex flex-wrap items-center gap-2"
    >
      {TOGGLES.map(({ key, label, hint }) => (
        <button
          key={key}
          type="button"
          title={hint}
          aria-pressed={toggles[key]}
          onClick={() => {
            onToggle(key)
          }}
          className={`${BUTTON} ${
            toggles[key]
              ? 'border-accent bg-accent/15 text-accent-ink'
              : 'border-line bg-surface text-muted hover:text-ink'
          }`}
        >
          {label}
        </button>
      ))}

      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

      <button
        type="button"
        onClick={onReset}
        className={`${BUTTON} border-line bg-surface text-muted hover:text-ink`}
      >
        Reset
      </button>
      <button
        type="button"
        onClick={onExpandAll}
        className={`${BUTTON} border-line bg-surface text-muted hover:text-ink`}
      >
        Expand All
      </button>



    </div>
  )
}
