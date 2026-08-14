/**
 * In-browser parsing of the analyst's own files.
 *
 * A transliteration of the Python in ingest/src/atlas_ingest/: same tables
 * (imported from the generated module, never re-typed), same precedence, same
 * outputs. The provider contract suite runs against both, so a divergence
 * fails a test rather than producing two different answers.
 *
 * Nothing here uploads anything. The File objects come from an <input> and are
 * read with FileReader; no request leaves the tab.
 */
import * as XLSX from 'xlsx'

import type {
  Link, Requirement, RequirementStatus, RiskLevel, System,
} from '../types/atlas'
import {
  ALWAYS_SOFT, CATEGORY_MAP, HIGH_KEYWORDS, ID_MAP, LABEL_MAP,
  LINK_NAME_FRAGMENTS, LOW_KEYWORDS, MEDIUM_KEYWORDS, NEVER_SOFT,
  OWNER_GROUP_DISPLAY, OWNER_RULES, SOFT_KEYWORDS,
} from './generated/classifierTables'

const MAX_BYTES = 50 * 1024 * 1024
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

const EXTERNAL: readonly [string, string, string] = ['ext', 'External /\nIndustry', 'ext']

export class LocalFileError extends Error {
  constructor(message: string, readonly fileName?: string) {
    super(message)
    this.name = 'LocalFileError'
  }
}

/**
 * Upload hardening, applied before SheetJS sees a byte.
 *
 * xlsx is a zip archive, so the extension proves nothing: sniff the magic
 * bytes, cap the size, and refuse macro-enabled workbooks. HTML is never
 * accepted at all, because the generated network graphs are stored XSS by
 * construction.
 */
export async function assertSafeWorkbook(file: File): Promise<ArrayBuffer> {
  if (/\.xlsm$/i.test(file.name)) {
    throw new LocalFileError(
      `${file.name}: .xlsm is refused because macros are executable content`,
      file.name,
    )
  }
  if (/\.(html?|xhtml|svg)$/i.test(file.name)) {
    throw new LocalFileError(`${file.name}: HTML is never accepted`, file.name)
  }
  if (file.size > MAX_BYTES) {
    throw new LocalFileError(
      `${file.name}: too large (${file.size} bytes, cap ${MAX_BYTES})`,
      file.name,
    )
  }
  const buffer = await file.arrayBuffer()
  const head = new Uint8Array(buffer.slice(0, 4))
  if (!ZIP_MAGIC.every((b, i) => head[i] === b)) {
    throw new LocalFileError(
      `${file.name}: not a valid xlsx (no zip signature)`,
      file.name,
    )
  }
  return buffer
}

/**
 * Drop a parenthetical, leaving a space where it stood.
 *
 * The old expression matched the parenthetical along with the whitespace on
 * BOTH sides and replaced the lot with nothing. A trailing parenthetical came
 * out right, which is the common shape and the only one the sample carries,
 * but an interior one joined the words around it: "Ridge (Legacy Variant)
 * Watch" became "RidgeWatch". Substituting a space and collapsing is right in
 * both positions, and the trailing case still trims to the same answer.
 *
 * Mirrors strip_parenthetical in ingest/src/atlas_ingest/identity.py.
 */
