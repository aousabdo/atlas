# In-app curation and site-walk checklist: design

First-wave analytics item 6, the last of the six. Definition:
`atlas-plan/ATLAS-analytics-brainstorm.md`, first wave item 6 and the
"In-app curation, site-walk checklist and workspace file" entry under
Evidence, uncertainty and curation.

## Why

Curation is the only thing that can move the realization figure. A system
counts as realized at a site only when the system to device map names a device
for it, and today the only way to say so is to hand-edit
`system_device_map.json`. The sample's Westfield site has nothing recorded, so
it reads 0 of 30 and every Westfield view says "not reviewed". Finishing this
item lets the first wave be reported as complete.

The question it answers: how do I walk Westfield with ATLAS in hand, write down
what I found, and have the figures reflect it?

## Goals

- A reviewer records, per system per site, what they found: a status, an
  evidence grade, who, when and a note. From a device, they can assign it to
  systems.
- The edits take effect across the whole app as they are made.
- The result exports as `system_device_map.json`, the file both engines
  already read. Loading it through the Load data panel, or passing it to the
  ingest's `--system-device-map`, reproduces the same figures.
- A printable site-walk checklist, generated from the current data (edits
  included), grouped by zone, riskiest first.

## Non-goals

- No backend, no accounts, no sign-off. Attestations are a 2.0 idea.
- No merging of two reviewers' exports. The export replaces the file.
- No `.atlas` workspace file, JSON Patch log or digest binding. That is the
  long-range version of this idea and is out of this item's size.
- No editing of the workbook, the overrides file, the glossary, the topology,
  `pending_review` or `decision_roots` from this view.
- No encryption.

## Anti-goals (failure even if it technically works)

- A figure that rests on unsaved edits without saying so.
- Anything written to browser storage. The data notice promises that nothing
  is, and the theme preference is the only existing exception.
- The browser and the ingest reading one exported file differently, or
  refusing it in different words.
- A sample edit that leaves the hosted site looking like real data.
- Copy that claims more than was measured: "not looked at" must never read as
  zero, and the checklist's ordering rule is printed, not implied.

## Constraints

- Repo conventions: test first; the two engines agree and give identical error
  messages; `docs/data-inputs.md` lists every message the loaders can build and
  a test enforces that (`TemplateDownloads.test.tsx`).
- Offline: the build fails on any remote reference (`check-offline.mjs`), and
  the standalone single-file build must keep working from `file://`.
- The hosted site (atlas.oceansllc.com) serves the fabricated sample only.
- The About drawer text may not state counts (a test enforces this).
- Visual baselines exist for two render environments. CI's Linux set is
  refreshed with the `refresh_baselines` workflow dispatch and committed after
  review. The darwin set is refreshed locally with `npm run e2e:update`.

## Approaches considered

**Where a review is written.** Chosen: **A.**

- **A. Update `system_device_map.json` itself (chosen).** Reviews become
  mappings or checked absences in the file realization already reads, plus two
  optional fields. No new input, no new CLI flag, and the realization code is
  untouched. Cost: an export replaces the previous file wholesale, and two
  reviewers' files cannot be merged by the tool.
- B. A new reviews file overlaid on the map by both engines. Keeps the
  original intact and every review as a record, but adds a sixth input, a CLI
  flag, and a merge rule both engines must implement identically.
- C. The brainstorm's `.atlas` workspace (JSON Patch, digest-bound). Closest to
  the long-range idea, well over this item's M size.

**Where unsaved edits show their effect.** Chosen: **live across the app.**

- Live (chosen): every tab reflects the edits immediately and a banner says
  they are unsaved. More useful during a walk. Cost: figures can rest on work
  that dies with the tab, so the banner must say so on every view.
- Preview inside the walk view only: no figure elsewhere ever comes from an
  unsaved edit, but the reviewer sees no effect until export and reload.

**Checklist order.** Chosen: **the system's risk level first, then the
weakest evidence first.** The alternative, weakest evidence first regardless of
risk, would raise the most grades per hour, but it puts a low-risk guess ahead
of a high-risk inference.

