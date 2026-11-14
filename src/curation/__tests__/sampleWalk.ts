import type { Edit } from '../edits'

const STAMP = { reviewed_by: 'Site lead', reviewed_on: '2026-11-13' }

/** Three Westfield reviews over the sample, shared by the edits, walk and provider tests. */
export const SAMPLE_WALK: Edit[] = [
  { kind: 'review', site: 'westfield', system: 'beacon', review: { status: 'found', devices: ['wf_gate_sensor'], confidence: 'high', note: 'Gate sensor feeds the beacon', ...STAMP } },
  { kind: 'review', site: 'westfield', system: 'scan', review: { status: 'found', devices: ['wf_server'], confidence: 'medium', note: 'Scan service on the site server', ...STAMP } },
  { kind: 'review', site: 'westfield', system: 'trackwell', review: { status: 'found', devices: ['wf_laptop'], confidence: 'low', note: 'Trackwell client seen on the range laptop', ...STAMP } },
]
