const BUTTON =
  'rounded px-1.5 py-0.5 text-sm leading-none text-muted hover:bg-surface-2 hover:text-ink'

export interface ViewStripStepper {
  /** Shown in full next to the value. Glyphs were unreadable: three unlabelled
   *  percentages in a row are indistinguishable at a glance. */
  label: string
  value: number
  decreaseLabel: string
  increaseLabel: string
  onStep: (direction: number) => void
}

export interface ViewStripAction {
  label: string
  title: string
  onClick: () => void
}

function Stepper({ label, value, decreaseLabel, increaseLabel, onStep }: ViewStripStepper) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <span className="w-12 text-xs text-muted-2">{label}</span>
      <button
        type="button"
        onClick={() => onStep(-1)}
        aria-label={decreaseLabel}
        className={BUTTON}
      >
        &minus;
      </button>
      <span className="tabular w-10 text-center text-xs text-ink">
        {Math.round(value * 100)}%
      </span>
      <button
        type="button"
        onClick={() => onStep(1)}
        aria-label={increaseLabel}
        className={BUTTON}
      >
        +
      </button>
    </div>
  )
}

/**
 * What an unlabelled strip is called.
 *
 * Only a fallback. A strip with no name at all is unreachable by role and name,
 * which is precisely the hole that let a deleted control go unnoticed, so the
 * absence of a caller-supplied label must not degrade into the absence of a
 * name. Callers are expected to say which view they control.
 */
export const DEFAULT_VIEW_STRIP_LABEL = 'View controls'

export interface ViewStripProps {
  /**
   * What this strip controls, as announced to assistive tech and asserted by
   * the e2e inventory test.
   *
   * A prop and not a constant because the map and the network tab each render
   * one. Two toolbars answering to the same name means a test that finds "the"
   * strip cannot say which tab's strip it found, and a control deleted from one
   * of them is then only ever a pixel count.
   */
  label?: string
  steppers: ViewStripStepper[]
  actions: ViewStripAction[]
}

/**
 * How big the view is, as opposed to what it shows.
 *
 * Shared by the map and the topology so the two graph tabs behave the same way.
 * Everything is spelled out: an earlier version used glyphs and it read as
 * three anonymous percentages side by side.
 *
 * Two columns rather than one long row. Three steppers plus an action group is
 * four cells, which lands as a 2x2 on both tabs and roughly halves the width,
 * so the strip stops running across the canvas.
 *
 * The grid is also why this is a named toolbar rather than a bare div. Removing
 * the only action leaves an empty cell and moves nothing, so the whole
 * regression is 33 pixels and no screenshot tolerance worth shipping can be
 * relied on to see it. A list of accessible names can.
 */
export function ViewStrip({
  label = DEFAULT_VIEW_STRIP_LABEL,
  steppers,
  actions,
}: ViewStripProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className="pointer-events-auto inline-grid grid-cols-2 gap-x-5 gap-y-1.5 rounded border border-line bg-surface/90 px-3 py-2 backdrop-blur"
    >
      {steppers.map((stepper) => (
        <Stepper key={stepper.label} {...stepper} />
      ))}
      {actions.length > 0 && (
        <div className="flex items-center gap-1">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              title={action.title}
              className={`${BUTTON} text-xs`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
