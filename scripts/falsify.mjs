#!/usr/bin/env node
/**
 * Prove the visual harness can fail.
 *
 * A test suite that has never been seen to go red is a suite nobody has any
 * evidence about. This one had two confirmed ways of passing vacuously: it
 * compared a stale page against stale baselines and agreed with itself, and
 * every baseline it looked for in CI was missing, written on the spot and
 * trusted by the next run. Both reported success.
 *
 * So each known regression gets injected here, one at a time, and the suite
 * has to notice. A mutation the suite does not catch is reported NOT CAUGHT and
 * the script exits 1. A mutation whose anchor no longer matches the source, or
 * which names a test that no longer exists, is reported STALE and also exits 1,
 * because a falsifier that silently no-ops when the code drifts reproduces the
 * vacuous-green problem one level up. A run whose report cannot be read is
 * reported NO REPORT and exits 2: that is broken plumbing, and it says nothing
 * at all about what the suite can see.
 *
 * Usage:
 *   npm run falsify                 every mutation, only the tests it claims to break
 *   npm run falsify -- --full       every mutation against the whole suite
 *   npm run falsify -- --only H1    one mutation by id
 *   npm run falsify -- --list       print the mutation table and exit
 *   npm run falsify -- --restore    restore from a journal left by a killed run
 *
 * The tree is restored in four layers, because the first two do not survive
 * `kill -9`: in-memory buffers restored in a finally, synchronous signal
 * handlers, an on-disk journal written before the first byte changes, and a
 * sha256 verification pass that refuses to exit quietly if anything is off.
 * Nothing here ever runs git: the journal carries the original bytes, so
 * restoration is exact and needs no version control to be correct.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Deliberately not under test-results/: Playwright empties that directory at
// the start of every run, which would take the journal with it exactly when it
// is needed. node_modules/.cache is gitignored and nothing else touches it.
const SCRATCH =
  process.env.ATLAS_FALSIFY_SCRATCH ?? join(ROOT, 'node_modules', '.cache', 'atlas-falsify')
const JOURNAL = join(SCRATCH, 'journal.json')
const LOCK = join(SCRATCH, 'falsify.lock')
// Written by the child's own json reporter, via PLAYWRIGHT_JSON_OUTPUT_NAME,
// rather than scraped off its stdout. See runSuite.
const REPORT = join(SCRATCH, 'report.json')
const SNAPSHOTS = join(ROOT, 'e2e', '__screenshots__')

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const rel = (path) => path.replace(`${ROOT}/`, '')

/* ------------------------------------------------------------------ *
 * The mutation table.
 *
 * `find` is an exact literal that must occur exactly once in the file.
 * `expect` names the tests that must fail. Exit codes are not enough on
 * their own: a run that dies because the preview never bound is also
 * non-zero and proves nothing, so the named tests have to be among the
 * failures.
 * ------------------------------------------------------------------ */
