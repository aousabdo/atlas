/**
 * Which slot a picked file belongs in.
 *
 * WHY THIS EXISTS
 *
 * The load panel used to be five separate file pickers, and an analyst who has
 * these files sitting in one directory had to place each one by hand. Five
 * slots is five chances to put a file in the wrong one, and the worst of those
 * mistakes is silent: a topology dropped into the wrong slot yields a site with
 * devices and no coverage, which reads on screen as a genuine finding rather
 * than as a mistake. The same failure src/lib/siteId.ts exists to prevent, one
 * step earlier in the same path.
 *
 * WHY THIS IS INSPECTION RATHER THAN GUESSWORK
 *
 * The five kinds are structurally distinct, so nothing here is a heuristic over
 * prose. The workbook is the only .xlsx and carries a sheet named Matrix. The
 * glossary is the only JSON with an acronyms array. The system to device map is
 * the only one keyed by site with mappings inside. A topology is the only one
 * carrying nodes and edges together with a graph block. The overrides file is
 * the only one carrying curation keys. Each test names keys, and the reason
 * string quotes the key it matched on, so the panel shows its working instead
 * of asserting an answer.
 *
 * IT READS KEYS, NEVER VALUES
 *
 * Not a style preference. Values are the controlled analytic content: gap
 * statements, owner clauses, device names, acronym expansions. A classifier
 * that matched on any of those would need a vocabulary of them, and that
 * vocabulary would then live in this repo forever. Key names are structure, not
 * content, so this file can be read by anyone. Nothing below inspects a value
 * beyond asking what type it is.
 *
 * IT IS ALWAYS OVERRIDABLE
 *
 * Every answer carries a confidence and a reason, and the panel renders both
 * next to a select. A classifier that cannot be corrected is worse than no
 * classifier, because it converts a visible chore into an invisible error.
 */
import { assertSafeWorkbook, readWorkbook } from '../data/localFileParse'

/** The five places a file can land. Same ids the load panel already uses. */
export type SlotKind = 'matrix' | 'overrides' | 'glossary' | 'systemDeviceMap' | 'topology'

/**
 * How much the structure actually settled it.
 *
 * `certain` means the defining structure was present. `likely` means part of it
 * was. `unsure` means the file's name put it here and its contents did not
 * confirm it. The panel flags anything short of `certain` for a look.
 */
export type Confidence = 'certain' | 'likely' | 'unsure'

export interface FileShape {
  name: string
  /** Sheet names, when the file opened as a workbook. */
  sheets?: readonly string[]
  /** Parsed contents, when the file parsed as JSON. */
  json?: unknown
  /** The file announced itself as a workbook or JSON and would not be read. */
  unreadable?: boolean
  /**
   * Why it would not open, in the opener's own words.
   *
   * Carried so the panel can say "no zip signature" or "too large" rather than
   * the same shrug for every workbook that failed. A refusal by the upload
   * hardening is the one the analyst most needs quoted back: it is the
   * difference between a corrupt export and a file that is not a workbook at
   * all.
   */
  refusal?: string
}

export interface Classification {
  kind: SlotKind | null
  confidence: Confidence
  /** Why, in the panel's own words. Always states the key or sheet it matched. */
  reason: string
}

/** What each slot is called on screen, in the select and in the table. */
export const SLOT_LABEL: Record<SlotKind, string> = {
  matrix: 'Traceability Matrix',
  overrides: 'Curation overrides',
  glossary: 'Glossary',
  systemDeviceMap: 'System to device map',
  topology: 'Site topology',
}

