import { randomUUID } from 'node:crypto'

/**
 * Identity of the build under test, minted once per run.
 *
 * The runner evaluates the Playwright config first and mints the id here.
 * Playwright forks both the web server and every worker with a copy of
 * `process.env`, and the config module re-executes inside each of them, so
 * `??=` keeps the inherited value rather than minting a second one. The build
 * command inherits it too, which is what lets vite stamp it into the document
 * (see the atlas-build-stamp plugin in vite.config.ts).
 *
 * Everything downstream depends on that chain: if the page in the browser does
 * not carry this exact id, it is not the build this run produced, and no
 * screenshot taken from it means anything.
 */
export function buildId(): string {
  process.env.ATLAS_BUILD_ID ??= randomUUID()
  return process.env.ATLAS_BUILD_ID
}

/**
 * The rendering environment a baseline belongs to.
 *
 * Screenshots are not portable across font stacks or Chromium builds, and
 * "linux" is not a sufficient specification: the device glyphs on the network
 * tab are Unicode symbols that Inter does not carry, so they resolve from
 * whatever system font is installed. Bare ubuntu-latest and the pinned
 * Playwright image do not agree about that.
 *
 * So a baseline is filed under the environment that produced it, and CI sets
 * ATLAS_RENDER_ENV explicitly to name the pinned image. A run in an
 * environment with no committed baselines fails the inventory check in
 * identity.setup.ts rather than quietly starting a second, unreviewed set.
 */
export function renderEnv(): string {
  return process.env.ATLAS_RENDER_ENV ?? `${process.platform}-${process.arch}`
}
