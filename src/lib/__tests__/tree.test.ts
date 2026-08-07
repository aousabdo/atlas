import { describe, expect, it } from 'vitest'

import {
  ROOT_LABEL, ancestorsOf, branchIds, buildTree, countLeaves, defaultExpanded, findNode,
  parentMap,
} from '../tree'
import { StaticProvider } from '../../data/StaticProvider'
import type { System } from '../../types/atlas'
import type { TreeNode } from '../../types/tree'

/** The real committed bundle, served through the stubbed fetch in setup.ts. */
const systems: System[] = await new StaticProvider('/data').getSystems()
const root: TreeNode = buildTree(systems)

describe('buildTree against the real bundle', () => {
  it('labels the root as the tool being replaced does', () => {
    expect(root.id).toBe('root')
    expect(root.label).toBe(ROOT_LABEL)
  })

  it('gives the root six branches in the Python order', () => {
    expect(root.children?.map((c) => c.id)).toEqual([
      'inv', 'integ', 'sensor', 'platform', 'mitig', 'gaps',
    ])
  })

  it('splits the inventory into the six owner groups', () => {
    const inv = findNode(root, 'inv')
    expect(inv?.children?.map((c) => c.id)).toEqual([
      'dhs-st', 'cbp', 'otherdhs', 'dhshq', 'ext', 'dod',
    ])
  })

  it('draws all 32 systems as leaves', () => {
    expect(countLeaves(root)).toBe(32)
  })

  it('marks the nine unconfirmed systems soft and only those', () => {
    const soft: string[] = []
    const collect = (n: TreeNode) => {
      if (n.leaf && n.soft) soft.push(n.id)
      n.children?.forEach(collect)
    }
    collect(root)
    expect(soft.sort()).toEqual(
      ['beacon', 'cirrus', 'dwell', 'ember', 'fathom', 'gantry', 'halyard', 'ingot', 'jetty'],
    )
  })

  it('marks the DoD and External groups soft, per SOFT_GROUPS', () => {
    const inv = findNode(root, 'inv')
    const softGroups = inv?.children?.filter((c) => c.soft).map((c) => c.id)
    expect(softGroups).toEqual(['ext', 'dod'])
  })

  it('carries the two-line group labels the map draws', () => {
    expect(findNode(root, 'otherdhs')?.label).toBe('Other DHS\nComponents')
    expect(findNode(root, 'dhshq')?.label).toBe('DHS HQ /\nOCIO')
  })

  it('colours inventory leaves by owner group and baselines by category', () => {
    expect(findNode(root, 'ucop')?.colorKey).toBe('dhsST')
    expect(findNode(root, 'bastion')?.colorKey).toBe('mitig')
  })

  it('carries risk and detail onto every leaf', () => {
    const beacon = findNode(root, 'beacon')
    expect(beacon?.risk).toBe('high')
    expect(beacon?.detail).toMatch(/Owner:/)
  })
})

describe('tree navigation', () => {
  it('expands the root and its branches by default, and nothing deeper', () => {
    expect(defaultExpanded(root)).toEqual({
      root: true, inv: true, integ: true, sensor: true, platform: true, mitig: true, gaps: true,
    })
  })

  it('lists every branch id for Expand All', () => {
    // 1 root + 6 branches + 6 owner groups.
    expect(branchIds(root)).toHaveLength(13)
  })

  it('walks the whole ancestor chain of a deep leaf', () => {
    expect(ancestorsOf(root, 'beacon')).toEqual(['root', 'inv', 'dhshq'])
  })

  it('gives a branch leaf the shorter chain it actually has', () => {
    expect(ancestorsOf(root, 'bastion')).toEqual(['root', 'mitig'])
  })

  it('returns null for an id that is not in the tree', () => {
    expect(ancestorsOf(root, 'no-such-system')).toBeNull()
  })

  it('maps every non-root node to its parent', () => {
    const parents = parentMap(root)
    expect(parents.beacon).toBe('dhshq')
    expect(parents.dhshq).toBe('inv')
    expect(parents.root).toBeUndefined()
  })
})

describe('buildTree edge cases', () => {
  it('omits a branch no system belongs to', () => {
    const one = systems.filter((s) => s.id === 'ucop')
    expect(buildTree(one).children?.map((c) => c.id)).toEqual(['inv'])
  })

  it('returns a childless root for no systems at all', () => {
    expect(buildTree([]).children).toEqual([])
    expect(countLeaves(buildTree([]))).toBe(0)
  })
})