**Devices with no system recorded.** Chosen: **a reviewer can record a device
as checked, carrying no system.** That is 51 of Northgate's 71 devices and all
8 at Westfield, many of them switches and firewalls that will never carry a
matrix system.

- Record checked devices (chosen): one optional field, read and gated the same
  way by both engines. A checked device moves to the settled section, so a
  walk can finish. Cost: a third kind of record in the file.
- List them, no record: no new field, but a device stays open until a system
  is assigned to it, so Northgate's printout lists 51 such rows on every walk.
- List only the devices the Network triage calls load-bearing: ruled out,
  because an unreviewed site has no triage, so Westfield's checklist would have
  no zones at all.

## Design

### 1. The file

`system_device_map.json` keeps its shape (docs/data-inputs.md section 4). Three
things are added, and all are optional, so every existing file loads as it
does today.

**On a mapping**, two new fields:

```json
"bastion": {
  "devices": ["field_house_effector"],
  "confidence": "high",
  "note": "Effector pair seen in the field house closet",
  "reviewed_by": "Site lead",
  "reviewed_on": "2026-11-13"
}
```

**On a checked absence**, the value may stay a bare reason string, as now, or
become an object:

```json
"not_deployed_at_site": {
  "cbpsen": "Checked with the range lead: no CBP Sentinel feed here",
  "fathom": {
    "reason": "No sonar on a dry range",
    "reviewed_by": "Site lead",
    "reviewed_on": "2026-11-13"
  }
}
```

Today no code reads the reason text: every consumer only tests key presence
(`in`, `Object.keys`, `sorted(...)`). So the widened value changes no figure.
The browser type becomes `string | CheckedAbsence`, and one helper,
`absenceReason()`, reads the text wherever it is shown.

