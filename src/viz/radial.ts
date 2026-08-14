import type { TreeNode } from '../types/tree'
import { geometryFor } from './nodeBox'

/**
 * Comfort spacing, in degrees, spent out of a ring's slack and never out of
 * its radius.
 *
 * This used to be the whole layout rule: eleven degrees a node, whatever that
 * node was drawing. The angular subdivision knew nothing about how wide a box
 * was, so two long labels at the same radius collided by construction, and
 * widening the boxes to stop them clipping their text made it worse. Now the
 * box decides the minimum and this only opens up a ring that has room to
 * spare. It has to work that way round: a floor that always applied would cap
 * a circle at thirty two nodes and push the ring out for nothing.
 */
export const MIN_DEG = 11

/** Radius added at each depth, when nothing on that ring is crowded. */
export const GAP = [0, 300, 280, 260, 240]
const DEFAULT_GAP = 220

/** Daylight left between two boxes, in world units. */
export const CLEARANCE = 16

/** How far a crowded ring may be pushed before the search gives up. */
const MAX_PUSH = 4096
/** Bisection steps for the ring radius. Fifty is exact to well under a pixel. */
const BISECTION_STEPS = 50
/**
 * Retries after the exact check finds boxes still touching, and the factor each
 * retry pushes the ring out by.
 *
 * The angular rules below are exact for two boxes on the same ring, and the
 * ring gap is exact for a parent and its own child. What they cannot see is a
 * node sitting beside a cousin from another wedge, one ring further in or out.
 * That case is rare and it is cheap to detect exactly, so the layout looks
 * before it commits and pushes the ring out again if it was wrong. Bounded, so
 * a bundle that cannot be satisfied still terminates with the best it managed
 * rather than hanging the tab.
 */
const REPAIR_TRIES = 24
const REPAIR_PUSH = 1.08

const DEG = 180 / Math.PI

export type Expanded = Record<string, boolean | undefined>

export interface Position {
  x: number
  y: number
  level: number
  node: TreeNode
}

export interface NodeBox {
  width: number
  height: number
}

/**
 * How big a node draws. The map passes its own label and box scales through
 * here, so the layout reserves room for the boxes the reader is actually
 * looking at rather than for some reference size.
 */
export type Measure = (node: TreeNode, level: number) => NodeBox

const defaultMeasure: Measure = (node, level) => geometryFor(node, level)

export interface LayoutOptions {
  measure?: Measure
  clearance?: number
}

/**
 * The size of a node in its worst direction: the diagonal of its box.
 *
 * A box is axis aligned wherever it lands on the ring, so how much of the ring
 * it eats depends on where it sits: a wide, short box costs its width at the
 * top of the circle and only its height at the side. Reserving the diagonal
 * everywhere ignores that and is therefore never wrong, and it keeps the
 * layout a single pass, because the reservation does not depend on the angle
 * the reservation decides. Measured, the angle-aware version buys back about
 * three per cent of the fitted zoom on the sample bundle at the default label
 * size, and costs a fixed point iteration and a second way to be wrong.
 */
export function extentOf(node: TreeNode, level: number, measure: Measure): number {
  const box = measure(node, level)
  const size = Math.hypot(box.width, box.height)
  // A measure that hands back a NaN would otherwise poison the ring radius and
  // put every coordinate on the map beyond it out of the SVG entirely.
  return Number.isFinite(size) ? size : 0
}

/**
 * The angle a chord of `size` subtends at `radius`, in degrees.
 *
 * This is the sentence the old layout was missing. A node's share of its ring
 * has to be at least this, or its box is wider than its slot and it overlaps
 * whatever is next to it. Returns the whole circle when the box is too big to
 * fit on the ring at any angle, which is the caller's signal to push the ring
 * out rather than to draw the impossible.
 */