const MUTATIONS = [
  {
    id: 'H1',
    tier: 'harness',
    what: 'a baseline goes missing',
    kind: 'baseline-missing',
    target: 'map-dark.png',
    // The inventory gate is what catches this, by design: it runs in the setup
    // project so nothing downstream can be written from a page compared against
    // an incomplete set. The second half of the requirement, that the run never
    // writes the baseline it could not find, is checked directly below rather
    // than inferred from a test result.
    expect: ['every baseline this environment compares against exists'],
    verify: ({ snapshotPath }) =>
      existsSync(snapshotPath)
        ? 'the run wrote the missing baseline instead of failing on it'
        : null,
  },
  {
    id: 'H2',
    tier: 'harness',
    what: 'a baseline outlives the test behind it',
    kind: 'baseline-orphan',
    target: 'ghost-dark.png',
    expect: ['every baseline this environment compares against exists'],
  },
  {
    id: 'H3',
    tier: 'harness',
    what: 'the page under test is not the build this run produced',
    kind: 'stale-server',
    expect: ['the page under test is the build this run produced'],
  },
  {
    id: 'H4',
    tier: 'harness',
    what: 'the build stamp stops being emitted',
    kind: 'source',
    file: 'vite.config.ts',
    find: "          attrs: { name: 'atlas-build', content: buildId },",
    replace: "          attrs: { name: 'atlas-build-disabled', content: buildId },",
    expect: ['the page under test is the build this run produced'],
  },
  {
    id: 'A1',
    tier: 'app',
    what: 'the map toolbar loses a control',
    kind: 'source',
    file: 'src/tabs/map/MapToolbar.tsx',
    find:
      "  { key: 'grid', label: 'Grid', hint: 'Snap nodes to aligned columns. Auto-enables Clean' },\n",
    replace: '',
    expect: ['map: Map controls still carries every control', 'map renders in dark'],
  },
  {
    id: 'A2',
    tier: 'app',
    what: 'the theme toggle ignores its argument, so both baselines render dark',
    kind: 'source',
    file: 'src/lib/theme.ts',
    find: "  document.documentElement.setAttribute('data-theme', theme)",
    replace: "  document.documentElement.setAttribute('data-theme', 'dark')",
    expect: ['the two themes are actually different', 'reference renders in light'],
  },
  {
    id: 'A3',
    tier: 'app',
    what: 'the radial layout collapses onto the origin',
    kind: 'source',
    file: 'src/viz/radial.ts',
    find: 'export const GAP = [0, 300, 280, 260, 240]',
    replace: 'export const GAP = [0, 0, 0, 0, 0]',
    expect: [
      'the orientation map draws its nodes away from the origin',
      'map renders in dark',
    ],
  },
  {
    id: 'A4',
    tier: 'app',
    what: 'the zero-size zoom guard is removed, so 1/k fills the SVG with Infinity',
    kind: 'source',
    file: 'src/viz/zoom.ts',
    find:
      '  if (!size.width || !size.height) return null\n' +
      '  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return null\n',
    replace: '',
    secondary: {
      find: '  if (!Number.isFinite(k) || k <= 0) return null',
      replace: '  if (!Number.isFinite(k)) return null',
    },
    // Measured, not assumed. With both guard lines gone the 1/k = Infinity path
    // still does not reach the DOM, so the raw NaN scan stays green and the
    // Infinity case is covered directly by src/viz/__tests__/zoom.test.ts.
    // The screenshots catch the map, where a lost guard visibly wrecks the
    // layout. The topology instead renders a plausible picture at a rescued
    // scale(1) with all 71 devices drawn, which no screenshot and no NaN scan
    // can distinguish from a correct one. safeScale marks the DOM for exactly
    // that case, and the scan below is what reads the mark, so it belongs here:
    // without it this mutation was only ever half seen.
    expect: [
      'map renders in dark',
      'no tab emits NaN or Infinity into the DOM',
    ],
  },
  {
    id: 'A5',
    tier: 'app',
    // The regression that actually happened. Tailwind 4 emits variables only
    // for namespaces it recognises, so the whole --node-* block silently
    // vanishes from inside @theme and every node on the map renders black.
    what: 'the node colour block moves back inside @theme, so the map draws black nodes',
    kind: 'source',
    file: 'src/styles/tokens.css',
    find: ':root {\n  /* Orientation map node colours',
    replace: '@theme {\n  /* Orientation map node colours',
    expect: ['map renders in dark'],
  },
  {
    id: 'A6',
    tier: 'app',
    what: 'a map stat tile counts the wrong thing',
    kind: 'source',
    file: 'src/tabs/map/MapTab.tsx',
    find: "      { label: 'Confirmed', value: systems.filter((s) => s.confirmed).length },",
    replace: "      { label: 'Confirmed', value: systems.filter((s) => !s.confirmed).length },",
    expect: ['the map stat tiles agree with the manifest'],
  },
  {
    id: 'A7',
    tier: 'app',
    // The regression that shipped, and the reason this table is not evidence of
    // much on its own: it printed "all 10 caught" while this exact deletion was
    // live in the tree. The strip is a two-column grid, so removing its only
    // action empties a cell and reflows nothing else. That is 33 pixels dark
    // and 35 light, which passed under the old cap of 100, and no inventory
    // test looked at anything but MapToolbar. Both halves of that are fixed:
    // the cap is 0 and every control group on the graph tabs is inventoried.
    what: 'the network view strip loses its Fit action',
    kind: 'source',
    file: 'src/tabs/network/NetworkTab.tsx',
    find:
      "    { label: 'Fit', title: 'Fit the whole topology (F)', onClick: () => setFitNonce((n) => n + 1) },\n",
    replace: '',
    expect: [
      'network: View controls still carries every control',
      'network renders in dark',
    ],
  },
]

