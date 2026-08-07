import type { RiskLevel } from './atlas'

/**
 * A node in the orientation tree.
 *
 * Built from systems.json by src/lib/tree.ts and laid out by
 * src/viz/radial.ts. `label` may contain newlines, which the renderer splits
 * into tspans.
 */
export interface TreeNode {
  id: string
  label: string
  colorKey: string
  leaf?: boolean
  soft?: boolean
  risk?: RiskLevel
  detail?: string
  children?: TreeNode[]
}
