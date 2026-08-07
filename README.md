# ATLAS

**Architecture Traceability and Lossiness Analysis System.**

An exploration tool for the DHS C-UAS architecture. It traces original requirements
through today's systems to the hardware actually deployed at each site, and is explicit
about what is lost at every step.

Live at [atlas.analyticadss.com](https://atlas.analyticadss.com). No login, no backend,
no data leaves your machine.

## The five views

| View | What it answers |
|---|---|
| **Reference & Methodology** | What do these terms mean, how were these figures derived, and what does this tool deliberately not claim? |
| **Analytics** | How is risk distributed across owner organizations, and how much of the original baseline survives? |
| **Lossiness** | Where does information die between intent and deployed reality? Seven dimensions, each drilling through to the entities behind the number. |
| **Network Topology** | What is physically deployed at each site, and which systems does each device implement? |
| **Orientation Map** | How does the whole architecture fit together? |

## Two ways to load data

ATLAS reads everything through one interface, `AtlasDataProvider`, with two
implementations:

- **Static** (default) reads pre-built JSON bundles committed to `public/data/`. This is
  what the hosted site serves.
- **Local file** parses a Traceability Matrix you choose, entirely in your browser using
  SheetJS. **The file never leaves your machine.** No upload, no request, nothing written
  anywhere. For sensitive data this is strictly safer than any hosted alternative,
  because there is no server to trust.

A single contract test suite runs against both, so they cannot quietly disagree about
what the data says.

## Works offline

The whole point of the single-file export is the analyst who cannot reach this domain.

```bash
npm run build:standalone
```

writes `dist-standalone/atlas.html`: one file, every asset and every data bundle inlined,
no network access required. Email it, or hand it over on a stick.

The previous version of this tool claimed to work air-gapped while loading D3,
html2canvas, jsPDF and two font stylesheets from CDNs. `npm run build` now fails if any
remote asset reference appears in the output, so the claim is enforced rather than
asserted. See `scripts/check-offline.mjs`.

## Regenerating the data

The classification logic lives in `ingest/`, a Python package lifted from the previous
generator. It reads the workbook and writes the JSON bundles.

```bash
PYTHONPATH=ingest/src python3 -m atlas_ingest.bundle \
  path/to/matrix.xlsx \
  --overrides path/to/overrides.json \
  --glossary path/to/glossary.json \
  --system-device-map path/to/system_device_map.json \
  --network-json northgate:path/to/northgate_network.json \
  --network-json westfield:path/to/westfield_network.json \
  -o public/data
```

Integrity gates run first and **fail closed**: if a mapping names a system that is not in
the matrix, or an edge points at a device that does not exist, nothing is written. The
previous script warned and continued, which is how stale data shipped unnoticed.

The classifier tables are also emitted as TypeScript (`npm run ingest:tables`) so the
in-browser parser uses the same tables rather than a hand-maintained copy. A test
regenerates that file and fails if it has drifted.

## Development

```bash
npm install          # needs one-time network access to cdn.sheetjs.com
npm run dev
npm test             # unit and component tests
npm run e2e          # visual regression, needs Chromium
npm run e2e:update   # regenerate baselines for your rendering environment
npm run falsify      # prove the visual suite can still fail
python3 -m pytest ingest/tests -q
```

### One-time setup: the real-data guard

This repo committed the real controlled bundle once. `scripts/check-no-real-data.mjs`
exists so that cannot happen quietly again, and it runs as a pre-commit hook. Git will
not enable a committed hook by itself, so enable it once per clone, and tell it where the
reference data lives:

```bash
git config core.hooksPath .githooks
export ATLAS_SOURCE_REPO=/path/to/cuas_arch   # add this to your shell profile
npm run check:data                            # tree-wide scan, same rules
```

**The hook fails closed if `ATLAS_SOURCE_REPO` is unset.** That is deliberate. It is not
an inconvenience to work around with `--no-verify`.

#### What each rule catches, and where it runs

| # | Rule | Pre-commit | CI |
|---|---|---|---|
| 1 | `public/data/` is tracked at all | yes | yes |
| 2 | IPv4 outside the documentation ranges | yes | yes |
| 3 | A control marking used as a value, in file contents and in paths | yes | yes |
| 4 | **Real entity names and real analytic phrases** | yes | **no, and it cannot** |
| 5 | A tracked binary that is not a known baseline | yes | yes |

**CI cannot run rule 4.** Rule 4 works by harvesting the vocabulary at run time from the
reference repo: the traceability matrix workbook, the generated tool, and every workbook
and JSON under its `traceability/` tree. A GitHub runner has none of that and must never
be given any, because shipping the controlled material to CI in order to check for the
controlled material is the disclosure the guard exists to prevent. There is no version of
this repo's CI that closes that gap, and pretending otherwise is worse than the gap.

So the split is: CI runs the structural rules, which catch a bulk re-import whatever it
is called, and prints an explicit warning saying rule 4 did not run. The pre-commit hook
runs everything, and refuses to run at all without the reference repo. The machine that
can paste a real capability-gap statement into this repo is by definition a machine with
the reference data open, and that is the machine where rule 4 always runs.

#### Why the guard contains no list of real names

The obvious implementation is a list of forbidden strings. That list would itself be the
sensitive vocabulary, published in the one file nobody thinks to purge because it looks
like tooling. So nothing is written down; it is harvested at run time and never printed.
Findings quote the offending text, which is safe because a match is already sitting in a
file in your tree.

This applies to the allowlist too. `PUBLIC_VOCABULARY` in that file once carried six
ordinary words that, taken as a set, identified the real site more precisely than the
data being guarded did. Before adding a word to it, the question is not "is this word
generic" but "would an adversary learn anything from the set". If the answer is that a
word is only there to stop the guard firing on a synthetic label, rename the label.

#### Rule 5 and the visual baselines

`e2e/__screenshots__/**` are PNGs, and no text rule can read one. They render the app's
own bundle, including the risk-keyword table and the gap statements, as pixels. They
cannot be scanned, so they are acknowledged instead: rule 5 fails on any tracked binary
that is not a known baseline, which turns "binaries are invisible" into "a new binary is
a failing build". Whoever refreshes a baseline is responsible for it having been rendered
from the synthetic bundle.

Baselines are keyed by rendering environment and the authoritative set is produced
in CI, inside a pinned Playwright image. See `e2e/README.md` for why, and for how
to refresh them.

`npm run build` runs `tsc --noEmit`, the Vite build, and the offline check.

The ingest tests read a reference workbook from a separate repository. When it is absent
they skip and the classifier unit tests still run, which is how CI works.

## Design rules worth knowing before you change things

**D3 computes geometry; React owns the DOM.** Everything under `src/viz/` is pure
functions returning coordinates. No `d3.select().append()` anywhere. The previous
implementation rebuilt the entire SVG on every frame and its minimap monkey-patched the
render function; that is precisely what this rule exists to prevent.

**Guard container dimensions before computing a zoom scale.** `Math.min(width/bw,
height/bh, 2)` is 0 when the container has no size, which pins the zoom transform at
k=0, and every later `width / k` yields Infinity. The old tool never hit this because it
mounted the graph lazily. React mounts before layout, so `fitToScreen` returns null
rather than a broken transform and the caller waits for the next resize.

**No number without its evidence.** Every lossiness figure carries the ids of the
entities behind it and drills through to them. A metric you cannot audit is a claim, not
a measurement.

**Distinguish "no data" from "failed to load."** They are separate components
(`EmptyState`, `LoadFailed`) so nobody can render one for the other. A chart showing 0
because a fetch died is a lie, and lying is the one thing this tool cannot do.

## Status and scope

This is **Phase 1**: a static application, no backend, no accounts. It honours the
platform's deployment gate by shipping to GitHub Pages rather than standing up
infrastructure that the roadmap has not reached yet.

**Phase 2** adds FastAPI, Postgres, accounts, and a server-side upload → diff → approve
ingest workflow. It is gated on an open question: **what marking does this data actually
carry?** The content includes site topologies, device IPs and subnets, and an explicit
map of which integrations are missing. That last item is a gap map, and individually
unclassified facts can become sensitive in aggregate. That question needs an answer in
writing from the data owner before any hosted multi-user version is designed.

See `docs/specs/` in the source repository for the full design, and
`docs/dependency-decisions.md` here for why certain versions are pinned where they are.