/* ------------------------------------------------------------------ *
 * Restoration
 * ------------------------------------------------------------------ */

/** file path -> original bytes, for everything this run has touched. */
const held = new Map()
let restoring = false

function journalWrite() {
  mkdirSync(SCRATCH, { recursive: true })
  writeFileSync(
    JOURNAL,
    JSON.stringify(
      {
        pid: process.pid,
        started: new Date().toISOString(),
        files: [...held].map(([file, original]) => ({
          file,
          sha256: sha(original),
          original,
        })),
      },
      null,
      2,
    ),
  )
}

/** Remember a file's bytes before the first time it is changed. */
function hold(file) {
  const path = join(ROOT, file)
  if (!held.has(file)) {
    held.set(file, readFileSync(path, 'utf-8'))
    journalWrite()
  }
  return path
}

/**
 * Put every held file back, byte for byte, and prove it.
 *
 * Synchronous throughout: an async restore inside a signal handler gets cut
 * off part way, which is the one outcome worse than not restoring at all.
 */
function restore({ verbose = true } = {}) {
  if (restoring) return true
  restoring = true
  let ok = true
  for (const [file, original] of held) {
    const path = join(ROOT, file)
    try {
      writeFileSync(path, original)
      if (sha(readFileSync(path, 'utf-8')) !== sha(original)) ok = false
    } catch (error) {
      ok = false
      console.error(`  restore FAILED for ${file}: ${error.message}`)
    }
  }
  restoreSnapshots()
  if (ok) {
    if (existsSync(JOURNAL)) rmSync(JOURNAL)
    if (verbose && held.size) console.log(`\nrestored ${held.size} file(s), verified by sha256`)
  } else {
    console.error(
      `\nRESTORE INCOMPLETE. The original bytes are in ${JOURNAL}.\n` +
        `Run \`npm run falsify -- --restore\`, or restore those files by hand.\n` +
        `This script deliberately does not run git, so nothing it does can ` +
        `discard work it did not make.`,
    )
  }
  restoring = false
  return ok
}

/** Baseline files this run moved aside or invented, tracked separately. */
const snapshotMoves = []

function restoreSnapshots() {
  while (snapshotMoves.length) {
    const move = snapshotMoves.pop()
    try {
      if (move.kind === 'moved' && existsSync(move.to)) renameSync(move.to, move.from)
      if (move.kind === 'created' && existsSync(move.path)) rmSync(move.path)
    } catch (error) {
      console.error(`  snapshot restore FAILED: ${error.message}`)
    }
  }
}

function restoreFromJournal() {
  if (!existsSync(JOURNAL)) {
    console.log('no journal to restore from')
    return true
  }
  const journal = JSON.parse(readFileSync(JOURNAL, 'utf-8'))
  console.log(`restoring ${journal.files.length} file(s) from a journal left at ${journal.started}`)
  let ok = true
  for (const entry of journal.files) {
    const path = join(ROOT, entry.file)
    writeFileSync(path, entry.original)
    if (sha(readFileSync(path, 'utf-8')) !== entry.sha256) {
      ok = false
      console.error(`  ${entry.file}: restored bytes do not match the journal`)
    } else {
      console.log(`  ${entry.file}`)
    }
  }
  if (ok) rmSync(JOURNAL)
  return ok
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    console.error(`\n${signal} received, restoring before exit`)
    restore()
    releaseLock()
    process.exit(130)
  })
}
process.on('uncaughtException', (error) => {
  console.error(`\nuncaught: ${error.stack}`)
  restore()
  releaseLock()
  process.exit(1)
})
process.on('unhandledRejection', (error) => {
  console.error(`\nunhandled rejection: ${error}`)
  restore()
  releaseLock()
  process.exit(1)
})