export function spanFor(size: number, radius: number): number {
  if (!(radius > 0) || !Number.isFinite(radius)) return 360
  const ratio = size / (2 * radius)
  // A box with no size asks for no angle. Written as a guard rather than left
  // to asin, which answers a negative size with a negative angle, and a
  // negative span walks the placement cursor backwards over its own siblings.
  if (!(ratio > 0)) return 0
  if (!(ratio < 1)) return 360
  return 2 * Math.asin(ratio) * DEG
}

/**
 * The arc the deepest drawn row under a node needs, in world units.
 *
 * Radius free on purpose: it is a length, not an angle, so it can be compared
 * between subtrees before anybody knows what ring they will land on. It is the
 * share metric for the leftover angle, and getting it right is most of why the
 * map stayed compact: a branch holding twenty wide leaves earns twenty wide
 * leaves worth of the circle, and a branch holding one earns one. Splitting
 * the circle evenly instead is what forced the crowded wedges out to radii
 * three times larger than they needed.
 */
export function spreadOf(
  node: TreeNode,
  expanded: Expanded,
  level: number,
  measure: Measure,
  clearance: number,
): number {
  const own = extentOf(node, level, measure) + clearance
  if (!expanded[node.id] || !node.children?.length) return own
  let sum = 0
  for (const child of node.children) {
    sum += spreadOf(child, expanded, level + 1, measure, clearance)
  }
  return Math.max(own, sum)
}

/**
 * Split a wedge between children: never below what a child's own box needs,
 * and everything above that in proportion to what its subtree needs.
 *
 * Water filled. A child whose own box needs more than its proportional share
 * is pinned at its need and drops out, and the rest divide what is left again,
 * because handing a narrow subtree its need and then also its full share is
 * how the wide subtrees end up starved.
 */
export function allocateSpans(
  available: number,
  needs: number[],
  shares: number[],
): number[] {
  const count = needs.length
  if (count === 0) return []
  const demanded = needs.reduce((a, b) => a + b, 0)
  // Nothing to allocate: hand back the window in the proportions asked for.
  if (demanded >= available) {
    return demanded > 0
      ? needs.map((need) => (need / demanded) * available)
      : needs.map(() => available / count)
  }

  const pinned = new Array<boolean>(count).fill(false)
  const spans = new Array<number>(count).fill(0)
  for (let pass = 0; pass <= count; pass++) {
    let free = available
    let pool = 0
    let open = 0
    for (let i = 0; i < count; i++) {
      if (pinned[i]) free -= needs[i]
      else {
        pool += shares[i]
        open += 1
      }
    }
    let changed = false
    for (let i = 0; i < count; i++) {
      if (pinned[i]) {
        spans[i] = needs[i]
        continue
      }
      // No subtree has anything to say: split what is free evenly.
      const share = pool > 0 ? (free * shares[i]) / pool : free / open
      if (share < needs[i]) {
        pinned[i] = true
        changed = true
      }
      spans[i] = Math.max(share, needs[i])
    }
    if (!changed) break
  }
  return spans
}

interface Wedge {
  node: TreeNode
  /** Angular window this node's children may use, in degrees. */
  from: number
  to: number
}

interface Placed {
  id: string
  x: number
  y: number
  width: number
  height: number
}

const hits = (a: Placed, b: Placed) =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
  Math.abs(a.y - b.y) < (a.height + b.height) / 2

/**
 * Every pair of drawn nodes whose boxes share any area.
 *
 * Exported because it is the definition the whole exercise turns on, and both
 * the layout and its tests must use the same one. The layout checks each ring
 * against what is already placed and pushes out again if this finds anything;
 * the tests assert the finished map has none.
 */
export function overlappingPairs(
  positions: Record<string, Position>,
  measure: Measure = defaultMeasure,
): Array<[string, string]> {
  const boxes: Placed[] = Object.values(positions).map((p) => {
    const box = measure(p.node, p.level)
    return { id: p.node.id, x: p.x, y: p.y, width: box.width, height: box.height }
  })
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (hits(boxes[i], boxes[j])) pairs.push([boxes[i].id, boxes[j].id])
    }
  }
  return pairs
}

