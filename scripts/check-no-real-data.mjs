#!/usr/bin/env node
/**
 * Refuse to let the real dataset back into this repo.
 *
 * This repo committed the real controlled C-UAS bundle once. History was
 * purged and the bundle replaced with a synthetic one, which cost a day and
 * a rebuilt remote. The reason it happened is that nothing was watching: the
 * bundle is a build output, `public/data/` was tracked, and a routine
 * `git add -A` did the rest. So this runs on every commit and in CI.
 *
 * WHAT IS ACTUALLY SENSITIVE
 *
 * The first version of this guard was aimed at addressing. It read the network
 * topology JSON, learned device hostnames and subnets, and reported clean. It
 * was clean, and it meant nothing, because the addressing was never the
 * controlled material. The controlled material is the ANALYTIC CONTENT of the
 * traceability matrix: the capability-gap statements carried forward from the
 * original baseline, the risk narrative and the keyword table derived from it,
 * the owner clauses, and the acronym glossary whose expansions decode every
 * rename in one pass. A reviewer recovered the full mapping from a bundle whose
 * identifiers had all been changed, because none of that content had been.
 *
 * So the harvest reads the traceability matrix, the generated tool, and every
 * workbook and JSON file under the reference repo's traceability tree, and it
 * extracts WHOLE PHRASES, because that is the shape this content has. A gap
 * statement is a sentence. Matching it as a sentence is close to
 * false-positive free, which is the only reason a rule this broad is
 * survivable.
 *
 * WHY THE REAL NAMES ARE NOT IN THIS FILE
 *
 * The obvious implementation is a list of the real names and phrases to grep
 * for. That implementation defeats itself: the list *is* the sensitive
 * vocabulary, so a guard written that way publishes the thing it exists to
 * hide, in a file everyone reads, forever. Worse, it would be the one file
 * nobody thinks to purge, because it looks like tooling.
 *
 * So the vocabulary is never stored. It is harvested at run time from the
 * read-only reference repo at $ATLAS_SOURCE_REPO, the same environment
 * variable ingest/tests/conftest.py and src/data/__tests__/localfile.test.ts
 * already use to find it.
 *
 * WHERE RULE 4 RUNS, AND WHERE IT HONESTLY CANNOT
 *
 * Rule 4 needs the reference data. A GitHub runner does not have it and must
 * not, so CI CANNOT RUN RULE 4. That is a real limit, not a passing test, and
 * the previous version hid it: CI omitted the variable, the name rules skipped,
 * and the job went green in a way that read as coverage.
 *
 * Two things make it honest now. The pre-commit hook REFUSES TO RUN without
 * $ATLAS_SOURCE_REPO, so the machine that could paste a real phrase is the
 * machine that always checks for one. And in every mode where the name rules do
 * not run, this script prints an explicit banner saying so, so a CI log states
 * the gap in words rather than implying coverage by staying quiet. The README
 * says the same thing in the development section.
 *
 * WHAT IS CHECKED
 *
 *   1. public/data/ is tracked at all      (it is generated; see .gitignore)
 *   2. IPv4 addresses outside RFC 5737 and the one RFC 1918 block the sample
 *      bundle is allowed to use
 *   3. FOUO / CUI appearing as a data value rather than as prose about markings
 *   4. real entity names and analytic phrases, when $ATLAS_SOURCE_REPO makes
 *      them available. Rules 3 and 4 also run against every tracked PATH,
 *      because a filename carries content too
 *   5. every tracked binary is on the expected-artifacts list, because no text
 *      rule can read a PNG and the committed baselines render the risk-keyword
 *      table and the gap statements as pixels
 *
 * USAGE
 *
 *   node scripts/check-no-real-data.mjs             every tracked file
 *   node scripts/check-no-real-data.mjs --staged    added lines of the index
 *
 * Findings print the offending text in full. That is safe in a way a dumped
 * term list is not: a match is by definition already sitting in a file in the
 * tree, so echoing it back reveals nothing new, whereas printing the harvested
 * vocabulary would leak content from a repo the reader does not have. There is
 * deliberately no flag to print the term list.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Files whose STRUCTURAL rules are relaxed, and nothing more.
 *
 * The pattern tables below necessarily contain the marking strings they look
 * for, and the tests plant addresses on purpose, so rules 2 and 3 cannot run
 * against these two files. Rule 4 still does, and that is the whole point of
 * the change: the previous version skipped these files ENTIRELY, which made
 * them an unscanned write-anything channel, and three real system ids were
 * sitting in a comment in this very file for exactly that reason. Neither of
 * these files has any legitimate need to contain a real name or a real phrase,
 * so the rule that matters is the rule that is never waived.
 *
 * The tests assert this list by value, because an exemption is a hole and a
 * hole that can be widened by editing one array is not a guard.
 */
export const SELF_EXEMPT = [
  'scripts/check-no-real-data.mjs',
  'scripts/__tests__/no-real-data.test.mjs',
]

/** Generated bundle. The .gitkeep is what keeps the directory in a fresh clone. */
const DATA_DIR = 'public/data/'
const DATA_DIR_ALLOWED = new Set(['public/data/.gitkeep'])

// ---------------------------------------------------------------------------
// Rule 2: addressing
// ---------------------------------------------------------------------------

/**
 * Ranges a sample bundle is allowed to use. RFC 5737 is the documentation
 * space; 172.31/16 is the single RFC 1918 block the synthetic vocabulary
 * assigns to building closets, and it is here because the sample bundle would
 * otherwise trip its own guard. Loopback and the all-zero address are dev
 * server bindings, not data: playwright.config.ts and falsify.mjs both use
 * 127.0.0.1 and are right to.
 */
const ALLOWED_NETS = [
  ['192.0.2.0', 24],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['172.31.0.0', 16],
  ['127.0.0.0', 8],
  ['0.0.0.0', 32],
]

/**
 * The lookarounds are the version-number defence and they are cheap: rejecting
 * a leading word character or dot drops `v1.2.3.4` and `@1.2.3.4`, and
 * rejecting a trailing one drops the middle of a longer run like `1.2.3.4.5`.
 */
