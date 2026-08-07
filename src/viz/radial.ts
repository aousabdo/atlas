import type { TreeNode } from '../types/tree'

/** Minimum angular span in degrees a node reserves for itself. */
export const MIN_DEG = 11

/** Radius from a parent to its children, by the child's depth. */
export const GAP = [0, 300, 280, 260, 240]
const DEFAULT_GAP = 220

export type Expanded = Record<string, boolean | undefined>

export interface Position {
  x: number
  y: number
  level: number
  node: TreeNode
}

/**
 * Subtree weight: how many drawn nodes this subtree contributes.
 *
 * A collapsed branch weighs 1 because it renders as a single node, which is
 * what makes expanding a branch redistribute the ring rather than overlap it.
 */
export function subtreeWeight(node: TreeNode, expanded: Expanded): number {
  if (!expanded[node.id] || !node.children) return 1
  return node.children.reduce((sum, c) => sum + subtreeWeight(c, expanded), 0)
}

/** Minimum angular span this subtree needs, in degrees. */
export function minSpan(node: TreeNode, expanded: Expanded): number {
  if (!expanded[node.id] || !node.children) return MIN_DEG
  return node.children.reduce((sum, c) => sum + minSpan(c, expanded), 0)
}

/**
 * Recursive angular subdivision, ported from cuas_tool_template_v6.html:3208-3224.
 *
 * Each node places its children on a circle of radius GAP[depth] around
 * itself, not on a shared concentric ring, so this is not what d3.tree or
 * d3.cluster produce. The span rule is the tuned part: when the children's
 * combined minimum spans exceed the arc available, every child is scaled down
 * proportionally to its minimum; otherwise each child gets its weight share of
 * the arc but never less than its minimum.
 */
export function doLayout(root: TreeNode, expanded: Expanded): Record<string, Position> {
  const positions: Record<string, Position> = {}

  function lay(node: TreeNode, cx: number, cy: number, a0: number, a1: number, level: number) {
    positions[node.id] = { x: cx, y: cy, level, node }
    if (!node.children || !expanded[node.id]) return

    const gap = GAP[level + 1] ?? DEFAULT_GAP
    const available = a1 - a0

    let totalMin = 0
    let totalWeight = 0
    for (const child of node.children) {
      totalMin += minSpan(child, expanded)
      totalWeight += subtreeWeight(child, expanded)
    }

    let cursor = a0
    for (const child of node.children) {
      const span =
        totalMin > available
          ? (minSpan(child, expanded) / totalMin) * available
          : Math.max((subtreeWeight(child, expanded) / totalWeight) * available,
                     minSpan(child, expanded))
      const mid = cursor + span / 2
      const rad = (mid * Math.PI) / 180
      lay(child, cx + Math.cos(rad) * gap, cy + Math.sin(rad) * gap, cursor, cursor + span, level + 1)
      cursor += span
    }
  }

  lay(root, 0, 0, 0, 360, 0)
  return positions
}

/** X column per level for the grid layout, ported from applyGridSnap. */
const COLUMN_X = [0, 380, 760, 1180]
const COLUMN_STEP = 380
/** Vertical spacing per level: root, branches, groups, leaves. */
const ROW_SPACING = [0, 110, 90, 58]
const DEEP_ROW_SPACING = 58

/**
 * The "Grid" alternative to the radial placement, from
 * cuas_tool_template_v6.html:3234-3300.
 *
 * Levels 0 and 1 spread evenly down a column; every deeper level clusters
 * under its own parent. Pure: returns a new position map and leaves the
 * radial one untouched, so toggling Grid off restores it exactly.
 */
export function snapToGrid(
  positions: Record<string, Position>,
  parentOf: Record<string, string>,
): Record<string, Position> {
  const snapped: Record<string, Position> = {}
  for (const [id, p] of Object.entries(positions)) snapped[id] = { ...p }

  const byLevel = new Map<number, Position[]>()
  for (const p of Object.values(snapped)) {
    const bucket = byLevel.get(p.level)
    if (bucket) bucket.push(p)
    else byLevel.set(p.level, [p])
  }

  const columnX = (level: number) => COLUMN_X[level] ?? COLUMN_STEP * level
  const spacing = (level: number) => ROW_SPACING[level] ?? DEEP_ROW_SPACING

  for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
    const nodes = (byLevel.get(level) ?? []).slice().sort((a, b) => a.y - b.y)
    if (level <= 1) {
      const height = (nodes.length - 1) * spacing(level)
      nodes.forEach((p, i) => {
        p.x = columnX(level)
        p.y = -height / 2 + i * spacing(level)
      })
      continue
    }
    const siblings = new Map<string, Position[]>()
    for (const p of nodes) {
      const parent = parentOf[p.node.id] ?? 'root'
      const bucket = siblings.get(parent)
      if (bucket) bucket.push(p)
      else siblings.set(parent, [p])
    }
    for (const [parent, kids] of siblings) {
      // Parents are laid out first because levels ascend, so parentY is final.
      const parentY = snapped[parent]?.y ?? 0
      const height = (kids.length - 1) * spacing(level)
      kids.forEach((p, i) => {
        p.x = columnX(level)
        p.y = parentY - height / 2 + i * spacing(level)
      })
    }
  }

  return snapped
}

export interface Bounds {
  minX: number
  minY: number
  width: number
  height: number
}

/**
 * Bounding box of the drawn nodes, padded.
 *
 * The map sizes itself from its own geometry rather than from a measured
 * container, so it never has to divide by a width the browser has not laid
 * out yet. An empty map still returns a usable box.
 */
export function boundsOf(positions: Record<string, Position>, pad = 140): Bounds {
  const all = Object.values(positions)
  if (all.length === 0) return { minX: -pad, minY: -pad, width: 2 * pad, height: 2 * pad }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of all) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }

  return {
    minX: minX - pad,
    minY: minY - pad,
    width: Math.max(maxX - minX + 2 * pad, 1),
    height: Math.max(maxY - minY + 2 * pad, 1),
  }
}