/**
 * Concentric rings: one circle per depth, subdivided by extent.
 *
 * Two rules, and the second one is the fix.
 *
 * The ring. Every node of a depth sits on one circle about the root, rather
 * than on its own little circle about its parent. The parent-anchored version
 * is what the tool being replaced did, and it wastes the room the map has:
 * a group four hundred pixels out still fanned its leaves across the width its
 * own wedge had back at the centre, so the same six leaves needed a radius
 * three times larger. Measured on the committed bundle with every branch open,
 * the parent-anchored version drew a 4621px map and this one draws 2082px,
 * which is the difference between a fitted zoom of 0.18 and one of 0.42.
 *
 * The subdivision. A child's share of its parent's wedge is at least the angle
 * its own box subtends at the ring it will sit on, so a long label reserves the
 * room a long label needs. Where the children of one wedge cannot all fit, the
 * ring is pushed out until they do, which works because the angle a box needs
 * falls away as the radius grows. Staggering the ring into lanes instead was
 * measured and dropped: it buys back part of the radius on a crowded bundle,
 * but it trades a legible circle for a sawtooth and it makes the clearance
 * between two lanes depend on which way the wedge points, and the ring push
 * costs two per cent of the fitted zoom at the view the map opens at.
 *
 * Pure: no DOM, no measurement of anything the browser has laid out. The box
 * sizes come from `measure`, which is the same function the renderer sizes its
 * rects with.
 */
export function doLayout(
  root: TreeNode,
  expanded: Expanded,
  options: LayoutOptions = {},
): Record<string, Position> {
  const clearance = options.clearance ?? CLEARANCE
  // Memoised because the radius search asks for the same fifty boxes fifty
  // times over, and every ask walks a label character by character. A node is
  // drawn at one depth, so its id is the whole key.
  const raw = options.measure ?? defaultMeasure
  const boxes = new Map<string, NodeBox>()
  const measure: Measure = (node, level) => {
    const known = boxes.get(node.id)
    if (known) return known
    const box = raw(node, level)
    boxes.set(node.id, box)
    return box
  }
  const spreads = new Map<string, number>()
  const spreadCached = (node: TreeNode, level: number) => {
    const known = spreads.get(node.id)
    if (known !== undefined) return known
    const value = spreadOf(node, expanded, level, measure, clearance)
    spreads.set(node.id, value)
    return value
  }

  const positions: Record<string, Position> = {}
  positions[root.id] = { x: 0, y: 0, level: 0, node: root }

  const rootBox = measure(root, 0)
  const placed: Placed[] = [
    { id: root.id, x: 0, y: 0, width: rootBox.width, height: rootBox.height },
  ]

  let wedges: Wedge[] = [{ node: root, from: 0, to: 360 }]
  let ringRadius = 0
  let level = 0

  while (wedges.length > 0) {
    const parents = wedges.filter((w) => expanded[w.node.id] && w.node.children?.length)
    if (parents.length === 0) break
    const childLevel = level + 1

    // The ring can never be closer than the two rows of boxes need, whatever
    // the ported gap says. Without this a root with a long label sits on top
    // of its own branches at any label scale above about two.
    const parentDepth = Math.max(
      ...parents.map((w) => extentOf(w.node, level, measure)),
    )
    const childDepth = Math.max(
      ...parents.flatMap((w) =>
        (w.node.children ?? []).map((c) => extentOf(c, childLevel, measure)),
      ),
    )
    const gap = Math.max(
      GAP[childLevel] ?? DEFAULT_GAP,
      (parentDepth + childDepth) / 2 + clearance,
    )
    const base = ringRadius + gap

    /** Do all the children of every wedge fit their own window at `radius`? */
    const fits = (radius: number) =>
      parents.every((w) => {
        let needed = 0
        for (const child of w.node.children ?? []) {
          needed += spanFor(extentOf(child, childLevel, measure) + clearance, radius)
        }
        return needed <= w.to - w.from + 1e-9
      })

    let radius = base
    if (!fits(radius)) {
      let high = base * 2
      while (!fits(high) && high < base * MAX_PUSH) high *= 2
      let low = base
      for (let i = 0; i < BISECTION_STEPS; i++) {
        const mid = (low + high) / 2
        if (fits(mid)) high = mid
        else low = mid
      }
      radius = high
    }

    let ring = placeRing(parents, childLevel, radius, measure, clearance, spreadCached)
    // Look before committing. The angular rules cover a ring against itself;
    // this covers it against everything already on the page.
    for (
      let tries = 0;
      tries < REPAIR_TRIES && collides(ring, placed, childLevel, measure);
      tries++
    ) {
      radius *= REPAIR_PUSH
      ring = placeRing(parents, childLevel, radius, measure, clearance, spreadCached)
    }

    for (const box of ringBoxes(ring, childLevel, measure)) placed.push(box)
    for (const entry of ring) {
      positions[entry.wedge.node.id] = {
        x: entry.x,
        y: entry.y,
        level: childLevel,
        node: entry.wedge.node,
      }
    }

    wedges = ring.map((entry) => entry.wedge)
    ringRadius = radius
    level = childLevel
  }

  return positions
}

