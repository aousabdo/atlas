# Site walk and in-app curation: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reviewer records per-system and per-device reviews in the app, sees every figure move live, exports `system_device_map.json`, re-ingests it in either engine with identical results, and prints a site-walk checklist ordered by risk and then evidence.

**Architecture:** Reviews are written into the existing system to device map (two optional stamp fields on a mapping, an object form for a checked absence, `unclaimed_devices.checked`). Both engines gate and serialise that file identically, pinned by shared fixture files read by vitest and pytest. In the browser, a pure edits module turns a list of edits into edited coverage. A `CuratedProvider` wraps the loaded provider only while edits exist, and a `CurationProvider` inside `AtlasProvider` holds the edits in memory and feeds the effective provider to every tab.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind 4, vitest and Testing Library, Playwright 1.62; Python 3.11 ingest with pytest.

**Spec:** `docs/superpowers/specs/2026-11-13-site-walk-curation-design.md` (read it first; this plan argues from it).

## Global Constraints

- Test first: every task writes its failing test before its code.
- Both engines build every gate message from the same template, word for word. Every message the loader can build appears in the "When a load fails" section of `docs/data-inputs.md`, which `src/components/__tests__/TemplateDownloads.test.tsx` enforces.
- Nothing is written to `localStorage`, `sessionStorage` or IndexedDB (the theme preference stays the only exception). Nothing is fetched or sent. `npm run build` (which runs `check-offline.mjs`) and the standalone build must keep passing.
- The hosted site serves the fabricated sample only. Edits made on the sample are labelled `Sample only: these edits describe no real site.`
- `ABOUT` entries state no counts (an existing test enforces this).
- Order text by code unit (`a < b`), never `localeCompare`, wherever an order is pinned by a test.
- Commit messages are lower-case imperative sentences, matching `git log`. Commit messages and the PR body carry no Co-Authored-By line and no tool attribution.
- Fixed strings, verbatim:
  - The printed ordering rule: `Ordered by the risk level the workbook gives each system, high first. At the same level, the weakest evidence comes first: no record, ungraded, best guess, strong inference. Devices with no system recorded follow, most relied on first. Physically verified items, and devices checked and found to carry no system, are listed last.`
  - The export band: `Includes N unsaved review(s), not yet exported to a file` (singular `review` when N is 1).
  - The gate messages listed in Task 2.

## Review Focus

