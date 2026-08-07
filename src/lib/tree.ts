/**
 * The orientation tree, built from systems.json.
 *
 * A transliteration of `build_tree` in build_cuas_tool_v4.py: an `inv` branch
 * holding one node per owner group, then the five baseline and gap branches in
 * a fixed order. The category, owner-rule and soft-group tables come from
 * src/data/generated, so the branch labels and group colours stay one source
 * of truth with the ingest rather than being retyped here.
 */
import {
  CATEGORY_MAP, OWNER_RULES, SOFT_GROUPS,
} from '../data/generated/classifierTables'
import type { System } from '../types/atlas'
import type { TreeNode } from '../types/tree'

export const ROOT_ID = 'root'
export const ROOT_LABEL = 'DHS C-UAS\nArchitecture'

/** Root children after `inv`, in the order the Python emits them. */
const BRANCH_ORDER = ['integ', 'sensor', 'platform', 'mitig', 'gaps']

const FALLBACK_CATEGORY = 'Deployed asset record'

/**
 * gid -> the group node's label and colour, first matching rule wins.
 *
 * OWNER_RULES carries the two-line labels the map draws ("Other DHS\nComponents");
 * the `owner_group` field on a System carries the one-line display name used in
 * tables. Both are correct for their own surface.
 */
const OWNER_GROUP_NODE: Record<string, { label: string; colorKey: string }> = {}
for (const [, gid, label, colorKey] of OWNER_RULES) {
  if (!(gid in OWNER_GROUP_NODE)) OWNER_GROUP_NODE[gid] = { label, colorKey }
}

interface Group {
  label: string
  colorKey: string
  systems: System[]
}

interface Branch {
  label: string
  colorKey: string
  groups: Map<string, Group>
}

function leafNode(system: System): TreeNode {
  return {
    id: system.id,
    label: system.label,
    colorKey: system.color_key,
    leaf: true,
    soft: !system.confirmed,
    risk: system.risk,
    detail: system.detail,
  }
}

export function buildTree(systems: System[]): TreeNode {
  const branches = new Map<string, Branch>()

  for (const system of systems) {
    const category = CATEGORY_MAP[system.category] ?? CATEGORY_MAP[FALLBACK_CATEGORY]
    let branch = branches.get(category.branch)
    if (!branch) {
      branch = { label: category.label, colorKey: category.ck, groups: new Map() }
      branches.set(category.branch, branch)
    }

    if (category.branch === 'inv') {
      const gid = system.owner_group_id
      let group = branch.groups.get(gid)
      if (!group) {
        const node = OWNER_GROUP_NODE[gid]
        group = {
          label: node?.label ?? system.owner_group,
          colorKey: node?.colorKey ?? system.color_key,
          systems: [],
        }
        branch.groups.set(gid, group)
      }
      group.systems.push(system)
    } else {
      // Everything outside the inventory hangs straight off its branch, which
      // is what the Python's single "_d" pseudo-group models.
      let group = branch.groups.get('_d')
      if (!group) {
        group = { label: branch.label, colorKey: category.ck, systems: [] }
        branch.groups.set('_d', group)
      }
      group.systems.push(system)
    }
  }

  const children: TreeNode[] = []

  const inventory = branches.get('inv')
  if (inventory) {
    children.push({
      id: 'inv',
      label: inventory.label,
      colorKey: inventory.colorKey,
      children: [...inventory.groups].map(([gid, group]) => ({
        id: gid,
        label: group.label,
        colorKey: group.colorKey,
        ...(SOFT_GROUPS.includes(gid) ? { soft: true } : {}),
        children: group.systems.map(leafNode),
      })),
    })
  }

  for (const key of BRANCH_ORDER) {
    const branch = branches.get(key)
    const group = branch?.groups.get('_d')
    if (!branch || !group || group.systems.length === 0) continue
    children.push({
      id: key,
      label: branch.label,
      colorKey: branch.colorKey,
      children: group.systems.map(leafNode),
    })
  }

  return { id: ROOT_ID, label: ROOT_LABEL, colorKey: 'root', children }
}

export function countLeaves(node: TreeNode): number {
  if (node.leaf) return 1
  return (node.children ?? []).reduce((sum, c) => sum + countLeaves(c), 0)
}

export function walk(node: TreeNode, visit: (node: TreeNode) => void): void {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

export function findNode(root: TreeNode, id: string): TreeNode | undefined {
  let found: TreeNode | undefined
  walk(root, (n) => {
    if (n.id === id) found = n
  })
  return found
}

/** Every id that has children, which is every id "Expand All" opens. */
export function branchIds(root: TreeNode): string[] {
  const ids: string[] = []
  walk(root, (n) => {
    if (n.children && n.children.length > 0) ids.push(n.id)
  })
  return ids
}

export function parentMap(root: TreeNode): Record<string, string> {
  const parents: Record<string, string> = {}
  walk(root, (n) => {
    for (const child of n.children ?? []) parents[child.id] = n.id
  })
  return parents
}

/**
 * The chain from the root down to `id`'s parent, or null when `id` is absent.
 *
 * A focused node whose ancestors are collapsed is never laid out, so ?focus=
 * has to expand every one of these before the node exists to select.
 */
export function ancestorsOf(root: TreeNode, id: string): string[] | null {
  if (root.id === id) return []
  const parents = parentMap(root)
  if (!(id in parents)) return null
  const chain: string[] = []
  let current: string | undefined = parents[id]
  while (current) {
    chain.unshift(current)
    current = parents[current]
  }
  return chain
}

/**
 * Root and its immediate children open, everything below collapsed.
 *
 * Matches the tool being replaced (cuas_tool_template_v6.html:3173), which
 * opens the six branches but leaves the owner groups shut.
 */
export function defaultExpanded(root: TreeNode): Record<string, boolean> {
  const expanded: Record<string, boolean> = { [root.id]: true }
  for (const child of root.children ?? []) expanded[child.id] = true
  return expanded
}