interface RingEntry {
  wedge: Wedge
  x: number
  y: number
}

/** One depth's worth of placement, at a radius the caller has chosen. */
function placeRing(
  parents: Wedge[],
  childLevel: number,
  radius: number,
  measure: Measure,
  clearance: number,
  spread: (node: TreeNode, level: number) => number,
): RingEntry[] {
  const ring: RingEntry[] = []

  for (const parent of parents) {
    const children = parent.node.children ?? []
    const available = parent.to - parent.from
    const needs = children.map((child) =>
      spanFor(extentOf(child, childLevel, measure) + clearance, radius),
    )
    // The comfort floor is applied only when the ring can afford it, so it
    // never becomes a reason to push the radius out.
    const floor = Math.min(MIN_DEG, available / Math.max(children.length, 1))
    const comfortable = needs.map((need) => Math.max(need, floor))
    const asked = comfortable.reduce((a, b) => a + b, 0) <= available ? comfortable : needs
    const shares = children.map((child) => spread(child, childLevel))
    const spans = allocateSpans(available, asked, shares)

    let cursor = parent.from
    children.forEach((child, i) => {
      const span = spans[i]
      const mid = (cursor + span / 2) / DEG
      ring.push({
        wedge: { node: child, from: cursor, to: cursor + span },
        x: Math.cos(mid) * radius,
        y: Math.sin(mid) * radius,
      })
      cursor += span
    })
  }

  return ring
}

/** Does anything on this ring touch anything already on the page? */
function collides(
  ring: RingEntry[],
  placed: Placed[],
  childLevel: number,
  measure: Measure,
): boolean {
  const boxes = ringBoxes(ring, childLevel, measure)
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (hits(boxes[i], boxes[j])) return true
    }
    for (const other of placed) {
      if (hits(boxes[i], other)) return true
    }
  }
  return false
}

function ringBoxes(ring: RingEntry[], childLevel: number, measure: Measure): Placed[] {
  return ring.map((entry) => {
    const box = measure(entry.wedge.node, childLevel)
    return {
      id: entry.wedge.node.id,
      x: entry.x,
      y: entry.y,
      width: box.width,
      height: box.height,
    }
  })
}

/** X column per level for the grid layout, ported from applyGridSnap. */
const COLUMN_X = [0, 380, 760, 1180]
const COLUMN_STEP = 380
/** Vertical spacing per level: root, branches, groups, leaves. */
const ROW_SPACING = [0, 110, 90, 58]
const DEEP_ROW_SPACING = 58

export interface GridOptions {
  measure?: Measure
  clearance?: number
}

