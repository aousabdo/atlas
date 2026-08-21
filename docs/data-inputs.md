# The files ATLAS reads

ATLAS takes five inputs. One is required and four are optional, and every one of
them is parsed in your browser: nothing is uploaded, nothing is stored, and
closing the tab erases the lot.

This page is the contract. Until it existed, the only complete description of
these files was `src/data/localFileParse.ts`, which meant that producing them
for your own architecture required reading the parser. Everything below is
derived from that parser and from `src/data/LocalFileProvider.ts`. A test
(`src/components/__tests__/TemplateDownloads.test.tsx`) asserts that the input
names and the required-ness in the table below still match what the loader
accepts, puts each "optional" claim to the loader itself, and checks every
message in [When a load fails](#when-a-load-fails) against the strings the code
can actually build, because a description nothing checks is wrong within a
month.

**Start from a working file, not from this page.** Open **Load data** in the
header and the panel's first block, **Sample files to start from**, downloads a
sample copy of every input: the workbook, the three JSON sidecars, and one
topology file per site in the sample. Download one, open it, replace the
contents. Every JSON template says inside itself that it is the sample rather
than leaning on its file name: the glossary and the overrides carry a `_comment`
and a `_version`, the system to device map carries a `_version`, and each
topology carries the sample bundle's own `graph.classification`. Only the last
of those is read by anything. A template that reaches somebody as an attachment,
or under a new name, still says what it is.

From a checkout, `node scripts/make-sample-workbook.mjs OUTPUT_DIR` writes the
same files under plainer names (`matrix.xlsx`, `overrides.json`,
`glossary.json`, `system_device_map.json`, `sites/<site>.json`). They are not
byte-identical to what the panel hands you: the CLI omits the `site_id` the
topology templates state, and the `_comment` and `_version` the panel adds to
the overrides file. A test compares the two file by file so they cannot diverge
anywhere else.

## The five inputs

| Input | Key | Required | What it is | What breaks without it |
|---|---|---|---|---|
| Traceability Matrix workbook (`.xlsx`) | `matrix` | required | One sheet of systems, one sheet crosswalking the original requirements to them. | Nothing loads. The load is refused and the app stays on whatever it was already showing. |
| Curation overrides (`.json`) | `overrides` | optional | Hand-curated cross links, suppressions and the desired-integration overlay. | No curated cross links and no desired integrations: only links mined from the integrations prose survive, pairs a curator struck out come back, and the integration gap is measured against a list of nothing. |
| Glossary (`.json`) | `glossary` | optional | Acronyms and the Reference tab's own prose. | The acronym table is empty, search finds no acronyms, and the confidence intro, the out-of-scope list and the methodology caveats are all blank. |
| System to device map (`.json`) | `systemDeviceMap` | optional | Which devices realize which systems, per site. | Every site reports nothing mapped, realization coverage reads zero across the whole app, and orphaned hardware and open questions are both zero because nothing records them. |
| Site topology (`.json`, one per site) | `topologies` | optional | The devices, zones and links at one site. | The Network Topology tab is empty, so there is no chokepoint finding, no blast radius and no path tracing, and search finds no devices or zones. |

The keys in that table are the field names on `LocalFileInputs`. Everything you
leave out is simply absent from the views that need it: no view invents a
number, and none of them silently reads zero as an answer.

---

## 1. Traceability Matrix workbook, required

A real `.xlsx`. Four checks run in the loader, before it hands the bytes to
SheetJS:

- a `.xlsm` name is refused outright, because macros are executable content
- `.html`, `.htm`, `.xhtml` and `.svg` are never accepted
- anything over 50 MB is refused
- the first four bytes must be the zip signature. An `.xlsx` is a zip archive,
  so the extension proves nothing.

These four checks apply to the workbook only. The JSON inputs are read with
`JSON.parse` and are not size capped.

They also gate the load rather than the whole panel, which is worth stating
plainly because it is the one place this page could mislead somebody thinking
about a hostile file. The panel's sorter opens a picked file once before any of
them run, to read its sheet names and decide which slot it belongs in, so
SheetJS has already parsed the workbook by the time the size cap and the zip
signature are checked. Only a name ending `.xlsx` is opened that way, so the
`.xlsm` refusal and the HTML refusal cannot be reached around; the size cap and
the signature check can be, and they are what stops the file **loading**, not
what stops it being read.

### Hard requirements

Three things, and a load fails loudly without them.

1. **A sheet named `Matrix`.** Matched literally and case sensitively against
   the sheet names. `matrix` or `Matrix ` is not it. The error names every sheet
   that was found instead.
2. **A `Project/System` column.** Two checks, and two different errors. First
   the header row is found: it does not have to be row 1, so the first ten rows
   are scanned for a cell whose text **contains** `Project/System`, which is how
   a title and a hand-written summary block above the header are walked past.
   Nothing found in ten rows is `no header row containing 'Project/System' in
   the first 10 rows`. Then the column itself is looked up on that row by
   **exact** trimmed text, so a header of `Project/System Name` passes the first
   check and fails the second with `no 'Project/System' column`.
3. **A crosswalk sheet.** The first sheet whose name contains `crosswalk`, case
   insensitively, so `original_to_current_crosswalk` matches. It must produce at
   least one row. This is the only source for requirement attrition, so an
   absent or empty one is refused rather than reported as zero loss.

Column headers are matched **literally**, on the trimmed cell text. Trailing
spaces in the sheet are fine; a different spelling is not, and a header that
does not match is not an error. The column is dropped, the tab still renders,
and it renders emptier. That is the failure mode to watch for.

### Columns on the Matrix sheet

| Header | Required | What it does | Without it |
|---|---|---|---|
| `Project/System` | yes | The system name. Also the source of its id and its display label. | The load fails. |
| `Capability Gap/Requirement` | no | The category, looked up in the category table to place the system on a branch. | Every system falls back to the deployed-asset category. |
| `Infrastructure/Technology` | no | Opens the detail sentence for the system. | The detail sentence loses its first clause. |
| `Owner Organization` | no | Classified into an owner group by the owner rules. | Every system lands in the External owner group and counts as unconfirmed, unless the `Confirmed` column says otherwise. |
| `Existing Interfaces` | no | The integrations prose, which is mined for links between systems. | Nothing is mined. The only links left are the ones stated by hand in the overrides file, and with no overrides file the map draws systems and nothing between them. |
| `Risk/Challenge` | no | The risk narrative, scanned for the risk keyword lists. | Risk falls back to medium for every row with no explicit `Risk Level`. |
| `Risk Level` | no | An explicit `high`, `medium` or `low`, which outranks the keyword scan. | Every risk is inferred, and the evidence gap dimension reads zero explicit. |
| `Confirmed` | no | An explicit `yes` or `no`, which outranks the ownership keywords in both directions. | Confirmation is inferred from the owner text alone. |

Two spellings of one column, because real workbooks disagree with themselves.
The integrations column is looked for under `Existing Interfaces`, then
`Currrent Integrations` (the doubled letter is not a typo here: real matrices
carry it), then `Current Integrations`. The first one present wins. If your
workbook spells it some other way, rename the header or the column is dropped
in silence.

Cell values are read leniently. `Risk Level` accepts `high`, `medium` or `low`
in any case and ignores anything else; `Confirmed` accepts `yes` or `no` in any
case and ignores anything else. Ignoring means falling back to the inferred
answer, never failing.

Every row below the header with a non-empty `Project/System` cell is a system.
A row with an empty one is skipped, so blank spacer rows and a footer are
harmless.

### The crosswalk sheet

Read by **position**, not by header name, because the first row is discarded as
a header whatever it says:

| Column | Meaning |
|---|---|
| A | The original requirement text. The row is skipped when this cell is empty, and the test is on the raw cell rather than on its trimmed text. Two consequences worth knowing: a cell holding only spaces is **not** skipped and yields a requirement with an empty original text, and a cell holding the number `0` **is** skipped. |
| B | The system it was originally attached to. |
| C | The present record. An empty cell, or one whose text contains `no matching system row` in any case, means it survived into nothing. Anything else is split on `;`, each piece trimmed, and empty pieces dropped. |
| D | The status. |

A status containing `didn't keep` or `did not keep`, with either apostrophe, is
normalised to the one spelling the attrition metric counts. Any other status is
kept as written, and an empty one becomes `Unknown`.

---

## 2. Curation overrides, optional

```json
{
  "cross_links": [
    { "from": "system_a", "to": "system_b", "label": "System A - System B" }
  ],
  "suppress_links": [["system_a", "system_c"]],
  "desired_links": [
    { "from": "system_b", "to": "system_d", "label": "System B to System D" }
  ]
}
```

- `cross_links` are links a curator asserts. They are added, marked as coming
  from an override rather than from prose, and they replace any mined link
  between the same pair.
- `suppress_links` are pairs to drop, given as two-element arrays. Order does
  not matter; the pair is compared sorted. This is how a false positive from
  prose mining is removed, and it is the one thing that cannot be recovered
  from the data afterwards, because a suppressed link is an absence.
- `desired_links` are integrations that should exist and do not. They are the
  **denominator of the integration gap**, so an absent overrides file makes that
  dimension zero out of zero, and the integration grid says only that no desired
  integrations are recorded.

Every key is optional inside the file, and an absent file is treated as an empty
one. Keys the loader does not know are ignored, which is why the sample template
carries a `_comment` and a `_version` saying that it is the synthetic sample:
those three curation keys are otherwise the whole file, and nothing inside it
would tell you what it was once it had been renamed.

No part of this file declares a site id. The load panel reads it looking for
one anyway, alongside the system to device map, because nothing stops a curator
keying overrides by site later; as the shape stands it always contributes
nothing, and the map is the only file that actually names the sites.

**Not applied today:** `risk_overrides`, `soft_overrides` and `node_order` are
accepted by the Python loader's shape normaliser and named in the browser's
`Overrides` type, but no code path reads them, in either the browser or the
ingest. Risk is overridden from the `Risk Level` column of the workbook, and
confirmation from the `Confirmed` column. The Reference tab's methodology text
still describes `risk_overrides` as a step in the risk rule; that description is
stale, and the column is the live path.

---

## 3. Glossary, optional

```json
{
  "confidence_intro": "One paragraph, shown above the confidence section.",
  "out_of_scope": ["One line per thing this dataset deliberately does not cover."],
  "methodology_extras": {
    "risk_caveat": "",
    "mapping_confidence_scale": "",
    "soft_ownership_note": ""
  },
  "acronyms": [{ "acr": "ATLAS", "meaning": "What the letters stand for" }]
}
```

If you supply this file, **supply all four keys**. Absent, the loader
substitutes an empty glossary with all four present and blank. Present but
missing a key is a different case: nothing fills it in, and the first reader of
the missing key fails at load or blanks a section. Any extra keys, such as a
`_version` or a `_comment`, are carried along and ignored.

`acronyms` also feeds the search palette, so an empty list is not only an empty
table.

---

## 4. System to device map, optional

The join between the matrix and the hardware. This is the file that decides
whether the architecture is realized anywhere.

```json
{
  "default_site": "northgate",
  "sites": {
    "northgate": {
      "label": "Northgate Sports Campus",
      "scope": "What this site covers, in one line",
      "mappings": {
        "system_id": {
          "devices": ["device_id_one", "device_id_two"],
          "note": "Why these devices realize this system",
          "confidence": "high",
          "matrix_id_exists": false
        }
      },
      "not_deployed_at_site": { "system_id": "Checked, and genuinely absent here" },
      "unclaimed_devices": { "infrastructure": ["device_id_three"] }
    }
  },
  "pending_review": { "subject": "An open question about the mapping" }
}
```

Field by field:

- **`sites`** is keyed by **site id**, and that id is the join key: it has to be
  the same string the topology file loads under. Get it wrong and nothing
  errors. The site loads with every device and no coverage at all, which reads
  on screen as a finding rather than as a naming mismatch. See section 5.
- **`mappings`** is keyed by system id, which is the id derived from the
  `Project/System` name, not the name itself. A system counts as **realized** at
  a site only when its mapping names at least one device **and** the matrix
  carries that system id. The two other cases are real facts with different
  meanings and are labelled as such: a mapping with an empty `devices` list is a
  survey gap, and a mapping the matrix does not carry documents hardware that no
  matrix row explains.
- **`matrix_id_exists: false`** is how you state that the second case is
  deliberate. Omit it and it defaults to true.
- **`confidence`** is `high`, `medium` or `low`. Anything else is counted as
  unspecified. Only realized mappings are graded, so the tally can never
  overstate how much is verified.
- **`not_deployed_at_site`** records what was checked and found absent, which is
  different from not yet looked at, and shows as such per site.
- **`unclaimed_devices.infrastructure`** is the numerator of the orphaned
  hardware dimension.
- **`pending_review`** is the open questions dimension, one entry per question.
- **`confidence_counts`**, if present, is ignored and recomputed from the
  mappings, so the file cannot disagree with the tabs.

A legacy single-site file with `mappings`, `not_deployed_at_northgate` and
`unclaimed_devices` at the top level and no `sites` object is still accepted,
and is wrapped as one site keyed `northgate`.

Note that the browser path does not reject a mapping naming a system the matrix
has never heard of. It counts it as outside the matrix and says so. The Python
ingest is stricter and fails closed.

---

## 5. Site topology, optional, one file per site

A graph export, in the shape the network exporters produce:

```json
{
  "site_id": "northgate",
  "graph": {
    "name": "Site Topology Export (Northgate)",
    "location": "Northgate Sports Campus",
    "description": "",
    "classification": "UNCLASSIFIED//SAMPLE",
    "version": "1.0",
    "updated": "2026-04-21",
    "visio_tabs": [],
    "source_images": 4
  },
  "zones": { "zone_id": { "label": "Zone label", "description": "" } },
  "nodes": [
    {
      "id": "device_id_one",
      "label": "Device label",
      "zone": "zone_id",
      "type": "firewall",
      "ip": null,
      "subnet": null,
      "description": null
    }
  ],
  "edges": [
    {
      "source": "device_id_one",
      "target": "device_id_two",
      "link_type": "ethernet",
      "label": null
    }
  ]
}
```

- The device array the loader reads is `nodes`, and the link array is `edges`.
  Both counts are derived from the arrays, so a device or edge count stated in
  `graph` is ignored rather than trusted; do not bother writing one.
- `graph.location`, or failing that `graph.name`, is the site's display label.
  `graph.classification` is the marking the banner shows and every export burns
  in. All of `graph` is optional and defaults to empty.
- `ip` and `subnet` are opaque text. The source mixes bare addresses and CIDR,
  and nothing parses them.
- `edges` may also carry `vlan`, `port_source` and `port_target`.

Two rules are enforced, and both fail the whole load rather than dropping a
device:

- every node's `zone` must be a key of `zones`
- every edge's `source` and `target` must be an `id` in `nodes`

### The site id, which is a join key and not a label

Each topology loads under a site id, and that id is what keys it into the system
to device map and the overrides. The load panel resolves it in a stated order,
shows you the answer, says where it came from, and lets you change it before the
load commits:

1. an explicit `site_id`, at the top level or inside `graph`
2. the site named in `graph.name`. The last trailing parenthetical is tried
   first; failing that, the last segment after a dash (hyphen, en dash or em
   dash), a colon, or a **pipe**. A segment is rejected as a sentence rather
   than a place when it runs to more than four words, and rejected as a
   document description when every word of it is one of `network`, `topology`,
   `site`, `baseline`, `overview` and the rest of the list in
   `src/lib/siteId.ts`. A title with no parenthetical and no separator at all
   yields nothing, because the separator is the only evidence that the tail is
   a distinct thing rather than the end of a sentence.
3. the file name, with a trailing `network`, `topology` or `graph` stripped, so
   `northgate_network.json` loads as `northgate`

Whatever you type into the panel is slugged by the same rule the resolver uses,
so `Harbor Point` keys the site `harbor_point` and not `Harbor Point`.

When a system to device map or an overrides file is also picked, the site ids
those files declare outrank the order above: the first candidate that matches a
declared id wins, whatever its rank. In practice that means the map. The ids are
read from a `sites` object and a `default_site` string, and an overrides file
carries neither, so the panel asks it and gets nothing back; it is asked because
the reader is free to put site keys in it, not because the documented shape has
any. A topology that resolves to an id none of the picked files declares gets a
warning naming the ids that were expected, with a button per id to take one. Two
files under one id is refused rather than silently dropping a site.

State `site_id` in the file if you can. It is rule 1, and it is the only source
that is not a guess at how you name things. It is not a guarantee: a declared id
that no picked map carries is still outranked by a file name or a title that
does match one, and it is still warned about, and it is still editable in the
panel before the load commits. The sample topology templates state it; most real
exports do not.

---

## When a load fails

Nothing is adopted until everything has parsed, so a failure leaves the app on
the dataset it was already showing and there is no half-loaded state.

Every failure states a reason rather than a generic "could not load". Most of
them also name the file, but not all, and the exceptions are worth knowing
before you go hunting for a file name that is not there. The header-row scan is
not told which workbook it is reading, so its message names nothing. The three
topology messages name the **site id**, not the file, because by the time they
run the file has already been keyed and the id is the more useful of the two.

`...` below stands for a value filled in at the time: a file name, a site id, a
list. The three tables are complete, and a test keeps them that way: it extracts
every message `src/data/localFileParse.ts`, `src/data/LocalFileProvider.ts` and
`src/components/LoadDataPanel.tsx` can build, and fails if one of them is
missing here or if a row here quotes wording no code path produces.

### The parser refuses

| Message | What it means |
|---|---|
| `...: .xlsm is refused because macros are executable content` | A macro-enabled workbook, refused on its name alone. Save it as `.xlsx`. |
| `...: HTML is never accepted` | The name ends `.html`, `.htm`, `.xhtml` or `.svg`. |
| `...: too large (... bytes, cap ...)` | Over the 50 MB cap. The two numbers are the file's size and the cap. |
| `...: not a valid xlsx (no zip signature)` | The first four bytes are not a zip header, so the file is not really a workbook whatever it is called. |
| `...: no 'Matrix' sheet; found ...` | The sheet is named something else. The list is every sheet that was found. |
| `no header row containing 'Project/System' in the first 10 rows` | No cell in the first ten rows contains that text. The header is further down, or the column is spelled differently. This is the one message that names no file. |
| `...: no 'Project/System' column` | A header row was found, but no cell on it trims to exactly `Project/System`. A trailing space is fine; `Project/System Name` is not. |
| `...: no 'original_to_current_crosswalk' sheet; the requirement attrition metric has no source` | No sheet name contains `crosswalk`, in any case. |
| `...: crosswalk sheet is empty` | The sheet exists but yielded no rows with a non-empty first column. |
| `... is not valid JSON` | One of the four JSON inputs did not parse. Note the file name is followed by a space here, not by a colon. |
| `...: topology file is empty` | A topology file parsed, and parsed to `null`. |
| `...: device '...' is in zone '...', which is not declared` | A topology names a zone its own `zones` object does not have. The name before the colon is the site id. |
| `...: edge ...->... references unknown device '...'` | A topology has an edge to a device that is not in `nodes`. Site id again, not the file name. |

### The files disagree with each other

Every check above reads one file. These read several, and they run last, over
the fully parsed set, because they cannot be answered any earlier: whether a
mapping names a real system depends on the workbook, and whether it names a real
device depends on the site's topology.

They are the same gates the command-line ingest applies before it will write a
bundle (`ingest/src/atlas_ingest/validate.py`), in the same words, so the same
files are refused with the same sentences whichever way you load them. They
refuse rather than warn for the reason the ingest does: every id below is read
downstream as a fact, by the confidence tally, the realization gap, the
attrition flow and the network graph, and there is nowhere on screen to put a
caveat beside the number it would taint. The load is atomic, so a refusal costs
you nothing: the data already showing stays, and every failing row is named so
the fix is one edit and one reload.

The glossary is deliberately exempt. A glossary missing keys still loads, and
the Reference tab says which parts of it carry nothing. See "3. Glossary,
optional" above: a missing block costs no figure its meaning, so refusing over
one would take the matrix, the links, the coverage and the topologies away to
protect nothing.

| Message | What it means |
|---|---|
| `... cross-file integrity failure(s). Nothing was loaded, and whatever was already on screen is unchanged.` | One or more of the checks below did not pass. The count is how many, and each is listed underneath it on its own line. |

Each line under that heading is one of:

- `system_device_map.sites.<site>.mappings.<system>: not a matrix system id; add
  it to the workbook or set matrix_id_exists:false` - the map claims a system the
  workbook does not carry. The flag is the way to record hardware that no matrix
  row explains.
- `system_device_map.sites.<site>.mappings.<system>: matrix_id_exists:false, but
  the matrix does carry that system id; drop the flag or rename the mapping` -
  the same fact stated two ways, and different views read different ones.
- `system_device_map.sites.<site>.mappings.<system>: device '<device>' is not in
  the <site> topology` - a mapping realizes a system with hardware the site does
  not have. Only checked when that site's topology was loaded.
- `system_device_map.sites.<site>.not_deployed_at_site.<system>: not a matrix
  system id` - a documented absence for something that was never present.
- `system_device_map.sites.<site>.unclaimed_devices: device '<device>' is not in
  the <site> topology` - orphaned hardware that the topology does not list.
- `link <from>-><to>: '<end>' is not a matrix system id` - a link with an end that
  resolves to nothing. Covers the links mined from the integration prose and the
  `cross_links` in the overrides file, which is the same set the ingest gate
  checks.
- `crosswalk '<requirement>...': current system '<name>' does not match any
  Project/System name in the matrix` - the crosswalk sheet names a current system
  by a spelling the Matrix sheet does not use.

### The panel refuses, before the parser is called

These four never reach the loader, so nothing is parsed and nothing changes.

| Message | What it means |
|---|---|
| `Choose a Traceability Matrix first. Everything else is optional.` | No file claimed the matrix slot, by sorting or by hand. |
| `... has no site id. A site has to be keyed by something.` | A topology's id field was emptied, or what was typed slugged away to nothing (`---`, say). The name is the file's. |
| `Two topology files share the site id .... Give each site its own id, or one of them is dropped.` | Two topologies resolved or were typed to one id. Loading them would key one site twice and keep only the last. |
| `More than one file claims the ... slot: .... Set all but one of them to something else, or the wrong file loads and nothing says so.` | Two files were sorted or placed into a single slot. This one stands in the alert region on its own, and the Load button does nothing at all while it is showing. |
