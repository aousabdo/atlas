# Parity against atlas_v6.html

Phase 1 is done when it fully replaces the generated single-file tool. This is the
checklist, walked against a real build rather than reasoned about.

Verified 2026-08-05 via the visual regression baselines in
`e2e/visual.spec.ts-snapshots/` (five tabs x two themes, inspected by eye), 290 component
and unit tests, 173 ingest tests, and the browser suites for export and offline delivery.

## Method

```bash
npm run dev -- --port 5199
```

Use a **fresh port for each verification run**. The browser console buffer does not clear
across same-origin navigation, so reusing a port means re-reading stale errors and
misdiagnosing them.

## Carried over from atlas_v6.html

| # | Capability | Where it lives now | Verified |
|---|---|---|---|
| 1 | 32 systems, 23 confirmed, 9 unconfirmed, 11/19/2 risk, 14 links in the stats bar | Map tab stats | yes, screenshot + test |
| 2 | Radial tree with expand/collapse and zoom | Map tab | yes, screenshot + 20 layout tests |
| 3 | Minimap | Map tab | yes, screenshot |
| 4 | Current links and desired links toggles | Map toolbar | yes, test asserts 14 and 13 |
| 5 | Risk View recolour | Map toolbar | yes, test asserts 11 high |
| 6 | Grid snap and Clean routing | Map toolbar | yes, Grid auto-enables Clean |
| 7 | Detail panel with integrations and the network cross-link | Map detail panel | yes, bastion links to the device, fathom reports unmapped |
| 8 | Risk heatmap 6x3 with hover listing the systems | Analytics | yes, every cell matches the golden numbers |
| 9 | Ownership confirmation bars with confirmed/pending counts | Analytics | yes, all six groups |
| 10 | Requirements coverage, 11 requirements, 5 statuses, dropped shown | Analytics | yes, now a real d3-sankey with an explicit loss node |
| 11 | Multi-site coverage, cross-site diff, pending questions | Analytics | yes |
| 12 | Filter dimming every card at once | Analytics | yes |
| 13 | Network graph, 71 + 8 devices, force/zone/tree, 14 zones, search | Network | yes, screenshot + tests |
| 14 | Device detail with implements-system chips linking back | Network | yes |
| 15 | Confidence and caveats, four cards | Reference | yes |
| 16 | Methodology with keyword lists from live config | Reference | yes, 19/3/9 keywords |
| 17 | Systems table, 32 rows, mapped-at column | Reference | yes |
| 18 | Acronyms table, 48 rows | Reference | yes |
| 19 | Architecture and build stamp | Reference | yes |
| 20 | Filter across both reference tables | Reference | yes |
| 21 | Save PNG of a panel | Export menu | yes, exercised in Chromium, PNG magic bytes checked |
| 22 | Export PDF | Export menu | yes, exercised in Chromium, %PDF- header checked |
| 23 | Print Mode / light theme | Theme toggle | yes, light baselines for all five tabs |
| 24 | Keyboard shortcuts and dialog | `?` | yes |
| 25 | About drawer per tab | `About` button or `A` | yes, rewritten rather than ported |

### Closed since the first pass

All three gaps are done.

**Export never worked, and only running it in a browser showed that.** html2canvas 1.4.1
predates modern CSS colour functions, and Tailwind 4 emits `color-mix(in oklab, ...)` for
every opacity modifier, so the first one it met threw and every export failed.
`html2canvas-pro` is API-compatible and parses them. `e2e/export.spec.ts` now clicks the
buttons in Chromium and checks the downloaded bytes carry the right magic numbers, which
is the difference between export code existing and export working.

**The About drawer is a rewrite, not a port.** The original restated the glossary in four
places and hardcoded counts that went stale. Each view now answers only what it shows and
where its numbers come from, and a test fails if that prose starts stating a count.

**The shortcuts dialog** covers `?`, `1`-`5` to jump between views, `E` to export, `A` for
about, and `Esc` to close. A test asserts the old "click into the network graph first to
focus it" caveat has not come back, since one document is what removed the need for it.

## New in Phase 1

| Capability | Verified |
|---|---|
| Lossiness tab: seven dimensions, each drilling to the entities behind the number | yes |
| Attrition flow with explicit loss nodes at each stage | yes |
| Top gaps ranking | yes |
| Load your own matrix in-browser, file never leaves the machine | yes, contract suite runs against it |
| Self-contained single-file export that genuinely works offline | yes, see below |
| Deep-linkable routes (`/map?focus=beacon`) | yes |
| git_sha and site classification displayed rather than injected and hidden | yes |
| Owner classification rules shown with priority and match mode | yes, 23 rows |