/**
 * The "Grid" alternative to the radial placement, from
 * cuas_tool_template_v6.html:3234-3300.
 *
 * Levels 0 and 1 spread evenly down a column; every deeper level clusters
 * under its own parent. Pure: returns a new position map and leaves the
 * radial one untouched, so toggling Grid off restores it exactly.
 *
 * The ported column pitch and row spacing are floors now rather than the
 * answer, for the same reason MIN_DEG is. 380px between columns and 58px
 * between rows were the right numbers when a box was 85 wide and 32 tall and
 * clipped whatever did not fit. Against a box sized to its own label they are
 * not: at the default label size the grid drew 23 pairs of systems on top of
 * one another, and turning the labels up made it 36. So the pitch is whatever
 * the widest box in the two columns needs, the row spacing is whatever the
 * tallest box in the row needs, and a column that still collides is combed out
 * from the top down.
 */
export function snapToGrid(
  positions: Record<string, Position>,
  parentOf: Record<string, string>,
  options: GridOptions = {},
): Record<string, Position> {
  const measure = options.measure ?? defaultMeasure
  const clearance = options.clearance ?? CLEARANCE

  const snapped: Record<string, Position> = {}
  for (const [id, p] of Object.entries(positions)) snapped[id] = { ...p }

  const byLevel = new Map<number, Position[]>()
  for (const p of Object.values(snapped)) {
    const bucket = byLevel.get(p.level)
    if (bucket) bucket.push(p)
    else byLevel.set(p.level, [p])
  }

  const levels = [...byLevel.keys()].sort((a, b) => a - b)

  /** The widest and tallest box drawn at each level. */
  const widest = new Map<number, number>()
  const tallest = new Map<number, number>()
  for (const level of levels) {
    let width = 0
    let height = 0
    for (const p of byLevel.get(level) ?? []) {
      const box = measure(p.node, p.level)
      if (box.width > width) width = box.width
      if (box.height > height) height = box.height
    }
    widest.set(level, width)
    tallest.set(level, height)
  }

  // Columns march right by whatever the two neighbouring columns need, never
  // by less than the ported pitch.
  const columnX = new Map<number, number>()
  let x = 0
  for (const level of levels) {
    if (level === levels[0]) {
      x = COLUMN_X[level] ?? COLUMN_STEP * level
    } else {
      const previous = levels[levels.indexOf(level) - 1]
      const ported = (COLUMN_X[level] ?? COLUMN_STEP * level) -
        (COLUMN_X[previous] ?? COLUMN_STEP * previous)
      const needed = ((widest.get(previous) ?? 0) + (widest.get(level) ?? 0)) / 2 + clearance
      x += Math.max(ported, needed)
    }
    columnX.set(level, x)
  }

  const spacing = (level: number) =>
    Math.max(ROW_SPACING[level] ?? DEEP_ROW_SPACING, (tallest.get(level) ?? 0) + clearance)

  for (const level of levels) {
    const nodes = (byLevel.get(level) ?? []).slice().sort((a, b) => a.y - b.y)
    const step = spacing(level)
    const column = columnX.get(level) ?? 0

    if (level <= 1) {
      const height = (nodes.length - 1) * step
      nodes.forEach((p, i) => {
        p.x = column
        p.y = -height / 2 + i * step
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
      const height = (kids.length - 1) * step
      kids.forEach((p, i) => {
        p.x = column
        p.y = parentY - height / 2 + i * step
      })
    }
    combColumn(nodes, step)
  }

  return snapped
}

/**
 * Push a column apart until no two boxes in it are closer than `step`.
 *
 * Two branches with many children each want their rows centred on their own
 * parent, and nothing in that rule stops one cluster from being written over
 * the next. Sweeping from the top and moving anything that is too close down
 * is the smallest repair that cannot fail, and recentring afterwards keeps the
 * column where the clusters wanted it rather than dragging the whole map down.
 */
function combColumn(nodes: Position[], step: number): void {
  if (nodes.length < 2) return
  const order = nodes.slice().sort((a, b) => a.y - b.y)
  const before = order.reduce((sum, p) => sum + p.y, 0) / order.length
  let last = -Infinity
  for (const p of order) {
    p.y = Math.max(p.y, last + step)
    last = p.y
  }
  const after = order.reduce((sum, p) => sum + p.y, 0) / order.length
  const shift = before - after
  for (const p of order) p.y += shift
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