/* ------------------------------------------------------------------ *
 * Preconditions
 * ------------------------------------------------------------------ */

function takeLock() {
  mkdirSync(SCRATCH, { recursive: true })
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, 'utf-8'))
    let alive = false
    try {
      process.kill(pid, 0)
      alive = true
    } catch {
      alive = false
    }
    if (alive) {
      console.error(
        `another falsify run (pid ${pid}) is mutating the same files. Wait for it, ` +
          `or kill it and run \`npm run falsify -- --restore\`.`,
      )
      process.exit(1)
    }
    rmSync(LOCK)
  }
  writeFileSync(LOCK, String(process.pid))
}

function releaseLock() {
  try {
    if (existsSync(LOCK)) rmSync(LOCK)
  } catch {
    /* nothing useful to do while exiting */
  }
}

function preflight(selected) {
  if (existsSync(JOURNAL)) {
    console.error(
      `A journal from a previous run is at ${JOURNAL}. That run did not finish ` +
        `restoring. Run \`npm run falsify -- --restore\` first.`,
    )
    process.exit(1)
  }

  // The single worst outcome of this script would be baselines rewritten from
  // a mutated build. Refuse if anything in argv could ask for that.
  const forbidden = process.argv.some((a) => a === '-u' || a.startsWith('--update-snapshots'))
  if (forbidden) {
    console.error('falsify never updates snapshots. Drop -u / --update-snapshots.')
    process.exit(1)
  }

  for (const mutation of selected) {
    if (mutation.kind !== 'source') continue
    const path = join(ROOT, mutation.file)
    if (!existsSync(path)) {
      console.error(`${mutation.id}: ${mutation.file} does not exist`)
      process.exit(1)
    }
  }

  if (!existsSync(SNAPSHOTS)) {
    console.error(
      `No baselines at ${SNAPSHOTS}. Generate them first, or the suite will be ` +
        `failing for a reason that has nothing to do with the mutations.`,
    )
    process.exit(1)
  }

  // Taken before anything is touched, so the first comparison is against the
  // pristine set rather than against whatever the first mutation left behind.
  baselineFingerprint = fingerprintDir(SNAPSHOTS)
}

/** Count of non-overlapping occurrences of an exact literal. */
function occurrences(text, needle) {
  let count = 0
  let index = text.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = text.indexOf(needle, index + needle.length)
  }
  return count
}

/* ------------------------------------------------------------------ *
 * Applying and running
 * ------------------------------------------------------------------ */

function applySource(mutation) {
  const path = hold(mutation.file)
  let text = readFileSync(path, 'utf-8')
  const edits = [{ find: mutation.find, replace: mutation.replace }]
  if (mutation.secondary) edits.push(mutation.secondary)

  for (const edit of edits) {
    const found = occurrences(text, edit.find)
    if (found !== 1) {
      return {
        stale: `anchor occurs ${found} time(s) in ${mutation.file}, expected exactly 1`,
      }
    }
    text = text.replace(edit.find, edit.replace)
  }
  writeFileSync(path, text)
  return {}
}

function applyBaseline(mutation) {
  // Key on the environment this run will actually compare against, not on
  // "the only directory present". Once a second environment is committed, and
  // CI commits one, an exactly-one check reports STALE for a harness that is
  // working perfectly, which reads as a defect and trains people to ignore it.
  const env = process.env.ATLAS_RENDER_ENV ?? `${process.platform}-${process.arch}`
  const envs = readdirSync(SNAPSHOTS)
  if (!envs.includes(env)) {
    return {
      stale: `no baselines for "${env}"; found ${envs.join(', ') || 'none'}`,
    }
  }
  const dir = join(SNAPSHOTS, env)
  const path = join(dir, mutation.target)

  if (mutation.kind === 'baseline-missing') {
    if (!existsSync(path)) return { stale: `${rel(path)} is not there to remove` }
    const to = join(SCRATCH, mutation.target)
    mkdirSync(SCRATCH, { recursive: true })
    renameSync(path, to)
    snapshotMoves.push({ kind: 'moved', from: path, to })
    return { snapshotPath: path }
  }

  if (existsSync(path)) return { stale: `${rel(path)} already exists` }
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  snapshotMoves.push({ kind: 'created', path })
  return { snapshotPath: path }
}