/** Curation keys, in the order the overrides file itself lists them. */
const CURATION_KEYS = [
  'cross_links', 'suppress_links', 'desired_links', 'risk_overrides',
  'soft_overrides', 'node_order',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasArray(record: Record<string, unknown>, key: string): boolean {
  return Array.isArray(record[key])
}

export function isWorkbookName(name: string): boolean {
  return /\.xlsx$/i.test(name)
}

export function isJsonName(name: string): boolean {
  return /\.json$/i.test(name)
}

/**
 * A workbook, first, because the extension already decides it.
 *
 * An .xlsx that will not open still goes to the matrix slot rather than to
 * nowhere. The parser's own message names the file and says what is wrong with
 * it, which is more use to the analyst than this module quietly declining to
 * place a file they clearly meant as the workbook.
 */
function classifyWorkbook(shape: FileShape): Classification {
  if (shape.unreadable || !shape.sheets) {
    return {
      kind: 'matrix',
      confidence: 'unsure',
      reason: shape.refusal
        ? `named .xlsx, but it would not open as a workbook: ${shape.refusal}`
        : 'named .xlsx, but it would not open as a workbook',
    }
  }
  if (shape.sheets.some((sheet) => sheet.trim() === 'Matrix')) {
    return {
      kind: 'matrix',
      confidence: 'certain',
      reason: 'a workbook carrying a Matrix sheet',
    }
  }
  return {
    kind: 'matrix',
    confidence: 'unsure',
    reason: 'a workbook, but with no sheet named Matrix',
  }
}

/**
 * The JSON tests, in order of how much structure each one demands.
 *
 * Order matters only for a file that carries two markers at once, which is why
 * the most specific test runs first: a topology is three keys agreeing, a
 * glossary or an overrides file is one. A real file matches exactly one of
 * these, and the order is pinned by test so it cannot drift silently.
 */
function classifyJson(raw: unknown): Classification {
  if (!isRecord(raw)) {
    return {
      kind: null,
      confidence: 'unsure',
      reason: Array.isArray(raw)
        ? 'a JSON array, and every file ATLAS reads is a JSON object'
        : 'JSON, but not an object',
    }
  }

  // 1. A site topology: a node list, an edge list and a graph block.
  if (hasArray(raw, 'nodes') && hasArray(raw, 'edges')) {
    return isRecord(raw.graph)
      ? {
          kind: 'topology',
          confidence: 'certain',
          reason: 'has nodes and edges plus a graph block',
        }
      : {
          kind: 'topology',
          confidence: 'likely',
          reason: 'has nodes and edges, but no graph block',
        }
  }

  /*
   * 1b. A topology-shaped file whose node list is keyed devices.
   *
   * This used to be accepted as a spelling of nodes, and it is not one:
   * loadTopology in src/data/LocalFileProvider.ts reads raw.nodes and nothing
   * else. A file keyed devices therefore loaded, at CERTAIN, as a site with no
   * devices in it, and the tab then said there were none recorded. That is the
   * confident wrong answer this module exists to prevent, so it is named here
   * instead, and the analyst can still overrule the refusal in the select.
   */
  if (hasArray(raw, 'devices') && hasArray(raw, 'edges')) {
    return {
      kind: null,
      confidence: 'unsure',
      reason:
        'has devices and edges, but a topology has to key its node list nodes, ' +
        'which is the only spelling the loader reads',
    }
  }

  // 2. The system to device map: keyed by site, with mappings inside.
  if (isRecord(raw.sites)) {
    const mapped = Object.values(raw.sites).some(
      (site) => isRecord(site) && 'mappings' in site,
    )
    return mapped
      ? {
          kind: 'systemDeviceMap',
          confidence: 'certain',
          reason: 'keyed by site, with mappings inside',
        }
      : {
          kind: 'systemDeviceMap',
          confidence: 'likely',
          reason: 'keyed by site, though no site carries mappings',
        }
  }

  // 3. The glossary.
  if (hasArray(raw, 'acronyms')) {
    return { kind: 'glossary', confidence: 'certain', reason: 'has an acronyms array' }
  }

  // 4. The curation overrides.
  const curation = CURATION_KEYS.filter((key) => key in raw)
  if (curation.length) {
    return {
      kind: 'overrides',
      confidence: curation.length > 1 ? 'certain' : 'likely',
      reason: `has the curation ${curation.length > 1 ? 'keys' : 'key'} ${curation.join(', ')}`,
    }
  }

  return {
    kind: null,
    confidence: 'unsure',
    reason: 'JSON, but with no key ATLAS recognises',
  }
}

/**
 * Pure. Given a file's name and what reading it produced, say where it goes.
 *
 * Kept free of File and of any reading so it can be tested exhaustively against
 * invented shapes, and so the panel can call it again, without re-reading, when
 * the analyst changes an earlier decision.
 */
export function classifyInput(shape: FileShape): Classification {
  if (isWorkbookName(shape.name)) return classifyWorkbook(shape)
  if (isJsonName(shape.name)) {
    if (shape.unreadable) {
      return {
        kind: null,
        confidence: 'unsure',
        reason: 'named .json, but it could not be read as JSON',
      }
    }
    return classifyJson(shape.json)
  }
  return {
    kind: null,
    confidence: 'unsure',
    reason: 'neither a workbook nor JSON, by its name',
  }
}

/**
 * The refusal, with the leading file name dropped.
 *
 * assertSafeWorkbook prefixes its messages with the file name, and the table
 * this ends up in already has a File column. Saying it twice on one row reads
 * as a stutter rather than as emphasis.
 */
function refusalOf(file: File, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  const prefix = `${file.name}: `
  return message.startsWith(prefix) ? message.slice(prefix.length) : message
}

/**
 * Read one File far enough to classify it, and no further.
 *
 * The whole file has to be read either way, so this parses it properly rather
 * than sniffing a prefix. It stays a separate function from classifyInput so
 * that the decision itself has no I/O in it.
 *
 * WHY IT OPENS A WORKBOOK THE LONG WAY
 *
 * assertSafeWorkbook then readWorkbook is exactly what LocalFileProvider.load
 * does, in that order, and that is the point: there is one way to hand a File
 * to SheetJS in this codebase and it goes through the hardening. Inspection
 * used to call XLSX.read on the raw buffer instead, which meant every
 * protection the gate provides was skipped for any file that arrived by the
 * drop path: no size cap, no zip signature, and an HTML document named .xlsx
 * parsed happily by SheetJS's HTML reader. The generated network graphs are
 * stored XSS by construction, so that last one is not hypothetical. A gate one
 * of two callers observes is decoration.
 *
 * The cost is a full parse where sheet names alone would do. It is paid once,
 * on a file capped at 50 MB, and the alternative is a second way in.
 *
 * Nothing here is retained. The parse result is handed straight back to the
 * caller, which holds it only for as long as the panel is open, and the real
 * parse happens again in LocalFileProvider from the same File.
 */
export async function inspectFile(file: File): Promise<FileShape> {
  if (isWorkbookName(file.name)) {
    try {
      const book = readWorkbook(await assertSafeWorkbook(file))
      return { name: file.name, sheets: book.SheetNames }
    } catch (cause) {
      return { name: file.name, unreadable: true, refusal: refusalOf(file, cause) }
    }
  }
  if (isJsonName(file.name)) {
    try {
      return { name: file.name, json: JSON.parse(await file.text()) as unknown }
    } catch {
      return { name: file.name, unreadable: true }
    }
  }
  return { name: file.name }
}