1. **A file that records one system as both mapped and checked absent.** No gate refuses this today. A reviewer expects the summary to count the system once, and a new review of it to replace both records. The summary's precedence is realized, then no hardware, then absent (Task 5). `applyEdit` removes both records before writing the new one (Task 4).
2. **A device two systems share, unassigned from one of them.** It must stay claimed: off the infrastructure list, still counted as carrying a recorded system. It rejoins the list only when its last mapping goes (Task 4).
3. **Dates the two calendars read differently.** Year `0000` (JavaScript accepts it, Python refuses it), non-ASCII digits (Python's `\d` matches them), `2026-02-30`, and the leap day `2028-02-29`. Both engines must reach the same verdict (Task 2, `gate-dates`).
4. **Cancelling the discard prompt.** A reviewer with unsaved reviews clicks Load data or Return to sample data, then cancels the prompt. Nothing may change: the edits stay and the data stays (Task 6).
5. **Editing after an export.** After an export, the unsaved count is 0, the band is gone and the leave-page prompt no longer fires. One further edit makes the count 1, not the total number of edits (Task 6).

---

## File structure

| File | Responsibility |
|---|---|
| `src/curation/dates.ts` | `isCalendarDate`, `localDate` |
| `src/curation/edits.ts` | edit types and pure `applyEdit` / `applyEdits` |
| `src/curation/serialise.ts` | canonical JSON and the export payload |
| `src/curation/walk.ts` | system standing, the site summary, the checklist model and order |
| `src/curation/CuratedProvider.ts` | the provider that serves edited coverage and a recomputed report |
| `src/curation/CurationContext.tsx` | in-memory edits, the export, guards, the band arming |
| `src/components/EditsBanner.tsx` | the unsaved-reviews banner |
| `src/tabs/walk/WalkTab.tsx` | the Site walk tab: summary, system rows, device rows |
| `src/tabs/walk/ReviewForm.tsx` | the inline review form for one system |
| `src/tabs/walk/CheckForm.tsx` | "Checked, carries no system" for one device |
| `src/tabs/walk/ChecklistPrint.tsx` | the print-only checklist |
| `fixtures/parity/curation/*.json` and `*.out.json` | shared parity cases and their exact serialised bytes |
| `fixtures/parity/sample-walk/system_device_map.json` | the sample after the three-system Westfield walk, as the browser exports it |
| `ingest/tests/test_curation_parity.py`, `ingest/tests/test_curation_roundtrip.py` | the Python side of the parity and round-trip tests |

The review gates go in `src/data/LocalFileProvider.ts`, beside `decisionRootFailures`, because the docs test extracts messages from that file.

---

### Task 1: One order for open questions, and the full-sample parity test

**Files:**
- Modify: `ingest/src/atlas_ingest/lossiness.py:240-247` (`_open_questions`)
- Modify: `src/lib/lossiness.ts` (the `openQuestions` block, near line 220)
- Regenerate: `fixtures/synthetic/lossiness.json`
- Test: `ingest/tests/test_lossiness.py`, `src/lib/__tests__/lossiness.test.ts`
- Create: `src/lib/__tests__/sampleParity.test.ts`

**Interfaces:**
- Produces: `open_questions.detail.questions` sorted by `subject` (code unit) in both engines.

- [ ] **Step 1: Write the failing tests**

```python
def test_open_questions_are_sorted_by_subject():
    sdmap = {"sites": {}, "pending_review": {"zeta": "z?", "alpha": "a?", "Mid": "m?"}}
    dim = lossiness._open_questions(sdmap)
    assert [q["subject"] for q in dim["detail"]["questions"]] == ["Mid", "alpha", "zeta"]
```

In `lossiness.test.ts`, the mirror: `computeLossiness` with empty systems, links, requirements and topologies, and `pending_review: { zeta: 'z?', alpha: 'a?', Mid: 'm?' }`. Assert the open-questions subjects equal `['Mid', 'alpha', 'zeta']`.

In `sampleParity.test.ts`, `it('computes the committed sample report from the committed sample inputs')`: build the inputs from `new StaticProvider('/data')`, with topologies from `getTopology` for every `project.sites` id. Then:

```ts
expect(report.dimensions).toEqual(bundled.dimensions)
expect(report.top_gaps).toEqual(bundled.top_gaps)
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `python3 -m pytest ingest/tests/test_lossiness.py -q -k sorted` and `npx vitest run src/lib/__tests__/lossiness.test.ts src/lib/__tests__/sampleParity.test.ts`
Expected: the Python test fails, because the questions come out in insertion order. The sample parity test fails only on `open_questions.detail.questions`. The TS sort test passes already, because the browser reads sorted keys; keep it as the pin.

- [ ] **Step 3: Sort in both engines**

Python: `sorted(pending.items())`. TS: sort the entries by key with `a < b ? -1 : a > b ? 1 : 0`.

- [ ] **Step 4: Regenerate the sample bundle**

Run: `PYTHONPATH=ingest/src python3 -m atlas_ingest.synthetic && node scripts/seed-data.mjs && git status --short`
Expected: only `fixtures/synthetic/lossiness.json` changes, and only the order of `open_questions.detail.questions`. If any other file changes, stop and report it.

- [ ] **Step 5: Run the tests and see them pass**

Run: `python3 -m pytest ingest/tests -q && npx vitest run src/lib`
Expected: PASS, `test_sample_bundle` included.

- [ ] **Step 6: Commit**

```bash
git add ingest/src/atlas_ingest/lossiness.py src/lib/lossiness.ts fixtures/synthetic/lossiness.json ingest/tests/test_lossiness.py src/lib/__tests__/lossiness.test.ts src/lib/__tests__/sampleParity.test.ts
git commit -m "list open questions by subject in both engines, and pin the browser to the sample report"
```

---

### Task 2: Review fields and checked devices, gated alike in both engines

**Files:**
- Modify: `src/types/atlas.ts` (`Mapping`, `CoverageSite`; new `ReviewStamp`, `CheckedAbsence`, `CheckedDevice`)
- Modify: `src/lib/coverage.ts` (new `absenceReason`, `isReviewed`)
- Create: `src/curation/dates.ts`
- Modify: `src/data/LocalFileProvider.ts`:
  - export `normaliseSystemDeviceMap` and `RawSystemDeviceMap`, widening the raw types to `unknown` values;
  - add `reviewFailures(siteId, site, deviceIds)` and call it from `crossFileFailures`.
- Modify: `src/lib/lossiness.ts`: extract `realizationGap(systems, coverage)`, which `computeLossiness` then calls.
- Modify: `ingest/src/atlas_ingest/curation.py`: split `normalise_system_device_map(raw)` out of `load_system_device_map(path)`.
- Modify: `ingest/src/atlas_ingest/validate.py`: add `_review_failures(site_id, site, device_ids)` and `_is_calendar_date(value)`.
- Create: `fixtures/parity/curation/*.json` (the cases below)
- Create: `src/curation/__tests__/parity.test.ts`, `ingest/tests/test_curation_parity.py`, `src/curation/__tests__/dates.test.ts`
- Modify: `docs/data-inputs.md`:
  - section 4: the stamp fields, the absence object, `unclaimed_devices.checked`, and the two readings of an empty-device mapping, as spec §1 states them;
  - "The files disagree with each other": one bullet per new message.
- Modify: `docs/parity.md`: one paragraph on `fixtures/parity/curation`.

**Interfaces:**
- Produces, in TypeScript:
  - `interface ReviewStamp { reviewed_by: string; reviewed_on: string }`
  - `interface CheckedAbsence extends ReviewStamp { reason: string }`
  - `interface CheckedDevice extends ReviewStamp { note?: string }`
  - `Mapping` gains `reviewed_by?: string; reviewed_on?: string`
  - `CoverageSite.not_deployed_at_site: Record<SystemId, string | CheckedAbsence>`
  - `CoverageSite.unclaimed_devices: { infrastructure: DeviceId[]; _comment?: string; checked?: Record<DeviceId, CheckedDevice> }`
  - `absenceReason(value: string | CheckedAbsence): string`
  - `isReviewed(entry: Partial<ReviewStamp>): boolean`, true when both fields are strings
  - `isCalendarDate(value: string): boolean`
  - `normaliseSystemDeviceMap(raw: RawSystemDeviceMap | null, matrixIds: ReadonlySet<SystemId>): CoverageMatrix`
  - `realizationGap(systems: System[], coverage: CoverageMatrix): LossinessDimension`
- Produces, in Python:
  - `curation.normalise_system_device_map(raw) -> dict`
  - `validate._review_failures(site_id, site, device_ids) -> list[str]`

**The messages.** `<m>` is `system_device_map.sites.<site>.mappings.<system>`, `<a>` is `...not_deployed_at_site.<system>`, `<c>` is `...unclaimed_devices.checked.<device>`.

| # | Message | Raised when |
|---|---|---|
| M1 | `<m or a>: reviewed_by and reviewed_on go together; give both or neither` | exactly one stamp field is present on a mapping or an absence object |
| M2 | `<m, a or c>: reviewed_by and reviewed_on must be text` | both are present and either is not a string |
| M3 | `<m, a or c>: reviewed_by is blank; say who reviewed it` | `reviewed_by` matches `_BLANK` |
| M4 | `<m, a or c>: reviewed_on '<value>' is not a date; write it as YYYY-MM-DD` | the value fails `isCalendarDate`. M3 and M4 can both fire, in that order |
| M5 | `<a>: must be a reason, or an object with reason, reviewed_by and reviewed_on` | the value is neither a string nor a plain object |
| M6 | `<a>: no reason; say what was checked` | an absence object whose `reason` is missing, not a string, or blank |
| M7 | `system_device_map.sites.<site>.unclaimed_devices.checked: must map device ids to reviews` | `checked` is present and not a plain object |
| M8 | `<c>: must be an object with reviewed_by and reviewed_on` | the entry is not a plain object, or lacks either stamp field |
| M9 | `<c>: mappings.<system> lists this device; a device checked as carrying no system takes no mapping` | one message per mapping at the site that names the device, in mapping order |
| M10 | `system_device_map.sites.<site>.unclaimed_devices.checked: device '<device>' is not in the <site> topology` | only when that site's topology is loaded |

**Rules shared by both engines:**
- `isCalendarDate` matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` (ASCII digits only; Python uses `re.fullmatch`). The year must be at least 1, and the date must be real: JavaScript uses `setUTCFullYear(y, m - 1, d)` and checks the result round-trips; Python uses `datetime.date`.
- Blank is the existing `_BLANK` rule (`[\s﻿]*` in Python, the matching pattern already in `LocalFileProvider.ts`), never `trim()`.
- Failure order: `reviewFailures` runs once per site, after the existing infrastructure-list check. It covers mappings (file order), then absences (file order), then the `checked` entries (file order).
- For one checked entry: first M8, or else the stamp checks (M2, M3, M4); then M9; then M10.
- Name the helper's parameter `at`, not `where`. The docs extractor binds `where` globally, to the decision-roots template.

- [ ] **Step 1: Write the shared cases**

Each `fixtures/parity/curation/<name>.json` holds:

```json
{
  "name": "...",
  "systems": [{"id": "alpha", "name": "Alpha", "category": "Deployed asset record"}],
  "topology_devices": {"yard": ["d1", "d2"]},
  "map": {},
  "expect": {
    "failures": [],
    "realization": {
      "numerator": 1,
      "per_site": {"yard": {"mapped_ids": ["alpha"], "checked_absent": []}},
      "by_confidence": {"high": ["alpha"], "medium": [], "low": [], "unspecified": []}
    }
  }
}
```

`realization` appears only when `failures` is empty. Write these cases, using sites `yard` and `annex`, systems `alpha`–`epsilon` (`Deployed asset record`) and `gap` (`Workflow shortfall`):

- **Valid files:**
  - `plain-file`: today's shape, with no stamps and a string absence.
  - `reviewed-mapping`
  - `object-absence`: one object with a stamp, one without.
  - `reviewed-no-hardware`
  - `checked-device`
  - `non-ascii`: reviewer `Zoë Ångström`, note `現場確認 — ok`, reason `Ölçüm yok`.
  - `unknown-keys`: a top-level `_comment`, a site key `walk_notes`, a mapping key `ticket`.
  - `legacy-flat`
  - `site-alias`: a site-level `not_deployed_at_northgate`.
  - `walk`: `yard` realizes `alpha`, and `annex` goes from nothing to stamped `beta`, `gamma` and `delta`. Expect `numerator` 4.
- **Gate cases:**
  - `gate-stamp-pair`: M1 on a mapping and on an absence object.
  - `gate-stamp-text`: M2, with `reviewed_by: 5`.
  - `gate-stamp-blank`: M3, with `reviewed_by: " \t"`.
  - `gate-dates`: M4 for `13/11/2026`, `2026-02-30`, `0000-01-01` and `٢٠٢٦-١١-١٣`; `2028-02-29` passes.
  - `gate-absence-shape`: M5 for `42`, `null` and `["x"]`.
  - `gate-absence-reason`: M6 for `{"reason": ""}` and for a stamped object with no reason.
  - `gate-checked-shape`: M7, with `checked: []`.
  - `gate-checked-entry`: M8 for `"yes"` and for `{"reviewed_by": "x"}`.
  - `gate-checked-mapped`: M9.
  - `gate-checked-off-drawing`: M10.

- [ ] **Step 2: Write both harnesses**

`parity.test.ts` reads every `*.json` in the folder except `*.out.json`, and asserts there are at least 20 cases. For each case:
- Fill each system to a full `System` with neutral values.
- Build `topologies` from `topology_devices`, with `devices: ids.map(id => ({ id }))`.
- Assert that `crossFileFailures({ systems, links: [], coverage: normaliseSystemDeviceMap(map, matrixIds), topologies, requirements: [] })`, filtered to strings starting with `system_device_map.`, equals `expect.failures`.
- When `realization` is present, assert that `realizationGap(systems, coverage)` matches it: `numerator`, `per_site.*.mapped_ids`, `per_site.*.checked_absent` and `by_confidence`.

`test_curation_parity.py` does the same with `@pytest.mark.parametrize` over the files:
- Call `validate(systems, [], normalise_system_device_map(map), networks, [], GLOSSARY_THAT_PASSES)`, with `networks = {site: {"devices": [{"id": d} for d in ids]}}`.
- Call `lossiness._realization_gap(systems, sdmap)`.

`dates.test.ts` covers `isCalendarDate` (the `gate-dates` values plus `2026-11-13`) and `localDate(new Date(2026, 10, 3))` → `'2026-11-03'`.

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run src/curation && python3 -m pytest ingest/tests/test_curation_parity.py -q`
Expected: FAIL. TypeScript fails with missing exports; Python fails on `normalise_system_device_map`, and every gate case fails.

- [ ] **Step 4: Implement the types, helpers and gates in both engines, as the table and rules above pin them**

- [ ] **Step 5: Run the harnesses, the docs test and typecheck**

Run: `npx vitest run src/curation src/data src/components/__tests__/TemplateDownloads.test.tsx && npm run typecheck && python3 -m pytest ingest/tests -q`
Expected: PASS. The docs test passes only once every M1–M10 bullet is in `docs/data-inputs.md`. Write each bullet with placeholders (`<site>`, `<system>`, `<device>`, `<value>`), as the existing bullets are written.

- [ ] **Step 6: Commit**

```bash
git add src/types/atlas.ts src/lib/coverage.ts src/lib/lossiness.ts src/curation src/data/LocalFileProvider.ts ingest/src/atlas_ingest/curation.py ingest/src/atlas_ingest/validate.py ingest/tests/test_curation_parity.py fixtures/parity docs/data-inputs.md docs/parity.md
git commit -m "accept review stamps, checked absences and checked devices, gated in the same words by both engines"
```

---

### Task 3: One canonical serialisation, and the export payload

**Files:**
- Create: `src/curation/serialise.ts`
- Modify: `ingest/src/atlas_ingest/curation.py` (add `canonical_map_json`)
- Modify: `src/data/provider.ts`: optional `getSourceSystemDeviceMap?(): Promise<Record<string, unknown> | null>`
- Modify: `src/data/LocalFileProvider.ts`: keep the raw parsed map in `ParsedState.sourceMap` and implement `getSourceSystemDeviceMap`
- Create: `fixtures/parity/curation/<name>.out.json` for every case with no failures
- Test: extend `parity.test.ts` and `test_curation_parity.py`; create `src/curation/__tests__/serialise.test.ts`

**Interfaces:**
- Consumes: `normaliseSystemDeviceMap` (Task 2).
- Produces:
  - `canonicalJson(value: unknown): string`: keys sorted recursively, then `JSON.stringify(sorted, null, 2) + '\n'`. Byte-equal to Python's `json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"`.
  - `canonicalMapObject(raw: Record<string, unknown> | null, coverage: CoverageMatrix): Record<string, unknown>`
  - `canonicalMapJson(raw: Record<string, unknown>): string`, which is `canonicalJson(canonicalMapObject(raw, normaliseSystemDeviceMap(raw, new Set())))`. The matrix ids only feed `confidence_counts`, which is never written.
  - `exportSystemDeviceMap(args: { raw: Record<string, unknown> | null; coverage: CoverageMatrix; source: 'sample' | 'local'; today: string }): { fileName: string; text: string }`
  - `SAMPLE_EXPORT_NAME = 'atlas-sample-system-device-map.json'`, `LOCAL_EXPORT_NAME = 'system_device_map.json'`
  - Python: `canonical_map_json(raw) -> str`

**What `canonicalMapObject` writes:**
- **The map's own top-level keys.** Every top-level key of `raw` except `default_site`, `sites`, `pending_review` and `confidence_counts`. When `raw.sites` is not an object, `mappings`, `not_deployed_at_northgate` and `unclaimed_devices` are dropped too. After those come `default_site` (`raw.default_site ?? first site id ?? null`), `sites` and `pending_review` (`raw.pending_review ?? {}`).
- **Each site.**
  - The raw block's keys other than `label`, `scope`, `mappings`, `not_deployed_at_site`, `not_deployed_at_northgate`, `unclaimed_devices` and `decision_roots`.
  - Then `label`, `scope`, `mappings`, `not_deployed_at_site`, `unclaimed_devices`, taken from `coverage.sites[id]`.
  - Then `decision_roots`, when the coverage site carries it.
  - `confidence_counts` is never written.
- **Python.** `canonical_map_json` applies the same normalisation itself: the label defaults to the site id, the scope to `''`, each mapping gains `devices: []`, the legacy flat map is wrapped as `northgate` with the TS label and scope, and `decision_roots` is kept whenever the key is present. Use `x if x is not None else default` wherever TypeScript uses `??`.
- **The sample** (`raw === null`). `{ _comment, _version: '0.2-sample', default_site, sites, pending_review }`, with `_comment` set to `Synthetic ATLAS sample data, edited in ATLAS on <today>. It describes no real site.`
- **The file name.** `fileName` is `SAMPLE_EXPORT_NAME` for `source: 'sample'`, otherwise `LOCAL_EXPORT_NAME`.

- [ ] **Step 1: Write the failing tests**

Parity: for every case with no failures, both engines' output must equal `readFileSync('<name>.out.json', 'utf-8')` exactly. Create each `.out.json` from Python, running `canonical_map_json(case["map"])` once. Read `unknown-keys.out.json`, `legacy-flat.out.json` and `site-alias.out.json` by hand against the rules above before committing them.

`serialise.test.ts`:
- `canonicalJson({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: 'é' } })` equals the literal Python output, written in the test.
- Re-serialising a case's `.out.json` (as `raw`) returns the same bytes.
- `exportSystemDeviceMap` on the unedited sample coverage returns `fileName` `atlas-sample-system-device-map.json`. Its text parses to `_version` `'0.2-sample'`, a `_comment` containing `2026-11-13` and `describes no real site`, and no `confidence_counts`.
- `exportSystemDeviceMap` with a `raw` that holds `{"_comment": "analyst note", "owner": "range team"}` keeps both keys.
- A `LocalFileProvider` loaded with a map file returns that file's parsed object from `getSourceSystemDeviceMap()`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/curation && python3 -m pytest ingest/tests/test_curation_parity.py -q`
Expected: FAIL (missing functions, missing `.out.json` files).

- [ ] **Step 3: Implement `serialise.ts`, `canonical_map_json`, and the raw map on `LocalFileProvider`**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src && python3 -m pytest ingest/tests -q && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/curation src/data fixtures/parity ingest/src/atlas_ingest/curation.py ingest/tests/test_curation_parity.py
git commit -m "write the device map one canonical way in both engines, keeping the analyst's own keys"
```

---

### Task 4: The edits module

**Files:**
- Create: `src/curation/edits.ts`
- Create: `fixtures/parity/sample-walk/system_device_map.json`
- Test: `src/curation/__tests__/edits.test.ts`

**Interfaces:**
- Consumes: `ReviewStamp`, `CheckedDevice` (Task 2); `realizedConfidenceCounts`, `isShortfall` (`src/lib/coverage.ts`); `exportSystemDeviceMap` (Task 3).
- Produces:

```ts
type Grade = 'high' | 'medium' | 'low'
export type Review =
  | ({ status: 'found'; devices: DeviceId[]; confidence: Grade; note: string } & ReviewStamp)
  | ({ status: 'no-hardware'; confidence: Grade; note: string } & ReviewStamp)
  | ({ status: 'absent'; reason: string } & ReviewStamp)
  | { status: 'clear' }
export type Edit =
  | { kind: 'review'; site: SiteId; system: SystemId; review: Review }
  | { kind: 'check'; site: SiteId; device: DeviceId; check: CheckedDevice | null }
export class CurationError extends Error {}
export function editKey(edit: Edit): string
export function upsertEdit(edits: readonly Edit[], edit: Edit): Edit[]
export function applyEdit(coverage: CoverageMatrix, edit: Edit, systems: readonly System[]): CoverageMatrix
export function applyEdits(coverage: CoverageMatrix, edits: readonly Edit[], systems: readonly System[]): CoverageMatrix
```

**Semantics:**
- `editKey` is `${site}\0system\0${system}` or `${site}\0device\0${device}`.
- `upsertEdit` removes any edit with the same key and appends the new one, so the last word on a row is replayed last.
- `applyEdit` is pure: it copies the site it touches and never mutates its input. It throws `CurationError`:
  - for a review of a shortfall system, or of an id the matrix lacks;
  - for `found` with no devices;
  - for `absent` with a blank reason;
  - for a check on a device a mapping at that site names.
- **`found`.** Write the mapping: devices deduplicated in the given order, the grade, the note, the stamp, and any other keys the prior mapping carried. Delete the system's absence. Each device it now names leaves the infrastructure list and loses its check.
- **`no-hardware`.** Write `devices: []` with the grade, note and stamp. Delete the absence.
- **`absent`.** Delete the mapping and write `{ reason, reviewed_by, reviewed_on }`.
- **`clear`.** Delete both.
- **Released devices.** In every case, a device that no mapping at the site still names, and that some mapping named before, is appended to the infrastructure list.
- **A check** (non-null). Write `unclaimed_devices.checked[device]`, dropping a blank note. A null check deletes the entry, and deletes `checked` once it is empty.
- `applyEdits` folds `applyEdit`, then sets `confidence_counts = realizedConfidenceCounts(result, matrixIdSet(systems))`.

- [ ] **Step 1: Write the failing tests**

```ts
const STAMP = { reviewed_by: 'Site lead', reviewed_on: '2026-11-13' }
export const SAMPLE_WALK: Edit[] = [
  { kind: 'review', site: 'westfield', system: 'beacon', review: { status: 'found', devices: ['wf_gate_sensor'], confidence: 'high', note: 'Gate sensor feeds the beacon', ...STAMP } },
  { kind: 'review', site: 'westfield', system: 'scan', review: { status: 'found', devices: ['wf_server'], confidence: 'medium', note: 'Scan service on the site server', ...STAMP } },
  { kind: 'review', site: 'westfield', system: 'trackwell', review: { status: 'found', devices: ['wf_laptop'], confidence: 'low', note: 'Trackwell client seen on the range laptop', ...STAMP } },
]
```

Put `SAMPLE_WALK` in `src/curation/__tests__/sampleWalk.ts` so Tasks 6 and 9 can reuse it. Then test:

- **The walk.** Over the sample coverage, Westfield has 3 mappings. Its infrastructure list is `['wf_firewall', 'wf_ap', 'wf_northwind_gw', 'wf_crestline_gw', 'wf_internet']`. `confidence_counts` is `{ high: +1, medium: +1, low: +1, total: 13 }` against the sample's own counts. The input object is unchanged (deep-equal to a copy taken before).
- **The export golden.** `exportSystemDeviceMap({ raw: null, coverage: walked, source: 'sample', today: '2026-11-13' }).text` equals `fixtures/parity/sample-walk/system_device_map.json` byte for byte. Create the file once from this call, read it, then commit it.
- **The result passes the gates.** `crossFileFailures` over the walked coverage with the sample's systems and topologies returns `[]`.
- **A shared device stays claimed** (Review Focus 2). Map `d1` to `alpha` and `beta`, then review `beta` as `found` on `d2`. `d1` is still off the infrastructure list. Then `clear` `alpha`: `d1` rejoins it.
- **Both records are replaced** (Review Focus 1). A system with both a mapping and an absence, reviewed `absent`, ends with only the absence. Reviewed `found`, it ends with only the mapping.
- **Checks.** Assigning a checked device drops its check. A null check removes the entry and then the emptied `checked` key.
- **Throws.** Each of the four `CurationError` cases throws.
- **Order.** `upsertEdit` keeps one edit per key, last one appended.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/curation/__tests__/edits.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `edits.ts`**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/curation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/curation fixtures/parity/sample-walk
git commit -m "turn reviews into edited coverage, keeping the unclaimed list and checks in step"
```

---

### Task 5: The walk model: standing, summary and checklist order

**Files:**
- Create: `src/curation/walk.ts`
- Test: `src/curation/__tests__/walk.test.ts`

**Interfaces:**
- Consumes: `isRealizedMapping`, `confidenceGrade`, `fieldableSystemIds`, `isReviewed`, `absenceReason` (`src/lib/coverage.ts`); `blastRadius` (`src/lib/graph.ts`); `resolveRoots`, `defaultRootChoice`, `searchRootIds` (`src/lib/dependency.ts`); `applyEdits`, `SAMPLE_WALK` (Task 4).
- Produces:

```ts
export type Standing =
  | { kind: 'realized'; mapping: Mapping }
  | { kind: 'no-hardware'; mapping: Mapping; reviewed: boolean }
  | { kind: 'absent'; reason: string; stamp: ReviewStamp | null }
  | { kind: 'none' }
export function systemStanding(site: CoverageSite, systemId: SystemId, matrixIds: ReadonlySet<SystemId>): Standing
export interface WalkSummary { fieldable: number; realized: number; noHardware: number; absent: number; notLookedAt: number; devices: number; carrying: number; checked: number; noRecord: number }
export function walkSummary(site: CoverageSite, systems: readonly System[], topology: Topology): WalkSummary
export interface DeviceRow { device: Device; systems: { id: SystemId; name: string; risk: RiskLevel | null; grade: ConfidenceGrade; outside: boolean }[]; reliance: number; check: CheckedDevice | null }
export interface Checklist {
  locate: { system: System; record: 'none' | 'survey-gap' }[]
  zones: { zoneId: string; label: string; devices: DeviceRow[] }[]
  settled: { devices: DeviceRow[]; checked: DeviceRow[]; absent: { id: SystemId; name: string; reason: string; stamp: ReviewStamp | null }[]; noHardware: { system: System; mapping: Mapping }[] }
}
export function buildChecklist(site: CoverageSite, systems: readonly System[], topology: Topology): Checklist
export const CHECKLIST_RULE: string // the verbatim rule in Global Constraints
```

**Rules (spec §5–6):**
- **Standing precedence.** Realized, then no hardware (an empty-device mapping, where `reviewed` is `isReviewed(mapping)`), then absent, then none.
- **Summary over systems.** Fieldable systems only; the four buckets sum to `fieldable`.
- **Summary over devices.** Devices come from the topology. `carrying` means a mapping at the site names the device, whether or not the mapping is in the matrix. `checked` means it has a `checked` entry and no mapping names it. `noRecord` is the rest.
- **`locate`.** Fieldable systems standing at `none`, or at `no-hardware` with `reviewed` false. Sort by risk rank (high 0, medium 1, low 2, anything else 3), then `none` before `survey-gap`, then `name`.
- **Where each device goes.** A device is settled when it has at least one mapping and every mapping is graded `high`; it goes to `settled.devices`. A device with no mapping and a check goes to `settled.checked`. Every other device is open.
- **Device key.** `[riskRank, evidenceRank, -reliance, label]`:
  - `riskRank` is the lowest rank among the risks of its mapped systems (an outside-matrix system is 3), or 4 when no mapping names it.
  - `evidenceRank` is the lowest grade rank among its mappings at that risk: `unspecified` 0, `low` 1, `medium` 2, `high` 3. A device with no mapping gets 0.
  - `reliance` is `blastRadius(topology, id, { rootIds: searchRootIds(resolveRoots(topology, site, defaultRootChoice(site))) }).unreachableCount`.
- **Zones.** Ordered by their first open device's key, then zone label. A zone with no open device has no section.
- **`settled` lists.** `devices` and `checked` are sorted by label. `absent` lists every `not_deployed_at_site` entry sorted by id, shortfalls included. `noHardware` lists reviewed empty-device mappings of fieldable systems.

- [ ] **Step 1: Write the failing tests** (values computed from the sample on 2026-11-14)

```ts
expect(walkSummary(westfield, systems, westfieldTopology)).toEqual({ fieldable: 30, realized: 0, noHardware: 0, absent: 0, notLookedAt: 30, devices: 8, carrying: 0, checked: 0, noRecord: 8 })
expect(walkSummary(northgate, systems, northgateTopology)).toEqual({ fieldable: 30, realized: 10, noHardware: 2, absent: 18, notLookedAt: 0, devices: 71, carrying: 20, checked: 0, noRecord: 51 })

const w = buildChecklist(westfield, systems, westfieldTopology)
expect(w.locate).toHaveLength(30)
expect(w.locate.map((r) => r.system.risk).slice(0, 9)).toEqual(Array(9).fill('high'))
expect(w.locate.map((r) => r.system.risk).slice(-2)).toEqual(['low', 'low'])
expect(w.zones.map((z) => z.devices.map((d) => d.device.id))).toEqual([
  ['wf_firewall', 'wf_gate_sensor', 'wf_laptop', 'wf_ap', 'wf_server'],
  ['wf_crestline_gw', 'wf_internet', 'wf_northwind_gw'],
])

const n = buildChecklist(northgate, systems, northgateTopology)
expect(n.locate.map((r) => [r.system.id, r.record])).toEqual([['kite', 'survey-gap'], ['homing', 'survey-gap']])
expect(n.zones.map((z) => z.zoneId)).toEqual(['ops_net', 'sensor_net', 'radio_net', 'perimeter', 'core', 'mgmt', 'cloud', 'annex_closet', 'north_stand', 'south_stand', 'field_house', 'wan', 'guest_net'])
expect(n.zones[0].devices.map((d) => d.device.id)).toEqual(['ops_tak_server', 'ops_laptop_cart', 'ops_workstation_a', 'ops_net_switch', 'ops_video_wall', 'ops_workstation_b'])
expect(n.zones[1].devices.map((d) => d.device.id)).toEqual(['remote_id_receiver', 'sensor_net_radar', 'sensor_net_eoir', 'sensor_net_rf_array', 'sensor_net_ptz', 'sensor_net_firewall', 'sensor_net_switch'])
expect(n.zones[4].devices[0]).toMatchObject({ device: { id: 'core_switch' }, reliance: 17 })
expect(n.settled.devices).toHaveLength(10)
expect(n.settled.absent).toHaveLength(20)

const walked = applyEdits(coverage, SAMPLE_WALK, systems).sites.westfield
const after = buildChecklist(walked, systems, westfieldTopology)
expect(after.zones[0].devices.map((d) => d.device.id)).toEqual(['wf_server', 'wf_laptop', 'wf_firewall', 'wf_ap'])
expect(after.settled.devices.map((d) => d.device.id)).toEqual(['wf_gate_sensor'])
```

Add two more:
- A site holding one system both mapped (with devices) and absent counts it once, as realized (Review Focus 1).
- A checked device moves to `settled.checked` and leaves its zone.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/curation/__tests__/walk.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `walk.ts`**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/curation`
Expected: PASS. If a hand-computed order disagrees, re-derive it from the rules above before touching code. The values were probed from the committed sample with `blastRadius` on 2026-11-14.

- [ ] **Step 5: Commit**

```bash
git add src/curation
git commit -m "order the site walk by risk, then evidence, then how much rests on each device"
```

---

### Task 6: Live edits: provider, context, banner, export band and guards

**Files:**
- Create: `src/curation/CuratedProvider.ts`, `src/curation/CurationContext.tsx`, `src/components/EditsBanner.tsx`
- Modify:
  - `src/data/ProviderContext.tsx`: `AtlasProvider` renders `CurationProvider` in place of `ProviderContext.Provider`, and `armMarking` also calls `setExportEditsNote(null)`.
  - `src/export/png.ts`, `src/export/pdf.ts`, `src/export/csv.ts`
  - `src/App.tsx`: render `<EditsBanner />` under `<DataSourceBanner />`.
  - `src/components/DataSourceBanner.tsx`: Return to sample data goes through `confirmDiscard`.
  - `src/components/LoadDataPanel.tsx`:
    - `load()` returns early unless `confirmDiscard()` passes;
    - one line in the dialog: `To keep reviews made in Site walk, use Export in the unsaved-reviews banner.`
  - `src/test/renderWithProvider.tsx`: option `curation?: boolean` wraps the UI in `CurationProvider` over the `StaticProvider`.
- Test: `src/curation/__tests__/CuratedProvider.test.ts`, `src/curation/__tests__/CurationContext.test.tsx`, `src/components/__tests__/EditsBanner.test.tsx`, `src/export/__tests__/band.test.ts`; extend `DataSourceBanner.test.tsx` and `LoadDataPanel.test.tsx`.

**Interfaces:**
- Consumes: `applyEdits`, `upsertEdit`, `editKey`, `Edit` (Task 4); `exportSystemDeviceMap` (Task 3); `localDate` (Task 2); `computeLossiness`; `downloadBlob` (`src/export/png.ts`).
- Produces:

```ts
export class CuratedProvider implements AtlasDataProvider {
  constructor(base: AtlasDataProvider, edits: readonly Edit[])
  // kind is base.kind. getCoverage memoises applyEdits(base coverage, edits, base systems).
  // getLossiness: computeLossiness over the base's systems, links and requirements, the edited
  // coverage, and getTopology for every project site. Every other getter, getSnapshots and
  // getSourceSystemDeviceMap included, delegates to the base.
}
export interface Curation {
  base: AtlasDataProvider
  source: DataSource
  edits: readonly Edit[]
  unsaved: number
  reviewer: string
  setReviewer(name: string): void
  apply(edit: Edit): void
  revert(key: string): void
  discard(): void
  confirmDiscard(): boolean
  exportMap(): Promise<void>
  exportFileName: string
}
export function CurationProvider(props: { base: AtlasDataProvider; source: DataSource; children: ReactNode }): JSX.Element
export function useCuration(): Curation
// png.ts
export function setExportEditsNote(note: string | null): void
export function getExportBand(): string | null // [marking, note].filter(Boolean).join(' · ') || null
```

**Behaviour:**
- **State and the effective provider.** State is `{ base, edits, exported: ReadonlySet<Edit> }`. When `props.base` is no longer the stored base, reset to no edits during render, using React's adjust-state-on-prop-change pattern. The effective provider, memoised on `[base, edits]`, is `edits.length ? new CuratedProvider(base, edits) : base`, served through `ProviderContext`.
- **Counting and arming.** `unsaved` is `edits.filter((e) => !exported.has(e)).length`. Every handler that changes edits arms the band synchronously, as `armMarking` does: `setExportEditsNote(unsaved ? \`Includes ${n} unsaved review${n === 1 ? '' : 's'}, not yet exported to a file\` : null)`.
- **`confirmDiscard`.** Returns true at once when `unsaved` is 0, clearing the edits. Otherwise it calls `window.confirm(\`Discard ${n} unsaved review${s}?\`)`, clears on yes, and returns the answer.
- **`exportMap`.** Builds the payload from `base.getSourceSystemDeviceMap?.() ?? null`, the effective coverage, `source.kind` and `localDate()`, downloads it, then sets `exported = new Set(edits)` and disarms the band.
- **`beforeunload`.** A listener that calls `preventDefault()` while `unsaved > 0`.
- **The banner.** Hidden with no edits.
  - With `unsaved > 0`: `N unsaved review(s). Export <exportFileName> to keep them. Closing this tab discards them.`
  - Otherwise: `N review(s) exported to <exportFileName>. They stay on screen until you close this tab; load the file to work from it.`
  - It carries Export and Discard buttons. Discard goes through `confirmDiscard`.
  - On the sample it adds `Sample only: these edits describe no real site.`
  - It carries `data-export-omit` like the other chrome.
- **Exports.** Every default read of the armed marking in `png.ts` (`elementToPngBlob`), `pdf.ts` (the per-page stamp) and `csv.ts` reads `getExportBand()` instead. An explicit `marking` option still wins.

- [ ] **Step 1: Write the failing tests**

- **`CuratedProvider`.** Over `new StaticProvider('/data')` with `SAMPLE_WALK`:
  - `getLossiness()`'s `realization_gap` has `numerator` 13, `denominator` 30 and `value_pct` 43.3;
  - its `per_site.westfield.mapped_ids` is `['beacon', 'scan', 'trackwell']`;
  - `getSnapshots()` deep-equals the base's.
- **`CurationContext`.** A probe component reads `useProvider()` and `useCuration()`:
  - with no edits, the provider is the base object;
  - after `apply`, it is a `CuratedProvider` and `getExportBand()` is `Includes 1 unsaved review, not yet exported to a file`;
  - after `exportMap` (spy on `downloadBlob`), it was called with `atlas-sample-system-device-map.json`, `unsaved` is 0 and the band is null;
  - one more `apply` makes `unsaved` 1 with 2 edits (Review Focus 5);
  - a `beforeunload` event is `defaultPrevented` only while `unsaved > 0`;
  - `useSampleData()` from the switch clears the edits.
- **Guards** (Review Focus 4). With one unsaved edit and `window.confirm` mocked to return false, clicking Return to sample data in `DataSourceBanner`, or Load in the load dialog, leaves the edits and the source unchanged. Mocked to true, the action proceeds and the edits are gone.
- **`EditsBanner`.** Each banner sentence above for N = 1 and N = 3, the sample line, Export, and Discard.
- **`band.test.ts`.**
  - `setExportMarking('TEST MARKING')` plus `setExportEditsNote('Includes 1 unsaved review, not yet exported to a file')` → `getExportBand()` is `TEST MARKING · Includes 1 unsaved review, not yet exported to a file`. (Use a made-up marking: `scripts/check-no-real-data.mjs` refuses a real one written as a value.)
  - Marking null plus the note → the note alone.
  - Both null → null.
  - `stampPdfMarking` receives the band text on every page; spy on a fake doc with 2 pages.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/curation src/components src/export`
Expected: FAIL.

- [ ] **Step 3: Implement the provider, the context, the band, the banner and the guards**

- [ ] **Step 4: Run the whole unit suite**

Run: `npm test && npm run typecheck`
Expected: PASS. Existing tabs still render through `AtlasProvider`, and `routes.test.tsx` still passes.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "show unsaved reviews live across the app, say so on every export, and guard them from a reload"
```

---

### Task 7: The Site walk tab

**Files:**
- Create: `src/tabs/walk/WalkTab.tsx`, `src/tabs/walk/ReviewForm.tsx`, `src/tabs/walk/CheckForm.tsx`
- Modify:
  - `src/components/TabBar.tsx`: append `{ path: '/walk', label: 'Site walk' }` to `TABS`. Shortcut 6 and the palette entry follow from `TABS`.
  - `src/App.tsx`: `<Route path="/walk" element={<Tab label={TABS[5].label}><WalkTab /></Tab>} />`.
  - `src/components/aboutContent.ts`: `walk`, with what the view does and where its numbers come from, and no counts.
  - `src/__tests__/routes.test.tsx`: six tabs, in this order.
  - `src/tabs/network/DeviceDetail.tsx`: under the no-mapping line, `Checked by <reviewer> on <date>: carries no system.` when the device has a check.
- Test: `src/tabs/walk/__tests__/WalkTab.test.tsx`; extend a Network test for the check line.

**Interfaces:**
- Consumes: `useCuration` (Task 6); `walkSummary`, `buildChecklist`, `systemStanding` (Task 5); `SiteSelector` (`src/tabs/network/SiteSelector.tsx`, props `{ sites, activeId, onSelect }`); `ShortfallNote` (`names`); `localDate`.
- Produces: the `/walk` route and the `data-testid="walk-summary"` element that Task 9's shots wait on.

**What the tab shows:**
- **Site and summary.**
  - A `SiteSelector`, defaulting to `coverage.default_site`.
  - A summary paragraph (`data-testid="walk-summary"`), with two lines:
    - `<realized> of <fieldable> realized · <noHardware> recorded with no hardware · <absent> checked absent · <notLookedAt> not looked at`. While edits exist, the realized figure is followed by ` (<base realized> when loaded)`, computed from `useCuration().base`.
    - `<devices> devices · <carrying> carry a recorded system · <checked> checked, carrying none · <noRecord> with no record`.
  - Then `ShortfallNote` naming the shortfall rows.
- **Systems.** Every fieldable system: name, risk, standing, the reviewer and date when stamped, and a Review button that opens `ReviewForm` inline. An edited row shows "Edited" and an Undo button (`revert(editKey)`).
- **`ReviewForm`.**
  - Status radio buttons:
    - **Found on devices:** a device picker grouped by zone (checkboxes), plus a grade of High (physically verified), Medium (strong inference) or Low (best guess).
    - **Present, no dedicated hardware:** a grade.
    - **Checked, not here:** a reason.
    - **Not looked at:** writes `{ status: 'clear' }`, shows `Removes this site's record of <name>. Nothing else is written.`, and takes no other field.
  - Every status but Not looked at takes a reviewer (prefilled from `reviewer`, which Save updates) and a date (`<input type="date">`, defaulting to `localDate()`). Found and Present also take a note.
  - Save is disabled when:
    - Found has no device;
    - Checked has a blank reason;
    - the reviewer is blank;
    - the date fails `isCalendarDate`.
- **Devices by zone.** Zones in the checklist order, then fully settled zones by label. Each device row shows its systems with their grades, and "Assign to systems", which opens `ReviewForm` for a chosen system with the device preselected.
  - A device that no mapping names also offers `Checked, carries no system`, which opens `CheckForm` (reviewer, date, optional note).
  - A checked device shows who checked it and when, and Clear check.
  - A mapping outside the matrix shows as `<id> (outside the matrix)` with no edit control.
- **Print checklist.** A button that calls `window.print()`; Task 8 supplies the printout.
- **Phone width.** At 375px the rows stack. The device picker is a collapsible list per zone (builder's call within the existing tokens).

- [ ] **Step 1: Write the failing tests**, with `renderWithProvider(<WalkTab />, { curation: true })`

- Switching to Westfield shows `0 of 30 realized · 0 recorded with no hardware · 0 checked absent · 30 not looked at` and `8 devices · 0 carry a recorded system · 0 checked, carrying none · 8 with no record`. Northgate shows `10 of 30 realized · 2 recorded with no hardware · 18 checked absent · 0 not looked at`.
- At Westfield, review Beacon as Found on `Gate Detection Sensor`, grade High, reviewer `Site lead` → the summary reads `1 of 30 realized (0 when loaded)`, and the row shows Edited. Undo → `0 of 30 realized`.
- Save is disabled in each of the four cases above.
- `Checked, carries no system` on `Northwind Telecom GW` → `1 checked, carrying none`. The action is absent on a device a mapping names.
- At Northgate, `ATAK / iTAK Field Devices` shows `atak (outside the matrix)` and no Assign or Review control for it.
- `dispatch` and `partner` appear only in the shortfall note, not as system rows.
- In `routes.test.tsx`, the six labels in order end with `Site walk`.
- On the Network tab, with a curation edit checking a device, its detail panel shows `Checked by Site lead on 2026-11-13: carries no system.`

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/tabs/walk src/__tests__/routes.test.tsx src/tabs/network`
Expected: FAIL.

- [ ] **Step 3: Implement the tab, the forms, the route, the About entry and the device-detail line**

- [ ] **Step 4: Run the whole unit suite**

Run: `npm test && npm run typecheck`
Expected: PASS. The About no-counts test, the CommandPalette test and the shortcuts test all pass, with 6 views and keys 1–6.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "add the Site walk tab: record what was found per system and per device"
```

---

### Task 8: The printed checklist, and the rule in Methodology

**Files:**
- Create: `src/tabs/walk/ChecklistPrint.tsx`, rendered inside `WalkTab`, hidden on screen (`hidden print:block`)
- Modify: `src/styles/index.css`, with an `@media print` block:
  - hide `header`, `[data-print-hide]` (both banners, the tab's interactive body and its forms);
  - force the light colour tokens;
  - give `.checklist-row` `break-inside: avoid`;
  - draw boxes as bordered squares and blanks as underlines.
- Modify: `src/tabs/reference/MethodologySection.tsx`: add the rule, `CHECKLIST_RULE`, as a paragraph.
- Test: `src/tabs/walk/__tests__/ChecklistPrint.test.tsx`; extend `src/tabs/reference/__tests__/ReferenceTab.test.tsx`.

**Interfaces:**
- Consumes: `buildChecklist`, `CHECKLIST_RULE` (Task 5); `useCuration` (`source`, `unsaved`); `UNMARKED_NOTICE` (`src/data/ProviderContext.tsx`).

**Layout (spec §6):**
- **Header.**
  - The site label.
  - The marking: `topology.meta.classification` on the sample, or else `source.marking ?? UNMARKED_NOTICE`.
  - `Data: <source.label>` and `Printed <localDate()>`.
  - `Reviewer ________  Date ________`.
  - `CHECKLIST_RULE`.
  - When `unsaved > 0`, the band line.
- **Section A, Systems to locate.** One row per `locate` entry, with:
  - a box;
  - the name and risk;
  - `survey gap` when `record` is `survey-gap`;
  - `found on ____________ grade H  M  L`;
  - `or not here: ____________`.
- **Section B and on.** One `<section>` per zone, headed with the zone label. Each device row has:
  - a box and the label;
  - each system with its grade, or `no system recorded`;
  - `carries: ____________`;
  - a box for `carries no system`.
- **Section D, Already settled.** Four compact lists: devices physically verified, devices checked as carrying no system (with who and when), systems checked absent (with reasons, from `absenceReason`), and systems recorded with no dedicated hardware.

- [ ] **Step 1: Write the failing tests**

- For Northgate on the sample, the header holds `UNCLASSIFIED//SAMPLE`, `Data: Sample data` and `CHECKLIST_RULE` verbatim. Section headings run `A. Systems to locate`, then the 13 zone labels in Task 5's order, then `D. Already settled`. Section A lists Kite, then Homing.
- After one `apply`, the header holds `Includes 1 unsaved review, not yet exported to a file`.
- The Reference tab's Methodology section contains `CHECKLIST_RULE`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/tabs/walk src/tabs/reference`
Expected: FAIL.

- [ ] **Step 3: Implement the printout, the print stylesheet and the Methodology paragraph**

- [ ] **Step 4: Run them and see them pass, then build**

Run: `npm test && npm run build`
Expected: PASS. `check-offline` reports no remote reference.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "print the site walk as a checklist, riskiest first, and state the order in Methodology"
```

---

### Task 9: End-to-end round trip, the ingest round trip, and the visual baselines

**Files:**
- Create: `e2e/walk.spec.ts`, `ingest/tests/test_curation_roundtrip.py`
- Modify:
  - `e2e/shots.ts`:
    - add `{ path: '/walk', name: 'walk', heading: /Site walk/i, proof: (page) => page.getByTestId('walk-summary') }` to `TABS`;
    - add `PRINT_SHOTS = ['walk-print.png']` to `SHOTS`.
  - `e2e/visual.spec.ts`: a `walk renders for print` test, using `page.emulateMedia({ media: 'print', colorScheme: 'light' })`, then `toHaveScreenshot('walk-print.png')` with the same options the tab shots use.
  - `e2e/standalone.spec.ts`: add `'Site walk'` to the tab list.
  - `e2e/__screenshots__/darwin-arm64/*.png` and `e2e/__screenshots__/linux-x64-noble-pw1.62.1/*.png`: every file, plus the three new ones.

**Interfaces:**
- Consumes: the UI from Tasks 6–8; `fixtures/parity/sample-walk/system_device_map.json` (Task 4); the `sample_source_repo` and `build_bundle_from` helpers in `ingest/tests/conftest.py`.

- [ ] **Step 1: Write the failing tests**

`e2e/walk.spec.ts`, `the Westfield walk survives an export and a reload`:
1. Go to `/walk` and choose Westfield. Review `beacon`, `scan` and `trackwell` as in `SAMPLE_WALK`, through the form.
2. Assert the banner reads `3 unsaved reviews`.
3. On `/lossiness`, assert the realization gap reads 13 of 30 (43.3%). On `/analytics`, assert the coverage panel shows Westfield's 3.
4. Click Export and save the download.
5. Open Load data and download each sample template from the panel into a temp directory. Pick the matrix, glossary, overrides and both topologies from there, with the exported map in the map slot. Accept the discard prompt with `page.once('dialog', (d) => d.accept())`.
6. Assert the same two figures, and that no unsaved-reviews banner is shown.

`test_curation_roundtrip.py`, `test_an_exported_walk_ingests_to_the_same_figures`:
1. Copy `sample_source_repo` to `tmp_path`.
2. Replace its system to device map with `fixtures/parity/sample-walk/system_device_map.json`.
3. Assert `validate(...)` returns `[]`.
4. Run `build_bundle_from`, then assert `realization_gap` has `numerator` 13 and `per_site.westfield.mapped_ids` equal to `["beacon", "scan", "trackwell"]`.
5. Assert `coverage.json` carries `reviewed_by: "Site lead"` on `westfield.mappings.beacon`.

- [ ] **Step 2: Run them and see them fail, then pass**

Run: `python3 -m pytest ingest/tests/test_curation_roundtrip.py -q` and `npx playwright test e2e/walk.spec.ts`
Expected: they pass once the earlier tasks are in. A failure here is a real defect in Tasks 2–8; fix it there, not in this test.

- [ ] **Step 3: Refresh the darwin baselines and review them**

Run: `npm run e2e:update`, then `git status --short e2e/__screenshots__`.
Expected: every darwin baseline changes (the tab bar gained a tab), and `walk-light.png`, `walk-dark.png` and `walk-print.png` are new.
- Open each changed file. The only difference from the old one should be the sixth tab, plus the banner area where relevant.
- Open each new one. The print shot shows no header, no banners and no forms, in black on white.
- Then run `npm run e2e`. Expected: PASS, the inventory check included.

- [ ] **Step 4: Commit, then refresh the Linux baselines through CI**

```bash
git add e2e ingest/tests/test_curation_roundtrip.py
git commit -m "prove the walk survives export and re-ingest, and refresh the baselines for the sixth tab"
git push -u origin HEAD
gh workflow run ci.yml --ref "$(git branch --show-current)" -f refresh_baselines=true
```

When that run finishes:
1. Download its `refreshed-baselines` artifact with `gh run download <run-id> -n refreshed-baselines -D /tmp/claude-baselines`.
2. Copy the `linux-x64-noble-pw1.62.1` set into `e2e/__screenshots__/`.
3. Review the files as in Step 3.
4. Commit with `git commit -m "refresh the Linux baselines for the Site walk tab"` and push.

---

### Task 10: The pull request

- [ ] **Step 1: Run every gate locally**

Run: `npm test && npm run typecheck && npm run build && npm run test:ingest && npm run build:standalone && npm run test:standalone && npm run e2e:standalone`
Expected: PASS.

- [ ] **Step 2: Open the PR**

`gh pr create --base main --title "Site walk: record reviews in the app and print the walk checklist" --body-file -`. The body should cover:
- what a reviewer can now do;
- the file fields and the ten new messages;
- the parity fixtures;
- the open-questions order change (one list reordered, no figure changed);
- the baselines refreshed in both environments.

No attribution lines.

- [ ] **Step 3: Bind the PR and read CI**

Call `get_status`, then `bind_pr` if the PR is not reported. Read CI once, and offer Auto-fix. Do not poll.
