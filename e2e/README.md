# The visual harness

The point of this suite is not that it passes. It is that it is incapable of
passing for the wrong reason. Two failure modes had already happened here:

- A baseline refresh reported "21 passed" while the map and network baselines
  still showed a toolbar that no longer existed. Nothing tied the page in the
  browser to the build the run had just produced, and the tolerance was wide
  enough to call the old toolbar and the new one the same image.
- Every baseline was named with a `-darwin` suffix. CI runs Linux, looked for
  `-linux`, found nothing, wrote the file it was missing and failed. The visual
  suite had never meaningfully run in CI.

Everything below exists to make both impossible.

## What gates a run

`playwright.config.ts` declares a `setup` project that every other project
depends on, so a failure there stops the run before a single screenshot is
taken or rewritten. It asserts two things:

1. **The page under test is the build this run produced.** The runner mints a
   UUID, Playwright hands it to the build through the environment, a vite plugin
   stamps it into `<meta name="atlas-build">`, and the setup project reads it
   back out of the served document. A stale preview, a leftover server, a `dist`
   that predates the change: all of them show up here.
2. **Every baseline this environment compares against exists.** Missing and
   orphaned baselines are both hard failures. `updateSnapshots: 'none'` means a
   missing snapshot is never written and then trusted by the next run.

## Baselines are keyed by rendering environment

Screenshots are not portable. Beyond the usual rasteriser differences, the
device glyphs on the Network tab are Unicode symbols that Inter does not carry,
so they resolve from whatever system font is installed. "Linux" is not a
sufficient specification either: a bare runner and the pinned Playwright image
ship different font sets.

So baselines live in `e2e/__screenshots__/<environment>/`, where the environment
is `ATLAS_RENDER_ENV` if set and `<platform>-<arch>` otherwise.

| environment | produced and verified by |
| --- | --- |
| `linux-x64-noble-pw1.62.1` | the `visual` job in CI, inside `mcr.microsoft.com/playwright:v1.62.1-noble` |
| `darwin-arm64` | a developer running `npm run e2e` on an Apple Silicon Mac |

CI is the authority: it is what blocks a merge. A local set exists so a
developer gets a real signal without a push-and-wait cycle. Neither set can go
missing quietly, because the inventory check fails on the environment it is
actually running in.

## Updating baselines

**In CI, which is the set that gates merges.** Actions -> CI -> Run workflow,
tick `refresh_baselines`. Download the `refreshed-baselines` artifact, unzip it
over `e2e/__screenshots__/`, **look at the diff**, then commit.

The job uploads an artifact rather than committing for you on purpose. A job
that both writes the baselines and checks them is the same self-agreeing loop
that hid the toolbar regression, just relocated into CI. Reviewing that diff is
the entire point of the suite.

**Locally, for your own environment.**

```sh
npm run e2e:update      # playwright test --update-snapshots=all
```

Never a bare `-u`. Playwright presets the bare flag to `changed`, which leaves
any baseline whose diff fits inside the tolerance untouched and still reports a
pass. `=all` skips the comparison and rewrites unconditionally.

When you change the pinned image, change `ATLAS_RENDER_ENV` in
`.github/workflows/ci.yml` with it. A new image is a new Chromium and a new font
set, so the old directory is no longer authoritative and the run should say so
rather than compare against it.

## Tolerance

`maxDiffPixels: 100`, `threshold: 0.01`. Both are measured.

An absolute cap, never a ratio: as a ratio, tolerance scaled with page height,
so 1% on the 1440x8256 reference tab licensed 118,886 pixels of unreviewed
change.

The threshold matters more than the cap on a dark, low-contrast UI. Deleting one
button from the map toolbar registers as **245** different pixels at Playwright's
default threshold of 0.2, and as **3,395** at 0.01, because most of the change is
dim grey moving over dark blue and the default writes that off as noise. At 0.2
that regression passed even with the cap set to zero.

Observed noise at 0.01 is zero: three consecutive full runs across two rebuilds
produced byte-identical captures. 100 is headroom, not licence.

## Waiting

Tests wait for `html[data-atlas-ready="true"]`, published by `src/lib/ready.ts`.
The previous version waited on `networkidle` plus a flat 1500ms, and neither says
what it needs to: `StaticProvider` caches every bundle, so after the first tab
the network goes quiet while a `ResizeObserver` has not yet delivered a size and
a graph is still sitting at the identity transform. Replacing the guess with the
fact took the suite from 58s to 15s and removed the reason to guess again.

## Proving the suite can fail

```sh
npm run falsify              # every known regression, only the tests it claims to break
npm run falsify -- --full    # every regression against the whole suite
npm run falsify -- --list    # the mutation table
npm run falsify -- --only A1
npm run falsify -- --restore # recover from a run that was killed mid-mutation
```

It injects each regression, asserts the named tests go red, and restores the
tree byte for byte, verified by sha256. A mutation the suite does not catch is
reported `NOT CAUGHT` and the script exits non-zero. A mutation whose anchor no
longer matches the source is reported `STALE`, also non-zero, because a
falsifier that silently no-ops when the code drifts reproduces the vacuous-green
problem one level up.

It never runs git. The journal carries the original bytes, so restoration is
exact and cannot discard work it did not make.