## A number that deliberately changed

The old tool reported Northgate coverage as **13 of 32 systems (41%)**. It now reports
**10 of 30 (33%)**, and names both differences.

The numerator: Northgate has 13 mapping entries, but three of them do not describe a
matrix system realized in hardware: `homing` and `kite` are ATAK plugins with an empty
device list, and `atak` carries `matrix_id_exists: false` because it is deliberately not a
matrix system. Counting them inflated the figure.

The denominator: two of the 32 matrix rows, `dispatch` and `partner`, are filed as
shortfalls (`Workflow shortfall`, `Exchange shortfall`). They record a gap in the
architecture, not a system anyone could field, so they can be neither realized nor
unmapped, and the load fails if a mapping gives one hardware. The panel now shows 33%,
states the three uncounted mappings underneath, and names the two shortfall rows it
leaves out.

This is the tool doing its job. Anyone who quoted 41% should be told.

## One set of curation cases, read by both engines

The browser and the ingest have to read one system to device map the same way,
and refuse a bad one in the same words. For the review fields that is held by
shared files rather than by mirrored tables: each file in
`fixtures/parity/curation/` holds a map as an analyst would write it, the
systems and drawings it is read against, the refusals expected word for word,
and, for a map both engines accept, the realization it produces (`numerator`,
`per_site.*.mapped_ids`, `per_site.*.checked_absent`, `by_confidence`).
`src/curation/__tests__/parity.test.ts` and `ingest/tests/test_curation_parity.py`
both read every file there, so a case added once runs in both, and the two
cannot drift apart the way a hand-mirrored pair of tables such as `PCT_CASES`
can. The cases cover today's files, every review gate, the dates the two
calendars could read differently, non-ASCII text and a site walk that moves
realization.

**The bytes are pinned, not just the figures.** Every case both engines accept
has a sibling `<name>.out.json` holding the exact bytes the export writes for
it. The vitest file requires the browser's writer to produce them byte for
byte, the pytest requires `canonical_map_json` to, and the pytest also reads
every `.out.json` back and requires it to come out unchanged, so a file the
browser exported survives the ingest's writer. A case the gates refuse has no
`.out.json`, and both tests fail if one appears. The same holds for
`fixtures/parity/sample-walk/system_device_map.json`, the export of the
three-review Westfield walk, which `src/curation/__tests__/edits.test.ts` pins
byte for byte and `ingest/tests/test_curation_roundtrip.py` reads back through
the ingest. Change a writer and these files have to be regenerated on purpose,
in both engines at once.

**The whole sample, not just the cases.** `src/lib/__tests__/sampleParity.test.ts`
recomputes the Lossiness report in the browser from the committed sample
inputs and requires it to deep-equal the report the ingest committed
(`fixtures/synthetic/lossiness.json`), every dimension and `top_gaps`. The
curation layer serves the browser's report in place of the ingest's as soon as
one review exists, so the two have to agree on the unedited sample first.

**Open questions are listed by subject in both engines.** The ingest used to
list them in the map's own order, and the browser in `coverage.json`'s, whose
keys are sorted, so the same report read in two orders. Both now sort them by
subject, and the committed sample report was regenerated in that order. No
figure changed.

## The offline guarantee

The previous tool's README claimed it worked air-gapped while loading D3, html2canvas,
jsPDF and two font stylesheets from CDNs. That claim had already been shown to
stakeholders, so it does not get marked done on a passing test alone.

| Check | Result |
|---|---|
| `npm run build` fails on any remote asset reference in the output | passing; verified by injecting a CDN tag and confirming it fails |
| Standalone structure: no remote or relative refs, fonts inlined, dataset complete | 7 of 7 passing |
| Loads from `file://` with every http and https request aborted, all five tabs, zero console errors | 3 of 3 passing |

Getting there took seven fixes, none of which a served build would have revealed: the CSP
blocked its own inlined scripts, `frame-ancestors` is ignored in a meta tag, split vendor
chunks cannot be inlined into one file, `BrowserRouter` cannot match a file path,
stylesheet `url()` references resolve against the stylesheet rather than the output root,
a bare `<script` inside a bundle's string literal puts the HTML tokenizer in a state where
the next `</script>` does not close the element, and Vite emits the module tag in `<head>`
so inlining before injecting anchored the data on a `</head>` inside the bundle's own
source. The last two are now gated: the build fails if script tags come out unbalanced.

**Still worth doing by hand:** open `dist-standalone/atlas.html` on a machine with no
network at all. The automated check aborts requests, which is very close but not identical
to an interface that is down.
