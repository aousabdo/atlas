#!/usr/bin/env node
/**
 * Assert a container image's web root carries the sample bundle and nothing else.
 *
 * scripts/check-no-real-data.mjs guards the repository: it reads `git ls-files`,
 * so it answers for what is committed and for nothing that is not. An image is
 * built from a directory, and on a developer's machine public/data is where the
 * README tells an analyst to build the real bundle. Built there, an image would
 * carry that bundle into a registry, which is harder to spot than a commit and
 * harder to claw back (technical plan, risk 12).
 *
 * The Dockerfile already keeps public/data out of the build context and seeds
 * the bundle from fixtures/synthetic inside the build. This is the check that
 * does not take the Dockerfile's word for it. CI copies the web root out of the
 * finished image and runs this over it, so what is asserted is what would be
 * shipped, after every stage and every COPY has had its say.
 *
 * The rule is byte equality with fixtures/synthetic, not a slug check. A slug
 * is one field a writer can copy; the systems file next to it is where the
 * controlled content sits. Every file under data/ must be a sample file with
 * the sample's bytes, every sample file must be there, and the only extra
 * allowed is the empty .gitkeep that seed-data.mjs leaves for vite to copy.
 *
 * Two more rules, both about the web root as a whole:
 *
 *   - no workbook or graph export anywhere (the .gitignore categories), since
 *     those files are the raw controlled material itself
 *   - no .env file anywhere, since public/ is copied into the output wholesale
 *     and the server would hand it to anyone who asked for it by name
 *   - no CNAME, because it pins the GitHub Pages host and the image is meant to
 *     run at whatever host the chart is given
 *
 *   node scripts/check-image-data.mjs <web-root>
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SAMPLE = join(REPO, 'fixtures', 'synthetic')

/** Same list as .gitignore's "raw controlled material" block. */
const RAW_MATERIAL = /\.(xlsx|xlsm|xls|gexf|graphml)$/i

/** Files that pin a deployment to one host. */
const HOST_PINNING = new Set(['CNAME'])

/** Environment files, by name, wherever they sit. */
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/

/** Every file under `dir`, as forward-slash paths relative to it. */
function filesUnder(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  walk(dir)
  return out.sort()
}

function sampleSlug() {
  return JSON.parse(readFileSync(join(SAMPLE, 'project.json'), 'utf-8')).slug
}

/** The slug a project.json claims, or a description of why there is none. */
function slugOf(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))?.slug ?? '(no slug)'
  } catch {
    return '(does not parse)'
  }
}

export function checkWebroot(root, sample = SAMPLE) {
  const findings = []
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [`${root} does not exist or is not a directory, so there is nothing to check`]
  }

  for (const file of filesUnder(root)) {
    if (RAW_MATERIAL.test(file)) {
      findings.push(`${file}: a workbook or graph export, which is the raw source material itself`)
    }
    if (ENV_FILE.test(file)) {
      findings.push(`${file}: an environment file, which would be served to anyone who asked for it`)
    }
    if (HOST_PINNING.has(file)) {
      findings.push(
        `${file}: pins the GitHub Pages host. The image is host-agnostic; the host is a chart value`,
      )
    }
  }

  const data = join(root, 'data')
  if (!existsSync(data) || !statSync(data).isDirectory()) {
    findings.push(
      'no data/ directory in the web root. Nothing to compare is not the same as ' +
        'nothing wrong: the layout moved, and this check has to move with it',
    )
    return findings
  }

  const expected = new Set(filesUnder(sample))
  const present = filesUnder(data)
  const slug = sampleSlug()

  for (const file of present) {
    const shown = `data/${file}`
    if (file === '.gitkeep') {
      if (statSync(join(data, file)).size !== 0) {
        findings.push(`${shown}: expected the empty placeholder seed-data.mjs writes, found content`)
      }
      continue
    }
    if (!expected.has(file)) {
      findings.push(`${shown}: not in the sample bundle (fixtures/synthetic)`)
      continue
    }
    const got = readFileSync(join(data, file))
    if (!got.equals(readFileSync(join(sample, file)))) {
      const claim =
        file === 'project.json' ? `, and it names project "${slugOf(join(data, file))}" not "${slug}"` : ''
      findings.push(`${shown}: differs from fixtures/synthetic/${file}${claim}`)
    }
  }

  const seen = new Set(present)
  for (const file of expected) {
    if (!seen.has(file)) findings.push(`data/${file}: in the sample bundle but missing from the image`)
  }

  return findings
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2]
  if (!target) {
    console.error('usage: node scripts/check-image-data.mjs <web-root>')
    process.exit(2)
  }
  const root = resolve(target)
  const findings = checkWebroot(root)
  if (findings.length) {
    console.error(`\nIMAGE DATA CHECK FAILED for ${root}: ${findings.length} finding(s).`)
    for (const finding of findings) console.error(`  ✗ ${finding}`)
    console.error(
      '\nThe image ships the invented sample bundle and nothing else. Build it in ' +
        'CI from a clean checkout; never from a machine whose public/data holds a ' +
        'real bundle.',
    )
    process.exit(1)
  }
  const count = filesUnder(join(root, 'data')).filter((f) => f !== '.gitkeep').length
  console.log(
    `Image data check passed: ${count} data file(s) are the sample bundle ` +
      `(${sampleSlug()}) byte for byte, and nothing else ships beside them.`,
  )
}