export function stripParenthetical(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

export function makeId(name: string): string {
  const n = name.trim()
  if (n in ID_MAP) return ID_MAP[n]
  const short = stripParenthetical(n)
  if (short in ID_MAP) return ID_MAP[short]
  return short
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
}

/**
 * Character budget for one line of a wrapped label.
 *
 * Aesthetic, not a fit guarantee: a character count cannot know how wide a
 * glyph is, and the node box is what actually guarantees the text fits (see
 * geometryFor in src/tabs/map/TreeNode.tsx). What this buys is a label shaped
 * like a label, a few short lines rather than one long ribbon, for names
 * nobody has curated. 14 is the threshold the previous rule used, and most of
 * the curated table was already written to it.
 *
 * Mirrors LABEL_LINE_CHARS in ingest/src/atlas_ingest/identity.py.
 */
export const LABEL_LINE_CHARS = 14

/**
 * Greedy word wrap to LABEL_LINE_CHARS, transliterated from wrap_label.
 *
 * The guarantee is the point: no line comes out over the budget unless it is a
 * single word that cannot be broken at a space. The rule it replaces split the
 * word list down the middle and made no claim about the halves, so a five-word
 * name became two fifteen-character lines and both overflowed.
 *
 * Long names are allowed as many lines as they need. Capping the line count
 * would mean either dropping words or letting the last line run long, and the
 * first loses information while the second gives back the guarantee.
 */
export function wrapLabel(text: string): string {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (!word) continue
    if (!line) line = word
    else if (line.length + 1 + word.length <= LABEL_LINE_CHARS) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines.join('\n')
}

/**
 * Display label: the curated short name, else the name wrapped to fit.
 *
 * A curated label is returned exactly as written, line breaks included, even
 * when it is longer than the budget. That table is where a human says how a
 * name should read, and re-wrapping it here would overrule the only place that
 * decision can be made. Nothing is lost by honouring it: the node box sizes
 * itself to whatever label it is handed.
 */
export function makeLabel(name: string): string {
  const sid = makeId(name)
  if (sid in LABEL_MAP) return LABEL_MAP[sid]
  let s = name.replace(/\s*\(.*?\)\s*/g, '').trim()
  if (s.length < 3) s = name.trim()
  return wrapLabel(s)
}

export function classifyOwner(
  rawOwner: string,
  systemName = '',
): [string, string, string, boolean] {
  if (!rawOwner) return [...EXTERNAL, true] as [string, string, string, boolean]

  const sid = makeId(systemName)
  const lower = rawOwner.toLowerCase()
  let isSoft = SOFT_KEYWORDS.some((kw) => lower.includes(kw))
  if (ALWAYS_SOFT.includes(sid)) isSoft = true
  if (NEVER_SOFT.includes(sid)) isSoft = false

  for (const [substring, gid, glabel, ckey] of OWNER_RULES) {
    if (substring.length <= 4) {
      // Word boundaries for short substrings, so "office" does not match ICE.
      const escaped = substring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(rawOwner)) {
        return [gid, glabel, ckey, isSoft]
      }
    } else if (lower.includes(substring.toLowerCase())) {
      return [gid, glabel, ckey, isSoft]
    }
  }
  return [...EXTERNAL, isSoft] as [string, string, string, boolean]
}

export function classifyRisk(riskText: string): RiskLevel {
  if (!riskText) return 'medium'
  const lo = riskText.toLowerCase()
  if (HIGH_KEYWORDS.some((kw) => lo.includes(kw))) return 'high'
  if (LOW_KEYWORDS.some((kw) => lo.includes(kw))) return 'low'
  if (MEDIUM_KEYWORDS.some((kw) => lo.includes(kw))) return 'medium'
  return 'medium'
}

export function ownerGroupDisplay(gid: string): string {
  return OWNER_GROUP_DISPLAY[gid] ?? 'Other DHS'
}

type Row = (string | number | boolean | null)[]

/**
 * The Matrix sheet does not start at row 1: a title and a hand-written summary
 * block sit above the header. Scan for it rather than assuming an offset.
 */
export function findHeaderRow(rows: Row[]): number {
  for (let r = 0; r < Math.min(rows.length, 10); r += 1) {
    if (rows[r]?.some((c) => typeof c === 'string' && c.includes('Project/System'))) {
      return r
    }
  }
  throw new LocalFileError(
    "no header row containing 'Project/System' in the first 10 rows",
  )
}

function sheetRows(wb: XLSX.WorkBook, name: string): Row[] {
  return XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], {
    header: 1,
    defval: null,
    blankrows: true,
  })
}

function cellText(row: Row, index: number | undefined): string {
  if (index === undefined || index < 0) return ''
  const v = row[index]
  return v === null || v === undefined ? '' : String(v).trim()
}

export function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: 'array' })
}

