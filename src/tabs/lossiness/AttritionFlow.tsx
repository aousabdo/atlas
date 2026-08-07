import { useMemo } from 'react'

import { EmptyState } from '../../components/EmptyState'
import type { LossinessDimension, Severity } from '../../types/atlas'
import {
  ATTRITION_DEFAULT_HEIGHT,
  ATTRITION_DEFAULT_WIDTH,
  buildAttritionStages,
  layoutAttrition,
} from '../../viz/attrition'

const SEVERITY_COLOR: Record<Severity, string> = {
  ok: 'var(--color-sev-ok)',
  watch: 'var(--color-sev-watch)',
  critical: 'var(--color-sev-critical)',
}

/**
 * The headline visual: requirements to systems to hardware, left to right,
 * with what is lost at each stage bleeding off into a named node instead of
 * quietly disappearing.
 *
 * Sized by viewBox rather than by measuring the container. The geometry is
 * pure and the SVG scales with CSS, so there is no first-paint measurement to
 * get wrong and no resize listener to leak.
 */
export function AttritionFlow({
  dimensions,
  width = ATTRITION_DEFAULT_WIDTH,
  height = ATTRITION_DEFAULT_HEIGHT,
}: {
  dimensions: LossinessDimension[]
  width?: number
  height?: number
}) {
  const geometry = useMemo(
    () => layoutAttrition(buildAttritionStages(dimensions), { width, height }),
    [dimensions, width, height],
  )

  return (
    <section aria-labelledby="attrition-heading" className="mt-8">
      <h2 id="attrition-heading" className="text-base font-semibold text-ink">
        Attrition flow
      </h2>
      <p className="mt-1 text-sm text-muted">
        Each stage is measured against its own denominator, so the bands are not
        one quantity flowing through four filters. Read each band on its own and
        read the arrows as the next question, not as a conversion.
      </p>

      {geometry.bands.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No flow to draw"
            detail="The report carries none of the four dimensions this flow is built from."
          />
        </div>
      ) : (
        <figure className="mt-3 rounded border border-line bg-surface p-3">
          <svg
            role="img"
            aria-label="Requirement to hardware attrition flow"
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            preserveAspectRatio="xMidYMid meet"
            className="h-auto w-full"
          >
            {geometry.arrows.map((arrow) => (
              <path
                key={arrow.id}
                d={arrow.path}
                fill="none"
                stroke="var(--color-muted-3)"
                strokeWidth={1.25}
              />
            ))}

            {geometry.bands.map((band) => {
              const color = SEVERITY_COLOR[band.severity]
              return (
                <g key={band.key}>
                  <path
                    d={band.keptPath}
                    fill="var(--color-accent)"
                    fillOpacity={0.18}
                    stroke="var(--color-accent)"
                    strokeOpacity={0.55}
                  />
                  <path
                    d={band.lossPath}
                    fill={color}
                    fillOpacity={0.16}
                    stroke={color}
                    strokeOpacity={0.5}
                  />
                  <rect
                    x={band.loss.x}
                    y={band.loss.y}
                    width={band.loss.width}
                    height={band.loss.height}
                    rx={6}
                    fill="var(--color-surface-2)"
                    stroke={color}
                  />

                  <text
                    x={band.titleX}
                    y={band.titleY}
                    fontSize={13}
                    fontWeight={600}
                    fill="var(--color-ink)"
                  >
                    {band.label}
                  </text>
                  <text
                    x={band.unitX}
                    y={band.unitY}
                    fontSize={11.5}
                    fill="var(--color-muted)"
                    className="tabular"
                  >
                    {`${band.total} ${band.unit}`}
                  </text>

                  <text
                    x={band.keptValueX}
                    y={band.keptValueY}
                    textAnchor="end"
                    fontSize={18}
                    fontWeight={600}
                    fill="var(--color-ink)"
                    className="tabular"
                  >
                    {band.kept}
                  </text>
                  <text
                    x={band.keptLabelX}
                    y={band.keptLabelY}
                    textAnchor="end"
                    fontSize={11.5}
                    fill="var(--color-muted)"
                  >
                    {band.keptLabel}
                  </text>

                  <text
                    x={band.loss.valueX}
                    y={band.loss.valueY}
                    fontSize={15}
                    fontWeight={600}
                    fill="var(--color-ink)"
                    className="tabular"
                  >
                    {band.lost}
                  </text>
                  <text
                    x={band.loss.labelX}
                    y={band.loss.labelY}
                    fontSize={11.5}
                    fill="var(--color-muted)"
                  >
                    {band.lossLabel}
                  </text>
                </g>
              )
            })}
          </svg>
          <figcaption className="mt-2 text-xs text-muted-2">
            The upper band is what survives the stage. The wedge below it is what
            the stage loses, funnelled into the named box underneath.
          </figcaption>
        </figure>
      )}
    </section>
  )
}
