/**
 * The mark is the thing the tool draws: a hub, spokes out to systems, and one
 * spoke that dashes out to a hollow node. That last one is the gap ATLAS
 * exists to make visible, so the logo states the thesis rather than decorating
 * it.
 *
 * Colours come from tokens, so it inverts with the theme. Geometry is the same
 * as public/favicon.svg, which is a fixed-palette copy for the browser tab.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  const spokes: Array<[number, number]> = [
    [32, 14],
    [47.6, 23],
    [47.6, 41],
    [16.4, 23],
    [16.4, 41],
  ]

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="ATLAS"
      className="shrink-0"
    >
      <g
        stroke="var(--color-accent)"
        strokeWidth={2.6}
        strokeLinecap="round"
        fill="none"
      >
        {spokes.map(([x, y]) => (
          <path key={`${x}-${y}`} d={`M32 32 L${x} ${y}`} />
        ))}
      </g>
      <path
        d="M32 32 L32 50"
        stroke="var(--color-risk-high)"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeDasharray="3.4 3.4"
        fill="none"
      />
      <g fill="var(--color-accent)">
        {spokes.map(([x, y]) => (
          <circle key={`n-${x}-${y}`} cx={x} cy={y} r={4.4} />
        ))}
      </g>
      <circle
        cx={32}
        cy={50}
        r={4.4}
        fill="none"
        stroke="var(--color-risk-high)"
        strokeWidth={2.6}
      />
      <circle cx={32} cy={32} r={7} fill="var(--color-ink)" />
    </svg>
  )
}

export function Logo() {
  return (
    <span
      className="mr-3 flex items-center gap-2"
      title="ATLAS: Architecture Traceability and Lossiness Analysis System"
    >
      <LogoMark />
      <span className="font-semibold tracking-wide text-accent-ink">ATLAS</span>
    </span>
  )
}