/**
 * Spellings the integrations column appears under in real workbooks.
 *
 * Real matrices carry a doubled letter in this header. The parser has to
 * recognise it or the column is silently dropped and every system loses its
 * integration prose, which is not an error anyone would notice: the tab still
 * renders, just emptier. The data guard allows these literals by name for the
 * same reason it allows the dropped-status wording, and for the same reason:
 * breaking a parser to satisfy a scanner trades a working feature for a
 * cosmetic pass.
 *
 * A previous edit collapsed the two spellings into one string twice, which
 * read as a fallback and was not one.
 */
const INTEGRATION_HEADERS = [
  'Existing Interfaces',
  'Currrent Integrations',
  'Current Integrations',
] as const

function firstHeader(
  headers: Map<string, number>,
  names: readonly string[],
): number | undefined {
  for (const name of names) {
    const index = headers.get(name)
    if (index !== undefined) return index
  }
  return undefined
}

export function readMatrixRows(wb: XLSX.WorkBook, fileName = 'workbook'): System[] {
  if (!wb.SheetNames.includes('Matrix')) {
    throw new LocalFileError(
      `${fileName}: no 'Matrix' sheet; found ${wb.SheetNames.join(', ')}`,
      fileName,
    )
  }
  const rows = sheetRows(wb, 'Matrix')
  const hrow = findHeaderRow(rows)

  // Header cells carry trailing spaces in the source workbook, and
  // "Existing Interfaces" is misspelled there. Both are handled, not fixed.
  const headers = new Map<string, number>()
  rows[hrow].forEach((c, i) => {
    if (typeof c === 'string' && c.trim()) headers.set(c.trim(), i)
  })

  const col = {
    cat: headers.get('Capability Gap/Requirement'),
    name: headers.get('Project/System'),
    infra: headers.get('Infrastructure/Technology'),
    owner: headers.get('Owner Organization'),
    integ: firstHeader(headers, INTEGRATION_HEADERS),
    risk: headers.get('Risk/Challenge'),
  }
  if (col.name === undefined) {
    throw new LocalFileError(`${fileName}: no 'Project/System' column`, fileName)
  }
  const colRiskLevel = headers.get('Risk Level')
  const colConfirmed = headers.get('Confirmed')

  const systems: System[] = []
  for (const row of rows.slice(hrow + 1)) {
    const name = cellText(row, col.name)
    if (!name) continue

    const owner = cellText(row, col.owner)
    const riskText = cellText(row, col.risk)
    const infra = cellText(row, col.infra)
    const category = cellText(row, col.cat)

    let explicitRisk: RiskLevel | null = null
    const rawRisk = cellText(row, colRiskLevel).toLowerCase()
    if (rawRisk === 'high' || rawRisk === 'medium' || rawRisk === 'low') {
      explicitRisk = rawRisk
    }

    let explicitConfirmed: boolean | null = null
    const rawConfirmed = cellText(row, colConfirmed).toLowerCase()
    if (rawConfirmed === 'yes' || rawConfirmed === 'no') {
      explicitConfirmed = rawConfirmed === 'yes'
    }

    const [gid, , gck, softByRule] = classifyOwner(owner, name)
    // The Confirmed column outranks ALWAYS_SOFT and NEVER_SOFT.
    const soft = explicitConfirmed !== null ? !explicitConfirmed : softByRule

    const risk = explicitRisk ?? classifyRisk(riskText)
    const riskSource = explicitRisk ? 'explicit' : 'inferred'

    const catInfo = CATEGORY_MAP[category] ?? CATEGORY_MAP['Deployed asset record']
    const colorKey = catInfo.branch !== 'inv' ? catInfo.ck : gck

    const parts = [infra, owner && `Owner: ${owner}`, riskText && `Risk: ${riskText}`]
    let detail = parts.filter(Boolean).join('. ')
    if (detail && !detail.endsWith('.')) detail += '.'

    systems.push({
      id: makeId(name),
      name,
      label: makeLabel(name),
      category,
      owner_group_id: gid,
      owner_group: ownerGroupDisplay(gid),
      color_key: colorKey,
      confirmed: !soft,
      risk,
      risk_source: riskSource,
      detail,
      integrations_prose: cellText(row, col.integ),
    })
  }
  return systems
}