/**
 * Run the suite and report which of the named tests failed.
 *
 * --update-snapshots=none is passed explicitly on every child, belt and braces
 * over the config default, so a mutated build can never author a baseline.
 */
function childEnv(extra = {}) {
  const env = { ...process.env, ATLAS_FALSIFY: '1', ...extra }
  // Deleted, not blanked: e2e/env.ts uses `??=`, and an empty string is
  // neither null nor undefined, so a blank would survive and the child would
  // test against a build id of "".
  if (env.ATLAS_BUILD_ID === undefined || env.ATLAS_BUILD_ID === '')
    delete env.ATLAS_BUILD_ID
  delete env.ATLAS_E2E_URL
  return env
}

function runSuite(mutation, { full, extraEnv = {} }) {
  const args = ['playwright', 'test', '--update-snapshots=none', `--reporter=json`]
  if (!full && mutation.expect.length) {
    args.push('-g', mutation.expect.map((t) => escapeForGrep(t)).join('|'))
  }

  // Stale bytes from the previous mutation must never be read as this one's
  // result, so the file is gone before the child can write it.
  rmSync(REPORT, { force: true })

  const result = spawnSync('npx', args, {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    // A fresh id per child, so the identity assertion is exercised each time
    // rather than inheriting one from the parent.
    //
    // The report goes to a file, not down stdout. Scraping stdout meant one
    // stray write ahead of the JSON broke the parse, and a single console.log
    // left in playwright.config.ts was enough to do it. The old code swallowed
    // the parse error and returned an empty failure list, so every mutation
    // read as NOT CAUGHT and the script announced that the suite could not see
    // any of them. Set last, after extraEnv, so nothing can redirect it.
    env: childEnv({ ...extraEnv, PLAYWRIGHT_JSON_OUTPUT_NAME: REPORT }),
  })

  const tail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-4000)

  // A report that cannot be read is a broken harness, not a suite that failed
  // to notice something. The caller must not be allowed to confuse the two.
  if (!existsSync(REPORT)) {
    return {
      failedTitles: [],
      skippedTitles: [],
      exitCode: result.status,
      unreadable: `the child wrote no report to ${rel(REPORT)}`,
      raw: tail,
    }
  }
  let report
  try {
    report = JSON.parse(readFileSync(REPORT, 'utf-8'))
  } catch (error) {
    return {
      failedTitles: [],
      skippedTitles: [],
      exitCode: result.status,
      unreadable: `${rel(REPORT)} is not valid JSON: ${error.message}`,
      raw: tail,
    }
  }

  const failedTitles = []
  const skippedTitles = []
  const seenTitles = new Set()
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      seenTitles.add(spec.title)
      const statuses = (spec.tests ?? []).map((t) => t.status)
      // "unexpected" and "flaky" are failures. "skipped" is not: a test blocked
      // by a failing dependency reports skipped, and counting that as a failure
      // would credit this script with catching a regression through a test that
      // never ran. That is the same self-agreeing mistake the suite is being
      // fixed for.
      if (statuses.some((s) => s === 'unexpected' || s === 'flaky')) {
        failedTitles.push(spec.title)
      } else if (statuses.length && statuses.every((s) => s === 'skipped')) {
        skippedTitles.push(spec.title)
      }
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of report.suites ?? []) walk(suite)

  // A report with no tests in it is the shape a run takes when the preview
  // never bound or the config threw: real JSON, zero evidence. Left to the
  // check below it would read as every expected test having been renamed.
  if (seenTitles.size === 0) {
    const errors = (report.errors ?? []).map((e) => e.message ?? String(e)).join(' | ')
    return {
      failedTitles: [],
      skippedTitles: [],
      exitCode: result.status,
      unreadable: `the run collected no tests${errors ? `: ${errors}` : ''}`,
      raw: tail,
    }
  }

  // A test this mutation claims to break but which no longer exists under that
  // title reads as NOT CAUGHT, which is a lie: nothing ran. Same failure as a
  // drifted source anchor, and reported the same way.
  const missingTitles = mutation.expect.filter((title) => !seenTitles.has(title))

  return { failedTitles, skippedTitles, missingTitles, exitCode: result.status }
}

