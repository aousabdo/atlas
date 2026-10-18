import type { Requirement } from '../types/atlas'

/**
 * The system names a requirement is carried by today, each once.
 *
 * A requirement the crosswalk did not keep is carried by nothing, whatever its
 * current cell says: the ingest sets status and current independently, and
 * the Requirements Sankey and the planning table have to read the same rows
 * the same way.
 */
export function carriedNames(requirement: Requirement): string[] {
  return requirement.status === "Didn't keep" ? [] : [...new Set(requirement.current)]
}