const NO_EQUIVALENT = 'no matching system row'

function normaliseStatus(raw: string): RequirementStatus {
  const status = raw.trim() || 'Unknown'
  const lowered = status.toLowerCase().replace(/’/g, "'")
  if (lowered.includes("didn't keep") || lowered.includes('did not keep')) {
    return "Didn't keep"
  }
  return status as RequirementStatus
}

export function readCrosswalkRows(wb: XLSX.WorkBook, fileName = 'workbook'): Requirement[] {
  const sheet = wb.SheetNames.find((s) => s.toLowerCase().includes('crosswalk'))
  if (!sheet) {
    throw new LocalFileError(
      `${fileName}: no 'original_to_current_crosswalk' sheet; the requirement ` +
        `attrition metric has no source`,
      fileName,
    )
  }
  const rows = sheetRows(wb, sheet)
  const out: Requirement[] = []
  rows.forEach((row, i) => {
    if (i === 0 || !row || !row[0]) return
    const currentCell = cellText(row, 2)
    out.push({
      orig: cellText(row, 0),
      sys: cellText(row, 1),
      current:
        !currentCell || currentCell.toLowerCase().includes(NO_EQUIVALENT)
          ? []
          : currentCell.split(';').map((c) => c.trim()).filter(Boolean),
      status: normaliseStatus(cellText(row, 3)),
    })
  })
  if (!out.length) throw new LocalFileError(`${fileName}: crosswalk sheet is empty`, fileName)
  return out
}

export function extractLinks(systems: System[]): Link[] {
  const fragToId = new Map<string, string>(Object.entries(LINK_NAME_FRAGMENTS))
  for (const s of systems) {
    fragToId.set(s.name.toLowerCase(), s.id)
    const short = s.name.replace(/\s*\(.*?\)\s*/g, '').trim()
    if (short.toLowerCase() !== s.name.toLowerCase() && short.length > 3) {
      fragToId.set(short.toLowerCase(), s.id)
    }
  }

  const display = (sid: string) =>
    LABEL_MAP[sid]?.replace(/\n/g, ' ') ??
    systems.find((x) => x.id === sid)?.name ??
    sid

  const links: Link[] = []
  const seen = new Set<string>()
  for (const s of systems) {
    const text = (s.integrations_prose || '').toLowerCase()
    if (!text) continue
    for (const [frag, tid] of fragToId) {
      if (tid === s.id || !text.includes(frag)) continue
      const pair = [s.id, tid].sort().join(' ')
      if (seen.has(pair)) continue
      seen.add(pair)
      links.push({
        from: s.id,
        to: tid,
        label: `${display(s.id)} - ${display(tid)}`,
        extraction_method: 'prose',
      })
    }
  }
  return links
}

export interface Overrides {
  cross_links?: Array<{ from: string; to: string; label: string }>
  suppress_links?: string[][]
  desired_links?: Array<{ from: string; to: string; label: string }>
  risk_overrides?: Record<string, RiskLevel>
  soft_overrides?: Record<string, boolean>
  node_order?: Record<string, string[]>
}

const key = (a: string, b: string) => [a, b].sort().join(' ')

export function mergeLinks(autoLinks: Link[], overrides: Overrides): Link[] {
  const manual: Link[] = (overrides.cross_links ?? []).map((m) => ({
    ...m,
    extraction_method: 'override' as const,
  }))
  const manualPairs = new Set(manual.map((m) => key(m.from, m.to)))
  const suppressed = new Set((overrides.suppress_links ?? []).map(([a, b]) => key(a, b)))

  const kept = autoLinks.filter((a) => {
    const k = key(a.from, a.to)
    return !manualPairs.has(k) && !suppressed.has(k)
  })
  return [...manual, ...kept]
}

export function desiredLinks(overrides: Overrides): Link[] {
  return (overrides.desired_links ?? []).map((d) => ({
    ...d,
    extraction_method: 'override' as const,
  }))
}