function escapeForGrep(title) {
  return title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * H3: serve a build this run did not produce.
 *
 * Builds once with one id, then runs the suite with a different id and a server
 * command that only serves what is already on disk. That is the exact shape of
 * the original defect, minus the accident: the page in the browser is real, it
 * is just not this run's build.
 */
function runStaleServer(mutation) {
  execFileSync('npm', ['run', 'build'], {
    cwd: ROOT,
    stdio: 'pipe',
    env: { ...process.env, ATLAS_BUILD_ID: 'falsify-stale-build' },
  })
  return runSuite(mutation, {
    full: false,
    extraEnv: {
      ATLAS_FALSIFY_SERVER_CMD:
        'npm run preview -- --host 127.0.0.1 --port 0 --strictPort',
    },
  })
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--list')) {
    for (const m of MUTATIONS) {
      console.log(`${m.id.padEnd(4)} ${m.tier.padEnd(8)} ${m.what}`)
      console.log(`     expects: ${m.expect.join(', ')}`)
    }
    return 0
  }
  if (argv.includes('--restore')) return restoreFromJournal() ? 0 : 1

  const full = argv.includes('--full')
  const onlyIndex = argv.indexOf('--only')
  const only = onlyIndex === -1 ? null : argv[onlyIndex + 1]
  const selected = only ? MUTATIONS.filter((m) => m.id === only) : MUTATIONS
  if (!selected.length) {
    console.error(`no mutation with id "${only}"`)
    return 1
  }

  takeLock()
  preflight(selected)

  console.log(
    `falsifying ${selected.length} regression(s), ` +
      `${full ? 'whole suite' : 'named tests only'}\n`,
  )

  const results = []
  try {
    for (const mutation of selected) {
      process.stdout.write(`${mutation.id}  ${mutation.what}\n`)

      let applied = {}
      if (mutation.kind === 'source') applied = applySource(mutation)
      else if (mutation.kind.startsWith('baseline-')) applied = applyBaseline(mutation)

      if (applied.stale) {
        console.log(`     STALE: ${applied.stale}\n`)
        results.push({ ...mutation, verdict: 'STALE', detail: applied.stale })
        restore({ verbose: false })
        held.clear()
        continue
      }

      const run =
        mutation.kind === 'stale-server'
          ? runStaleServer(mutation)
          : runSuite(mutation, { full })

      // No report means no evidence, in either direction. Saying NOT CAUGHT
      // here would be an accusation against the suite for something the child
      // process did, which is how a stray write into stdout once produced
      // "10 of 10 regressions were not caught".
      if (run.unreadable) {
        console.log(`     NO REPORT: ${run.unreadable}`)
        if (run.raw) console.log(`     output tail:\n${run.raw}`)
        console.log()
        results.push({ ...mutation, verdict: 'NO REPORT', detail: run.unreadable })
        restore({ verbose: false })
        held.clear()
        restoreSnapshots()
        assertBaselinesUntouched()
        continue
      }

      // A named test that no longer exists is drift in this table, the same as
      // a source anchor that stopped matching, and gets the same verdict.
      if (run.missingTitles?.length) {
        const detail = `expects tests that no longer exist: ${run.missingTitles.join(', ')}`
        console.log(`     STALE: ${detail}\n`)
        results.push({ ...mutation, verdict: 'STALE', detail })
        restore({ verbose: false })
        held.clear()
        restoreSnapshots()
        assertBaselinesUntouched()
        continue
      }

      const caught = mutation.expect.filter((title) => run.failedTitles.includes(title))
      const missed = mutation.expect.filter((title) => !run.failedTitles.includes(title))
      const extra = run.failedTitles.filter((title) => !mutation.expect.includes(title))

      // Some mutations have a second thing to prove beyond "a test went red",
      // such as the run not having written the baseline it could not find.
      const sideEffect = mutation.verify?.(applied) ?? null

      let verdict
      if (sideEffect) verdict = 'NOT CAUGHT'
      else if (caught.length === mutation.expect.length) verdict = 'CAUGHT'
      else if (caught.length > 0) verdict = 'PARTIAL'
      else verdict = 'NOT CAUGHT'
      if (sideEffect) console.log(`     side effect: ${sideEffect}`)

      const label =
        verdict === 'CAUGHT' && full && extra.length ? 'CAUGHT (over-triggered)' : verdict
      console.log(`     ${label} by: ${caught.join(', ') || '(nothing)'}`)
      if (missed.length) {
        const blocked = missed.filter((t) => run.skippedTitles.includes(t))
        console.log(`     missed: ${missed.join(', ')}`)
        if (blocked.length) {
          console.log(`     (blocked by an earlier failure, never ran: ${blocked.join(', ')})`)
        }
      }
      if (full && extra.length) console.log(`     also failed: ${extra.join(', ')}`)
      if (run.note) console.log(`     note: ${run.note}`)
      if (verdict === 'NOT CAUGHT' && run.raw) console.log(`     output tail:\n${run.raw}`)
      console.log()

      results.push({ ...mutation, verdict, caught, missed, extra })

      // Restore before the next mutation, so no two are ever live at once.
      restore({ verbose: false })
      held.clear()
      restoreSnapshots()

      // A mutated build must never have authored a baseline.
      assertBaselinesUntouched()
    }
  } finally {
    restore()
    releaseLock()
  }

  console.log('─'.repeat(72))
  for (const r of results) console.log(`${r.verdict.padEnd(11)} ${r.id}  ${r.what}`)
  console.log('─'.repeat(72))

  // Three different things, and reporting them as one number is what made the
  // last failure unreadable. Broken plumbing proves nothing about the suite;
  // drift proves nothing about it either; only a mutation that ran and was
  // missed is a statement about what the suite can see.
  const broken = results.filter((r) => r.verdict === 'NO REPORT')
  const stale = results.filter((r) => r.verdict === 'STALE')
  const missed = results.filter((r) => r.verdict === 'NOT CAUGHT' || r.verdict === 'PARTIAL')

  if (broken.length) {
    console.log(
      `\n${broken.length} of ${results.length} run(s) produced no readable report, so ` +
        `nothing was proved either way. Fix this script or the child command ` +
        `before reading anything else above.`,
    )
  }
  if (stale.length) {
    console.log(
      `\n${stale.length} of ${results.length} mutation(s) no longer match the code they ` +
        `describe. Update the table; a mutation that cannot be applied tests nothing.`,
    )
  }
  if (missed.length) {
    console.log(
      `\n${missed.length} of ${results.length} regressions were not caught. ` +
        `The suite cannot see them, so a green run does not rule them out.`,
    )
  }
  if (broken.length) return 2
  if (stale.length || missed.length) return 1
  console.log(`\nall ${results.length} regressions caught`)
  return 0
}

/**
 * The baselines must be exactly as they were before the child ran.
 *
 * If a mutated build ever authored one, everything downstream is poisoned and
 * stopping now is the only safe move.
 */
let baselineFingerprint = null
function assertBaselinesUntouched() {
  if (fingerprintDir(SNAPSHOTS) !== baselineFingerprint) {
    console.error(
      '\nA child run modified the baselines. That should be impossible with ' +
        'updateSnapshots "none". Stopping with the journal intact.',
    )
    process.exit(1)
  }
}

function fingerprintDir(dir) {
  const hash = createHash('sha256')
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) walk(full)
      else hash.update(entry.name).update(readFileSync(full))
    }
  }
  walk(dir)
  return hash.digest('hex')
}

process.exit(main())
