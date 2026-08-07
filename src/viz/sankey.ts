/**
 * Requirements crosswalk geometry.
 *
 * Pure: data in, numbers out. No DOM, no d3.select, no append. The React
 * component owns every node it draws, which is what lets the same geometry be
 * unit tested without a browser and re-laid-out on resize without a teardown.
 */
import { sankey as sankeyLayout } from 'd3-sankey'
import type { SankeyLink, SankeyNode } from 'd3-sankey'

import type { Requirement, RequirementStatus } from '../types/atlas'

export type SankeySide = 'requirement' | 'system' | 'loss'

/** The single sink every requirement that was not carried forward flows into. */
export const LOSS_NODE_NAME = 'Not carried forward'

export interface SankeyNodeGeometry {
  index: number
  name: string
  side: SankeySide
  /** Number of flows through the node. */
  value: number
  x0: number
  x1: number
  y0: number
  y1: number
  /** Requirement nodes only. */
  status?: RequirementStatus
  /** Requirement nodes only: the baseline system the requirement sat under. */
  sys?: string
}

export interface SankeyLinkGeometry {
  index: number
  /** Index into `nodes`, never a node reference: the caller gets a flat, JSON-safe graph. */
  source: number
  target: number
  value: number
  status: RequirementStatus
  y0: number
  y1: number
  width: number
  /** Cubic path between the two node edges, ready for an SVG `d` attribute. */
  path: string
}

export interface SankeyGeometry {
  nodes: SankeyNodeGeometry[]
  links: SankeyLinkGeometry[]
}

export interface SankeyOptions {
  width: number
  height: number
  nodeWidth?: number
  nodePadding?: number
  /** Inset from the edges, so stroke caps are not clipped. */
  padding?: number
  /** Left inset, where the caller draws requirement labels. */
  paddingLeft?: number
  /** Right inset, where the caller draws system labels. */
  paddingRight?: number
}

type NodeSeed = {
  name: string
  side: SankeySide
  status?: RequirementStatus
  sys?: string
}

type LinkSeed = {
  status: RequirementStatus
}

type LaidOutNode = SankeyNode<NodeSeed, LinkSeed>
type LaidOutLink = SankeyLink<NodeSeed, LinkSeed>

const round = (v: number) => Math.round(v * 100) / 100

function endIndex(end: LaidOutLink['source']): number {
  return typeof end === 'object' ? (end.index ?? 0) : Number(end)
}

/**
 * Lay out the crosswalk as a two column flow: one node per original
 * requirement on the left, one per distinct current system on the right, and
 * one explicit loss node for everything that was dropped. A requirement that
 * simply vanished from the diagram would be the exact lie this tool exists to
 * catch, so the drop is a destination rather than an absence.
 */
export function buildRequirementsSankey(
  requirements: readonly Requirement[],
  options: SankeyOptions,
): SankeyGeometry {
  const {
    width,
    height,
    nodeWidth = 14,
    nodePadding = 10,
    padding = 4,
    paddingLeft = padding,
    paddingRight = padding,
  } = options

  // React mounts before layout, so the first render measures a zero-size
  // container. d3-sankey would divide by that and hand back NaN geometry.
  const innerWidth = width - paddingLeft - paddingRight
  const innerHeight = height - padding * 2
  if (!(innerWidth > nodeWidth) || !(innerHeight > 0) || requirements.length === 0) {
    return { nodes: [], links: [] }
  }

  const nodes: LaidOutNode[] = []
  const links: LaidOutLink[] = []
  const systemIndex = new Map<string, number>()
  let lossIndex = -1

  const systemNode = (name: string): number => {
    const existing = systemIndex.get(name)
    if (existing !== undefined) return existing
    const index = nodes.push({ name, side: 'system' }) - 1
    systemIndex.set(name, index)
    return index
  }

  const lossNode = (): number => {
    if (lossIndex < 0) lossIndex = nodes.push({ name: LOSS_NODE_NAME, side: 'loss' }) - 1
    return lossIndex
  }

  requirements.forEach((req) => {
    nodes.push({
      name: req.orig,
      side: 'requirement',
      status: req.status,
      sys: req.sys,
    })
  })

  requirements.forEach((req, source) => {
    const carried = req.status !== "Didn't keep" ? [...new Set(req.current)] : []
    if (carried.length === 0) {
      links.push({ source, target: lossNode(), value: 1, status: req.status })
      return
    }
    for (const name of carried) {
      links.push({ source, target: systemNode(name), value: 1, status: req.status })
    }
  })

  const graph = sankeyLayout<NodeSeed, LinkSeed>()
    .nodeWidth(nodeWidth)
    .nodePadding(nodePadding)
    .extent([
      [paddingLeft, padding],
      [width - paddingRight, height - padding],
    ])({ nodes, links })

  return {
    nodes: graph.nodes.map((n) => ({
      index: n.index ?? 0,
      name: n.name,
      side: n.side,
      status: n.status,
      sys: n.sys,
      value: n.value ?? 0,
      x0: n.x0 ?? 0,
      x1: n.x1 ?? 0,
      y0: n.y0 ?? 0,
      y1: n.y1 ?? 0,
    })),
    links: graph.links.map((l) => {
      const source = endIndex(l.source)
      const target = endIndex(l.target)
      const x0 = graph.nodes[source].x1 ?? 0
      const x1 = graph.nodes[target].x0 ?? 0
      const y0 = l.y0 ?? 0
      const y1 = l.y1 ?? 0
      const mid = round((x0 + x1) / 2)
      return {
        index: l.index ?? 0,
        source,
        target,
        value: l.value,
        status: l.status,
        y0,
        y1,
        width: l.width ?? 0,
        path:
          `M${round(x0)},${round(y0)}` +
          `C${mid},${round(y0)} ${mid},${round(y1)} ${round(x1)},${round(y1)}`,
      }
    }),
  }
}
