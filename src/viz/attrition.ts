/**
 * Geometry for the attrition flow. Pure functions: numbers in, numbers out.
 *
 * Requirements, systems and devices are three different populations. A
 * conserved Sankey across them would invent a quantity nobody counted, so each
 * stage is measured against its own denominator: every band starts at full
 * height and tapers by that stage's own loss, and the loss bleeds off into a
 * labelled node underneath.
 */
import type { LossinessDimension, Severity } from '../types/atlas'

export interface AttritionStage {
  key: string
  label: string
  /** Plural noun for the population this stage measures, e.g. 'requirements'. */
  unit: string
  total: number
  kept: number
  lost: number
  keptLabel: string
  lossLabel: string
  severity: Severity
}

interface StageSpec {
  key: string
  label: string
  unit: string
  keptLabel: string
  lossLabel: string
  /** Whether the dimension's numerator counts what survived or what was lost. */
  numeratorIs: 'kept' | 'lost'
}

/** The four stages of the flow, left to right. Order is the visual order. */
const STAGE_SPECS: readonly StageSpec[] = [
  {
    key: 'requirement_attrition',
    label: 'Requirements',
    unit: 'requirements',
    keptLabel: 'carried forward',
    lossLabel: 'not carried forward',
    numeratorIs: 'kept',
  },
  {
    key: 'ownership_ambiguity',
    label: 'Systems: ownership',
    unit: 'systems',
    keptLabel: 'owner confirmed',
    lossLabel: 'unconfirmed',
    numeratorIs: 'kept',
  },
  {
    key: 'realization_gap',
    label: 'Systems: realization',
    unit: 'systems',
    keptLabel: 'mapped to hardware',
    lossLabel: 'unmapped',
    numeratorIs: 'kept',
  },
  {
    key: 'orphaned_hardware',
    label: 'Hardware',
    unit: 'devices',
    keptLabel: 'claimed by a system',
    lossLabel: 'unexplained hardware',
    numeratorIs: 'lost',
  },
]

/**
 * Reduce the lossiness dimensions to the four stages of the flow.
 *
 * A dimension the report does not carry is skipped rather than faked, so a
 * partial report draws a shorter flow instead of a wrong one.
 */
export function buildAttritionStages(
  dimensions: LossinessDimension[],
): AttritionStage[] {
  const byKey = new Map(dimensions.map((d) => [d.key, d]))
  const stages: AttritionStage[] = []
  for (const spec of STAGE_SPECS) {
    const dimension = byKey.get(spec.key)
    if (!dimension) continue
    const total = Math.max(0, dimension.denominator)
    const numerator = clamp(dimension.numerator, 0, total)
    const kept = spec.numeratorIs === 'kept' ? numerator : total - numerator
    stages.push({
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      total,
      kept,
      lost: total - kept,
      keptLabel: spec.keptLabel,
      lossLabel: spec.lossLabel,
      severity: dimension.severity,
    })
  }
  return stages
}

export const ATTRITION_DEFAULT_WIDTH = 960
export const ATTRITION_DEFAULT_HEIGHT = 420

const PADDING = { top: 58, right: 16, bottom: 104, left: 16 }
const STAGE_GAP = 34
const LOSS_BOX_HEIGHT = 44
const LOSS_BOX_GAP = 26
const LOSS_BOX_WIDTH_RATIO = 0.8

export interface AttritionLossNode {
  x: number
  y: number
  width: number
  height: number
  valueX: number
  valueY: number
  labelX: number
  labelY: number
}

export interface AttritionBand extends AttritionStage {
  x0: number
  x1: number
  keptHeight: number
  lossHeight: number
  /** The band that survives this stage, top aligned and tapering right. */
  keptPath: string
  /** The wedge peeling off the taper into the loss node. */
  lossPath: string
  titleX: number
  titleY: number
  unitX: number
  unitY: number
  keptValueX: number
  keptValueY: number
  keptLabelX: number
  keptLabelY: number
  loss: AttritionLossNode
}

export interface AttritionArrow {
  id: string
  path: string
}

export interface AttritionGeometry {
  width: number
  height: number
  trunkTop: number
  trunkHeight: number
  bands: AttritionBand[]
  arrows: AttritionArrow[]
}

export interface AttritionSize {
  width: number
  height: number
}