An absence takes no separate `note`. Its reason is its note, and the form
shows only the reason field for that status (builder's call, after review).

**A mapping with no devices** already has two readings in this repo.
`docs/data-inputs.md` and `coverage.ts` call it a survey gap, meaning hardware
not yet identified. The sample's own notes on `homing` and `kite` say
"client software, no dedicated hardware". The review fields separate the two
(builder's call):

- An empty-device mapping **with** `reviewed_by` and `reviewed_on` is a
  reviewer's statement that the system has no dedicated hardware. It is
  settled.
- An empty-device mapping **without** them stays a survey gap. It is open.

The form status "Present, no dedicated hardware" always writes the review
fields, so it always produces the first kind. `docs/data-inputs.md` section 4
says this. On the unedited sample, `homing` and `kite` carry no review fields,
so they show as open until someone reviews them.

**The infrastructure list.** `unclaimed_devices.infrastructure` is defined
by the project as the devices no mapping names. `synthetic.build_sdmap`
derives it that way, and Methodology and the Network triage read it beside the
mappings. Edits keep it in step (builder's call):

- When a device gains its first mapping at a site, it leaves the list.
- When it loses its last mapping, it joins the list.
- No other entry is touched, so a hand-maintained list that already disagrees
  with its mappings is left as the analyst wrote it.

The list cannot be edited directly.

**A device checked and found to carry no system** (the user's call). A new
optional map beside the infrastructure list, keyed by device id:

```json
"unclaimed_devices": {
  "infrastructure": ["wf_firewall", "wf_northwind_gw"],
  "checked": {
    "wf_northwind_gw": {
      "reviewed_by": "Site lead",
      "reviewed_on": "2026-11-13",
      "note": "Carrier gateway; carries no matrix system"
    }
  }
}
```

- `reviewed_by` and `reviewed_on` are required, because the entry is itself a
  review. `note` is optional.
- A checked device is still unclaimed. It stays on the infrastructure list,
  and the orphaned-hardware dimension still counts it, because a check does
  not make a device claimed. No figure reads `checked`; it only settles the
  device on the walk.
- A device a mapping names cannot also be checked. The edits keep this true:
  assigning a checked device to a system drops its check.
- The bundle already passes `unclaimed_devices` through whole, so `checked`
  reaches `coverage.json` with no ingest change beyond the gates. The browser
  type gains `checked?: Record<DeviceId, CheckedDevice>`.

**New gates.** They run in `validate.py` and in `crossFileFailures`, with the
same words in both, and they refuse the load like every other cross-file gate.
`<where>` is `system_device_map.sites.<site>.mappings.<system>`,
`system_device_map.sites.<site>.not_deployed_at_site.<system>` or
`system_device_map.sites.<site>.unclaimed_devices.checked.<device>`.

- `<where>: reviewed_by and reviewed_on go together; give both or neither`
- `<where>: reviewed_by is blank; say who reviewed it` (blank is the existing
  `_BLANK` rule shared by both engines, not `trim()`)
- `<where>: reviewed_on '<value>' is not a date; write it as YYYY-MM-DD` (it
  must match `^\d{4}-\d{2}-\d{2}$` and be a real calendar date, so 2026-02-30
  fails)
- `<where>: must be a reason, or an object with reason, reviewed_by and reviewed_on`
  (for an absence that is neither a string nor an object)
- `<where>: no reason; say what was checked` (for an absence object whose
  reason is missing or blank)
- `system_device_map.sites.<site>.unclaimed_devices.checked: must map device
  ids to reviews` (for a `checked` value that is not an object)
- `<where>: must be an object with reviewed_by and reviewed_on` (for a checked
  entry that is not an object, or lacks either field; blank and bad-date
  values then get the two shared messages above)
- `<where>: mappings.<system> lists this device; a device checked as carrying
  no system takes no mapping`
- `system_device_map.sites.<site>.unclaimed_devices.checked: device '<device>'
  is not in the <site> topology` (only when that topology is loaded, worded
  like the existing infrastructure-list gate)

There is no "date in the future" gate. It would make the gate depend on the
clock, which breaks the deterministic tests and the byte-identical rebuild.

**Builder's call:** keys a loader does not know stay ignored, as now.

**The ingest.** `load_system_device_map` passes the new fields through, and
`bundle.py` carries them into `coverage.json`. The sample map gets no review
fields, so the committed sample bundle changes in one place only: the
open-questions order fix in section 3. The sample stays unreviewed at
Westfield on purpose, because it is the demonstration.

### 2. One canonical serialisation, in both engines

The browser exports the map. The Python gains a function that writes the same
bytes (`curation.canonical_map_json(sdmap)`), so the writer has an engine of
its own to agree with:

- Top-level keys: `_comment` and `_version` when present, then `default_site`,
  `sites` and `pending_review`. Keys are sorted at every level, as in
  `json.dumps(..., sort_keys=True, indent=2, ensure_ascii=False)`, with a
  trailing newline. The browser sorts keys recursively and writes the result
  with a small writer of its own, because `JSON.stringify` always puts
  integer-like keys first. The two must match byte for byte, non-ASCII text
  included.
- `confidence_counts` is never written. It is recomputed on every read.
- Unknown keys from the file that was loaded are preserved. To make that
  possible, the LocalFileProvider keeps the raw parsed map, and the export
  overlays the edited sites onto it, so an analyst's own `_comment` survives an
  edit.
- On the sample, the export carries `_version: "0.2-sample"` and a `_comment`
  saying it is the synthetic sample edited in ATLAS on a given date. It
  downloads as `atlas-sample-system-device-map.json`, the same name as the
  template. On local data it downloads as `system_device_map.json`.

A re-export of an unedited map is byte-identical to a canonical export of the
same map, in both engines.

### 3. Parity tests: one set of cases, read by both engines

Today's cross-engine pattern is mirrored tables of cases (`PCT_CASES`) kept by
hand in a `.test.ts` and a `test_*.py`. This item uses shared fixture files
instead, so the two tables cannot drift:

- `fixtures/parity/curation/*.json`. Each case holds the input map, the matrix
  ids, the shortfall ids and the topology device ids per site, plus the
  expected results: the failure strings, the realization detail
  (`per_site.*.mapped_ids`, `checked_absent`, `by_confidence`), and the
  canonical serialisation. The serialisation is stored in a sibling `.out.json`
  holding the exact bytes.
- A vitest file and a pytest file both iterate every case. Adding a case adds
  it to both.
- Cases cover at least: no review fields (today's files), a reviewed mapping, a
  string absence, an object absence, a checked device, every new gate
  (a checked device that a mapping also names, and one not on the drawing,
  included), a bad calendar date, non-ASCII reviewer text, and a Westfield walk
  that moves realization from 0 to a known number.
- **Full-sample parity** (new): `computeLossiness` over the committed sample
  inputs deep-equals `fixtures/synthetic/lossiness.json`, dimensions and
  `top_gaps` both. The live layer (section 4) swaps the Python's report for the
  browser's as soon as one edit exists, so the two must already agree on the
  unedited sample.

  **Checked on 2026-11-13:** every dimension's figures, every detail list
  except one, and `top_gaps` are identical. The exception is the order of
  `open_questions.detail.questions`. The Python lists them in the source map's
  order, while the browser reads `coverage.json`, whose keys are sorted, and so
  lists them alphabetically by subject. The counts are equal. Fixed first, as
  the builder's call: both engines sort the questions by subject, and the
  committed sample `lossiness.json` is regenerated. That rewrites the order of
  one list and changes no figure.

### 4. The edits layer (live across the app)

- **A pure module, `src/curation/`.** It holds the edit operations as
  functions from coverage to coverage: `setReview(site, system, review)`,
  `clearReview(site, system)`, `assignDevice(site, device, systems)`,
  `checkDevice(site, device, {reviewed_by, reviewed_on, note})` and
  `clearCheck(site, device)`. A review is one of
  `{status: 'found', devices, confidence}`,
  `{status: 'no-hardware', confidence}`, `{status: 'absent', reason}` or
  `{status: 'clear'}`. All but `absent` carry `note`, and all of them carry
  `reviewed_by` and `reviewed_on`. The module also produces the change list
  the banner counts: one entry per (site, system) reviewed and one per
  (site, device) checked or cleared, each with its before and after. The
  infrastructure-list upkeep in section 1, and the dropped check when a checked
  device is assigned, are consequences of a review, not changes of their own,
  so three reviews read as 3.
- **`CuratedProvider` wraps the loaded provider.** With no edits, it is not
  used at all, and the tabs read the base provider exactly as today. With
  edits:
  - `getCoverage` returns the edited coverage with `confidence_counts`
    recomputed.
  - `getLossiness` recomputes with `computeLossiness` over the base's systems,
    links, requirements and topologies (one `getTopology` per project site)
    and the edited coverage.
  - Every other getter passes through, snapshots included. Snapshots record
    builds, and the Trend view compares snapshots with each other, never with
    the live report.
- **A `CurationContext` sits above the provider switch.** It holds the edits,
  and the effective provider is `edits.length ? new CuratedProvider(base,
  edits) : base`. Every edit makes a new provider object, so `useAtlas`
  refetches in every mounted tab.
- **A banner under `DataSourceBanner`, shown only while edits exist.** It reads
  "N unsaved reviews. Export system_device_map.json to keep them. Closing this
  tab discards them." It carries Export and Discard buttons. On the sample it
  adds "Sample only: these edits describe no real site."
- **Unsaved edits are guarded.** While edits exist:
  - a `beforeunload` handler raises the browser's leave-page prompt;
  - loading new files, or Return to sample data, first confirms "Discard N
    unsaved reviews?" and then clears them.
  - Nothing is written to storage. The reviewer's name is remembered in memory
    for the session only.
- **Exports say so too.** The banner sits outside `<main>`, which is what
  PNG, PDF and CSV capture, and anti-goal 1 forbids a figure resting on
  unsaved edits without saying so. While edits exist, the export register
  (`src/export/png.ts`) carries a second line beside the marking:
  "Includes N unsaved reviews, not yet exported to a file". It is burnt in
  wherever the marking is, on every PDF page included, and it goes as soon as
  the edits are exported or discarded. The printed checklist's header carries
  the same line.
- **The Load data panel.** Its sample templates still read the sample bundle,
  not the edited one. The panel gains one line saying that the edited map
  comes from the banner's Export.

### 5. The Site walk tab

- **Placement.** Route `/walk`, sixth in `TABS` as "Site walk", shortcut `6`,
  an `ABOUT.walk` entry with no counts, and a palette entry. It works at 375px
  width.
- **Top of the tab.** A site selector (the project's sites, defaulting to
  `default_site`), followed by a summary line computed by the same predicates
  as the coverage panel. Its four buckets cover the fieldable systems only,
  are disjoint, and sum to the denominator:
  - realized;
  - recorded with no hardware;
  - checked absent;
  - not looked at.

  Shortfall rows are left out and named by `ShortfallNote`. Examples:
  - Westfield: "0 of 30 realized · 0 recorded with no hardware · 0 checked
    absent · 30 not looked at".
  - Northgate: "10 of 30 realized · 2 recorded with no hardware · 18 checked
    absent · 0 not looked at".
  - With edits, the realized figure adds "(0 when loaded)".

  A second line counts the site's devices in three disjoint buckets that sum
  to the drawing's device count: carry a recorded system (named by any
  mapping), checked and carrying none, and no record. Westfield: "8 devices ·
  0 carry a recorded system · 0 checked, carrying none · 8 with no record".
  Northgate: "71 devices · 20 carry a recorded system · 0 checked, carrying
  none · 51 with no record".
- **Every row opens one inline review form:**
  - **Status:** Found on devices / Present, no dedicated hardware / Checked,
    not here / Not looked at.
  - **Found on devices:** a device picker, the site's devices grouped by zone,
    plus a grade: High (physically verified) / Medium (strong inference) / Low
    (best guess).
  - **Checked, not here:** a reason.
  - **Always:** a reviewer (prefilled from the session) and a date (prefilled
    with today's local date). Every status but Checked also takes a note.
  - Save writes one edit. A Found review with no device, and a Checked review
    with a blank reason, cannot be saved. Every other gate in section 1 is made
    unreachable by the form.
- **Device rows** offer "Assign to systems", which opens the review form for a
  chosen system with this device preselected. A device no mapping names also
  offers "Checked, carries no system", which takes a reviewer, a date and an
  optional note. A checked device shows who checked it and when, with "Clear
  check".
- **The Network tab's device detail** shows a check under its existing "No
  system mapping recorded" line: "Checked by <reviewer> on <date>: carries no
  system." The triage and its figures are unchanged (builder's call).
- **Rows that are not reviewable here.** Shortfall rows take no mapping, so
  they are not listed as systems to locate. `ShortfallNote` names them, and
  checking one absent is left to the file. Mappings outside the matrix
  (`matrix_id_exists: false`, such as `atak`) show read-only in their zone.
- **Print checklist** calls `window.print()`. A print stylesheet hides the
  header, tabs, banners and forms, forces light colours, and lays the checklist
  out (see section 6).

### 6. The checklist and its order

Generated for one site from the current coverage, edits included, and the
site's topology. Printed in this order:

1. **Header.**
   - Site label.
   - The marking: the topology's `classification` on the sample; on local data,
     the stated marking or `MARKING NOT STATED IN THE LOADED FILES`.
   - The data source.
   - Print date, and blank lines for reviewer and date.
   - The ordering rule, in words.
2. **A. Systems to locate.** Fieldable systems with no record at this site
   (no mapping, no checked absence), plus survey gaps (an empty-device mapping
   with no review fields, see section 1). Ordered by risk level, high then
   medium then low then any other. At the same risk, no record comes before a
   survey gap. Then by name. Each row has a box, the system name
   and risk, "found on ____ grade H M L" and "or not here: ____".
3. **B onward, one section per zone.** Every device in the zone that still has
   something open, with the systems believed to run on it and each one's
   grade, or "no system recorded", plus a line for "carries: ____" and a box
   for "carries no system". A device is settled, and moves to section D, when
   it has mappings and every one of them is high grade, or when no mapping
   names it and a reviewer checked that it carries no system.
4. **D. Already settled.** Devices whose every mapping is physically verified,
   devices checked and found to carry no system (with who and when), systems
   checked absent (with reasons), and systems a reviewer recorded as having no
   dedicated hardware. Each list is compact, for re-confirmation if there is
   time.

**The order within a zone and between zones.** Each open device gets a key:

- **Risk rank:** the best (lowest) risk rank among the systems mapped to it at
  this site (high 0, medium 1, low 2, other 3). A device with no system gets
  rank 4, after every banded device.
- **Evidence rank:** among the mappings at that best risk, the weakest
  evidence: ungraded 0, low 1, medium 2. Devices with no system all tie at 0.
- **Reliance:** how many devices lose their path on the drawing if this one
  fails, using `blastRadius(...).unreachableCount` over physical links, rooted
  as the Network tab roots that site by default (declared decision roots where
  the site has them, otherwise the drawing's entry points). Higher comes first.
- **Name:** the device label, alphabetical.

Devices sort by (risk rank, evidence rank, −reliance, label). Zones sort by
their first device's key, then by zone label. At Westfield no device carries a
system, so the order there is by reliance, then name, and the printed rule says
so.

The printed rule, verbatim: "Ordered by the risk level the workbook gives each
system, high first. At the same level, the weakest evidence comes first: no
record, ungraded, best guess, strong inference. Devices with no system recorded
follow, most relied on first. Physically verified items, and devices checked
and found to carry no system, are listed last."

The same rule is added to the Reference tab's Methodology section.

**Print layout.**
- Rows never split across a page (`break-inside: avoid`).
- Each zone starts on a new line block, not a new page.
- Boxes are bordered squares and blanks are underlines, so the printout works
  in black and white.

### 7. The hosted site

Edits work on the sample exactly as on local data, in memory only. The
sample-only line in the banner, and the `_comment` in the export, say that
they describe no real site. Nothing new is fetched, stored or sent, so the
offline and no-real-data guards are unaffected.

### 8. Tests, written first

- **Parity:** the shared fixtures in section 3 (vitest and pytest), plus the
  full-sample parity test.
- **Unit:**
  - the edit functions, including the device side effects (the infrastructure
    list, and a check dropped when its device is assigned);
  - the ordering rule, against hand-computed Northgate and Westfield orders;
  - `CuratedProvider`: no edits returns the base unchanged; with edits, the
    recomputed report matches the parity fixtures;
  - the serialiser (byte-identical re-export, unknown keys kept, sample
    markers present).
- **Component:**
  - the Site walk tab (summary line, sections, form validation);
  - the edits banner (count, sample-only line, Export, Discard);
  - the discard confirmations on load and on Return to sample.
- **Docs test:** the new gate messages appear in `docs/data-inputs.md`.
  `TemplateDownloads.test.tsx` already fails if they do not.
- **End to end:** mark three Westfield systems as found. Assert the banner
  says 3 and the Lossiness and Analytics realization figures moved. Export.
  Load the sample templates with the exported map in the map slot. Assert the
  same figures with no banner. A pytest does the same round trip through the
  ingest, using the exported fixture map.
- **Visual:**
  - every existing baseline changes, because the tab bar gains a tab, so all
    are refreshed in both environments;
  - new: `walk-light`, `walk-dark` and `walk-print`, the last taken under
    `page.emulateMedia({ media: 'print' })`.
- **Standalone:** the walk tab renders from `file://` with the network cut.

### 9. Docs

- `docs/data-inputs.md` section 4: the two review fields, the object form of
  an absence, `unclaimed_devices.checked`, and the new messages in the
  cross-file list.
- The Methodology section: the checklist ordering rule.
- `ABOUT.walk`: what the view does and where its numbers come from.

## Left to the builder

- The visual design of the tab and the form, within the existing tokens and
  components.
- Exact copy, within the conventions above. The fixed strings are the gate
  messages and the printed ordering rule.
- File and component names inside `src/curation/` and `src/tabs/walk/`.
- How the device picker presents 71 Northgate devices at phone width.
