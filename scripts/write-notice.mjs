#!/usr/bin/env node
/**
 * Write the handling notice into the documents from the one place it lives.
 *
 * The alternative was pasting it into README.md and docs/data-inputs.md by
 * hand, which is how a disclaimer ends up saying three different things and
 * the oldest copy is the one somebody quotes back at you. The blocks below are
 * delimited by HTML comments and rewritten in place; a test runs this with
 * --check and fails if either document has drifted from src/lib/notice.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BEGIN = '<!-- notice:begin -->'
const END = '<!-- notice:end -->'
const TARGETS = ['README.md', 'docs/data-inputs.md']

const { noticeMarkdown } = await import(join(ROOT, 'src', 'lib', 'notice.ts'))

let drifted = []
for (const rel of TARGETS) {
  const path = join(ROOT, rel)
  const text = readFileSync(path, 'utf-8')
  const from = text.indexOf(BEGIN)
  const to = text.indexOf(END)
  if (from < 0 || to < 0) {
    throw new Error(`${rel}: no ${BEGIN} / ${END} block to write into`)
  }
  const wanted = `${BEGIN}\n${noticeMarkdown()}\n${END}`
  const current = text.slice(from, to + END.length)
  if (current === wanted) continue
  drifted.push(rel)
  if (!process.argv.includes('--check')) {
    writeFileSync(path, text.slice(0, from) + wanted + text.slice(to + END.length))
  }
}

if (process.argv.includes('--check')) {
  if (drifted.length) {
    console.error(
      `The handling notice has drifted from src/lib/notice.ts in: ${drifted.join(', ')}\n` +
        'Run `npm run notice` to rewrite them.',
    )
    process.exit(1)
  }
  console.log('Handling notice is current in every document.')
} else {
  console.log(drifted.length ? `Rewrote the notice in ${drifted.join(', ')}` : 'Notice already current.')
}