/**
 * Place the stages across the viewport.
 *
 * Returns empty geometry for a non-positive width or height. React mounts
 * before layout, so the first measurement of a container is 0; without this
 * guard every coordinate downstream becomes NaN and the SVG renders blank
 * with a console full of attribute errors.
 */
export function layoutAttrition(
  stages: AttritionStage[],
  { width, height }: AttritionSize,
): AttritionGeometry {
  const empty: AttritionGeometry = {
    width: Math.max(0, finite(width)),
    height: Math.max(0, finite(height)),
    trunkTop: 0,
    trunkHeight: 0,
    bands: [],
    arrows: [],
  }
  if (!Number.isFinite(width) || !Number.isFinite(height)) return empty
  if (width <= 0 || height <= 0) return empty
  if (stages.length === 0) return empty

  const trunkTop = PADDING.top
  const trunkHeight = height - PADDING.top - PADDING.bottom
  const inner = width - PADDING.left - PADDING.right
  const spanWidth = (inner - STAGE_GAP * (stages.length - 1)) / stages.length
  if (trunkHeight <= 0 || spanWidth <= 0) return empty

  const yFull = trunkTop + trunkHeight
  const bands: AttritionBand[] = []
  const arrows: AttritionArrow[] = []

  stages.forEach((stage, i) => {
    const x0 = PADDING.left + i * (spanWidth + STAGE_GAP)
    const x1 = x0 + spanWidth
    const xm = (x0 + x1) / 2
    const fraction = stage.total > 0 ? clamp(stage.kept / stage.total, 0, 1) : 0
    const keptHeight = trunkHeight * fraction
    const yKept = trunkTop + keptHeight

    const lossWidth = spanWidth * LOSS_BOX_WIDTH_RATIO
    const lossX = x1 - lossWidth
    const lossY = yFull + LOSS_BOX_GAP

    bands.push({
      ...stage,
      x0: r(x0),
      x1: r(x1),
      keptHeight: r(keptHeight),
      lossHeight: r(trunkHeight - keptHeight),
      keptPath:
        `M ${r(x0)},${r(trunkTop)}` +
        ` L ${r(x1)},${r(trunkTop)}` +
        ` L ${r(x1)},${r(yKept)}` +
        ` C ${r(xm)},${r(yKept)} ${r(xm)},${r(yFull)} ${r(x0)},${r(yFull)}` +
        ' Z',
      lossPath:
        `M ${r(x0)},${r(yFull)}` +
        ` C ${r(xm)},${r(yFull)} ${r(xm)},${r(yKept)} ${r(x1)},${r(yKept)}` +
        ` L ${r(x1)},${r(lossY)}` +
        ` L ${r(lossX)},${r(lossY)}` +
        ` C ${r(lossX - spanWidth * 0.2)},${r(lossY)}` +
        ` ${r(x0 + spanWidth * 0.12)},${r(yFull + 6)}` +
        ` ${r(x0)},${r(yFull)}` +
        ' Z',
      titleX: r(x0),
      titleY: r(trunkTop - 30),
      unitX: r(x0),
      unitY: r(trunkTop - 12),
      keptValueX: r(x1 - 10),
      keptValueY: r(trunkTop + 24),
      keptLabelX: r(x1 - 10),
      keptLabelY: r(trunkTop + 41),
      loss: {
        x: r(lossX),
        y: r(lossY),
        width: r(lossWidth),
        height: LOSS_BOX_HEIGHT,
        valueX: r(lossX + 12),
        valueY: r(lossY + 20),
        labelX: r(lossX + 12),
        labelY: r(lossY + 35),
      },
    })

    if (i > 0) {
      const from = x0 - STAGE_GAP + 8
      const to = x0 - 8
      const y = trunkTop + 16
      arrows.push({
        id: `${stages[i - 1].key}-${stage.key}`,
        path:
          `M ${r(from)},${r(y)} L ${r(to)},${r(y)}` +
          ` M ${r(to - 7)},${r(y - 4.5)} L ${r(to)},${r(y)} L ${r(to - 7)},${r(y + 4.5)}`,
      })
    }
  })

  return {
    width: r(width),
    height: r(height),
    trunkTop: r(trunkTop),
    trunkHeight: r(trunkHeight),
    bands,
    arrows,
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function r(value: number): number {
  return Math.round(value * 100) / 100
}