const IPV4 = /(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?(?![\w.])/g

/**
 * `"version": "1.2.3.4"` survives the lookarounds because the quote resets the
 * word boundary, so it is caught by looking at what precedes it on the line.
 * The optional quote after the keyword is what makes the JSON spelling work.
 */
const VERSION_CONTEXT = /(?:\bversions?\b|\bsemver\b)["']?\s*[:=]?\s*["'`]?\s*$|[@^~]\s*$/i

function toInt(octets) {
  return octets.reduce((acc, o) => acc * 256 + o, 0)
}

function inNet(octets, [net, bits]) {
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0
  return (toInt(octets) & mask) >>> 0 === (toInt(net.split('.').map(Number)) & mask) >>> 0
}

/**
 * A contiguous mask starting at 255 identifies no host, so `255.255.255.0` in a
 * device record is noise rather than a finding. Masks that do not start with
 * 255 are not excused, because `128.0.0.0` and `192.0.0.0` are also routable.
 */
function isNetmask(octets) {
  if (octets[0] !== 255) return false
  const value = toInt(octets)
  const inverted = (~value >>> 0) + 1
  return (inverted & (inverted - 1)) === 0
}

function findAddresses(line) {
  const out = []
  for (const match of line.matchAll(IPV4)) {
    const octets = match.slice(1, 5).map(Number)
    const raw = match.slice(1, 5)
    // Not an address at all: out of range, or zero-padded the way dates and
    // build numbers are.
    if (octets.some((o) => o > 255)) continue
    if (raw.some((o) => o.length > 1 && o.startsWith('0'))) continue
    if (match[5] !== undefined && Number(match[5]) > 32) continue
    if (VERSION_CONTEXT.test(line.slice(0, match.index))) continue
    if (isNetmask(octets)) continue
    if (ALLOWED_NETS.some((net) => inNet(octets, net))) continue
    out.push({ rule: 'address', text: match[0] })
  }
  return out
}

// ---------------------------------------------------------------------------
// Rule 3: control markings
// ---------------------------------------------------------------------------

/**
 * Only markings used as *values* are findings. Prose that discusses markings
 * has to stay writable, or the guard makes its own subject undiscussable: this
 * comment, the plan documents and a README paragraph about why the sample
 * bundle says UNCLASSIFIED//SAMPLE all have to survive it. A marking-shaped
 * quoted literal is all-caps and short; a sentence about markings is neither.
 */
const QUOTED_MARKING = /(["'`])([A-Z0-9 /_.-]{0,48}\b(?:FOUO|CUI)\b[A-Z0-9 /_.-]{0,48})\1/g
const BARE_MARKING = /(?:^|[:=,|\t])[ \t]*((?:[A-Z0-9]+\/\/)?(?:FOUO|CUI))[ \t]*(?=$|[,|\t])/g

/**
 * A path has no quotes and no delimiters to anchor on, so the two matchers
 * above find nothing in one. A marking in a filename is unambiguous anyway:
 * there is no prose in a path for it to be part of.
 */
const PATH_MARKING = /(?:^|[^a-z0-9])((?:FOUO|CUI))(?![a-z0-9])/gi

function findMarkings(line) {
  const out = []
  for (const match of line.matchAll(QUOTED_MARKING)) {
    out.push({ rule: 'marking', text: match[2] })
  }
  for (const match of line.matchAll(BARE_MARKING)) {
    out.push({ rule: 'marking', text: match[1] })
  }
  return out
}

// ---------------------------------------------------------------------------
// Rule 4: real names and analytic phrases, harvested at run time
// ---------------------------------------------------------------------------

/**
 * Words that appear in the reference data but identify nothing: generic network
 * and IT vocabulary, public agency abbreviations, and the handful of zone ids
 * the synthetic vocabulary deliberately reuses because they are descriptive
 * rather than revealing. Everything here is safe to write down, which is the
 * test for whether it belongs here rather than in the harvest.
 *
 * THIS LIST ONCE LEAKED THE SITE, AND THE WORDS ARE NOT REPEATED HERE.
 *
 * It carried six words naming the kind of venue the real site is and the kinds
 * of business the buildings on it are named after. Each one is ordinary English
 * on its own. Together they picked out a single location in the United States,
 * more precisely than the data being guarded did, and they sat in the one file
 * everybody reads. Listing them again in this comment to explain the fix would
 * repeat the disclosure, so they are described and not named: rule 4 scans this
 * file now, and it rejected the first draft of this paragraph for spelling one
 * of them out.
 *
 * They were only ever here to stop the guard firing on the synthetic labels
 * that reused them. That is a reason to rename a synthetic label, never a
 * reason to widen the vocabulary, and the labels needing it are listed in
 * e2e/README.md and the handover notes.
 *
 * The test for membership is therefore not "is this word generic" but "would
 * an adversary learn anything from the SET". Nothing venue-shaped goes back in.
 */
export const PUBLIC_VOCABULARY = new Set([
  'access', 'adaptor', 'annex', 'backbone', 'building', 'cable',
  'camera', 'cbp', 'closet', 'cloud', 'command', 'controller',
  'core', 'data', 'desktop', 'device', 'devices', 'dhs', 'display', 'displays',
  'dod', 'edge', 'external', 'fiber', 'firewall',
  'gateway', 'government', 'guest', 'injector', 'internet', 'lan',
  'laptop', 'layer', 'management', 'mgmt', 'micro', 'microwave', 'mobile',
  'network', 'node', 'ocio', 'operational', 'ops', 'outside', 'panel',
  'patch', 'perimeter', 'poe', 'precision', 'printer', 'quick', 'radar',
  'radio', 'receiver', 'remote', 'roof', 'router', 'routing', 's&t', 'sensor',
  'sensor_net', 'server', 'site', 'storage', 'strategic',
  'switch', 'tactical', 'terminal', 'tower', 'vehicle', 'vlan', 'wan', 'wifi',
  'wireless', 'workshop', 'zone',
  // Public programme and product names. ATAK and WinRelay are published DoD
  // software; flagging them would fire on any C-UAS document ever written.
  // ADS-B is an ICAO surveillance standard, so renaming it would leave the
  // sample describing a receiver for a protocol that does not exist.
  'ads-b', 'atak', 'itak', 'recon', 'winrel',
  // Words this repo is made of. "C-UAS" and "architecture" are in its own
  // description, "focus" is a DOM concept and a query parameter, "point" is
  // ordinary English, and the CI image name contains "linux" and "ubuntu".
  'architecture', 'c-uas', 'cuas', 'focus', 'linux', 'point', 'rocky', 'ubuntu',
  // The six owner-group ids. These are public agency names that the sample
  // bundle keeps deliberately: the sensitive fact was never that CBP exists,
  // it was which systems exist and where they are deployed.
  'cbp', 'dhshq', 'dhsst', 'dod', 'ext', 'otherdhs',
  // Same category: agencies the sample bundle names as owners, and the
  // doctrine term for the mission they own. Public, and renaming them would
  // make the ownership model incoherent rather than safer.
  'faa', 'fbi', 'isr', 'uscg', 'usss', 'ice', 'fps', 'amo', 'ocio',
  'other dhs components', 'dhs hq/ocio', 'dhs s&t', 'usss tak', 'us army',
  // Crosswalk status vocabulary. These are ordinary English describing what
  // happened to a requirement, not anything about this architecture.
  // Published expansions of public acronyms. The harvest reads a glossary,
  // so every standards body's own wording arrives with the real content.
  'ios team awareness kit', 'android team awareness kit', 'windows team awareness kit',
  'common operating picture', 'virtual local area network', 'u.s. secret service',
  'u.s. immigration and customs enforcement', 'u.s. coast guard', 'uss',
  'uas service supplier (faa utm concept)', 'federal bureau of investigation',
  'federal aviation administration', 'department of homeland security',
  // Published expansions of public acronyms, from the glossary the harvest
  // reads. Every one is safe to write down, which is this list's own test
  // for membership, and the sample glossary keeps them on purpose.
  'aar',
  'after action report',
  'automatic dependent surveillance-broadcast',
  'cad',
  'computer-aided dispatch',
  'cop',
  'cot',
  'counter-unmanned aircraft systems',
  'dss',
  'daas',
  'department of defense',
  'department of homeland security science and technology directorate',
  'discovery and synchronization service',
  'electro-optical / infrared (sensor)',
  'federal protective service (dhs component)',
  'intelligence, surveillance, reconnaissance',
  'mcv',
  'noc',
  'network operations center',
  'office of the chief information officer',
  'ptz',
  'pan-tilt-zoom (camera)',
  'power over ethernet',
  'research, development, test & evaluation',
  'snap',
  'tak',
  'team awareness kit, us army situational-awareness platform',
  'u.s. customs and border protection',
  // The crosswalk parser has to recognise how a real matrix spells its
  // dropped status, or it cannot read one. Breaking that to satisfy this
  // guard would trade a working feature for a cosmetic pass.
  "didn't keep as system row", "didn't keep", 'did not keep',
  // Spreadsheet column headers the parser must match literally to read a real
  // workbook, including the doubled letter real matrices carry. Breaking the
  // parser to satisfy this scanner would trade a working feature for a pass.
  'currrent integrations', 'current integrations', 'desired integrations',
  'existing interfaces', 'planned interfaces',
  // Ordinary code identifiers that collide with harvested words.
  'nodecount', 'nodecounts', 'axis', 'axes',
  'split out', 'renamed / split out', 'partly carried forward', 'condensed',
  "didn't keep",
  // Spreadsheet furniture. The harvest now reads workbooks, so the column
  // headers and status words of a traceability matrix arrive with the content.
  // They describe the shape of any such document and identify nothing.
  'capability', 'confirmed', 'current', 'gap', 'high', 'low', 'matrix',
  'medium', 'notes', 'organization', 'original', 'owner', 'project', 'requirement',
  'risk', 'status', 'summary', 'system', 'systems', 'technology', 'total',
  'traceability', 'unconfirmed', 'infrastructure',
  // Tooling vocabulary. The reference repo is a working directory, so its
  // documents talk about file formats and version control the same way this
  // one does, and those words arrive with the harvest.
  'api', 'atlas', 'git', 'html', 'json', 'jsons', 'oceans', 'xlsx',
  // Rule 3 owns the control markings. Letting rule 4 harvest them too would
  // undo the careful distinction rule 3 draws between a marking used as a
  // value and a sentence about markings, and would fail this repo's README
  // for explaining why the sample bundle is marked the way it is.
  'cui', 'fouo',
])

const TOKEN = /^[a-z0-9][a-z0-9_.&-]*$/
const PROPER = /\b[A-Z][A-Za-z0-9&.-]{3,}\b/g

/**
 * Free text arrives from workbooks and from the generated tool, where most
 * strings are ordinary English and a capitalised word is as likely to be
 * "Confirmed" as it is to be a system name. Admitting those as single tokens
 * is how a guard starts firing on ordinary English and gets switched off, so
 * from free text only identifier-shaped tokens are admitted: an acronym, a
 * CamelCase product name, or something carrying a digit or a separator. Every
 * other name in free text is carried by the phrase that contains it.
 */
const ACRONYM = /^[A-Z][A-Z0-9]{2,11}$/
const CAMEL = /^[A-Za-z]+[A-Z][A-Za-z0-9]*$/

/**
 * Phrase floors. A gap statement, a risk-keyword entry and an acronym
 * expansion are all several words long, and a several-word phrase matched whole
 * is close to false-positive free. Below these floors a "phrase" is a fragment
 * of English that would fire on prose written years apart on the same subject,
 * which is the failure mode that gets a guard disabled.
 *
 * Two shapes qualify. Three words and sixteen characters catches
 * keyword-table entries. Two words and twenty characters catches the
 * hyphenated compounds that tokenize as two words but are plainly not ordinary
 * English.
 */
const PHRASE_MIN_WORDS = 3
const PHRASE_MIN_CHARS = 16
const PHRASE_SHORT_WORDS = 2
const PHRASE_SHORT_CHARS = 20

function words(key) {
  return key.split(/[^a-z0-9&.-]+/).filter(Boolean)
}

function admit(terms, value) {
  if (typeof value !== 'string') return
  const term = value.trim().replace(/\s+/g, ' ')
  if (!term) return
  const key = term.toLowerCase()
  if (PUBLIC_VOCABULARY.has(key)) return
  // Multi-word labels are matched whole. A whole phrase is close to
  // false-positive free, which is what makes the guard survivable.
  if (term.includes(' ')) {
    // Unless every word in it is already public. "WAN / Internet" identifies
    // nothing, and adding such phrases to PUBLIC_VOCABULARY one at a time is
    // endless: the reference data is full of them and each one costs a commit
    // that looks like an exemption being widened.
    const parts = words(key)
    if (parts.length && parts.every((w) => PUBLIC_VOCABULARY.has(w))) return
    if (term.length >= 8) terms.add(key)
    return
  }
  // Single tokens are ids: site, system and device identifiers. Three-character
  // ids exist in the reference data and are kept, but matched only in quoted
  // positions later on, because a bare three-letter word boundary is noise.
  if (TOKEN.test(key) && key.length >= 3) terms.add(key)
}

/**
 * Proper nouns inside a known label field: carrier names, place names.
 *
 * `minLength` is the whole argument. A label is prose with names in it, and
 * splitting "Fairground Sports Complex" into three tokens produces one useful
 * rule and two words of ordinary English. The two words then fire on every
 * unrelated use of them, which is how a guard becomes noise and gets switched
 * off, and they carry no protection on their own: nothing is disclosed by a
 * repo containing the word "complex". The place name is what identifies the
 * place, and place names are long, so bare words are taken from a label only at
 * eight characters or more. The whole label is admitted as a phrase separately,
 * which is what actually catches a copied label.
 *
 * Fields that are lists of names rather than prose pass a lower floor: in
 * `sys` and `current` every capitalised word is a system name, so there is no
 * ordinary English in them to protect.
 */
function admitProper(terms, value, minLength = 8) {
  if (typeof value !== 'string') return
  for (const match of value.matchAll(PROPER)) {
    const word = match[0]
    // A word carrying an ampersand is a company name, never English. Naming an
    // example here would mean writing a real carrier's name into this file,
    // which is the disclosure the whole design avoids; rule 4 now scans this
    // file and caught exactly that when it was written out.
    if (word.length < minLength && !word.includes('&')) continue
    admit(terms, word)
  }
}

/**
 * Identifier-shaped tokens only. The free-text counterpart of admit().
 *
 * Only two shapes qualify, and the omission is deliberate. An earlier version
 * also took anything carrying a digit or a separator, on the theory that ids
 * look like that. So do dates, version strings and filenames, so `2026`,
 * `README.md` and `glossary.json` became rules and the guard failed on its own
 * README. Every id that actually matters is either read from a structured id
 * position by admit(), or is an acronym, or is a product name in CamelCase.
 */
function admitIdentifier(acronyms, value) {
  if (typeof value !== 'string') return
  for (const raw of value.split(/[\s,;|()[\]{}"']+/)) {
    const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    if (token.length < 3 || token.length > 40) continue
    const key = token.toLowerCase()
    if (PUBLIC_VOCABULARY.has(key)) continue
    if (!TOKEN.test(key)) continue
    // Kept in its original casing, and matched case-sensitively later, because
    // an abbreviation is a name in capitals and an ordinary word in lower case.
    // Several real systems are abbreviated exactly the way this repo spells a
    // charting module, a toolbar verb and a classifier key, so folding case
    // made the guard report three files that have nothing to do with any of
    // them. The examples are not named here for the same reason the rest of the
    // vocabulary is not: rule 4 scans this file, and it rejected the draft that
    // spelled them out.
    if (ACRONYM.test(token) || CAMEL.test(token)) acronyms.add(token)
  }
}

/**
 * A whole phrase, kept verbatim. This is the rule that would have caught the
 * disclosure: the identifiers in the shipped bundle had all been renamed and
 * the sentences around them had not.
 */
function admitPhrase(phrases, value) {
  if (typeof value !== 'string') return
  const phrase = value.replace(/\s+/g, ' ').trim()
  if (phrase.length > 300) return
  // A phrase is multi-word text. Without this, `system_device_map.json` splits
  // on its underscores into three "words" and becomes a rule, and the guard
  // fails on this repo's own README for documenting the ingest command line.
  if (!phrase.includes(' ')) return
  const key = phrase.toLowerCase()
  const parts = words(key)
  const longEnough =
    (parts.length >= PHRASE_MIN_WORDS && phrase.length >= PHRASE_MIN_CHARS) ||
    (parts.length >= PHRASE_SHORT_WORDS && phrase.length >= PHRASE_SHORT_CHARS)
  if (!longEnough) return
  // A phrase built only from public vocabulary identifies nothing, same as for
  // labels, and "Sensor / Radar Network Zone" is a real example of one.
  if (parts.every((w) => PUBLIC_VOCABULARY.has(w))) return
  phrases.add(key)
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * The reference files spell a set of system ids two ways: a bare list in some
 * places, an id-keyed object with a note per id in others. Both mean the same
 * thing here, and the guard should not break when a field changes shape.
 */
function ids(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.keys(value)
  return []
}

// ---------------------------------------------------------------------------
// Reading a workbook without a dependency
// ---------------------------------------------------------------------------

/**
 * The traceability matrix is an .xlsx, and the cell text of an .xlsx lives in
 * one part of the archive: xl/sharedStrings.xml. An .xlsx is a zip and node
 * ships inflate, so reading it costs no dependency, which matters because this
 * guard deliberately runs before `npm ci` and has to keep working when the
 * install is broken.
 *
 * The central directory is the thing parsed rather than the stream of local
 * headers, because a local header may carry zero for the compressed size and
 * defer it to a trailing data descriptor, and a reader that trusts the local
 * header walks off the rails on exactly those files.
 */
function zipEntry(buffer, wanted) {
  const EOCD = 0x06054b50
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 66000; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  // ZIP64. The reference workbooks are far too small to need it, and guessing
  // at a format this guard has never seen is worse than reporting nothing.
  if (offset === 0xffffffff) return null

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length) return null
    if (buffer.readUInt32LE(offset) !== 0x02014b50) return null
    const method = buffer.readUInt16LE(offset + 10)
    const compressed = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf-8', offset + 46, offset + 46 + nameLen)
    if (name === wanted) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return null
      const localNameLen = buffer.readUInt16LE(localOffset + 26)
      const localExtraLen = buffer.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLen + localExtraLen
      const raw = buffer.subarray(start, start + compressed)
      try {
        return method === 0 ? raw : inflateRawSync(raw)
      } catch {
        return null
      }
    }
    offset += 46 + nameLen + extraLen + commentLen
  }
  return null
}

const XML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

function unescapeXml(text) {
  return text
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => XML_ENTITIES[e])
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
}

/** Every distinct cell string in a workbook, in no particular order. */
export function readWorkbookStrings(path) {
  let buffer
  try {
    buffer = readFileSync(path)
  } catch {
    return []
  }
  const part = zipEntry(buffer, 'xl/sharedStrings.xml')
  if (!part) return []
  const xml = part.toString('utf-8')
  const out = []
  // A cell string is one <si>, but rich text splits it across several <t> runs
  // inside that <si>, and joining the runs is what keeps a phrase whole when
  // somebody bolded three words of it.
  for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const runs = [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1])
    if (!runs.length) continue
    out.push(unescapeXml(runs.join('')))
  }
  return out
}

// ---------------------------------------------------------------------------
// Reading the generated tool
// ---------------------------------------------------------------------------

/**
 * The generated tool is a single HTML file with the analytic content inlined as
 * JavaScript literals, next to a megabyte of minified vendor code. Parsing it
 * as JavaScript is not on the table, so the named analytic assignments are
 * located and brace-matched, which is exact for the ones that are JSON and
 * degrades to string extraction for the ones that are JS object literals.
 */
const TOOL_DATA_VARS = [
  'CROSSWALK',
  'GLOSSARY',
  'METHODOLOGY',
  'SITES',
  'ZONES',
  'SYSTEM_DEVICE_MAP',
  'CONFIDENCE_COUNTS',
  'GROUP_COLORS',
  'LINK_TYPES',
  'BUILD_PROVENANCE',
]

/**
 * Keys whose values are analytic content wherever they appear, including inside
 * the network diagrams the tool embeds as escaped HTML strings. Deliberately
 * narrow: `name` is not here, because minified vendor code is full of it.
 */
const TOOL_TEXT_KEYS =
  /\\?["']?\b(label|short|acr|meaning|orig|status|note|confidence_intro|caveat|rationale|source_label)\b\\?["']?\s*:\s*\\?["']((?:[^"\\]|\\.){2,300}?)\\?["']/g

const unescapeLiteral = (text) =>
  text.replace(/\\n/g, ' ').replace(/\\u003c/gi, '<').replace(/\\(["'\\/])/g, '$1')

function braceMatch(text, start) {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = null
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i += 1
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') inString = ch
    else if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function walkStrings(value, visit, depth = 0) {
  if (depth > 12) return
  if (typeof value === 'string') visit(value)
  else if (Array.isArray(value)) for (const item of value) walkStrings(item, visit, depth + 1)
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      visit(key, true)
      walkStrings(item, visit, depth + 1)
    }
  }
}

function harvestToolHtml(terms, phrases, acronyms, path) {
  let html
  try {
    html = readFileSync(path, 'utf-8')
  } catch {
    return false
  }
  let found = false

  for (const name of TOOL_DATA_VARS) {
    const anchor = new RegExp(`\\b${name}\\s*=\\s*[{[]`).exec(html)
    if (!anchor) continue
    const start = anchor.index + anchor[0].length - 1
    const slice = braceMatch(html, start)
    if (!slice) continue
    found = true
    let parsed = null
    try {
      parsed = JSON.parse(slice)
    } catch {
      parsed = null
    }
    if (parsed !== null) {
      walkStrings(parsed, (value, isKey) => {
        if (isKey) {
          admitIdentifier(acronyms, value)
          return
        }
        admitPhrase(phrases, value)
        admitIdentifier(acronyms, value)
      })
      // The crosswalk's `sys` and `current` fields are lists of system names
      // and nothing else, so a capitalised word in one is a name rather than
      // the first word of a sentence. That distinction is the whole reason
      // admitProper is not let loose on free text: "Where we had to infer" put
      // `where` in the term list and the guard started firing on English.
      if (name === 'CROSSWALK' && Array.isArray(parsed)) {
        for (const row of parsed) {
          for (const entry of [row?.sys, row?.current].flat()) {
            // Not admit(): that folds case, and an entry here is as likely to
            // be a bare abbreviation as a name. Sending abbreviations through
            // the case-sensitive path is what keeps them from matching the
            // ordinary words they collide with.
            admitIdentifier(acronyms, entry)
            admitProper(terms, entry, 5)
          }
        }
      }
      if (name === 'SITES' && Array.isArray(parsed)) {
        for (const site of parsed) {
          admit(terms, site?.id)
          admit(terms, site?.label)
          admitProper(terms, site?.label)
        }
      }
    } else {
      // A JS object literal, or a block escaped inside a string, which is how
      // ZONES arrives: it lives inside the network diagram the tool embeds as
      // an escaped HTML document. Brace matching cannot tell where that ends,
      // so the slice may run on into script, and only the analytic key/value
      // pairs inside it are read. Taking every quoted run instead put
      // `toLowerCase`, `innerHTML` and `fitToScreen` in the term list, and the
      // guard started reporting the app's own source code as a leak.
      for (const match of slice.matchAll(TOOL_TEXT_KEYS)) {
        admitPhrase(phrases, unescapeLiteral(match[2]))
      }
    }
  }

  // Whole-file sweep for the analytic keys, which is what reaches the labels
  // inside the embedded network diagrams. Phrases only: a `label:` in minified
  // vendor code is a short identifier and would be admitted as a name, whereas
  // no vendor library contains a four-word capability-gap statement.
  for (const match of html.matchAll(TOOL_TEXT_KEYS)) {
    found = true
    admitPhrase(phrases, unescapeLiteral(match[2]))
  }

  return found
}

// ---------------------------------------------------------------------------
// The harvest
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git', 'vendor', '.venv'])

function walkFiles(dir, visit, depth = 0) {
  if (depth > 6) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkFiles(full, visit, depth + 1)
    } else if (entry.isFile()) {
      visit(full, entry.name)
    }
  }
}

/**
 * Harvest the vocabulary from the reference repo.
 *
 * Three sources, and the first version had only the third:
 *
 *   the traceability tree   every workbook and every JSON under
 *                           traceability/, which is where the matrix, the
 *                           overrides, the glossary and their archived
 *                           revisions live. This is the analytic content.
 *   the generated tool      traceability/mindmap/cuas_tool_v6.html, which
 *                           carries the crosswalk, the risk-keyword table and
 *                           the glossary inlined, already rendered the way a
 *                           copy-paste would arrive.
 *   the site graphs         the per-site network JSON, for device and zone
 *                           labels. Kept, because it is still true, but it was
 *                           never the part that mattered.
 *
 * Returns { terms, phrases }. Terms are ids and names matched with word
 * boundaries; phrases are whole sentences matched verbatim.
 */
export function harvestNames(sourceRepo) {
  const terms = new Set()
  const phrases = new Set()
  const acronyms = new Set()
  const mindmap = join(sourceRepo, 'traceability', 'mindmap')

  // --- structured id positions, where a bare token really is a name ---
  const deviceMap = readJson(join(mindmap, 'system_device_map.json'))
  const siteIds = []
  if (deviceMap?.sites) {
    for (const [siteId, site] of Object.entries(deviceMap.sites)) {
      siteIds.push(siteId)
      admit(terms, siteId)
      admit(terms, site?.label)
      admitProper(terms, site?.label)
      admitPhrase(phrases, site?.label)
      for (const systemId of ids(site?.mappings)) admit(terms, systemId)
      for (const systemId of ids(site?.not_deployed_at_site)) admit(terms, systemId)
    }
  }
  for (const systemId of ids(deviceMap?.pending_review)) admit(terms, systemId)

  const overrides = readJson(join(mindmap, 'overrides.json'))
  for (const key of ['node_order', 'risk_overrides', 'soft_overrides']) {
    for (const systemId of ids(overrides?.[key])) admit(terms, systemId)
  }

  // --- the analytic content: every workbook and every JSON under traceability/ ---
  const traceability = join(sourceRepo, 'traceability')
  if (existsSync(traceability)) {
    walkFiles(traceability, (full, name) => {
      const lower = name.toLowerCase()
      if (/\.(xlsx|xlsm|xltx)$/.test(lower)) {
        for (const cell of readWorkbookStrings(full)) {
          admitPhrase(phrases, cell)
          admitIdentifier(acronyms, cell)
        }
        return
      }
      if (lower.endsWith('.json')) {
        const data = readJson(full)
        if (data === null) return
        walkStrings(data, (value, isKey) => {
          // Keys are ids often enough to be worth reading, and ordinary words
          // often enough that only the identifier-shaped ones are taken: a
          // sweep over every JSON in the tree turns `sites`, `zones` and
          // `coverage` into rules otherwise, and those are section names.
          if (isKey) {
            admitIdentifier(acronyms, value)
            return
          }
          admitPhrase(phrases, value)
          admitIdentifier(acronyms, value)
        })
      }
    })
  }

  // --- the generated tool ---
  if (existsSync(mindmap)) {
    for (const entry of readdirSync(mindmap)) {
      if (!/^(cuas_tool|atlas)[\w.]*\.html$/i.test(entry)) continue
      harvestToolHtml(terms, phrases, acronyms, join(mindmap, entry))
    }
  }

  // --- the site graphs ---
  for (const siteId of siteIds) {
    const dir = join(sourceRepo, siteId)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue
      const graph = readJson(join(dir, entry))
      if (!Array.isArray(graph?.nodes)) continue
      admitProper(terms, graph?.graph?.name)
      admitPhrase(phrases, graph?.graph?.name)
      for (const zone of Object.values(graph.zones ?? {})) {
        admit(terms, zone?.label)
        admitProper(terms, zone?.label)
      }
      for (const node of graph.nodes) {
        admit(terms, node?.id)
        admit(terms, node?.label)
        admitProper(terms, node?.label)
      }
    }
  }

  return { terms, phrases, acronyms }
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')

/**
 * Alternations are chunked. One regex holding every harvested phrase is both
 * slow to compile and, past a few hundred kilobytes of source, liable to be
 * rejected outright by the engine, and a guard that throws is a guard that gets
 * commented out.
 */
const CHUNK = 250

function chunked(list, wrap, flags = 'gi') {
  const out = []
  for (let i = 0; i < list.length; i += CHUNK) {
    out.push(new RegExp(wrap(list.slice(i, i + CHUNK).map(escape).join('|')), flags))
  }
  return out
}

// Longest first. Regex alternation is leftmost-first, not longest-first, so in
// alphabetical order a device id shadows the label it starts, and the finding
// reads `north` where the file actually says `north gate site`.
const byLength = (a, b) => b.length - a.length || a.localeCompare(b)

const QUOTED = (body) => `(?<=["'\`])(?:${body})(?=["'\`])`

/**
 * Matchers, one per shape, because the right amount of context differs by shape.
 *
 *   terms     ids and place names read out of structured positions. Four
 *             characters or more is distinctive enough for a plain word
 *             boundary; shorter ones are a finding only when quoted, which is
 *             how they appear in the data files that matter and not how they
 *             appear by accident.
 *   acronyms  abbreviations read out of free text, matched CASE-SENSITIVELY.
 *             Real systems are abbreviated the way this repo spells ordinary
 *             words, so folding case turned a handful of them into rules that
 *             fired on a d3 module, a toolbar verb and a config key. In a
 *             quoted position they are matched case-insensitively as well,
 *             since a lower-cased id inside quotes is data, not prose.
 *   phrases   whole sentences, with runs of whitespace treated as equivalent so
 *             a formatter cannot hide one by wrapping it across two lines.
 */
export function buildNameMatchers(harvest) {
  // Accept a plain Set so a caller holding only terms still works.
  const terms = harvest instanceof Set ? harvest : (harvest?.terms ?? new Set())
  const phrases = harvest instanceof Set ? new Set() : (harvest?.phrases ?? new Set())
  const acronyms = harvest instanceof Set ? new Set() : (harvest?.acronyms ?? new Set())

  // Every matcher gets the same exemption rule. Only admit() applied it before,
  // so a phrase or an acronym could be listed in PUBLIC_VOCABULARY and still be
  // reported, which is how the crosswalk status words and the owner-group
  // labels kept failing the guard after they were deliberately allowed. An
  // exemption honoured on one path and ignored on another is worse than none:
  // it teaches the reader that the list does not work.
  const allowed = (t) => !PUBLIC_VOCABULARY.has(String(t).toLowerCase())

  const long = [...terms].filter((t) => t.length >= 4).filter(allowed).sort(byLength)
  const short = [...terms].filter((t) => t.length < 4).filter(allowed).sort(byLength)
  const acroLong = [...acronyms].filter((t) => t.length >= 4).filter(allowed).sort(byLength)
  const acroAll = [...acronyms].filter(allowed).sort(byLength)
  const whole = [...phrases].filter(allowed).sort(byLength)

  return {
    long: long.length ? new RegExp(`\\b(?:${long.map(escape).join('|')})\\b`, 'gi') : null,
    short: short.length ? new RegExp(QUOTED(short.map(escape).join('|')), 'gi') : null,
    acronyms: chunked(acroLong, (body) => `\\b(?:${body})\\b`, 'g'),
    acronymsQuoted: chunked(acroAll, QUOTED, 'gi'),
    phrases: chunked(whole, (body) => `(?<![A-Za-z0-9])(?:${body})(?![A-Za-z0-9])`),
  }
}

/**
 * The matcher groups overlap on purpose: an abbreviation inside quotes is
 * reachable by both the case-sensitive pass and the quoted case-insensitive
 * one, and a phrase can contain a term. Reporting the same span once per group
 * would triple-count a single occurrence and make a finding count meaningless,
 * so the same span found twice is one finding.
 */
function findNames(line, matchers) {
  const out = []
  const seen = new Set()
  const groups = [
    ...[matchers.long, matchers.short].filter(Boolean),
    ...(matchers.acronyms ?? []),
    ...(matchers.acronymsQuoted ?? []),
    ...(matchers.phrases ?? []),
  ]
  for (const re of groups) {
    re.lastIndex = 0
    for (const match of line.matchAll(re)) {
      const key = `${match.index}:${match[0].length}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ rule: 'name', text: match[0] })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Identity of a finding for de-duplication. Was `f.value`, which is undefined. */
const identity = (f) => `${f.rule}:${f.text.replace(/\s+/g, ' ').toLowerCase()}`

/**
 * Exported so the tests can drive the rules without building a git repo.
 *
 * `structural` is off for the two files in SELF_EXEMPT, which must be allowed
 * to contain the marking strings they match on and the addresses they plant.
 * The name rules run regardless: see the note on SELF_EXEMPT.
 */
export function scanText(text, matchers = null, { structural = true } = {}) {
  const findings = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const hits = structural ? [...findAddresses(line), ...findMarkings(line)] : []
    if (matchers) hits.push(...findNames(line, matchers))
    for (const hit of hits) findings.push({ ...hit, line: i + 1 })
  }

  // Second pass over the whole file with runs of whitespace collapsed.
  //
  // A line scan cannot see a name a formatter has wrapped. This one really
  // shipped: prettier broke a site label across two lines of JSX, so the name
  // survived a grep, this scanner, and a forbidden-term sweep built from the
  // source repo, and was only caught by eye in the built bundle where the
  // whitespace had already been collapsed.
  //
  // This pass was dead twice over. It de-duplicated on `f.value`, a field no
  // finding has, so `seen` was a set of `undefined` and the first collapsed hit
  // suppressed every one after it. And in --staged mode the caller handed it
  // one line at a time, so there was never anything to collapse. The caller now
  // passes whole files in both modes; see stagedAdditions.
  if (matchers) {
    const flat = text.replace(/\s+/g, ' ')
    const seen = new Set(findings.map(identity))
    for (const hit of findNames(flat, matchers)) {
      const key = identity(hit)
      if (seen.has(key)) continue
      seen.add(key)
      findings.push({ ...hit, line: 0, note: 'found only with whitespace collapsed' })
    }
  }
  return findings
}

/**
 * Rules 3 and 4 against a path. A filename carries content: the reference repo
 * has workbook backups whose names spell out the system ids involved in each
 * revision, and a directory is named for the site it holds. The previous
 * version scanned file bodies only, so `mysite_2026_backup.xlsx` could sit in
 * the index and report clean.
 *
 * The path is scanned twice: once as written, and once with separators turned
 * into spaces, because a phrase harvested as "north gate annex" appears in a
 * path as `north_gate_annex` and neither form matches the other.
 */
export function scanPath(path, matchers) {
  const findings = []
  const seen = new Set()
  const spaced = path.replace(/[_\-./\\]+/g, ' ')
  for (const variant of new Set([path, spaced])) {
    const hits = [...(matchers ? findNames(variant, matchers) : [])]
    for (const match of variant.matchAll(PATH_MARKING)) {
      hits.push({ rule: 'marking', text: match[1] })
    }
    for (const hit of hits) {
      const key = identity(hit)
      if (seen.has(key)) continue
      seen.add(key)
      findings.push({ rule: `path-${hit.rule}`, text: hit.text, line: 0 })
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// Rule 5: tracked binaries
// ---------------------------------------------------------------------------

/**
 * No text rule can read a PNG. The visual-regression baselines are the app
 * rendering its own bundle, which means they show the risk-keyword table and
 * the gap statements as pixels, and the previous version skipped every binary
 * wholesale, so all ten were invisible to all four rules.
 *
 * They cannot be scanned, so they are ACKNOWLEDGED instead: a tracked binary
 * must match one of these patterns or it is a finding. That converts "binaries
 * are invisible" into "a new binary is a failing build", which is the property
 * that matters, because the risk is a workbook or an export arriving in a
 * commit and nobody noticing.
 *
 * The baseline pattern enumerates the five views and the two themes rather than
 * allowing the directory wholesale, so a new rendering environment brings the
 * same ten known images and anything else, an extra screenshot, a stray export,
 * a font, fails. Whoever refreshes these is responsible for the bundle they
 * were rendered from being the synthetic one; see e2e/README.md.
 */
export const EXPECTED_BINARIES = [
  /^e2e\/__screenshots__\/[a-z0-9][a-z0-9.-]*\/(analytics|lossiness|map|network|reference)-(light|dark)\.png$/,
]

function isBinary(buffer) {
  return buffer.subarray(0, 8192).includes(0)
}

// ---------------------------------------------------------------------------
// Git plumbing
// ---------------------------------------------------------------------------

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    // This guard runs inside `npm run build`, so when git fails the build dies
    // with a raw exec stack trace from a vite webServer log and the actual
    // cause is three screens up. It has already happened once: container jobs
    // run as root over a checkout owned by the runner uid, git refuses the
    // repository, and the message that mattered was git's own suggestion.
    const detail = String(err.stderr || err.message || '').trim()
    const hint = /dubious ownership/.test(detail)
      ? '\n  Fix: git config --global --add safe.directory "$GITHUB_WORKSPACE"'
      : ''
    throw new Error(
      `the data guard could not run \`git ${args.join(' ')}\` in ${cwd}.\n` +
        `  ${detail}${hint}\n` +
        '  This is a hard failure on purpose. The guard cannot tell a clean repo ' +
        'from an unreadable one, and reporting a pass for the second is how the ' +
        'controlled dataset got committed in the first place.',
    )
  }
}

function trackedFiles(cwd) {
  return git(['ls-files', '-z'], cwd).split('\0').filter(Boolean)
}

/**
 * Added lines only, grouped by file. A pre-commit hook that also scanned
 * removed lines would fail every commit of the purge itself, which is the
 * moment the hook is most likely to be uninstalled in frustration.
 *
 * THE FILENAME COMES FROM `git diff --name-only`, NOT FROM THE `+++` HEADER.
 * The previous version read the header, and an added line whose own text began
 * with `++ /dev/null` renders in a unified diff as `+++ /dev/null`, which the
 * header branch read as "this file was deleted" and set the current file to
 * null. Every added line after it in that file was then dropped on the floor,
 * so a commit could carry anything at all as long as one line above it said
 * that. Diffing one known file at a time removes the ambiguity completely:
 * inside a hunk every line is content, and a `+++` line is just content that
 * starts with a plus.
 */
function stagedAdditions(cwd) {
  const files = git(
    ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'],
    cwd,
  )
    .split('\0')
    .filter(Boolean)

  const out = new Map()
  for (const file of files) {
    const diff = git(
      ['diff', '--cached', '--unified=0', '--no-color', '--', `:(literal)${file}`],
      cwd,
    )
    const lines = []
    let inHunk = false
    let lineNo = 0
    for (const line of diff.split('\n')) {
      // Only a real hunk header can start at column zero with `@@`: added
      // content is always prefixed with `+`, removed with `-`.
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (hunk) {
        inHunk = true
        lineNo = Number(hunk[1])
        continue
      }
      // Everything before the first hunk is the file header block, which is
      // where `+++ b/path` legitimately lives and where it is ignored.
      if (!inHunk) continue
      if (!line.startsWith('+')) continue
      lines.push({ line: lineNo, text: line.slice(1) })
      lineNo += 1
    }
    if (lines.length) out.set(file, lines)
  }
  return out
}

function report(findings) {
  for (const f of findings) {
    const note = f.note ? ` (${f.note})` : ''
    console.error(`  ✗ ${f.file}:${f.line}: ${f.rule} -> ${f.text}${note}`)
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const NO_SOURCE_REPO_HELP =
  `Rule 4 checks the tree against the real names and the real analytic phrases, ` +
  `and it can only do that with the reference repo in reach. Set it:\n\n` +
  `    export ATLAS_SOURCE_REPO=/path/to/cuas_arch\n\n` +
  `Rules 1, 2, 3 and 5 are structural and would still have run, but a commit ` +
  `that has only had the structural rules run against it is the commit that ` +
  `leaked last time. If you genuinely do not have the reference data, you are ` +
  `not the person who can paste a real phrase into this repo, and you should ` +
  `be committing from a machine that does.`

function main(argv) {
  const staged = argv.includes('--staged')
  const cwd = process.cwd()

  let matchers = null
  const sourceRepo = process.env.ATLAS_SOURCE_REPO
  if (sourceRepo) {
    if (!existsSync(sourceRepo)) {
      console.error(
        `ATLAS_SOURCE_REPO is set to ${sourceRepo}, which does not exist. ` +
          `Unset it to run the structural rules alone; leaving it wrong would ` +
          `silently downgrade the check.`,
      )
      return 1
    }
    const harvest = harvestNames(sourceRepo)
    if (harvest.terms.size === 0 && harvest.phrases.size === 0 && harvest.acronyms.size === 0) {
      console.error(
        `ATLAS_SOURCE_REPO is set to ${sourceRepo} but no reference data was ` +
          `found there. Point it at the reference repo or unset it.`,
      )
      return 1
    }
    matchers = buildNameMatchers(harvest)
  } else if (staged) {
    // The hook is the only caller that passes --staged, and it is the one place
    // where refusing costs a developer thirty seconds and buys the check that
    // actually matters. CI never takes this branch.
    console.error(`\nDATA CHECK REFUSED: ATLAS_SOURCE_REPO is not set.\n`)
    console.error(NO_SOURCE_REPO_HELP)
    return 1
  }

  const findings = []
  const tracked = trackedFiles(cwd)

  // Rule 1. Independent of file contents: the bundle is generated, so its
  // presence in the index is the finding.
  for (const file of tracked) {
    if (file.startsWith(DATA_DIR) && !DATA_DIR_ALLOWED.has(file)) {
      findings.push({ rule: 'tracked-bundle', file, line: 0, text: 'generated bundle is tracked' })
    }
  }

  // Rules 3, 4 and 5 against the paths themselves, in both modes, because
  // `git ls-files` reads the index and the index is what is about to be
  // committed. A path is not exempt just because the file it names is.
  for (const file of tracked) {
    for (const hit of scanPath(file, matchers)) findings.push({ ...hit, file })
    if (!existsSync(file)) continue
    if (!isBinary(readFileSync(file))) continue
    if (EXPECTED_BINARIES.some((re) => re.test(file))) continue
    findings.push({
      rule: 'unexpected-binary',
      file,
      line: 0,
      text: 'tracked binary is not an expected artifact and cannot be scanned',
    })
  }

  const exempt = new Set(SELF_EXEMPT)
  if (staged) {
    for (const [file, lines] of stagedAdditions(cwd)) {
      // Whole added text at once, not line by line, so the whitespace-collapse
      // pass has something to collapse. The map back to real line numbers keeps
      // the report pointing at the file the developer is looking at.
      const text = lines.map((l) => l.text).join('\n')
      const numbers = lines.map((l) => l.line)
      for (const hit of scanText(text, matchers, { structural: !exempt.has(file) })) {
        findings.push({ ...hit, file, line: hit.line === 0 ? 0 : (numbers[hit.line - 1] ?? 0) })
      }
    }
  } else {
    for (const file of tracked) {
      if (!existsSync(file)) continue
      const buffer = readFileSync(file)
      if (isBinary(buffer)) continue
      for (const hit of scanText(buffer.toString('utf-8'), matchers, {
        structural: !exempt.has(file),
      })) {
        findings.push({ ...hit, file })
      }
    }
  }

  if (findings.length) {
    console.error(`\n${findings.length} finding(s):`)
    report(findings)
    console.error(
      `\nDATA CHECK FAILED. This repo carries a synthetic sample bundle and ` +
        `nothing else. If a finding is wrong, widen a rule in ` +
        `scripts/check-no-real-data.mjs and say why in the diff. Do not skip ` +
        `the hook.`,
    )
    return 1
  }

  const scope = staged ? 'staged changes' : `${tracked.length} tracked file(s)`
  const names = matchers ? 'structural and name rules' : 'structural rules only'
  console.log(`Data check passed: ${scope}, ${names}.`)
  if (!matchers) {
    // Said out loud, every time. A quiet skip is what let a green CI job read
    // as coverage for a rule it has never once run.
    console.warn(
      `\nWARNING: rule 4 did NOT run. Real entity names and real analytic ` +
        `phrases were NOT checked, because ATLAS_SOURCE_REPO is not set and ` +
        `this environment has no reference data. This run proves nothing about ` +
        `whether real content is present. Rule 4 runs in the pre-commit hook, ` +
        `which refuses to run without it.`,
    )
  }
  return 0
}

// Run as a CLI, stay quiet when imported by the tests. If this comparison ever
// stops matching, every subprocess test in scripts/__tests__ fails at once,
// which is the point of testing the binary rather than the exports.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
