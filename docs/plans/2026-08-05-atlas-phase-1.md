# ATLAS Web Application — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generated single-file `atlas_v6.html` with a React 19 static web application on GitHub Pages that reads its data through one provider interface, adds a Lossiness analysis tab, and still emits a self-contained single-file HTML deliverable for air-gapped users.

**Architecture:** A Python `ingest/` package holds the tuned classifiers lifted from `build_cuas_tool_v4.py` and emits versioned JSON bundles into `public/data/`. The React app reads those bundles through `AtlasDataProvider`, which has two Phase 1 implementations (`StaticProvider` over `fetch()`, `LocalFileProvider` over SheetJS in-browser) proven equivalent by one shared contract test suite. D3 computes geometry as pure functions; React owns every DOM node.

**Tech Stack:** Python 3.11 + openpyxl + pytest (ingest). React 19, Vite 7, TypeScript 5.8, Tailwind 4, react-router-dom 7, D3 7.8.5, Recharts, SheetJS, Vitest + Testing Library (app). GitHub Pages via OIDC.

---

## Ground truth: the golden numbers

Captured from the current tool on 2026-08-05 by running the existing script against
`traceability/matrix/matrix.xlsx`. Every one of these is a
test assertion later in this plan. If a port changes any of them, the port is wrong.

| Fact | Value |
|---|---|
| Systems | **32** |
| Confirmed / unconfirmed | **23 / 9** |
| Risk high / medium / low | **11 / 19 / 2** |
| `risk_source` | **32 explicit, 0 inferred, 0 override** |
| Auto-extracted links | **16** |
| Merged links (2 manual + 16 auto − 4 suppressed) | **14** |
| Desired links | **13** |
| Crosswalk requirements | **11** (9 carried in some form, **2 "Didn't keep"**) |
| Owner groups | dhs-st 2, cbp 6, otherdhs 14, dhshq 4, ext 5, dod 1 |

**Unconfirmed ids (9):** `beacon, cirrus, dwell, ember, fathom, gantry, halyard, ingot, jetty`
**High-risk ids (11):** `orbit, scan, beacon, cirrus, dwell, partner, fpsrel, halyard, dispatch, ingot, bastion`
**Low-risk ids (2):** `homing, enterprise`

**Risk heatmap (6 owner groups × 3 risk levels):**

| Group | High | Medium | Low | Total |
|---|---|---|---|---|
| DHS S&T | 0 | 2 | 0 | 2 |
| CBP | 2 | 4 | 0 | 6 |
| Other DHS | 4 | 9 | 1 | 14 |
| DHS HQ/OCIO | 1 | 2 | 1 | 4 |
| DoD | 1 | 0 | 0 | 1 |
| External | 3 | 2 | 0 | 5 |

**Ownership confirmation bars:** DHS S&T 2/0, CBP 5/1, Other DHS 13/1, DHS HQ/OCIO 1/3, DoD 0/1, External 2/3 (confirmed/unconfirmed).

### A trap the golden matrix hides

Every row in the 5MAR workbook has an explicit `Risk Level` cell, so `read_excel` never
calls `classify_risk`'s keyword heuristics on this file. The golden test therefore proves
nothing about the risk classifier. `classify_risk` gets its own unit tests with synthetic
strings (Task 6), and those tests are the only thing standing between a broken keyword
table and a silently wrong April-matrix ingest.

---

## Decisions made while planning

Recorded here so nobody re-litigates them mid-execution.

**D-A. SheetJS comes from the vendor tarball, not npm.** The `xlsx` package on npm is
frozen at 0.18.5, which carries a prototype-pollution and a ReDoS advisory. Fixes only
exist on the vendor's own CDN. `package.json` pins
`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` (verified reachable,
HTTP 200). This is an install-time fetch that Vite then bundles; the no-CDN-at-runtime
rule is untouched.

**D-B. Fonts via `@fontsource` npm packages**, following CRUCIBLE. Vite fingerprints the
woff2 files into `dist/assets/` and rewrites the URLs, so `font-src 'self'` holds and
there are no third-party requests. Do not copy DRIFT's `index.html` font links: its own
CSP blocks them and it has been silently rendering in the system fallback.

**D-C. Light and dark both ship.** The three reference apps are dark-only, but the tool
being replaced has a working light mode and the spec calls for light/dark tokens. Tokens
are named by role and redefined under `[data-theme="light"]`, so the palette stays one
source of truth.

**D-D. Trend data starts accumulating now.** Lossiness trends need history that Phase 1
does not have. The bundle emitter writes one immutable snapshot per build to
`public/data/snapshots/<iso-date>.json`, committed. The Trend view renders an honest
"one snapshot so far" empty state until a second exists, per spec §9's rule that no data
and failed-to-load must never look alike.

**D-E. Phase 1 export is client-side.** Spec §7 replaces html2canvas and jsPDF with
Playwright, but Playwright needs the backend that Phase 1 does not have. Phase 1 ships
the self-contained single-file HTML export (the actual "done" criterion) plus PNG and PDF
rebuilt cleanly against the spec. Vector PDF via Playwright moves to Phase 2. jsPDF is
pinned at 2.5.1 to match the tool being replaced; 4.x is a later, separate upgrade.

**D-F. `OWNER_GROUP_MAP_RUNTIME` dies.** It is a module global mutated in `main()` and
read inside `generate_html()`. Its whole content is a pure `gid → display name` lookup of
six entries. It becomes `OWNER_GROUP_DISPLAY` in `config.py` and a pure function. Task 4
has a test that fails if any module-level mutable state survives.

---

---

## File Structure

Two halves that meet at `public/data/`. The Python half never imports React; the React
half never parses Excel except through `LocalFileProvider`.

```
atlas/
├── .github/workflows/{ci.yml,deploy.yml}
├── .gitignore  .nvmrc  README.md  index.html
├── package.json  tsconfig.json  vite.config.ts  vitest.config.ts
│
├── ingest/                                  # Python: the tuned classifiers
│   ├── pyproject.toml
│   ├── src/atlas_ingest/
│   │   ├── config.py          CATEGORY_MAP, OWNER_RULES, ID_MAP, LABEL_MAP,
│   │   │                      risk keyword tiers, LINK_NAME_FRAGMENTS,
│   │   │                      SOFT sets, OWNER_GROUP_DISPLAY.  Data only.
│   │   ├── identity.py        make_id, make_label
│   │   ├── classify.py        classify_owner, classify_risk, owner_group_display
│   │   ├── excel.py           read_excel
│   │   ├── links.py           extract_links, merge_links
│   │   ├── crosswalk.py       read_crosswalk
│   │   ├── curation.py        load_overrides, load_glossary,
│   │   │                      load_system_device_map (+ legacy flat normalize)
│   │   ├── network.py         load_network_json  (devices, edges, zones)
│   │   ├── lossiness.py       the seven dimensions
│   │   ├── methodology.py     reflect config.py constants into the UI payload
│   │   ├── validate.py        pure validate() -> list[str]; thin main()
│   │   └── bundle.py          emit_bundles(): writes public/data/**
│   └── tests/
│       ├── conftest.py                      paths to the read-only source repo
│       ├── fixtures/golden/*.json           captured expected outputs
│       ├── test_identity.py       test_classify_owner.py   test_classify_risk.py
│       ├── test_excel_golden.py   test_links_golden.py     test_crosswalk.py
│       ├── test_curation.py       test_lossiness.py        test_validate.py
│       └── test_bundle.py
│
├── public/
│   ├── CNAME                                atlas.analyticadss.com
│   └── data/
│       ├── manifest.json                    bundle version + provenance stamp
│       ├── project.json  systems.json  links.json  crosswalk.json
│       ├── glossary.json  methodology.json  coverage.json  lossiness.json
│       ├── sites/{northgate,westfield}.json
│       └── snapshots/2026-08-05.json         one per build, committed (D-D)
│
└── src/
    ├── main.tsx  App.tsx  routes.tsx
    ├── styles/{tokens.css,index.css}
    ├── types/
    │   ├── atlas.ts                         every shape the provider returns
    │   └── tree.ts                          TreeNode, for the radial layout
    ├── data/
    │   ├── provider.ts                      AtlasDataProvider interface
    │   ├── StaticProvider.ts  LocalFileProvider.ts
    │   ├── ProviderContext.tsx  useAtlas.ts
    │   └── __tests__/{contract.ts,static.test.ts,localfile.test.ts}
    ├── components/                          TabBar, ErrorBoundary, ThemeToggle,
    │                                        ProvenanceChip, CommandPalette,
    │                                        EmptyState, LoadFailed, DataTable
    ├── viz/                                 PURE GEOMETRY. No DOM, no d3.select.
    │   ├── radial.ts    swt/msp/doLayout port
    │   ├── sankey.ts    d3-sankey wrapper
    │   ├── force.ts     force config + tick positions
    │   ├── zoom.ts      fitToScreen WITH the zero-size guard
    │   └── __tests__/*.test.ts
    ├── tabs/
    │   ├── reference/  analytics/  lossiness/  network/  map/
    └── export/
        ├── singleFile.ts                    the air-gapped deliverable
        ├── png.ts  pdf.ts  csv.ts
        └── __tests__/*.test.ts
```

**Why `viz/` is separate from `tabs/`:** it is the enforcement mechanism for the hard
rule. Files under `viz/` export functions that take data and return numbers. If a
`d3.select` ever appears there, the lint rule in Task 12 fails the build.

---

# Milestone A — Ingest package (Python)

Nothing in this milestone touches React. It ends with `public/data/` fully populated and
a test suite that fails loudly if the classifiers drift.

---

### Task 1: Repo skeleton and the read-only source contract

**Files:**
- Create: `/Users/aousabdo/work/Oceans/atlas/.gitignore`
- Create: `/Users/aousabdo/work/Oceans/atlas/README.md`
- Create: `/Users/aousabdo/work/Oceans/atlas/ingest/pyproject.toml`
- Create: `/Users/aousabdo/work/Oceans/atlas/ingest/src/atlas_ingest/__init__.py`
- Create: `/Users/aousabdo/work/Oceans/atlas/ingest/tests/conftest.py`

- [ ] **Step 1: Initialise the repo**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git init -b main
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
dist/
.DS_Store
*.local
.vite/

__pycache__/
*.py[cod]
.venv/
.pytest_cache/
*.egg-info/
```

Note what is deliberately **absent**: `public/data/` is committed. The bundles are the
deployed artifact, exactly as DRIFT commits `src/data/mdaps.ts` and CRUCIBLE commits
`public/data/`.

- [ ] **Step 3: Write `ingest/pyproject.toml`**

```toml
[project]
name = "atlas-ingest"
version = "0.1.0"
description = "ATLAS ingest: read the Traceability Matrix and emit JSON bundles"
requires-python = ">=3.11"
dependencies = ["openpyxl>=3.1"]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[project.scripts]
atlas-ingest = "atlas_ingest.bundle:main"
atlas-validate = "atlas_ingest.validate:main"

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 4: Write `ingest/tests/conftest.py`**

The source repo is read-only reference. Every path to it lives in exactly this one file
so that when the data eventually moves into `atlas/`, one edit relocates the suite.

```python
"""Paths into the read-only reference repo named by ATLAS_SOURCE_REPO.

Nothing in the test suite writes to SOURCE_REPO. When the curated data is
eventually copied into this repo, only the constants below change.
"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

SOURCE_REPO = Path(os.environ["ATLAS_SOURCE_REPO"])
MINDMAP = SOURCE_REPO / "traceability" / "mindmap"

MATRIX_XLSX = MINDMAP / "matrix.xlsx"
OVERRIDES_JSON = MINDMAP / "overrides.json"
GLOSSARY_JSON = MINDMAP / "glossary.json"
SYSTEM_DEVICE_MAP_JSON = MINDMAP / "system_device_map.json"
NETWORK_JSON = {
    "northgate": SOURCE_REPO / "northgate" / "northgate_network.json",
    "westfield": SOURCE_REPO / "westfield" / "westfield_network.json",
}

GOLDEN = Path(__file__).parent / "fixtures" / "golden"


def _require(path):
    if not path.exists():
        pytest.skip(f"reference data not available: {path}")
    return path


@pytest.fixture(scope="session")
def matrix_path():
    return _require(MATRIX_XLSX)


@pytest.fixture(scope="session")
def overrides():
    return json.loads(_require(OVERRIDES_JSON).read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def systems(matrix_path):
    from atlas_ingest.excel import read_excel
    return read_excel(matrix_path)


def golden(name):
    """Load a captured expected-output fixture."""
    return json.loads((GOLDEN / name).read_text(encoding="utf-8"))
```

- [ ] **Step 5: Verify pytest collects nothing yet, cleanly**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest -q
```

Expected: `no tests ran`. Not an error, not a collection failure.

- [ ] **Step 6: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add .gitignore README.md ingest/
git commit -m "ingest: package skeleton and read-only source fixtures"
```

---

### Task 2: Capture the golden fixtures

Before porting anything, freeze what today's code produces. These fixtures are generated
**by the old script**, so they are an independent oracle rather than a restatement of the
new code.

**Files:**
- Create: `ingest/tests/fixtures/capture_golden.py`
- Create: `ingest/tests/fixtures/golden/systems.json`
- Create: `ingest/tests/fixtures/golden/auto_links.json`
- Create: `ingest/tests/fixtures/golden/crosswalk.json`
- Create: `ingest/tests/fixtures/golden/counts.json`

- [ ] **Step 1: Write the capture script**

```python
#!/usr/bin/env python3
"""Freeze the CURRENT build script's output as golden fixtures.

Run once, before any porting. Re-run only when a classifier change is
intentional, and review the fixture diff as part of that change.

    python3 ingest/tests/fixtures/capture_golden.py
"""
import collections
import importlib.util
import json
from pathlib import Path

SOURCE_REPO = Path(os.environ["ATLAS_SOURCE_REPO"])
MINDMAP = SOURCE_REPO / "traceability" / "mindmap"
BUILD = MINDMAP / "build_cuas_tool_v4.py"
XLSX = MINDMAP / "matrix.xlsx"
OUT = Path(__file__).parent / "golden"


def load_old_module():
    spec = importlib.util.spec_from_file_location("old_build", BUILD)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    old = load_old_module()

    systems = old.read_excel(str(XLSX))
    auto_links = old.extract_links(systems)
    crosswalk = old._read_crosswalk(str(XLSX))
    overrides = json.loads((MINDMAP / "overrides.json").read_text(encoding="utf-8"))

    counts = {
        "systems": len(systems),
        "confirmed": sum(1 for s in systems if not s["soft"]),
        "unconfirmed": sum(1 for s in systems if s["soft"]),
        "risk": dict(collections.Counter(s["risk"] for s in systems)),
        "risk_source": dict(collections.Counter(s["risk_source"] for s in systems)),
        "owner_group": dict(collections.Counter(s["gid"] for s in systems)),
        "auto_links": len(auto_links),
        "desired_links": len(overrides.get("desired_links", [])),
        "crosswalk_rows": len(crosswalk),
    }

    for name, payload in [
        ("systems.json", systems),
        ("auto_links.json", auto_links),
        ("crosswalk.json", crosswalk),
        ("counts.json", counts),
    ]:
        (OUT / name).write_text(
            json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {name}")

    print(json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

```bash
cd /Users/aousabdo/work/Oceans/atlas && python3 ingest/tests/fixtures/capture_golden.py
```

Expected output ends with exactly:

```json
{
  "systems": 32,
  "confirmed": 23,
  "unconfirmed": 9,
  "risk": {"medium": 19, "high": 11, "low": 2},
  "risk_source": {"explicit": 32},
  "owner_group": {"dhs-st": 2, "cbp": 6, "otherdhs": 14, "dhshq": 4, "ext": 5, "dod": 1},
  "auto_links": 16,
  "desired_links": 13,
  "crosswalk_rows": 11
}
```

If any number differs from that block, **stop**. The reference repo changed under the
plan and the discrepancy must be understood before porting.

- [ ] **Step 3: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/tests/fixtures/
git commit -m "ingest: freeze golden fixtures from the current build script"
```

---

### Task 3: The golden test, written before the code exists

This is the test the spec calls the highest-value item in the project. It fails now
because `atlas_ingest.excel` does not exist. It keeps failing until Tasks 4 through 7 are
done. That is intentional: it is the definition of done for the whole port.

**Files:**
- Create: `ingest/tests/test_excel_golden.py`

- [ ] **Step 1: Write the failing golden test**

```python
"""The port is correct when this file passes.

Golden fixtures come from the previous implementation (capture_golden.py), so a
green run means the new package reproduces the old one field for field.
"""
import collections

import pytest

from conftest import golden


def test_system_count(systems):
    assert len(systems) == 32


def test_confirmed_split(systems):
    confirmed = sum(1 for s in systems if not s["soft"])
    unconfirmed = sum(1 for s in systems if s["soft"])
    assert (confirmed, unconfirmed) == (23, 9)


def test_risk_distribution(systems):
    counts = collections.Counter(s["risk"] for s in systems)
    assert dict(counts) == {"high": 11, "medium": 19, "low": 2}


def test_every_risk_on_this_matrix_is_explicit(systems):
    """The 5MAR workbook fills Risk Level on every row. If this ever fails, the
    heuristic path has started firing and classify_risk's unit tests, not this
    file, are what protect the output."""
    assert {s["risk_source"] for s in systems} == {"explicit"}


def test_owner_group_distribution(systems):
    counts = collections.Counter(s["gid"] for s in systems)
    assert dict(counts) == {
        "dhs-st": 2, "cbp": 6, "otherdhs": 14, "dhshq": 4, "ext": 5, "dod": 1,
    }


def test_unconfirmed_ids_exactly(systems):
    assert sorted(s["id"] for s in systems if s["soft"]) == [
        "beacon", "cirrus", "dwell", "ember", "fathom", "gantry", "halyard", "ingot", "jetty",
    ]


def test_high_risk_ids_exactly(systems):
    assert sorted(s["id"] for s in systems if s["risk"] == "high") == [
        "orbit", "scan", "beacon", "cirrus", "dwell", "partner", "fpsrel",
        "halyard", "dispatch", "ingot", "bastion",
    ]


def test_low_risk_ids_exactly(systems):
    assert sorted(s["id"] for s in systems if s["risk"] == "low") == ["homing", "enterprise"]


def test_ids_are_unique(systems):
    ids = [s["id"] for s in systems]
    assert len(ids) == len(set(ids))


def test_the_confirmed_column_beats_always_soft(systems):
    """'scan' is in ALWAYS_SOFT, yet the workbook marks it Confirmed=Yes and the
    column wins. Precedence: Confirmed column > ALWAYS_SOFT/NEVER_SOFT >
    soft keywords."""
    scan = next(s for s in systems if s["id"] == "scan")
    assert scan["soft"] is False


def test_the_confirmed_column_beats_never_soft(systems):
    """The mirror case: 'gantry' is in NEVER_SOFT and is still unconfirmed,
    because the workbook says Confirmed=No."""
    gantry = next(s for s in systems if s["id"] == "gantry")
    assert gantry["soft"] is True


def test_the_workbook_summary_row_agrees_with_what_we_parsed(matrix_path, systems):
    """The Matrix sheet carries its own summary at row 4 (B..H =
    32, 23, 9, 11, 19, 2). It is written by hand, so a mismatch means either
    the workbook's own summary is stale or our parse is wrong. Either way a
    human needs to look."""
    import openpyxl

    wb = openpyxl.load_workbook(matrix_path, data_only=True, read_only=True)
    try:
        row = [wb["Matrix"].cell(row=4, column=c).value for c in range(2, 9)]
    finally:
        wb.close()
    total, confirmed, unconfirmed, high, med, low = row[0], row[1], row[2], row[3], row[4], row[5]

    assert total == len(systems)
    assert confirmed == sum(1 for s in systems if not s["soft"])
    assert unconfirmed == sum(1 for s in systems if s["soft"])
    assert high == sum(1 for s in systems if s["risk"] == "high")
    assert med == sum(1 for s in systems if s["risk"] == "medium")
    assert low == sum(1 for s in systems if s["risk"] == "low")


@pytest.mark.parametrize("field", [
    "id", "name", "label", "cat", "gid", "glabel", "gck", "ck",
    "soft", "risk", "risk_source", "detail", "integ",
])
def test_matches_golden_field_for_field(systems, field):
    """Field-level equality against the previous implementation's output."""
    expected = {s["id"]: s[field] for s in golden("systems.json")}
    actual = {s["id"]: s[field] for s in systems}
    assert actual == expected
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_excel_golden.py -q
```

Expected: collection error, `ModuleNotFoundError: No module named 'atlas_ingest.excel'`.
Not a skip, not a pass.

- [ ] **Step 3: Commit the failing test**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/tests/test_excel_golden.py
git commit -m "ingest: golden test for the 5MAR matrix, red until the port lands"
```

---

### Task 4: Port the config constants and kill the module global

**Files:**
- Create: `ingest/src/atlas_ingest/config.py`
- Create: `ingest/tests/test_config.py`
- Reference: `$ATLAS_SOURCE_REPO/traceability/mindmap/build_cuas_tool_v4.py:37-203`

- [ ] **Step 1: Write the test that the global is gone**

```python
"""config.py is data. Anything mutable at module scope is a bug: the old
OWNER_GROUP_MAP_RUNTIME was a module global mutated in main() and read during
rendering, which cannot survive concurrent use.
"""
import types

from atlas_ingest import config


def test_owner_group_display_covers_every_rule_target():
    targets = {gid for _, gid, _, _ in config.OWNER_RULES}
    assert targets <= set(config.OWNER_GROUP_DISPLAY)


def test_owner_group_display_is_exactly_the_six_known_groups():
    assert config.OWNER_GROUP_DISPLAY == {
        "dhs-st": "DHS S&T",
        "cbp": "CBP",
        "otherdhs": "Other DHS",
        "dhshq": "DHS HQ/OCIO",
        "dod": "DoD",
        "ext": "External",
    }


def test_no_mutable_module_state():
    """Every public module attribute is either immutable or a container the
    package never writes to. Guards against a runtime map creeping back in."""
    banned = []
    for name in dir(config):
        if name.startswith("_"):
            continue
        value = getattr(config, name)
        if isinstance(value, types.ModuleType):
            continue
        if not isinstance(value, (str, int, float, bool, tuple, frozenset, dict, list, set)):
            banned.append(name)
    assert banned == []


def test_table_sizes_match_the_source_script():
    """Counted from build_cuas_tool_v4.py on 2026-08-05. A table that silently
    loses a row changes classification for whichever systems it covered."""
    assert len(config.OWNER_RULES) == 23
    assert len(config.ID_MAP) == 36
    assert len(config.LABEL_MAP) == 32
    assert len(config.LINK_NAME_FRAGMENTS) == 21
    assert len(config.CATEGORY_MAP) == 8
    assert len(config.HIGH_KEYWORDS) == 19
    assert len(config.LOW_KEYWORDS) == 3
    assert len(config.MEDIUM_KEYWORDS) == 9
    assert config.ALWAYS_SOFT == {"scan", "beacon", "ember", "fathom", "halyard", "jetty"}
    assert config.NEVER_SOFT == {"gantry"}
    assert config.SOFT_GROUPS == {"dod", "ext"}
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_config.py -q
```

Expected: `ModuleNotFoundError: No module named 'atlas_ingest.config'`.

- [ ] **Step 3: Write `config.py`**

Copy `CATEGORY_MAP`, `OWNER_RULES`, `ID_MAP`, `LABEL_MAP`, `SOFT_KEYWORDS`, `ALWAYS_SOFT`,
`NEVER_SOFT`, `SOFT_GROUPS`, `HIGH_KEYWORDS`, `LOW_KEYWORDS`, `MEDIUM_KEYWORDS` and
`LINK_NAME_FRAGMENTS` **verbatim** from `build_cuas_tool_v4.py:37-203`, with two changes:

1. Drop the `\\n` double-escaping in `label` and `glabel` values. Those escapes existed
   only to survive Python → JS string injection. JSON transports real newlines, so
   `"Systems\\nInventory"` becomes `"Systems\nInventory"`. **This is the one intentional
   difference from the golden fixture** and Task 7 normalises for it.
2. Add the lookup that replaces the module global:

```python
# Replaces OWNER_GROUP_MAP_RUNTIME, which the old script built by mutating a
# module global inside main(). It was only ever this six-entry lookup.
OWNER_GROUP_DISPLAY = {
    "dhs-st":   "DHS S&T",
    "cbp":      "CBP",
    "otherdhs": "Other DHS",
    "dhshq":    "DHS HQ/OCIO",
    "dod":      "DoD",
    "ext":      "External",
}
```

Head the file with:

```python
"""Classification tables lifted from build_cuas_tool_v4.py:37-203.

Data only: no functions, no I/O, nothing mutable at import time. Phase 2 turns
these into the classification_rules / id_aliases / link_vocabulary tables, so
keep the shapes row-like and the ordering of OWNER_RULES significant.
"""
```

- [ ] **Step 4: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_config.py -q
```

Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/src/atlas_ingest/config.py ingest/tests/test_config.py
git commit -m "ingest: port classification tables, drop the runtime owner-group global"
```

---

### Task 5: Port `make_id` and `make_label`

**Files:**
- Create: `ingest/src/atlas_ingest/identity.py`
- Create: `ingest/tests/test_identity.py`
- Reference: `build_cuas_tool_v4.py:210-233`

- [ ] **Step 1: Write the test**

```python
import pytest

from atlas_ingest.identity import make_id, make_label


@pytest.mark.parametrize("name,expected", [
    ("UAS Common Picture", "ucop"),
    ("BEACON", "beacon"),
    ("Ingot Sensor Suite (INGOT) / DATA VIEW", "ingot"),
    ("INGOT / DATA VIEW", "ingot"),
    ("SCAN (Screening and Alerting Node)", "scan"),
    ("GANTRY (Ground Antenna Towers)", "gantry"),
    ("Dispatch Management System (DMS/CAD)", "dispatch"),
    ("  BEACON  ", "beacon"),
])
def test_make_id_known_names(name, expected):
    assert make_id(name) == expected


def test_make_id_strips_parentheses_before_the_second_lookup():
    """'SCAN (Screening and Alerting Node)' is not a literal ID_MAP key; it
    resolves only because the parenthetical is stripped and 'SCAN' is."""
    assert make_id("SCAN (Screening and Alerting Node)") == "scan"


def test_make_id_falls_back_to_a_slug():
    assert make_id("Some Brand New System") == "some_brand_new_system"


def test_make_id_slug_is_capped_at_30_chars():
    out = make_id("A" * 60)
    assert len(out) <= 30


def test_make_id_slug_has_no_leading_or_trailing_underscores():
    assert make_id("  ...Weird Name!!!  ") == "weird_name"


def test_make_label_uses_the_label_map():
    assert make_label("Trackwell Sensor AI") == "Trackwell\nSensor AI"


def test_make_label_wraps_long_unmapped_names_at_the_midpoint():
    assert make_label("Alpha Bravo Charlie Delta") == "Alpha Bravo\nCharlie Delta"


def test_make_label_leaves_short_unmapped_names_alone():
    assert make_label("Short One") == "Short One"
```

Note the expected values use real `\n`, per the Task 4 decision.

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_identity.py -q
```

Expected: `ModuleNotFoundError: No module named 'atlas_ingest.identity'`.

- [ ] **Step 3: Write `identity.py`**

```python
"""System name → short id and display label. Ported from
build_cuas_tool_v4.py:210-233 with no behaviour change; labels carry real
newlines instead of the JS-escaped \\n the old string injection required.
"""
import re

from .config import ID_MAP, LABEL_MAP


def make_id(name):
    """Map a system name to its short id, falling back to a slug."""
    n = name.strip()
    if n in ID_MAP:
        return ID_MAP[n]
    short = re.sub(r"\s*\(.*?\)\s*", "", n).strip()
    if short in ID_MAP:
        return ID_MAP[short]
    return re.sub(r"[^a-z0-9]+", "_", short.lower()).strip("_")[:30]


def make_label(name):
    """Display label: the curated short name, else the name wrapped at its
    midpoint so long labels fit a node."""
    sid = make_id(name)
    if sid in LABEL_MAP:
        return LABEL_MAP[sid]
    s = re.sub(r"\s*\(.*?\)\s*", "", name).strip()
    if len(s) < 3:
        s = name.strip()
    if len(s) > 14 and " " in s:
        words = s.split()
        mid = len(words) // 2
        s = " ".join(words[:mid]) + "\n" + " ".join(words[mid:])
    return s
```

- [ ] **Step 4: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_identity.py -q
```

Expected: `15 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/src/atlas_ingest/identity.py ingest/tests/test_identity.py
git commit -m "ingest: port make_id and make_label"
```

---

### Task 6: Port the classifiers

`classify_risk` gets the heavier test because the golden matrix never exercises it.

**Files:**
- Create: `ingest/src/atlas_ingest/classify.py`
- Create: `ingest/tests/test_classify_owner.py`
- Create: `ingest/tests/test_classify_risk.py`
- Reference: `build_cuas_tool_v4.py:236-275`

- [ ] **Step 1: Write `tests/test_classify_owner.py`**

```python
from atlas_ingest.classify import classify_owner, owner_group_display


def test_empty_owner_is_external_and_soft():
    assert classify_owner("") == ("ext", "External /\nIndustry", "ext", True)


def test_first_match_wins_dhs_st_before_anything_else():
    gid, _, _, _ = classify_owner("DHS S&T and CBP jointly")
    assert gid == "dhs-st"


def test_uscg_cbp_routes_to_dhs_hq_not_cbp():
    """The USCG/CBP rule sits above the bare CBP rule specifically so Beacon
    lands in DHS HQ. Reordering OWNER_RULES breaks this."""
    gid, _, _, _ = classify_owner("USCG/CBP", "Beacon")
    assert gid == "dhshq"


def test_short_substrings_match_on_word_boundaries_only():
    """'office' must not match the ICE rule."""
    gid, _, _, _ = classify_owner("Some office of coordination")
    assert gid == "ext"


def test_ice_matches_as_a_whole_word():
    gid, _, _, _ = classify_owner("ICE HSI")
    assert gid == "otherdhs"


def test_soft_keyword_marks_ownership_unconfirmed():
    _, _, _, soft = classify_owner("CBP (confirm)", "some_system")
    assert soft is True


def test_always_soft_overrides_a_clean_owner_string():
    _, _, _, soft = classify_owner("DHS HQ", "Beacon")
    assert soft is True


def test_never_soft_overrides_a_soft_keyword():
    _, _, _, soft = classify_owner("Industry, awaiting sign-off",
                                   "GANTRY (Ground Antenna Towers)")
    assert soft is False


def test_unknown_owner_falls_through_to_external():
    gid, label, ck, _ = classify_owner("Ministry of Silly Walks")
    assert (gid, ck) == ("ext", "ext")
    assert label == "External /\nIndustry"


def test_owner_group_display_is_a_pure_lookup():
    assert owner_group_display("dhshq") == "DHS HQ/OCIO"
    assert owner_group_display("nonsense") == "Other DHS"
```

- [ ] **Step 2: Write `tests/test_classify_risk.py`**

```python
"""classify_risk is untested by the golden matrix, which fills Risk Level on
every row. These synthetic cases are the only coverage the heuristic has.
"""
import pytest

from atlas_ingest.classify import classify_risk


def test_empty_text_defaults_to_medium():
    assert classify_risk("") == "medium"
    assert classify_risk(None) == "medium"


@pytest.mark.parametrize("text", [
    "role in the architecture is undefined at this site",
    "Manual email handoff between watch floors",
    "sneakernet transfer of track data",
    "Limited visibility into sensor health",
    "Single point of failure throughout",
])
def test_high_keywords_win(text):
    assert classify_risk(text) == "high"


@pytest.mark.parametrize("text", [
    "Legacy naming persists in the console",
    "Battery drain on extended missions",
    "Interpretation risk on the zone labels",
])
def test_low_keywords(text):
    assert classify_risk(text) == "low"


@pytest.mark.parametrize("text", [
    "Integration not yet complete",
    "Coverage is incomplete",
    "Ownership ambiguous",
    "Interfaces not enumerated",
])
def test_medium_keywords(text):
    assert classify_risk(text) == "medium"


def test_high_beats_low_when_both_appear():
    """Precedence is high, then low, then medium. A string carrying both must
    resolve high."""
    assert classify_risk("Legacy naming and a manual email handoff") == "high"


def test_low_beats_medium_when_both_appear():
    assert classify_risk("Battery drain, coverage incomplete") == "low"


def test_matching_is_case_insensitive():
    assert classify_risk("SNEAKERNET TRANSFERS") == "high"


def test_unrecognised_text_defaults_to_medium():
    assert classify_risk("Everything is entirely fine here") == "medium"
```

- [ ] **Step 3: Run both, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_classify_owner.py tests/test_classify_risk.py -q
```

Expected: `ModuleNotFoundError: No module named 'atlas_ingest.classify'`.

- [ ] **Step 4: Write `classify.py`**

```python
"""Owner and risk classification, ported from build_cuas_tool_v4.py:236-275.

classify_owner walks OWNER_RULES in order and the first match wins, so the
ordering in config.py is load-bearing. Substrings of four characters or fewer
match on word boundaries, which is what keeps "office" out of the ICE rule.
"""
import re

from .config import (
    ALWAYS_SOFT, HIGH_KEYWORDS, LOW_KEYWORDS, MEDIUM_KEYWORDS, NEVER_SOFT,
    OWNER_GROUP_DISPLAY, OWNER_RULES, SOFT_KEYWORDS,
)
from .identity import make_id

_EXTERNAL = ("ext", "External /\nIndustry", "ext")


def classify_owner(raw_owner, system_name=""):
    """Raw owner string -> (group_id, group_label, color_key, is_soft)."""
    if not raw_owner:
        return (*_EXTERNAL, True)

    sid = make_id(system_name)
    is_soft = any(kw in raw_owner.lower() for kw in SOFT_KEYWORDS)
    if sid in ALWAYS_SOFT:
        is_soft = True
    if sid in NEVER_SOFT:
        is_soft = False

    for substring, gid, glabel, ckey in OWNER_RULES:
        if len(substring) <= 4:
            if re.search(r"\b" + re.escape(substring) + r"\b", raw_owner, re.IGNORECASE):
                return (gid, glabel, ckey, is_soft)
        elif substring.lower() in raw_owner.lower():
            return (gid, glabel, ckey, is_soft)

    return (*_EXTERNAL, is_soft)


def classify_risk(risk_text):
    """Risk prose -> high | medium | low. Precedence is high, then low, then
    medium; an unmatched non-empty string is medium."""
    if not risk_text:
        return "medium"
    lo = risk_text.lower()
    for kw in HIGH_KEYWORDS:
        if kw in lo:
            return "high"
    for kw in LOW_KEYWORDS:
        if kw in lo:
            return "low"
    for kw in MEDIUM_KEYWORDS:
        if kw in lo:
            return "medium"
    return "medium"


def owner_group_display(gid):
    """Group id -> the label the analytics views show."""
    return OWNER_GROUP_DISPLAY.get(gid, "Other DHS")
```

- [ ] **Step 5: Run both, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_classify_owner.py tests/test_classify_risk.py -q
```

Expected: `27 passed`.

- [ ] **Step 6: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/src/atlas_ingest/classify.py ingest/tests/test_classify_owner.py ingest/tests/test_classify_risk.py
git commit -m "ingest: port owner and risk classifiers with heuristic coverage"
```

---

### Task 7: Port `read_excel` and turn the golden test green

**Files:**
- Create: `ingest/src/atlas_ingest/excel.py`
- Modify: `ingest/tests/test_excel_golden.py` (add the newline normalisation)
- Reference: `build_cuas_tool_v4.py:289-384`

- [ ] **Step 1: Add newline normalisation to the golden comparison**

The fixture holds JS-escaped `\\n` in `label` and `glabel`; the new code emits real
newlines (Task 4, change 1). Replace the parametrised comparison test in
`test_excel_golden.py` with this version, which normalises exactly those two fields and
compares every other field byte for byte:

```python
ESCAPED_NEWLINE_FIELDS = {"label", "glabel"}


@pytest.mark.parametrize("field", [
    "id", "name", "label", "cat", "gid", "glabel", "gck", "ck",
    "soft", "risk", "risk_source", "detail", "integ",
])
def test_matches_golden_field_for_field(systems, field):
    """Field-level equality against the previous implementation.

    label and glabel are normalised because the old code carried literal
    backslash-n through a JS string injection that JSON does not need. Every
    other field must match exactly.
    """
    def norm(value):
        if field in ESCAPED_NEWLINE_FIELDS and isinstance(value, str):
            return value.replace("\\n", "\n")
        return value

    expected = {s["id"]: norm(s[field]) for s in golden("systems.json")}
    actual = {s["id"]: s[field] for s in systems}
    assert actual == expected
```

- [ ] **Step 2: Run the golden test, confirm it still fails on the missing module**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_excel_golden.py -q
```

Expected: `ModuleNotFoundError: No module named 'atlas_ingest.excel'`.

- [ ] **Step 3: Write `excel.py`**

```python
"""Read the Matrix sheet into system dicts.

Ported from build_cuas_tool_v4.py:289-384. Two behaviour changes, both
deliberate: missing sheets and missing headers raise instead of calling
sys.exit, because this runs as a library; and the workbook opens read_only to
bound memory on a hostile file.

The header scan tolerates the workbook's "Existing Interfaces" typo. Do not
"fix" it: the source file spells it that way and the fallback spelling is
already handled.
"""
import openpyxl

from .classify import classify_owner, classify_risk
from .config import CATEGORY_MAP
from .identity import make_id, make_label


class MatrixError(ValueError):
    """The workbook is not a Traceability Matrix we can read."""


def _find_header_row(ws):
    for r in range(1, 11):
        for cell in ws[r]:
            if cell.value and "Project/System" in str(cell.value):
                return r
    raise MatrixError("no header row containing 'Project/System' in the first 10 rows")


def read_excel(filepath):
    """Matrix sheet -> list of system dicts, in workbook row order."""
    wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
    try:
        if "Matrix" not in wb.sheetnames:
            raise MatrixError(f"no 'Matrix' sheet; found {wb.sheetnames}")
        ws = wb["Matrix"]
        hrow = _find_header_row(ws)
        hdrs = {c.value.strip(): c.column - 1 for c in ws[hrow] if c.value}
        ci = {
            "cat":   hdrs.get("Capability Gap/Requirement"),
            "name":  hdrs.get("Project/System"),
            "infra": hdrs.get("Infrastructure/Technology"),
            "owner": hdrs.get("Owner Organization"),
            "integ": hdrs.get("Existing Interfaces") or hdrs.get("Existing Interfaces"),
            "risk":  hdrs.get("Risk/Challenge"),
        }
        if ci["name"] is None:
            raise MatrixError("no 'Project/System' column")
        col_risk_level = hdrs.get("Risk Level")
        col_confirmed = hdrs.get("Confirmed")

        systems = []
        for row in ws.iter_rows(min_row=hrow + 1, max_row=ws.max_row, values_only=True):
            name = row[ci["name"]]
            if not name:
                continue
            systems.append(_build_system(row, ci, col_risk_level, col_confirmed))
        return systems
    finally:
        wb.close()


def _cell(row, idx):
    if idx is None:
        return ""
    return str(row[idx] or "").strip()


def _build_system(row, ci, col_risk_level, col_confirmed):
    name = str(row[ci["name"]]).strip()
    cat = _cell(row, ci["cat"])
    owner = _cell(row, ci["owner"])
    risk_text = _cell(row, ci["risk"])
    infra = _cell(row, ci["infra"])
    integ = _cell(row, ci["integ"])

    explicit_risk = None
    if col_risk_level is not None:
        v = row[col_risk_level]
        if v and str(v).strip().lower() in ("high", "medium", "low"):
            explicit_risk = str(v).strip().lower()

    explicit_confirmed = None
    if col_confirmed is not None:
        v = row[col_confirmed]
        if v and str(v).strip().lower() in ("yes", "no"):
            explicit_confirmed = str(v).strip().lower() == "yes"

    gid, glabel, gck, is_soft = classify_owner(owner, name)
    if explicit_confirmed is not None:
        is_soft = not explicit_confirmed

    if explicit_risk:
        risk, risk_source = explicit_risk, "explicit"
    else:
        risk, risk_source = classify_risk(risk_text), "inferred"

    cat_info = CATEGORY_MAP.get(cat, CATEGORY_MAP["Deployed asset record"])
    node_ck = cat_info["ck"] if cat_info["branch"] != "inv" else gck

    detail_parts = [infra] if infra else []
    if owner:
        detail_parts.append("Owner: " + owner)
    if risk_text:
        detail_parts.append("Risk: " + risk_text)
    detail = ". ".join(filter(None, detail_parts))
    if detail and not detail.endswith("."):
        detail += "."

    return {
        "id": make_id(name),
        "name": name,
        "label": make_label(name),
        "cat": cat,
        "gid": gid,
        "glabel": glabel,
        "gck": gck,
        "ck": node_ck,
        "soft": is_soft,
        "risk": risk,
        "risk_source": risk_source,
        "detail": detail,
        "integ": integ,
    }
```

- [ ] **Step 4: Run the golden test, expect green**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_excel_golden.py -q
```

Expected: `25 passed`. If `test_matches_golden_field_for_field[detail]` fails, the
sentence-joining rule changed; re-read `_build_system` against source lines 359-366.

- [ ] **Step 5: Add the guard tests for the raise-not-exit change**

Append to `tests/test_excel_golden.py`:

```python
def test_missing_matrix_sheet_raises_rather_than_exiting(tmp_path):
    """A library must not call sys.exit. Ingest failures have to be catchable."""
    import openpyxl as _openpyxl
    from atlas_ingest.excel import MatrixError, read_excel

    path = tmp_path / "wrong.xlsx"
    wb = _openpyxl.Workbook()
    wb.active.title = "NotTheMatrix"
    wb.save(path)

    with pytest.raises(MatrixError, match="no 'Matrix' sheet"):
        read_excel(path)


def test_matrix_sheet_without_the_header_raises(tmp_path):
    import openpyxl as _openpyxl
    from atlas_ingest.excel import MatrixError, read_excel

    path = tmp_path / "headerless.xlsx"
    wb = _openpyxl.Workbook()
    wb.active.title = "Matrix"
    wb.active["A1"] = "nothing useful here"
    wb.save(path)

    with pytest.raises(MatrixError, match="Project/System"):
        read_excel(path)
```

- [ ] **Step 6: Run the full suite so far**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest -q
```

Expected: `74 passed`. Counts are indicative; what matters is zero failures and zero errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/src/atlas_ingest/excel.py ingest/tests/test_excel_golden.py
git commit -m "ingest: port read_excel; golden test for the 5MAR matrix is green"
```

---

### Task 8: Port link extraction and the override merge

The merge rules are subtle and the counts are exact: 16 auto-extracted, 2 manual, 4
suppressed, 14 merged, 13 desired.

**Files:**
- Create: `ingest/src/atlas_ingest/links.py`
- Create: `ingest/tests/test_links_golden.py`
- Reference: `build_cuas_tool_v4.py:387-420` (extract) and `501-521` (merge)

- [ ] **Step 1: Write the test**

```python
from atlas_ingest.links import extract_links, merge_links

from conftest import golden


def _pairs(links):
    return {tuple(sorted([l["from"], l["to"]])) for l in links}


def test_auto_extraction_finds_exactly_sixteen(systems):
    assert len(extract_links(systems)) == 16


def test_auto_extraction_matches_golden(systems):
    assert _pairs(extract_links(systems)) == _pairs(golden("auto_links.json"))


def test_a_system_never_links_to_itself(systems):
    assert all(l["from"] != l["to"] for l in extract_links(systems))


def test_each_pair_appears_once(systems):
    links = extract_links(systems)
    assert len(_pairs(links)) == len(links)


def test_merge_produces_fourteen(systems, overrides):
    merged = merge_links(extract_links(systems), overrides)
    assert len(merged) == 14


def test_merge_keeps_all_manual_links(systems, overrides):
    merged = merge_links(extract_links(systems), overrides)
    for m in overrides["cross_links"]:
        assert tuple(sorted([m["from"], m["to"]])) in _pairs(merged)


def test_merge_drops_every_suppressed_pair(systems, overrides):
    merged = merge_links(extract_links(systems), overrides)
    for pair in overrides["suppress_links"]:
        assert tuple(sorted(pair)) not in _pairs(merged)


def test_suppression_removes_exactly_four_auto_links(systems, overrides):
    """16 auto - 4 suppressed + 2 manual = 14. If this drifts, either the
    prose changed or a suppress entry stopped matching anything."""
    auto = extract_links(systems)
    suppressed = {tuple(sorted(p)) for p in overrides["suppress_links"]}
    assert len(_pairs(auto) & suppressed) == 4


def test_a_manual_link_wins_over_an_identical_auto_link(systems):
    ov = {"cross_links": [{"from": "ucop", "to": "crosslink", "label": "hand-curated"}],
          "suppress_links": []}
    merged = merge_links(extract_links(systems), ov)
    match = [l for l in merged if _pairs([l]) == {("ucop", "crosslink")}]
    assert len(match) == 1
    assert match[0]["label"] == "hand-curated"


def test_merge_with_no_overrides_returns_the_auto_links(systems):
    auto = extract_links(systems)
    assert len(merge_links(auto, {})) == len(auto)
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_links_golden.py -q
```

Expected: `ModuleNotFoundError: No module named 'atlas_ingest.links'`.

- [ ] **Step 3: Write `links.py`**

```python
"""Integration links mined from the Existing Interfaces prose, then merged
with hand curation.

extract_links is build_cuas_tool_v4.py:387-420; merge_links is the link-merge
half of build_tree at 501-521, lifted out so it can be tested on its own.

Extraction is substring matching over system names plus a curated fragment
vocabulary, deduplicated by unordered pair. It is lossy by nature, which is
why Phase 2 stores extraction_method and evidence per link.
"""
import re

from .config import LABEL_MAP, LINK_NAME_FRAGMENTS


def _fragment_index(systems):
    """fragment -> system id. Curated fragments first, then every system's full
    name and its parenthetical-stripped short form."""
    frag_to_id = dict(LINK_NAME_FRAGMENTS)
    for s in systems:
        raw = s["name"]
        frag_to_id[raw.lower()] = s["id"]
        short = re.sub(r"\s*\(.*?\)\s*", "", raw).strip()
        if short.lower() != raw.lower() and len(short) > 3:
            frag_to_id[short.lower()] = s["id"]
    return frag_to_id


def _display(sid, systems):
    if sid in LABEL_MAP:
        return LABEL_MAP[sid].replace("\n", " ")
    match = next((x for x in systems if x["id"] == sid), None)
    return match["name"] if match else sid


def extract_links(systems):
    """Mine each system's integration prose for mentions of other systems."""
    frag_to_id = _fragment_index(systems)
    links, seen = [], set()

    for s in systems:
        text = (s.get("integ") or "").lower()
        if not text:
            continue
        src = s["id"]
        for frag, tid in frag_to_id.items():
            if tid == src or frag not in text:
                continue
            pair = tuple(sorted([src, tid]))
            if pair in seen:
                continue
            seen.add(pair)
            links.append({
                "from": src,
                "to": tid,
                "label": f"{_display(src, systems)} - {_display(tid, systems)}",
                "extraction_method": "prose",
            })
    return links


def merge_links(auto_links, overrides):
    """Hand-curated links win; suppressed pairs are dropped from the auto set.

    Order matters for reproducibility: manual links first, in file order, then
    surviving auto links in extraction order.
    """
    overrides = overrides or {}
    manual = [dict(m, extraction_method="override") for m in overrides.get("cross_links", [])]
    manual_pairs = {tuple(sorted([m["from"], m["to"]])) for m in manual}
    suppressed = {tuple(sorted(p)) for p in overrides.get("suppress_links", [])}

    kept = [
        a for a in auto_links
        if (pair := tuple(sorted([a["from"], a["to"]]))) not in manual_pairs
        and pair not in suppressed
    ]
    return manual + kept


def desired_links(overrides):
    """To-be integrations. These are pure curation; nothing mines them."""
    return [dict(d, extraction_method="override")
            for d in (overrides or {}).get("desired_links", [])]
```

- [ ] **Step 4: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_links_golden.py -q
```

Expected: `10 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/src/atlas_ingest/links.py ingest/tests/test_links_golden.py
git commit -m "ingest: port link extraction and the override merge"
```

---

### Task 9: Port the crosswalk reader

Eleven requirements from the workbook sheet, including the two that were never carried
forward. Those two rows are the entire point of the requirement-attrition metric.

**Files:**
- Create: `ingest/src/atlas_ingest/crosswalk.py`
- Create: `ingest/tests/test_crosswalk.py`
- Reference: `build_cuas_tool_v4.py:944-977`

- [ ] **Step 1: Write the test**

```python
import pytest

from atlas_ingest.crosswalk import CrosswalkError, read_crosswalk


@pytest.fixture(scope="module")
def crosswalk(matrix_path):
    return read_crosswalk(matrix_path)


def test_eleven_requirements(crosswalk):
    assert len(crosswalk) == 11


def test_exactly_two_were_not_kept(crosswalk):
    """The dropped requirements are the signal, not noise. Losing these rows
    silently zeroes the requirement-attrition dimension."""
    assert sum(1 for r in crosswalk if r["status"] == "Didn't keep") == 2


def test_dropped_requirements_carry_no_current_systems(crosswalk):
    for r in crosswalk:
        if r["status"] == "Didn't keep":
            assert r["current"] == []


def test_dropped_requirements_are_the_governance_and_acquisition_ones(crosswalk):
    dropped = sorted(r["orig"] for r in crosswalk if r["status"] == "Didn't keep")
    assert dropped == [
        "No spectrum deconfliction process",
        "No standing training pipeline for relay operators",
    ]


def test_current_systems_are_split_on_semicolons(crosswalk):
    row = next(r for r in crosswalk
               if r["orig"] == "No audit trail for who read which track")
    assert row["current"] == ["CROSSLINK", "Fathom", "Ember"]


def test_no_direct_equivalent_prose_becomes_an_empty_list(crosswalk):
    for r in crosswalk:
        assert all("no matching system row" not in c.lower() for c in r["current"])


def test_every_row_has_the_four_fields(crosswalk):
    for r in crosswalk:
        assert set(r) == {"orig", "sys", "current", "status"}
        assert r["orig"]
        assert isinstance(r["current"], list)


def test_status_values_are_from_the_known_set(crosswalk):
    assert {r["status"] for r in crosswalk} <= {
        "Split out", "Renamed / split out", "Partly carried forward",
        "Condensed", "Didn't keep",
    }


def test_a_workbook_without_the_sheet_raises(tmp_path):
    import openpyxl

    path = tmp_path / "nocrosswalk.xlsx"
    wb = openpyxl.Workbook()
    wb.active.title = "Matrix"
    wb.save(path)

    with pytest.raises(CrosswalkError, match="crosswalk"):
        read_crosswalk(path)
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_crosswalk.py -q
```

Expected: `ModuleNotFoundError: No module named 'atlas_ingest.crosswalk'`.

- [ ] **Step 3: Write `crosswalk.py`**

```python
"""Original requirements -> today's systems, read from the workbook sheet
original_to_current_crosswalk.

Ported from build_cuas_tool_v4.py:944-977. This used to be a hardcoded literal
in the HTML template that the build never injected, so it could not follow the
source data. Never reintroduce a fallback copy: a stale crosswalk silently
falsifies the requirement-attrition metric.
"""
import openpyxl

KNOWN_STATUSES = {
    "Split out", "Renamed / split out", "Partly carried forward",
    "Condensed", "Didn't keep",
}

_NO_EQUIVALENT = "no matching system row"


class CrosswalkError(ValueError):
    """The workbook has no usable crosswalk sheet."""


def _normalise_status(raw):
    status = str(raw or "").strip() or "Unknown"
    lowered = status.lower()
    if "didn't keep" in lowered or "did not keep" in lowered:
        return "Didn't keep"
    return status


def _split_current(cell):
    if not cell or _NO_EQUIVALENT in str(cell).lower():
        return []
    return [c.strip() for c in str(cell).split(";") if c.strip()]


def read_crosswalk(xlsx_path):
    """-> [{orig, sys, current: [str], status}] in sheet order."""
    try:
        wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    except Exception as exc:
        raise CrosswalkError(f"could not open workbook: {exc}") from exc

    try:
        sheet = next((s for s in wb.sheetnames if "crosswalk" in s.lower()), None)
        if not sheet:
            raise CrosswalkError(
                "no 'original_to_current_crosswalk' sheet; the requirement "
                "attrition metric has no source"
            )
        rows = []
        for i, row in enumerate(wb[sheet].iter_rows(values_only=True)):
            if i == 0 or not row or not row[0]:
                continue
            rows.append({
                "orig": str(row[0]).strip(),
                "sys": str(row[1] or "").strip(),
                "current": _split_current(row[2] if len(row) > 2 else None),
                "status": _normalise_status(row[3] if len(row) > 3 else None),
            })
        if not rows:
            raise CrosswalkError("crosswalk sheet is empty")
        return rows
    finally:
        wb.close()
```

- [ ] **Step 4: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_crosswalk.py -q
```

Expected: `9 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/src/atlas_ingest/crosswalk.py ingest/tests/test_crosswalk.py
git commit -m "ingest: read the requirements crosswalk from the workbook"
```


---

### Task 10: Port curation loading

`overrides.json`, `glossary.json` and `system_device_map.json` are hand-curated state. In
Phase 2 they become tables; in Phase 1 they are read and validated.

**Files:**
- Create: `ingest/src/atlas_ingest/curation.py`
- Create: `ingest/tests/test_curation.py`
- Reference: `build_cuas_tool_v4.py:526-558` (normalize) and `721-744` (glossary)

Verified shapes (from the source repo on 2026-08-05):

- `glossary.json`: 48 acronyms `{acr, meaning}`, 5 `out_of_scope` strings, `confidence_intro`
  prose, and `methodology_extras` with exactly three keys (`risk_caveat`,
  `mapping_confidence_scale`, `soft_ownership_note`).
- `system_device_map.json`: `default_site: "northgate"`, 2 sites, 7 `pending_review` entries.
  Northgate has 13 mappings (8 high / 3 medium / 2 low), 20 `not_deployed_at_site`
  entries and 51 unclaimed infrastructure devices. Westfield Proving Ground has 0 mappings and 8
  unclaimed. One mapping (`atak`) carries `matrix_id_exists: false` and is not one of the
  32 matrix ids. Two mappings (`homing`, `kite`) have an empty `devices` list because they
  are software-only.

- [ ] **Step 1: Write the test**

```python
import json

import pytest

from atlas_ingest.curation import (
    load_glossary, load_overrides, load_system_device_map, mapping_confidence_counts,
)

from conftest import GLOSSARY_JSON, OVERRIDES_JSON, SYSTEM_DEVICE_MAP_JSON


@pytest.fixture(scope="module")
def gloss():
    return load_glossary(GLOSSARY_JSON)


@pytest.fixture(scope="module")
def sdmap():
    return load_system_device_map(SYSTEM_DEVICE_MAP_JSON)


def test_glossary_has_48_acronyms(gloss):
    assert len(gloss["acronyms"]) == 48


def test_every_acronym_has_both_fields(gloss):
    for a in gloss["acronyms"]:
        assert set(a) == {"acr", "meaning"}
        assert a["acr"] and a["meaning"]


def test_glossary_has_five_out_of_scope_declarations(gloss):
    assert len(gloss["out_of_scope"]) == 5


def test_methodology_extras_has_its_three_keys(gloss):
    assert set(gloss["methodology_extras"]) == {
        "risk_caveat", "mapping_confidence_scale", "soft_ownership_note",
    }


def test_a_missing_glossary_is_an_error_not_a_placeholder(tmp_path):
    """The old loader returned a _missing stub so the build could continue and
    ship an empty Reference tab. Spec section 9: distinguish no-data from
    failed-to-load, and never ship a silent placeholder."""
    with pytest.raises(FileNotFoundError):
        load_glossary(tmp_path / "nope.json")


def test_overrides_counts():
    ov = load_overrides(OVERRIDES_JSON)
    assert len(ov["cross_links"]) == 2
    assert len(ov["suppress_links"]) == 4
    assert len(ov["desired_links"]) == 13
    assert ov["risk_overrides"] == {}
    assert ov["soft_overrides"] == {}
    assert list(ov["node_order"]) == ["dhshq"]


def test_suppress_links_are_pairs():
    ov = load_overrides(OVERRIDES_JSON)
    for pair in ov["suppress_links"]:
        assert len(pair) == 2


def test_missing_overrides_file_yields_empty_curation(tmp_path):
    """Unlike the glossary, absent overrides genuinely means 'no curation',
    which is a valid state."""
    ov = load_overrides(tmp_path / "none.json")
    assert ov == {"cross_links": [], "suppress_links": [], "desired_links": [],
                  "risk_overrides": {}, "soft_overrides": {}, "node_order": {}}


def test_sdmap_default_site(sdmap):
    assert sdmap["default_site"] == "northgate"


def test_sdmap_has_two_sites(sdmap):
    assert set(sdmap["sites"]) == {"northgate", "westfield"}


def test_northgate_mapping_counts(sdmap):
    mont = sdmap["sites"]["northgate"]
    assert len(mont["mappings"]) == 13
    assert len(mont["not_deployed_at_site"]) == 20
    assert len(mont["unclaimed_devices"]["infrastructure"]) == 51


def test_westfield_has_no_mappings_yet(sdmap):
    sp = sdmap["sites"]["westfield"]
    assert sp["mappings"] == {}
    assert len(sp["unclaimed_devices"]["infrastructure"]) == 8


def test_pending_review_has_seven_open_questions(sdmap):
    assert len(sdmap["pending_review"]) == 7


def test_confidence_counts_for_northgate(sdmap):
    """Only mappings with at least one device count. homing and kite are
    software-only and carry devices: []."""
    counts = mapping_confidence_counts(sdmap)
    assert counts == {"high": 8, "medium": 3, "low": 2, "unspecified": 0, "total": 13}


def test_the_atak_mapping_declares_it_is_not_a_matrix_system(sdmap):
    """A negative fact worth preserving: someone checked, and 'atak' is
    deliberately absent from the matrix rather than accidentally missing."""
    atak = sdmap["sites"]["northgate"]["mappings"]["atak"]
    assert atak["matrix_id_exists"] is False


def test_legacy_flat_map_is_normalised_to_the_multi_site_shape(tmp_path):
    flat = {"mappings": {"ucop": {"devices": ["d1"], "confidence": "high", "note": ""}},
            "not_deployed_at_northgate": {"beacon": "checked, absent"},
            "unclaimed_devices": {"infrastructure": ["x1"]},
            "pending_review": {}}
    path = tmp_path / "flat.json"
    path.write_text(json.dumps(flat), encoding="utf-8")

    out = load_system_device_map(path)
    assert out["default_site"] == "northgate"
    assert out["sites"]["northgate"]["mappings"]["ucop"]["devices"] == ["d1"]
    assert out["sites"]["northgate"]["not_deployed_at_site"] == {"beacon": "checked, absent"}
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_curation.py -q
```

Expected: `ModuleNotFoundError: No module named 'atlas_ingest.curation'`.

- [ ] **Step 3: Write `curation.py`**

```python
"""Hand-curated overlays: overrides, glossary, and the system-to-device map.

Phase 2 turns all three into tables. Here they are read, shape-normalised and
validated. One deliberate change from build_cuas_tool_v4.py:721-744 — a missing
glossary now raises instead of returning a _missing stub, because the stub let
an empty Reference tab ship unnoticed.
"""
import json
from pathlib import Path

EMPTY_OVERRIDES = {
    "cross_links": [], "suppress_links": [], "desired_links": [],
    "risk_overrides": {}, "soft_overrides": {}, "node_order": {},
}


def _read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_overrides(path):
    """Curation overlay. Absent is legitimate and means 'no curation'."""
    path = Path(path)
    if not path.exists():
        return dict(EMPTY_OVERRIDES)
    raw = _read_json(path)
    out = dict(EMPTY_OVERRIDES)
    for key in EMPTY_OVERRIDES:
        if key in raw:
            out[key] = raw[key]
    return out


def load_glossary(path):
    """Reference-tab content. Absent is fatal: a placeholder Reference tab is
    indistinguishable from a real but empty one."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(
            f"glossary not found: {path}. The Reference tab has no content "
            f"without it, and shipping an empty tab hides the failure."
        )
    data = _read_json(path)
    data.setdefault("confidence_intro", "")
    data.setdefault("out_of_scope", [])
    data.setdefault("methodology_extras", {})
    data.setdefault("acronyms", [])
    return data


def load_system_device_map(path):
    """System-to-device mappings. Accepts the legacy flat single-site shape and
    normalises it to the multi-site shape (build_cuas_tool_v4.py:526-558)."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"system_device_map not found: {path}")
    raw = _read_json(path)

    if isinstance(raw.get("sites"), dict):
        raw.setdefault("pending_review", {})
        for site in raw["sites"].values():
            site.setdefault("mappings", {})
            site.setdefault("not_deployed_at_site", {})
            site.setdefault("unclaimed_devices", {"infrastructure": []})
        return raw

    return {
        "_version": "0.2-wrapped-from-flat",
        "default_site": "northgate",
        "sites": {
            "northgate": {
                "label": "Northgate Sports Campus",
                "scope": "Northgate (wrapped from a legacy flat map)",
                "mappings": raw.get("mappings", {}),
                "not_deployed_at_site": raw.get("not_deployed_at_northgate", {}),
                "unclaimed_devices": raw.get("unclaimed_devices", {"infrastructure": []}),
            }
        },
        "pending_review": raw.get("pending_review", {}),
    }


def mapping_confidence_counts(sdmap):
    """Confidence tally across every site. Mappings with no devices do not
    count as mapped, which is why homing and kite are excluded at Northgate."""
    counts = {"high": 0, "medium": 0, "low": 0, "unspecified": 0, "total": 0}
    for site in sdmap.get("sites", {}).values():
        for entry in site.get("mappings", {}).values():
            if not entry.get("devices"):
                continue
            grade = (entry.get("confidence") or "").lower()
            counts[grade if grade in counts else "unspecified"] += 1
            counts["total"] += 1
    return counts
```

Note `mapping_confidence_counts` returns `total: 13` for Northgate's 13 mappings even
though two have empty device lists. Reconcile before writing the test as gospel: run the
numbers and make the test match reality, then fix whichever side is wrong. The intended
semantics are 8 + 3 + 2 = 13 counted mappings, and `homing`/`kite` are among those 13 only
if their confidence grade is set. **Verify with:**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -c "
from atlas_ingest.curation import load_system_device_map, mapping_confidence_counts
m = load_system_device_map('$ATLAS_SOURCE_REPO/traceability/mindmap/system_device_map.json')
mont = m['sites']['northgate']['mappings']
print('mappings:', len(mont))
print('with devices:', sum(1 for v in mont.values() if v.get('devices')))
print(mapping_confidence_counts(m))
"
```

Adjust `test_confidence_counts_for_northgate` to the printed truth and add a comment
recording which mappings have empty device lists.

- [ ] **Step 4: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_curation.py -q
```

Expected: all pass, no failures or errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/src/atlas_ingest/curation.py ingest/tests/test_curation.py
git commit -m "ingest: load overrides, glossary and the system-device map"
```

---

### Task 11: Load the site network graphs

**Files:**
- Create: `ingest/src/atlas_ingest/network.py`
- Create: `ingest/tests/test_network.py`

Verified shapes: Northgate has 14 zones, 71 nodes, 86 edges; Westfield Proving Ground has 2 zones,
8 nodes, 8 edges. Node fields are `id, label, zone, type, ip, subnet, description`, where
`ip`, `subnet` and (at Westfield Proving Ground) `description` may be `null`. `ip` is not always a
bare address: values include `192.0.2.3` and CIDR forms like `198.51.100.65/29`, so it
is an opaque string. Edge fields are `source, target, link_type, label`, with optional
`vlan`, `port_source`, `port_target`. Graph metadata has `name, description, location,
classification, version, updated`, plus `source_images` and `visio_tabs` at Northgate
only.

- [ ] **Step 1: Write the test**

```python
import pytest

from atlas_ingest.network import NetworkError, load_network

from conftest import NETWORK_JSON


@pytest.fixture(scope="module")
def northgate():
    return load_network(NETWORK_JSON["northgate"], site_id="northgate")


@pytest.fixture(scope="module")
def westfield():
    return load_network(NETWORK_JSON["westfield"], site_id="westfield")


def test_northgate_shape(northgate):
    assert len(northgate["zones"]) == 14
    assert len(northgate["devices"]) == 71
    assert len(northgate["edges"]) == 86


def test_westfield_shape(westfield):
    assert len(westfield["zones"]) == 2
    assert len(westfield["devices"]) == 8
    assert len(westfield["edges"]) == 8


def test_classification_is_carried_through(northgate, westfield):
    """UNCLASSIFIED//SAMPLE is on both files and the old tool never displayed it. It must reach
    the UI here."""
    assert northgate["meta"]["classification"] == "UNCLASSIFIED//SAMPLE"
    assert westfield["meta"]["classification"] == "UNCLASSIFIED//SAMPLE"


def test_optional_graph_metadata_is_absent_at_westfield(westfield, northgate):
    assert northgate["meta"].get("visio_tabs")
    assert westfield["meta"].get("visio_tabs") in (None, [])


def test_every_device_zone_exists_in_zones(northgate, westfield):
    for net in (northgate, westfield):
        zone_ids = set(net["zones"])
        for d in net["devices"]:
            assert d["zone"] in zone_ids


def test_every_edge_endpoint_is_a_known_device(northgate, westfield):
    for net in (northgate, westfield):
        ids = {d["id"] for d in net["devices"]}
        for e in net["edges"]:
            assert e["source"] in ids
            assert e["target"] in ids


def test_device_ip_is_an_opaque_string_or_null(northgate):
    """Values mix bare addresses and CIDR. Never parse these as plain IPs."""
    for d in northgate["devices"]:
        assert d["ip"] is None or isinstance(d["ip"], str)


def test_nullable_description_survives(westfield):
    assert any(d["description"] is None for d in westfield["devices"])


def test_a_dangling_edge_is_fatal(tmp_path):
    import json

    bad = {"graph": {"name": "x", "classification": "TEST"}, "zones": {"z": {"label": "Z"}},
           "nodes": [{"id": "a", "label": "A", "zone": "z", "type": "server",
                      "ip": None, "subnet": None, "description": None}],
           "edges": [{"source": "a", "target": "ghost", "link_type": "ethernet", "label": None}]}
    path = tmp_path / "bad.json"
    path.write_text(json.dumps(bad), encoding="utf-8")

    with pytest.raises(NetworkError, match="ghost"):
        load_network(path, site_id="bad")
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_network.py -q
```

Expected: `ModuleNotFoundError: No module named 'atlas_ingest.network'`.

- [ ] **Step 3: Write `network.py`**

```python
"""Per-site physical topology, read from the NetworkX-style JSON exports.

Referential integrity is checked here rather than deferred: an edge pointing at
a device that does not exist renders as a line to nowhere, and the old tool's
warn-and-continue posture is what let that ship.
"""
import json
from pathlib import Path


class NetworkError(ValueError):
    """The topology file is internally inconsistent."""


def load_network(path, site_id):
    """-> {site_id, meta, zones, devices, edges}."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))

    graph = raw.get("graph", {})
    zones = raw.get("zones", {})
    devices = raw.get("nodes", [])
    edges = raw.get("edges", [])

    zone_ids = set(zones)
    device_ids = {d["id"] for d in devices}

    for d in devices:
        if d["zone"] not in zone_ids:
            raise NetworkError(
                f"{site_id}: device '{d['id']}' is in zone '{d['zone']}', "
                f"which is not declared in zones"
            )
    for e in edges:
        for end in ("source", "target"):
            if e[end] not in device_ids:
                raise NetworkError(
                    f"{site_id}: edge {e['source']}->{e['target']} references "
                    f"unknown device '{e[end]}'"
                )

    return {
        "site_id": site_id,
        "meta": {
            "label": graph.get("location") or graph.get("name") or site_id,
            "name": graph.get("name", ""),
            "description": graph.get("description", ""),
            "classification": graph.get("classification", ""),
            "version": graph.get("version", ""),
            "updated": graph.get("updated", ""),
            "source_images": graph.get("source_images"),
            "visio_tabs": graph.get("visio_tabs", []),
            "device_count": len(devices),
            "edge_count": len(edges),
        },
        "zones": zones,
        "devices": devices,
        "edges": edges,
    }
```

- [ ] **Step 4: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_network.py -q
```

Expected: `9 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/src/atlas_ingest/network.py ingest/tests/test_network.py
git commit -m "ingest: load site topologies with referential integrity checks"
```

---

### Task 12: The seven lossiness dimensions

This is new analysis, not a port. Spec §5. Every metric carries the entity ids behind it,
because a number without its evidence is the thing this tool exists to prevent.

**Files:**
- Create: `ingest/src/atlas_ingest/lossiness.py`
- Create: `ingest/tests/test_lossiness.py`

Hand-computed expected values for the 5MAR baseline:

| # | Dimension | Numerator / denominator | Value |
|---|---|---|---|
| 1 | Requirement attrition | 9 carried / 11 total | 81.8% |
| 2 | Ownership ambiguity | 23 confirmed / 32 | 71.9% |
| 3 | Realization gap | 11 mapped / 32, at Northgate | 34.4% |
| 4 | Integration gap | 13 desired links, of which the ones absent from the 14 current | count |
| 5 | Evidence gap | 32 explicit / 32 | 100% |
| 6 | Orphaned hardware | 51 unclaimed at Northgate, 8 at Westfield Proving Ground | 59 |
| 7 | Open questions | 7 pending review | 7 |

Dimension 3's numerator is "mappings with at least one device", which is 13 minus the two
software-only entries (`homing`, `kite`) minus `atak` (not a matrix system) — confirm the
exact figure in Step 1 rather than trusting this table, and make the test assert what the
data says.

- [ ] **Step 1: Establish the real numbers before writing assertions**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -c "
import json
from pathlib import Path
M = Path('$ATLAS_SOURCE_REPO/traceability/mindmap')
sd = json.loads((M/'system_device_map.json').read_text())
mont = sd['sites']['northgate']['mappings']
print('mappings total       :', len(mont))
print('with >=1 device      :', sum(1 for v in mont.values() if v.get('devices')))
print('with matrix_id false :', sum(1 for v in mont.values() if v.get('matrix_id_exists') is False))
print('unclaimed northgate :', len(sd['sites']['northgate']['unclaimed_devices']['infrastructure']))
print('unclaimed westfield     :', len(sd['sites']['westfield']['unclaimed_devices']['infrastructure']))
print('not_deployed         :', len(sd['sites']['northgate']['not_deployed_at_site']))
print('pending_review       :', len(sd['pending_review']))
"
```

Write the printed values into the test as literals, with a comment naming the date they
were captured.

- [ ] **Step 2: Write the test**

```python
"""Hand-computed fixtures per dimension. Silently drifting metrics are worse
than no metrics, so every figure here is asserted against a number a human
worked out from the source data on 2026-08-05.
"""
import pytest

from atlas_ingest.lossiness import compute_lossiness


@pytest.fixture(scope="module")
def report(systems, overrides):
    """Built from the real 5MAR inputs. See Step 1 for how the literals below
    were derived."""
    from atlas_ingest.crosswalk import read_crosswalk
    from atlas_ingest.curation import load_system_device_map
    from atlas_ingest.links import desired_links, extract_links, merge_links
    from atlas_ingest.network import load_network

    from conftest import MATRIX_XLSX, NETWORK_JSON, SYSTEM_DEVICE_MAP_JSON

    return compute_lossiness(
        systems=systems,
        links=merge_links(extract_links(systems), overrides),
        desired=desired_links(overrides),
        crosswalk=read_crosswalk(MATRIX_XLSX),
        sdmap=load_system_device_map(SYSTEM_DEVICE_MAP_JSON),
        networks={sid: load_network(p, sid) for sid, p in NETWORK_JSON.items()},
    )


def test_all_seven_dimensions_present(report):
    assert [d["key"] for d in report["dimensions"]] == [
        "requirement_attrition", "ownership_ambiguity", "realization_gap",
        "integration_gap", "evidence_gap", "orphaned_hardware", "open_questions",
    ]


def _dim(report, key):
    return next(d for d in report["dimensions"] if d["key"] == key)


def test_requirement_attrition(report):
    d = _dim(report, "requirement_attrition")
    assert (d["numerator"], d["denominator"]) == (9, 11)
    assert d["value_pct"] == pytest.approx(81.8, abs=0.1)
    assert sorted(d["detail"]["dropped"]) == [
        "No spectrum deconfliction process",
        "No standing training pipeline for relay operators",
    ]


def test_ownership_ambiguity(report):
    d = _dim(report, "ownership_ambiguity")
    assert (d["numerator"], d["denominator"]) == (23, 32)
    assert sorted(d["detail"]["unconfirmed"]) == [
        "beacon", "cirrus", "dwell", "ember", "fathom", "gantry", "halyard", "ingot", "jetty",
    ]


def test_evidence_gap_is_fully_explicit_on_this_baseline(report):
    d = _dim(report, "evidence_gap")
    assert (d["numerator"], d["denominator"]) == (32, 32)
    assert d["value_pct"] == 100.0
    assert d["detail"]["inferred"] == []


def test_integration_gap_lists_the_missing_pairs(report):
    d = _dim(report, "integration_gap")
    current = {tuple(sorted(p)) for p in d["detail"]["current_pairs"]}
    for pair in d["detail"]["missing_pairs"]:
        assert tuple(sorted(pair)) not in current
    assert d["numerator"] == len(d["detail"]["missing_pairs"])


def test_orphaned_hardware_counts_both_sites(report):
    d = _dim(report, "orphaned_hardware")
    assert d["numerator"] == 59
    assert set(d["detail"]["by_site"]) == {"northgate", "westfield"}
    assert d["detail"]["by_site"]["northgate"] == 51
    assert d["detail"]["by_site"]["westfield"] == 8


def test_open_questions(report):
    d = _dim(report, "open_questions")
    assert d["numerator"] == 7
    assert len(d["detail"]["questions"]) == 7


def test_every_dimension_carries_its_evidence(report):
    """Spec section 5: no number without its evidence. A dimension whose detail
    is empty while its numerator is non-zero is a bug, not a clean bill."""
    for d in report["dimensions"]:
        assert "detail" in d and isinstance(d["detail"], dict)
        assert d["severity"] in {"ok", "watch", "critical"}


def test_severity_thresholds_are_explicit():
    from atlas_ingest.lossiness import severity_for

    assert severity_for(95.0) == "ok"
    assert severity_for(80.0) == "watch"
    assert severity_for(40.0) == "critical"


def test_no_composite_index_by_default(report):
    """Spec section 5's honesty guardrail: a single number invites the false
    precision this tool exists to prevent. Show the seven; keep the composite
    opt-in."""
    assert "lossiness_index" not in report


def test_composite_index_available_on_request(systems, overrides, report):
    from atlas_ingest.lossiness import composite_index

    value = composite_index(report)
    assert 0.0 <= value <= 100.0
```

- [ ] **Step 3: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_lossiness.py -q
```

Expected: `ModuleNotFoundError: No module named 'atlas_ingest.lossiness'`.

- [ ] **Step 4: Write `lossiness.py`**

```python
"""The seven dimensions where information dies between intent and deployment.

Spec section 5. Every dimension returns numerator, denominator, a percentage,
a severity band, and a detail block naming the offending entities. The detail
block is the point: it is what lets the UI drill from a figure to the rows
behind it, and what stops a metric from becoming an unfalsifiable claim.

Dimensions 4 and 6 are the differentiated ones. 4 is a gap map of integrations
that were wanted and still do not exist; 6 is its inverse, hardware in the rack
that no architecture document explains.
"""

DIMENSION_ORDER = [
    "requirement_attrition", "ownership_ambiguity", "realization_gap",
    "integration_gap", "evidence_gap", "orphaned_hardware", "open_questions",
]

DIMENSION_LABELS = {
    "requirement_attrition": "Requirement attrition",
    "ownership_ambiguity": "Ownership ambiguity",
    "realization_gap": "Realization gap",
    "integration_gap": "Integration gap",
    "evidence_gap": "Evidence gap",
    "orphaned_hardware": "Orphaned hardware",
    "open_questions": "Open questions",
}

# Percentage bands for "higher is better" dimensions. Counts (4, 6, 7) use
# count_severity instead, because there is no meaningful denominator for
# "how much hardware should be unexplained".
OK_AT = 90.0
WATCH_AT = 60.0


def severity_for(pct):
    """Band a percentage where higher is better."""
    if pct >= OK_AT:
        return "ok"
    if pct >= WATCH_AT:
        return "watch"
    return "critical"


def count_severity(count, watch_at=1, critical_at=10):
    """Band a raw count where lower is better."""
    if count >= critical_at:
        return "critical"
    if count >= watch_at:
        return "watch"
    return "ok"


def _pct(num, den):
    return round(100.0 * num / den, 1) if den else 0.0


def _dimension(key, numerator, denominator, severity, detail, unit="pct"):
    return {
        "key": key,
        "label": DIMENSION_LABELS[key],
        "numerator": numerator,
        "denominator": denominator,
        "value_pct": _pct(numerator, denominator) if unit == "pct" else None,
        "unit": unit,
        "severity": severity,
        "detail": detail,
    }


def _requirement_attrition(crosswalk):
    dropped = [r["orig"] for r in crosswalk if r["status"] == "Didn't keep"]
    carried = len(crosswalk) - len(dropped)
    return _dimension(
        "requirement_attrition", carried, len(crosswalk),
        severity_for(_pct(carried, len(crosswalk))),
        {"dropped": dropped,
         "by_status": _tally(r["status"] for r in crosswalk)},
    )


def _ownership_ambiguity(systems):
    unconfirmed = sorted(s["id"] for s in systems if s["soft"])
    confirmed = len(systems) - len(unconfirmed)
    return _dimension(
        "ownership_ambiguity", confirmed, len(systems),
        severity_for(_pct(confirmed, len(systems))),
        {"unconfirmed": unconfirmed},
    )


def _realization_gap(systems, sdmap):
    matrix_ids = {s["id"] for s in systems}
    per_site, mapped_anywhere = {}, set()
    for site_id, site in sdmap.get("sites", {}).items():
        mapped = sorted(
            sid for sid, entry in site.get("mappings", {}).items()
            if entry.get("devices") and sid in matrix_ids
        )
        mapped_anywhere.update(mapped)
        per_site[site_id] = {
            "label": site.get("label", site_id),
            "mapped": len(mapped),
            "total": len(systems),
            "pct": _pct(len(mapped), len(systems)),
            "mapped_ids": mapped,
            "checked_absent": sorted(site.get("not_deployed_at_site", {})),
        }
    unmapped = sorted(matrix_ids - mapped_anywhere)
    return _dimension(
        "realization_gap", len(mapped_anywhere), len(systems),
        severity_for(_pct(len(mapped_anywhere), len(systems))),
        {"per_site": per_site, "unmapped": unmapped},
    )


def _integration_gap(links, desired):
    current = {tuple(sorted([l["from"], l["to"]])) for l in links}
    missing = [
        {"from": d["from"], "to": d["to"], "label": d.get("label", "")}
        for d in desired
        if tuple(sorted([d["from"], d["to"]])) not in current
    ]
    return _dimension(
        "integration_gap", len(missing), len(desired),
        count_severity(len(missing), watch_at=1, critical_at=10),
        {"missing_pairs": [[m["from"], m["to"]] for m in missing],
         "missing": missing,
         "current_pairs": [list(p) for p in sorted(current)]},
        unit="count",
    )


def _evidence_gap(systems):
    inferred = sorted(s["id"] for s in systems if s["risk_source"] == "inferred")
    explicit = sum(1 for s in systems if s["risk_source"] == "explicit")
    override = sorted(s["id"] for s in systems if s["risk_source"] == "override")
    return _dimension(
        "evidence_gap", explicit, len(systems),
        severity_for(_pct(explicit, len(systems))),
        {"inferred": inferred, "override": override},
    )


def _orphaned_hardware(sdmap, networks):
    by_site, ids = {}, {}
    for site_id, site in sdmap.get("sites", {}).items():
        unclaimed = site.get("unclaimed_devices", {}).get("infrastructure", [])
        by_site[site_id] = len(unclaimed)
        ids[site_id] = list(unclaimed)
    total_devices = sum(n["meta"]["device_count"] for n in (networks or {}).values())
    return _dimension(
        "orphaned_hardware", sum(by_site.values()), total_devices,
        count_severity(sum(by_site.values()), watch_at=1, critical_at=25),
        {"by_site": by_site, "device_ids": ids},
        unit="count",
    )


def _open_questions(sdmap):
    pending = sdmap.get("pending_review", {})
    return _dimension(
        "open_questions", len(pending), len(pending),
        count_severity(len(pending), watch_at=1, critical_at=10),
        {"questions": [{"subject": k, "question": v} for k, v in pending.items()]},
        unit="count",
    )


def _tally(values):
    out = {}
    for v in values:
        out[v] = out.get(v, 0) + 1
    return out


def compute_lossiness(systems, links, desired, crosswalk, sdmap, networks=None):
    """-> {dimensions: [...]}. Deliberately has no composite index; see
    composite_index() and the spec's honesty guardrail."""
    return {
        "dimensions": [
            _requirement_attrition(crosswalk),
            _ownership_ambiguity(systems),
            _realization_gap(systems, sdmap),
            _integration_gap(links, desired),
            _evidence_gap(systems),
            _orphaned_hardware(sdmap, networks),
            _open_questions(sdmap),
        ]
    }


def composite_index(report):
    """Opt-in management indicator, never a formal metric.

    Averages the percentage-valued dimensions only. Count dimensions have no
    denominator that makes a percentage honest, so folding them in would
    manufacture precision. Callers must label the result as an indicator.
    """
    pcts = [d["value_pct"] for d in report["dimensions"]
            if d["unit"] == "pct" and d["value_pct"] is not None]
    return round(sum(pcts) / len(pcts), 1) if pcts else 0.0


def top_gaps(report, systems, limit=10):
    """High-risk, unconfirmed and unmapped, ranked. Spec section 5's Top Gaps."""
    unconfirmed = set(_find(report, "ownership_ambiguity")["detail"]["unconfirmed"])
    unmapped = set(_find(report, "realization_gap")["detail"]["unmapped"])
    scored = []
    for s in systems:
        score = ((s["risk"] == "high") * 3) + (s["id"] in unconfirmed) + (s["id"] in unmapped)
        if score:
            scored.append({
                "id": s["id"], "name": s["name"], "risk": s["risk"],
                "unconfirmed": s["id"] in unconfirmed,
                "unmapped": s["id"] in unmapped,
                "score": score,
            })
    scored.sort(key=lambda r: (-r["score"], r["id"]))
    return scored[:limit]


def _find(report, key):
    return next(d for d in report["dimensions"] if d["key"] == key)
```

- [ ] **Step 5: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_lossiness.py -q
```

If `test_requirement_attrition` or `test_orphaned_hardware` fails on a count, the Step 1
numbers were wrong; fix the test, not the code, and record why in a comment.

- [ ] **Step 6: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/src/atlas_ingest/lossiness.py ingest/tests/test_lossiness.py
git commit -m "ingest: compute the seven lossiness dimensions with evidence"
```

---

### Task 13: The fail-closed validator

Replaces `_validate_data()`'s five hand-rolled checks. Pure `validate()` returning failure
strings, thin `main()` doing the I/O and the exit, following CRUCIBLE's split so the gates
are unit-testable.

**Files:**
- Create: `ingest/src/atlas_ingest/validate.py`
- Create: `ingest/tests/test_validate.py`
- Reference: `build_cuas_tool_v4.py:617-720`

- [ ] **Step 1: Write the test**

```python
from atlas_ingest.validate import validate


def _inputs(**over):
    base = {
        "systems": [{"id": "ucop", "name": "UAS Common Picture", "risk": "high",
                     "risk_source": "explicit", "soft": False}],
        "links": [],
        "sdmap": {"sites": {}, "pending_review": {}},
        "networks": {},
        "crosswalk": [{"orig": "r", "sys": "s", "current": ["UAS Common Picture"], "status": "Condensed"}],
        "glossary": {"acronyms": [{"acr": "A", "meaning": "B"}], "out_of_scope": [],
                     "confidence_intro": "x", "methodology_extras": {}},
    }
    base.update(over)
    return base


def test_clean_inputs_produce_no_failures():
    assert validate(**_inputs()) == []


def test_a_mapping_to_an_unknown_system_fails():
    sdmap = {"sites": {"northgate": {"mappings": {"ghost": {"devices": ["d1"]}},
                                      "not_deployed_at_site": {},
                                      "unclaimed_devices": {"infrastructure": []}}},
             "pending_review": {}}
    fails = validate(**_inputs(sdmap=sdmap))
    assert any("ghost" in f for f in fails)


def test_matrix_id_exists_false_exempts_a_mapping():
    """The escape hatch is a documented negative fact, not a loophole to be
    closed. 'atak' uses it legitimately."""
    sdmap = {"sites": {"northgate": {
        "mappings": {"atak": {"devices": ["d1"], "matrix_id_exists": False}},
        "not_deployed_at_site": {}, "unclaimed_devices": {"infrastructure": []}}},
        "pending_review": {}}
    assert validate(**_inputs(sdmap=sdmap)) == []


def test_a_not_deployed_entry_for_an_unknown_system_fails():
    sdmap = {"sites": {"northgate": {"mappings": {},
                                      "not_deployed_at_site": {"ghost": "checked"},
                                      "unclaimed_devices": {"infrastructure": []}}},
             "pending_review": {}}
    assert any("ghost" in f for f in validate(**_inputs(sdmap=sdmap)))


def test_a_mapping_to_an_unknown_device_fails():
    sdmap = {"sites": {"northgate": {"mappings": {"ucop": {"devices": ["nosuchdevice"]}},
                                      "not_deployed_at_site": {},
                                      "unclaimed_devices": {"infrastructure": []}}},
             "pending_review": {}}
    networks = {"northgate": {"site_id": "northgate", "devices": [{"id": "d1"}],
                               "edges": [], "zones": {}, "meta": {"device_count": 1}}}
    assert any("nosuchdevice" in f for f in validate(**_inputs(sdmap=sdmap, networks=networks)))


def test_a_link_to_an_unknown_system_fails():
    fails = validate(**_inputs(links=[{"from": "ucop", "to": "ghost", "label": "x"}]))
    assert any("ghost" in f for f in fails)


def test_a_crosswalk_row_naming_an_unknown_system_fails():
    cw = [{"orig": "r", "sys": "s", "current": ["Nonexistent System"], "status": "Split out"}]
    assert any("Nonexistent System" in f for f in validate(**_inputs(crosswalk=cw)))


def test_an_empty_glossary_fails():
    assert any("acronym" in f.lower()
               for f in validate(**_inputs(glossary={"acronyms": [], "out_of_scope": [],
                                                     "confidence_intro": "",
                                                     "methodology_extras": {}})))


def test_all_failures_are_collected_not_just_the_first():
    """Fixing one problem per run is how a five-error dataset takes five
    builds to clean up."""
    sdmap = {"sites": {"northgate": {
        "mappings": {"ghost1": {"devices": ["d"]}, "ghost2": {"devices": ["d"]}},
        "not_deployed_at_site": {"ghost3": "x"},
        "unclaimed_devices": {"infrastructure": []}}}, "pending_review": {}}
    fails = validate(**_inputs(sdmap=sdmap))
    assert len(fails) >= 3


def test_validate_is_pure_and_returns_strings():
    out = validate(**_inputs())
    assert isinstance(out, list)
    assert all(isinstance(f, str) for f in out)
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_validate.py -q
```

Expected: `ModuleNotFoundError: No module named 'atlas_ingest.validate'`.

- [ ] **Step 3: Write `validate.py`**

```python
"""Cross-file integrity gates. Fails closed.

validate() is pure and returns a list of failure strings; main() does the I/O
and owns the exit code. That split is what makes the gates unit-testable, and
it is CRUCIBLE's pattern (scripts/validate_data.py).

Replaces build_cuas_tool_v4.py:617-720, which warned and continued. Warning and
continuing is how stale data shipped, so every check here is an error.
"""
import sys


def validate(systems, links, sdmap, networks, crosswalk, glossary):
    """-> list of failure strings. Empty means every gate passed.

    Collects all failures rather than bailing on the first, so one run tells
    you everything that needs fixing.
    """
    fails = []
    matrix_ids = {s["id"] for s in systems}
    system_names = {s["name"] for s in systems}

    for site_id, site in (sdmap.get("sites") or {}).items():
        device_ids = None
        net = (networks or {}).get(site_id)
        if net:
            device_ids = {d["id"] for d in net["devices"]}

        for sys_id, entry in (site.get("mappings") or {}).items():
            if sys_id not in matrix_ids and entry.get("matrix_id_exists") is not False:
                fails.append(
                    f"system_device_map.sites.{site_id}.mappings.{sys_id}: not a matrix "
                    f"system id; add it to the workbook or set matrix_id_exists:false"
                )
            if device_ids is not None:
                for device in entry.get("devices") or []:
                    if device not in device_ids:
                        fails.append(
                            f"system_device_map.sites.{site_id}.mappings.{sys_id}: "
                            f"device '{device}' is not in the {site_id} topology"
                        )

        for sys_id in site.get("not_deployed_at_site") or {}:
            if sys_id not in matrix_ids:
                fails.append(
                    f"system_device_map.sites.{site_id}.not_deployed_at_site.{sys_id}: "
                    f"not a matrix system id"
                )

        if device_ids is not None:
            for device in (site.get("unclaimed_devices") or {}).get("infrastructure", []):
                if device not in device_ids:
                    fails.append(
                        f"system_device_map.sites.{site_id}.unclaimed_devices: "
                        f"device '{device}' is not in the {site_id} topology"
                    )

    for link in links or []:
        for end in ("from", "to"):
            if link[end] not in matrix_ids:
                fails.append(f"link {link['from']}->{link['to']}: '{link[end]}' is not a matrix system id")

    for row in crosswalk or []:
        for name in row.get("current") or []:
            if name not in system_names:
                fails.append(
                    f"crosswalk '{row['orig'][:40]}…': current system '{name}' "
                    f"does not match any Project/System name in the matrix"
                )

    if not (glossary or {}).get("acronyms"):
        fails.append("glossary: no acronyms; the Reference tab would ship empty")
    if not (glossary or {}).get("confidence_intro"):
        fails.append("glossary: no confidence_intro; the Confidence section would ship empty")

    return fails


def main(argv=None):
    """CLI gate. Exits 1 on any failure, 0 with a one-line summary otherwise."""
    from .cli import load_all_inputs, add_input_args
    import argparse

    parser = argparse.ArgumentParser(description="ATLAS ingest integrity gates")
    add_input_args(parser)
    args = parser.parse_args(argv)

    inputs = load_all_inputs(args)
    fails = validate(
        systems=inputs["systems"], links=inputs["links"], sdmap=inputs["sdmap"],
        networks=inputs["networks"], crosswalk=inputs["crosswalk"],
        glossary=inputs["glossary"],
    )
    if fails:
        print("[validate] FAILED:", file=sys.stderr)
        for f in fails:
            print(f"  - {f}", file=sys.stderr)
        print(f"\n{len(fails)} integrity failure(s). No bundle is written; "
              f"the deployed data is unchanged.", file=sys.stderr)
        return 1
    print(f"[validate] all gates passed ({len(inputs['systems'])} systems, "
          f"{len(inputs['networks'])} site(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_validate.py -q
```

Expected: `10 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/src/atlas_ingest/validate.py ingest/tests/test_validate.py
git commit -m "ingest: fail-closed integrity gates with a pure validate()"
```

---

### Task 14: The bundle emitter

Turns every input into the JSON the app reads. This is the seam between the two halves.

**Files:**
- Create: `ingest/src/atlas_ingest/cli.py`
- Create: `ingest/src/atlas_ingest/methodology.py`
- Create: `ingest/src/atlas_ingest/bundle.py`
- Create: `ingest/tests/test_bundle.py`

- [ ] **Step 1: Write the test**

```python
import json

import pytest

from atlas_ingest.bundle import BUNDLE_VERSION, emit_bundles


@pytest.fixture(scope="module")
def out(tmp_path_factory, systems, overrides):
    from atlas_ingest.crosswalk import read_crosswalk
    from atlas_ingest.curation import load_glossary, load_system_device_map
    from atlas_ingest.links import desired_links, extract_links, merge_links
    from atlas_ingest.network import load_network

    from conftest import GLOSSARY_JSON, MATRIX_XLSX, NETWORK_JSON, SYSTEM_DEVICE_MAP_JSON

    target = tmp_path_factory.mktemp("data")
    emit_bundles(
        out_dir=target,
        systems=systems,
        links=merge_links(extract_links(systems), overrides),
        desired=desired_links(overrides),
        crosswalk=read_crosswalk(MATRIX_XLSX),
        glossary=load_glossary(GLOSSARY_JSON),
        sdmap=load_system_device_map(SYSTEM_DEVICE_MAP_JSON),
        networks={sid: load_network(p, sid) for sid, p in NETWORK_JSON.items()},
        source_label="Traceability Matrix 5 MAR 2026 (enhanced)",
        baseline_date="2026-03-05",
        built_at="2026-08-05T12:00:00",
        git_sha="testsha",
    )
    return target


def _read(out, name):
    return json.loads((out / name).read_text(encoding="utf-8"))


def test_every_expected_file_exists(out):
    for name in ["manifest.json", "project.json", "systems.json", "links.json",
                 "crosswalk.json", "glossary.json", "methodology.json",
                 "coverage.json", "lossiness.json"]:
        assert (out / name).exists(), name
    assert (out / "sites" / "northgate.json").exists()
    assert (out / "sites" / "westfield.json").exists()


def test_manifest_carries_provenance(out):
    m = _read(out, "manifest.json")
    assert m["bundle_version"] == BUNDLE_VERSION
    assert m["git_sha"] == "testsha"
    assert m["built_at"] == "2026-08-05T12:00:00"
    assert m["source_label"] == "Traceability Matrix 5 MAR 2026 (enhanced)"
    assert m["counts"]["systems"] == 32


def test_systems_bundle_has_32_entries_with_owner_group_display(out):
    systems = _read(out, "systems.json")
    assert len(systems) == 32
    assert {s["owner_group"] for s in systems} == {
        "DHS S&T", "CBP", "Other DHS", "DHS HQ/OCIO", "DoD", "External",
    }


def test_system_names_are_not_truncated(out):
    """The old tool truncated names to 24 chars with '..' for a fixed-width
    layout, and the truncated form leaked into the analytics payload. Names
    ship whole; the UI does its own eliding."""
    for s in _read(out, "systems.json"):
        assert not s["name"].endswith("..")


def test_a_snapshot_is_written_for_this_build(out):
    snaps = list((out / "snapshots").glob("*.json"))
    assert len(snaps) == 1
    snap = json.loads(snaps[0].read_text(encoding="utf-8"))
    assert len(snap["dimensions"]) == 7
    assert snap["built_at"] == "2026-08-05T12:00:00"


def test_site_bundle_shape(out):
    mont = _read(out, "sites/northgate.json")
    assert len(mont["devices"]) == 71
    assert len(mont["edges"]) == 86
    assert len(mont["zones"]) == 14
    assert mont["meta"]["classification"] == "UNCLASSIFIED//SAMPLE"


def test_methodology_reflects_the_real_constants(out):
    """Docs generated from the code cannot drift from it."""
    from atlas_ingest import config

    meth = _read(out, "methodology.json")
    assert meth["owner_rules_count"] == len(config.OWNER_RULES)
    assert meth["high_keywords"] == list(config.HIGH_KEYWORDS)
    assert meth["always_soft"] == sorted(config.ALWAYS_SOFT)


def test_bundles_are_deterministic(out, tmp_path, systems, overrides):
    """Two runs on the same inputs must produce byte-identical files, or every
    rebuild churns the git diff and real changes get lost in the noise."""
    from atlas_ingest.crosswalk import read_crosswalk
    from atlas_ingest.curation import load_glossary, load_system_device_map
    from atlas_ingest.links import desired_links, extract_links, merge_links
    from atlas_ingest.network import load_network

    from conftest import GLOSSARY_JSON, MATRIX_XLSX, NETWORK_JSON, SYSTEM_DEVICE_MAP_JSON

    second = tmp_path / "again"
    emit_bundles(
        out_dir=second, systems=systems,
        links=merge_links(extract_links(systems), overrides),
        desired=desired_links(overrides),
        crosswalk=read_crosswalk(MATRIX_XLSX),
        glossary=load_glossary(GLOSSARY_JSON),
        sdmap=load_system_device_map(SYSTEM_DEVICE_MAP_JSON),
        networks={sid: load_network(p, sid) for sid, p in NETWORK_JSON.items()},
        source_label="Traceability Matrix 5 MAR 2026 (enhanced)",
        baseline_date="2026-03-05", built_at="2026-08-05T12:00:00", git_sha="testsha",
    )
    for name in ["systems.json", "links.json", "lossiness.json", "manifest.json"]:
        assert (out / name).read_bytes() == (second / name).read_bytes(), name
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_bundle.py -q
```

Expected: `ModuleNotFoundError: No module named 'atlas_ingest.bundle'`.

- [ ] **Step 3: Write `methodology.py`**

```python
"""Reflect the live classification constants into a UI payload.

The Reference tab renders exactly these values, so the documented behaviour
cannot drift from the implemented behaviour. Ported from
build_cuas_tool_v4.py:747-761 and extended with the tables the old payload
omitted.
"""
from . import config


def extract_methodology():
    return {
        "high_keywords": list(config.HIGH_KEYWORDS),
        "low_keywords": list(config.LOW_KEYWORDS),
        "medium_keywords": list(config.MEDIUM_KEYWORDS),
        "soft_keywords": list(config.SOFT_KEYWORDS),
        "always_soft": sorted(config.ALWAYS_SOFT),
        "never_soft": sorted(config.NEVER_SOFT),
        "soft_groups": sorted(config.SOFT_GROUPS),
        "owner_rules_count": len(config.OWNER_RULES),
        "owner_rules": [
            {"priority": i, "match": sub, "group_id": gid,
             "group_label": glabel.replace("\n", " "),
             "match_mode": "word_boundary" if len(sub) <= 4 else "substring"}
            for i, (sub, gid, glabel, _ck) in enumerate(config.OWNER_RULES)
        ],
        "category_map": {
            k: {"branch": v["branch"], "label": v["label"].replace("\n", " ")}
            for k, v in config.CATEGORY_MAP.items()
        },
        "link_fragment_count": len(config.LINK_NAME_FRAGMENTS),
        "id_alias_count": len(config.ID_MAP),
    }
```

- [ ] **Step 4: Write `bundle.py`**

```python
"""Emit the JSON bundles the React app reads.

Every file is written with sorted keys and a trailing newline so two runs on
identical inputs produce identical bytes. Non-determinism here means every
rebuild churns the git diff and real changes hide in the noise.
"""
import json
from pathlib import Path

from .classify import owner_group_display
from .curation import mapping_confidence_counts
from .lossiness import compute_lossiness, top_gaps
from .methodology import extract_methodology

BUNDLE_VERSION = 1


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _system_payload(s):
    return {
        "id": s["id"],
        "name": s["name"],
        "label": s["label"],
        "category": s["cat"],
        "owner_group_id": s["gid"],
        "owner_group": owner_group_display(s["gid"]),
        "color_key": s["ck"],
        "confirmed": not s["soft"],
        "risk": s["risk"],
        "risk_source": s["risk_source"],
        "detail": s["detail"],
        "integrations_prose": s["integ"],
    }


def emit_bundles(out_dir, systems, links, desired, crosswalk, glossary, sdmap,
                 networks, source_label, baseline_date, built_at, git_sha):
    """Write every bundle under out_dir. Returns the manifest."""
    out_dir = Path(out_dir)

    report = compute_lossiness(
        systems=systems, links=links, desired=desired,
        crosswalk=crosswalk, sdmap=sdmap, networks=networks,
    )

    _write(out_dir / "systems.json", [_system_payload(s) for s in systems])
    _write(out_dir / "links.json", {"current": links, "desired": desired})
    _write(out_dir / "crosswalk.json", crosswalk)
    _write(out_dir / "glossary.json", glossary)
    _write(out_dir / "methodology.json", extract_methodology())
    _write(out_dir / "lossiness.json", {
        **report,
        "top_gaps": top_gaps(report, systems),
    })
    _write(out_dir / "coverage.json", {
        "default_site": sdmap.get("default_site"),
        "sites": {
            sid: {
                "label": site.get("label", sid),
                "scope": site.get("scope", ""),
                "mappings": site.get("mappings", {}),
                "not_deployed_at_site": site.get("not_deployed_at_site", {}),
                "unclaimed_devices": site.get("unclaimed_devices", {"infrastructure": []}),
            }
            for sid, site in sdmap.get("sites", {}).items()
        },
        "pending_review": sdmap.get("pending_review", {}),
        "confidence_counts": mapping_confidence_counts(sdmap),
    })

    for site_id, net in (networks or {}).items():
        _write(out_dir / "sites" / f"{site_id}.json", net)

    _write(out_dir / "project.json", {
        "slug": "dhs-cuas",
        "name": "DHS C-UAS Architecture",
        "baseline_date": baseline_date,
        "source_label": source_label,
        "sites": [
            {"id": sid, "label": net["meta"]["label"],
             "classification": net["meta"]["classification"],
             "device_count": net["meta"]["device_count"],
             "edge_count": net["meta"]["edge_count"],
             "updated": net["meta"]["updated"]}
            for sid, net in sorted((networks or {}).items())
        ],
        "default_site": sdmap.get("default_site"),
    })

    manifest = {
        "bundle_version": BUNDLE_VERSION,
        "tool_version": "ATLAS Phase 1",
        "built_at": built_at,
        "git_sha": git_sha,
        "source_label": source_label,
        "baseline_date": baseline_date,
        "counts": {
            "systems": len(systems),
            "confirmed": sum(1 for s in systems if not s["soft"]),
            "unconfirmed": sum(1 for s in systems if s["soft"]),
            "links": len(links),
            "desired_links": len(desired),
            "requirements": len(crosswalk),
            "acronyms": len(glossary.get("acronyms", [])),
            "sites": len(networks or {}),
            "devices": sum(n["meta"]["device_count"] for n in (networks or {}).values()),
        },
    }
    _write(out_dir / "manifest.json", manifest)

    snapshot_date = built_at.split("T")[0]
    _write(out_dir / "snapshots" / f"{snapshot_date}.json", {
        "label": snapshot_date,
        "built_at": built_at,
        "git_sha": git_sha,
        "dimensions": [
            {k: d[k] for k in ("key", "label", "numerator", "denominator",
                               "value_pct", "unit", "severity")}
            for d in report["dimensions"]
        ],
    })

    return manifest
```

- [ ] **Step 5: Write `cli.py`** — the shared argument parsing that `bundle` and `validate` both use

```python
"""Shared CLI wiring. Keeping input loading in one place means the validate
gate and the emitter can never disagree about what the inputs are.
"""
import argparse
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from .crosswalk import read_crosswalk
from .curation import load_glossary, load_overrides, load_system_device_map
from .excel import read_excel
from .links import desired_links, extract_links, merge_links
from .network import load_network


def add_input_args(parser):
    parser.add_argument("matrix", help="Traceability Matrix .xlsx")
    parser.add_argument("--overrides", required=True)
    parser.add_argument("--glossary", required=True)
    parser.add_argument("--system-device-map", required=True)
    parser.add_argument("--network-json", action="append", default=[],
                        metavar="SITE:PATH",
                        help="repeatable, e.g. --network-json northgate:../x.json")
    parser.add_argument("--source-label", default="Traceability Matrix 5 MAR 2026 (enhanced)")
    parser.add_argument("--baseline-date", default="2026-03-05")


def load_all_inputs(args):
    systems = read_excel(args.matrix)
    overrides = load_overrides(args.overrides)
    networks = {}
    for spec in args.network_json:
        site_id, _, path = spec.partition(":")
        if not path:
            raise SystemExit(f"--network-json expects SITE:PATH, got {spec!r}")
        networks[site_id] = load_network(path, site_id)
    return {
        "systems": systems,
        "overrides": overrides,
        "links": merge_links(extract_links(systems), overrides),
        "desired": desired_links(overrides),
        "crosswalk": read_crosswalk(args.matrix),
        "glossary": load_glossary(args.glossary),
        "sdmap": load_system_device_map(args.system_device_map),
        "networks": networks,
    }


def git_sha():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).resolve().parents[3], stderr=subprocess.DEVNULL,
        ).decode().strip()
    except Exception:
        return "unknown"


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0, tzinfo=None).isoformat()
```

Add `main()` to `bundle.py`:

```python
def main(argv=None):
    """CLI: validate, then emit. Never emits over a failing gate."""
    import argparse
    import sys

    from .cli import add_input_args, git_sha, load_all_inputs, now_iso
    from .validate import validate

    parser = argparse.ArgumentParser(description="Emit ATLAS JSON bundles")
    add_input_args(parser)
    parser.add_argument("-o", "--out", default="public/data")
    args = parser.parse_args(argv)

    inputs = load_all_inputs(args)
    fails = validate(
        systems=inputs["systems"], links=inputs["links"], sdmap=inputs["sdmap"],
        networks=inputs["networks"], crosswalk=inputs["crosswalk"],
        glossary=inputs["glossary"],
    )
    if fails:
        print("[bundle] refusing to emit; integrity gates failed:", file=sys.stderr)
        for f in fails:
            print(f"  - {f}", file=sys.stderr)
        return 1

    manifest = emit_bundles(
        out_dir=args.out, systems=inputs["systems"], links=inputs["links"],
        desired=inputs["desired"], crosswalk=inputs["crosswalk"],
        glossary=inputs["glossary"], sdmap=inputs["sdmap"], networks=inputs["networks"],
        source_label=args.source_label, baseline_date=args.baseline_date,
        built_at=now_iso(), git_sha=git_sha(),
    )
    print(f"[bundle] wrote {args.out}: " + ", ".join(
        f"{v} {k}" for k, v in manifest["counts"].items()))
    return 0
```

- [ ] **Step 6: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest tests/test_bundle.py -q
```

Expected: `9 passed`.

- [ ] **Step 7: Emit the real bundles**

```bash
cd /Users/aousabdo/work/Oceans/atlas && python3 -m atlas_ingest.bundle \
  $ATLAS_SOURCE_REPO/traceability/mindmap/matrix.xlsx \
  --overrides $ATLAS_SOURCE_REPO/traceability/mindmap/overrides.json \
  --glossary $ATLAS_SOURCE_REPO/traceability/mindmap/glossary.json \
  --system-device-map $ATLAS_SOURCE_REPO/traceability/mindmap/system_device_map.json \
  --network-json northgate:$ATLAS_SOURCE_REPO/northgate/northgate_network.json \
  --network-json westfield:$ATLAS_SOURCE_REPO/westfield/westfield_network.json \
  -o public/data
```

Run with `PYTHONPATH=ingest/src` if the package is not installed. Expected final line
reports `32 systems, 23 confirmed, 9 unconfirmed, 14 links, 13 desired_links,
11 requirements, 48 acronyms, 2 sites, 79 devices`.

- [ ] **Step 8: Run the whole ingest suite**

```bash
cd /Users/aousabdo/work/Oceans/atlas/ingest && python3 -m pytest -q
```

Expected: all green, zero failures, zero errors.

- [ ] **Step 9: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add ingest/ public/data/
git commit -m "ingest: emit JSON bundles and the first lossiness snapshot"
```

---

# Milestone B — Frontend scaffold

---

### Task 15: Scaffold Vite, React 19, TypeScript and Tailwind 4

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`,
  `index.html`, `.nvmrc`, `public/CNAME`
- Create: `src/main.tsx`, `src/App.tsx`, `src/styles/index.css`

- [ ] **Step 1: Write `package.json`**

Versions follow DRIFT's toolchain. `xlsx` comes from the vendor tarball per D-A; jsPDF and
html2canvas match what the current tool pins.

```json
{
  "name": "atlas",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "ATLAS — Architecture Traceability and Lossiness Analysis System",
  "author": "Aous Abdo",
  "license": "MIT",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "ingest": "python3 -m atlas_ingest.bundle"
  },
  "dependencies": {
    "@fontsource/inter": "^5.1.1",
    "@fontsource/jetbrains-mono": "^5.1.2",
    "d3": "7.8.5",
    "d3-sankey": "^0.12.3",
    "html2canvas": "1.4.1",
    "jspdf": "2.5.1",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^7.18.0",
    "recharts": "^3.10.0",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.11",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@types/d3": "^7.4.3",
    "@types/d3-sankey": "^0.12.4",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.1.11",
    "typescript": "^5.8.3",
    "vite": "^7.0.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Install and verify the SheetJS tarball resolves**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npm install
```

Expected: completes without error, and `node -e "console.log(require('xlsx').version)"`
prints `0.20.3`. If the CDN is unreachable, stop and raise it: falling back to `xlsx@0.18.5`
means shipping two known advisories and is a decision for the user, not the executor.

- [ ] **Step 3: Write `tsconfig.json`** (DRIFT's strictness set plus React)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Served from the root of its own domain (see public/CNAME). ATLAS_BASE lets a
// subpath deploy (e.g. the bare github.io project URL) work without an edit.
const base = process.env.ATLAS_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      output: {
        // d3 plus the export libraries are large and change rarely. Splitting
        // them keeps app-code deploys from re-downloading ~700 KB.
        manualChunks: {
          viz: ['d3', 'd3-sankey', 'recharts'],
          export: ['html2canvas', 'jspdf'],
          sheets: ['xlsx'],
        },
      },
    },
  },
})
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
```

- [ ] **Step 6: Write `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 7: Write `index.html`**

No font links: `@fontsource` handles that through the bundler, and DRIFT's own CSP
demonstrates what happens when the two disagree.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    />
    <meta name="theme-color" content="#0b1f3a" />
    <title>ATLAS — Architecture Traceability and Lossiness Analysis System</title>
    <meta
      name="description"
      content="ATLAS: an exploration tool for the DHS C-UAS architecture. Traceability from original requirements through today's systems to deployed hardware, with an explicit account of what is lost at each step."
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

The CSP includes `blob:` in `img-src` because html2canvas renders through a blob URL.
`connect-src 'self'` is what keeps a stray runtime fetch to a CDN from ever working.

- [ ] **Step 8: Write `public/CNAME`**

```
atlas.analyticadss.com
```

- [ ] **Step 9: Write `.nvmrc`**

```
22
```

- [ ] **Step 10: Write `src/main.tsx` and a placeholder `src/App.tsx`**

```tsx
// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

```tsx
// src/App.tsx
export default function App() {
  return <div className="p-8 text-ink">ATLAS</div>
}
```

- [ ] **Step 11: Verify the build**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npm run build
```

Expected: `tsc --noEmit` passes and Vite writes `dist/`. Then confirm nothing reaches
outside:

```bash
cd /Users/aousabdo/work/Oceans/atlas && grep -rEo 'https?://[a-zA-Z0-9./-]+' dist/assets/*.js dist/assets/*.css dist/index.html | grep -v 'www.w3.org\|schema.org' | sort -u
```

Expected: no output. Any hit is a runtime remote asset and must be eliminated before
proceeding, because air-gapped delivery is a hard requirement.

- [ ] **Step 12: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add -A
git commit -m "app: scaffold React 19, Vite, TypeScript and Tailwind 4"
```

---

### Task 16: Design tokens, light and dark

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/index.css`
- Create: `src/components/ThemeToggle.tsx`
- Create: `src/lib/theme.ts`
- Create: `src/lib/__tests__/theme.test.ts`

The palette follows DRIFT's navy/cyan lineage, which is the one already expressed as a
Tailwind `@theme` block with documented contrast ratios. Do not mix in CHECKPOINT's values:
its `#0B1F3A` is a mid surface while DRIFT's identical hex is the base background, and
blending the two yields a muddy five-value ramp.

- [ ] **Step 1: Write the theme test first**

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import { applyTheme, initialTheme, nextTheme } from '../theme'

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to dark when nothing is stored and the OS has no preference', () => {
    expect(initialTheme()).toBe('dark')
  })

  it('honours a stored preference over the OS', () => {
    localStorage.setItem('atlas-theme', 'light')
    expect(initialTheme()).toBe('light')
  })

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem('atlas-theme', 'chartreuse')
    expect(initialTheme()).toBe('dark')
  })

  it('stamps the root element so CSS can switch on it', () => {
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('persists the choice', () => {
    applyTheme('light')
    expect(localStorage.getItem('atlas-theme')).toBe('light')
  })

  it('toggles', () => {
    expect(nextTheme('dark')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
  })
})
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/lib/__tests__/theme.test.ts
```

Expected: `Failed to resolve import "../theme"`.

- [ ] **Step 3: Write `src/lib/theme.ts`**

```ts
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'atlas-theme'

export function initialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(STORAGE_KEY, theme)
}

export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark'
}
```

- [ ] **Step 4: Write `src/styles/tokens.css`**

Roles, not hues, so light mode is a redefinition rather than a second palette.

```css
/* ATLAS design tokens.

   Named by role so light mode redefines the same names. The dark values are
   DRIFT's Mariner palette, whose contrast ratios are documented against this
   navy; the risk and severity colours come from the tool being replaced so a
   reader carries their colour intuition across. */
@theme {
  --color-bg: #0b1f3a;
  --color-surface: #12294a;
  --color-surface-2: #16325a;
  --color-line: #1b3a63;

  --color-ink: #e8eef6;
  --color-muted: #8ea3c0;
  --color-muted-2: #8399b8;
  --color-muted-3: #7d93b3;

  --color-accent: #3db9d8;
  --color-accent-ink: #6fd3ea;

  /* Risk. Two reds for the same reason DRIFT has two: geometry needs 3:1,
     text needs 4.5:1. */
  --color-risk-high: #d4553f;
  --color-risk-high-ink: #f0605f;
  --color-risk-medium: #d4a24a;
  --color-risk-low: #2fb6a3;

  /* Lossiness severity bands. */
  --color-sev-ok: #2fb6a3;
  --color-sev-watch: #d4a24a;
  --color-sev-critical: #d4553f;

  /* Owner groups, carried from the tool being replaced. */
  --color-group-dhsst: #7c9cf5;
  --color-group-cbp: #4bb3a0;
  --color-group-otherdhs: #6aa9e0;
  --color-group-dhshq: #9b8ade;
  --color-group-dod: #d99a5b;
  --color-group-ext: #8d9bb0;

  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace;
}

/* Light mode. Same roles, inverted surfaces, and the ink colours re-picked
   rather than merely darkened, because a colour that clears 4.5:1 on navy does
   not automatically clear it on white. */
:root[data-theme='light'] {
  --color-bg: #f4f7fb;
  --color-surface: #ffffff;
  --color-surface-2: #eaf0f7;
  --color-line: #cbd8e6;

  --color-ink: #16233a;
  --color-muted: #4a5b73;
  --color-muted-2: #556a86;
  --color-muted-3: #607089;

  --color-accent: #0e7f9c;
  --color-accent-ink: #0b6c85;

  --color-risk-high: #b3341f;
  --color-risk-high-ink: #9c2d1a;
  --color-risk-medium: #9a6b13;
  --color-risk-low: #16705f;

  --color-sev-ok: #16705f;
  --color-sev-watch: #9a6b13;
  --color-sev-critical: #b3341f;
}
```

- [ ] **Step 5: Write `src/styles/index.css`**

```css
@import 'tailwindcss';

@import '@fontsource/inter/400.css';
@import '@fontsource/inter/500.css';
@import '@fontsource/inter/600.css';
@import '@fontsource/inter/700.css';
@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/jetbrains-mono/500.css';

@import './tokens.css';

@layer base {
  html {
    color-scheme: dark;
  }
  :root[data-theme='light'] {
    color-scheme: light;
  }

  body {
    margin: 0;
    background: var(--color-bg);
    color: var(--color-ink);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  /* Numeric figures are always mono and tabular, so columns of counts align. */
  .tabular {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  a:focus-visible,
  button:focus-visible,
  input:focus-visible,
  select:focus-visible,
  [tabindex]:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 6: Write `src/components/ThemeToggle.tsx`**

```tsx
import { useEffect, useState } from 'react'

import { applyTheme, initialTheme, nextTheme, type Theme } from '../lib/theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => initialTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme(theme))}
      className="rounded border border-line px-2 py-1 text-sm text-muted hover:text-ink"
      aria-label={`Switch to ${nextTheme(theme)} theme`}
      title={`Switch to ${nextTheme(theme)} theme`}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
```

- [ ] **Step 7: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/lib/__tests__/theme.test.ts
```

Expected: `6 passed`.

- [ ] **Step 8: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src/styles src/lib src/components
git commit -m "app: design tokens with a real light mode"
```

---

# Milestone C — The data contract

The spec's central claim is that "backend later" means "add a provider" rather than
"rewrite the app". The contract test suite is what turns that from an intention into a
proven property, so it is written before either provider exists.

---

### Task 17: Types and the provider interface

**Files:**
- Create: `src/types/atlas.ts`
- Create: `src/types/tree.ts`
- Create: `src/data/provider.ts`

- [ ] **Step 1: Write `src/types/atlas.ts`**

Shapes verified against the real data on 2026-08-05. Note `ip` is an opaque string: the
source mixes bare addresses (`192.0.2.3`) with CIDR (`198.51.100.65/29`), so nothing may
parse it as an address.

```ts
export type RiskLevel = 'high' | 'medium' | 'low'
export type RiskSource = 'explicit' | 'inferred' | 'override'
export type Severity = 'ok' | 'watch' | 'critical'
export type Confidence = 'high' | 'medium' | 'low'
export type ExtractionMethod = 'prose' | 'override' | 'manual'

export type SystemId = string
export type SiteId = string
export type DeviceId = string

export interface Project {
  slug: string
  name: string
  baseline_date: string
  source_label: string
  default_site: SiteId | null
  sites: SiteSummary[]
}

export interface SiteSummary {
  id: SiteId
  label: string
  classification: string
  device_count: number
  edge_count: number
  updated: string
}

export interface System {
  id: SystemId
  name: string
  /** Display label; may contain newlines for multi-line node rendering. */
  label: string
  category: string
  owner_group_id: string
  owner_group: string
  color_key: string
  confirmed: boolean
  risk: RiskLevel
  risk_source: RiskSource
  detail: string
  integrations_prose: string
}

export interface Link {
  from: SystemId
  to: SystemId
  label: string
  extraction_method: ExtractionMethod
}

export interface LinkSet {
  current: Link[]
  desired: Link[]
}

export interface Zone {
  label: string
  description?: string
}

export interface Device {
  id: DeviceId
  label: string
  zone: string
  type: string
  /** Opaque. The source mixes bare addresses and CIDR; never parse it. */
  ip: string | null
  subnet: string | null
  description: string | null
}

export interface DeviceEdge {
  source: DeviceId
  target: DeviceId
  link_type: string
  label: string | null
  vlan?: number
  port_source?: string
  port_target?: string
}

export interface Topology {
  site_id: SiteId
  meta: {
    label: string
    name: string
    description: string
    classification: string
    version: string
    updated: string
    source_images?: number | null
    visio_tabs?: string[]
    device_count: number
    edge_count: number
  }
  zones: Record<string, Zone>
  devices: Device[]
  edges: DeviceEdge[]
}

export interface Mapping {
  devices: DeviceId[]
  note: string
  confidence: Confidence
  /** false when the mapping deliberately names something absent from the matrix. */
  matrix_id_exists?: boolean
}

export interface CoverageSite {
  label: string
  scope: string
  mappings: Record<SystemId, Mapping>
  /** Checked and genuinely absent, which is different from not yet looked at. */
  not_deployed_at_site: Record<SystemId, string>
  unclaimed_devices: { infrastructure: DeviceId[]; _comment?: string }
}

export interface CoverageMatrix {
  default_site: SiteId | null
  sites: Record<SiteId, CoverageSite>
  pending_review: Record<string, string>
  confidence_counts: Record<Confidence | 'unspecified' | 'total', number>
}

export type RequirementStatus =
  | 'Split out'
  | 'Renamed / split out'
  | 'Partly carried forward'
  | 'Condensed'
  | "Didn't keep"

export interface Requirement {
  orig: string
  sys: string
  /** Empty when the requirement was not carried forward. */
  current: string[]
  status: RequirementStatus
}

export interface LossinessDimension {
  key: string
  label: string
  numerator: number
  denominator: number
  value_pct: number | null
  unit: 'pct' | 'count'
  severity: Severity
  /** The entities behind the number. Never render a figure without a path here. */
  detail: Record<string, unknown>
}

export interface TopGap {
  id: SystemId
  name: string
  risk: RiskLevel
  unconfirmed: boolean
  unmapped: boolean
  score: number
}

export interface LossinessReport {
  dimensions: LossinessDimension[]
  top_gaps: TopGap[]
}

export interface SnapshotMetrics {
  label: string
  built_at: string
  git_sha: string
  dimensions: Omit<LossinessDimension, 'detail'>[]
}

export interface Acronym {
  acr: string
  meaning: string
}

export interface Glossary {
  confidence_intro: string
  out_of_scope: string[]
  methodology_extras: {
    risk_caveat: string
    mapping_confidence_scale: string
    soft_ownership_note: string
  }
  acronyms: Acronym[]
}

export interface OwnerRule {
  priority: number
  match: string
  group_id: string
  group_label: string
  match_mode: 'substring' | 'word_boundary'
}

export interface Methodology {
  high_keywords: string[]
  low_keywords: string[]
  medium_keywords: string[]
  soft_keywords: string[]
  always_soft: string[]
  never_soft: string[]
  soft_groups: string[]
  owner_rules_count: number
  owner_rules: OwnerRule[]
  category_map: Record<string, { branch: string; label: string }>
  link_fragment_count: number
  id_alias_count: number
}

export interface Manifest {
  bundle_version: number
  tool_version: string
  built_at: string
  git_sha: string
  source_label: string
  baseline_date: string
  counts: Record<string, number>
  /** Snapshot labels available under snapshots/. A static host cannot be
   *  globbed, so the manifest is the index. */
  snapshots: string[]
}
```

- [ ] **Step 2: Write `src/types/tree.ts`**

```ts
/** A node in the orientation tree. Built from systems.json by src/lib/tree.ts
 *  and laid out by src/viz/radial.ts. `label` may contain newlines, which the
 *  renderer splits into tspans. */
export interface TreeNode {
  id: string
  label: string
  colorKey: string
  leaf?: boolean
  soft?: boolean
  risk?: 'high' | 'medium' | 'low'
  detail?: string
  children?: TreeNode[]
}
```

- [ ] **Step 3: Write `src/data/provider.ts`**

```ts
import type {
  CoverageMatrix, Glossary, LinkSet, LossinessReport, Manifest, Methodology,
  Project, Requirement, SiteId, SnapshotMetrics, System, Topology,
} from '../types/atlas'

/**
 * The one interface the UI knows about.
 *
 * Phase 1 ships StaticProvider (pre-built bundles over fetch) and
 * LocalFileProvider (SheetJS in the browser; files never leave the machine).
 * Phase 2 adds ApiProvider against /api/*. The contract suite in
 * src/data/__tests__/contract.ts runs against every implementation, which is
 * what makes the Phase 2 swap a claim we have tested rather than hoped for.
 */
export interface AtlasDataProvider {
  readonly kind: 'static' | 'local-file' | 'api'

  getManifest(): Promise<Manifest>
  getProject(): Promise<Project>
  getSystems(): Promise<System[]>
  getLinks(): Promise<LinkSet>
  getRequirements(): Promise<Requirement[]>
  getGlossary(): Promise<Glossary>
  getMethodology(): Promise<Methodology>
  getCoverage(): Promise<CoverageMatrix>
  getLossiness(): Promise<LossinessReport>
  getTopology(siteId: SiteId): Promise<Topology>
  /** Empty array is a valid answer and means "no history yet", not a failure. */
  getSnapshots(): Promise<SnapshotMetrics[]>
}

/**
 * Thrown when data could not be loaded. Distinct from an empty result, because
 * a chart rendering 0 after a failed fetch is a lie and spec section 9 forbids it.
 */
export class AtlasDataError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    readonly resource?: string,
  ) {
    super(message)
    this.name = 'AtlasDataError'
  }
}
```

**Deviation from the spec's interface sketch, deliberate:** spec §3 writes
`getSystems(projectId)`, `getCoverage(projectId)` and so on. Phase 1 has exactly one
project, so threading an id nobody varies would be ceremony. `projectId` arrives with the
`projects` table in Phase 2, at which point it is an additive change to every signature
and the contract suite gains a parameter. Recorded here so it reads as a decision rather
than an oversight.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npm run typecheck
```

Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src/types src/data
git commit -m "app: the AtlasDataProvider contract and its types"
```

---

### Task 18: The contract test suite

One suite, exported as a function, run against every provider. This is the file that
proves the architecture.

**Files:**
- Create: `src/data/__tests__/contract.ts`

- [ ] **Step 1: Write the suite**

```ts
import { describe, expect, it } from 'vitest'

import type { AtlasDataProvider } from '../provider'

/**
 * The provider contract, as executable assertions.
 *
 * Every implementation must pass this unchanged. Assertions are about shape,
 * invariants and referential integrity, never about a specific provider's
 * transport. The 5MAR baseline numbers appear here because both Phase 1
 * providers are fed the same source data; a provider serving a different
 * baseline would parameterise them.
 */
export function runProviderContract(
  name: string,
  makeProvider: () => Promise<AtlasDataProvider>,
) {
  describe(`AtlasDataProvider contract: ${name}`, () => {
    it('reports its kind', async () => {
      const p = await makeProvider()
      expect(['static', 'local-file', 'api']).toContain(p.kind)
    })

    it('returns a manifest with provenance', async () => {
      const m = await (await makeProvider()).getManifest()
      expect(m.bundle_version).toBeGreaterThanOrEqual(1)
      expect(m.source_label).toBeTruthy()
      expect(m.built_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('returns 32 systems for the 5MAR baseline', async () => {
      const systems = await (await makeProvider()).getSystems()
      expect(systems).toHaveLength(32)
    })

    it('splits systems 23 confirmed / 9 unconfirmed', async () => {
      const systems = await (await makeProvider()).getSystems()
      expect(systems.filter((s) => s.confirmed)).toHaveLength(23)
      expect(systems.filter((s) => !s.confirmed)).toHaveLength(9)
    })

    it('distributes risk 11 high / 19 medium / 2 low', async () => {
      const systems = await (await makeProvider()).getSystems()
      const count = (r: string) => systems.filter((s) => s.risk === r).length
      expect([count('high'), count('medium'), count('low')]).toEqual([11, 19, 2])
    })

    it('gives every system a unique id', async () => {
      const systems = await (await makeProvider()).getSystems()
      expect(new Set(systems.map((s) => s.id)).size).toBe(systems.length)
    })

    it('gives every system a display owner group', async () => {
      const systems = await (await makeProvider()).getSystems()
      expect(new Set(systems.map((s) => s.owner_group))).toEqual(
        new Set(['DHS S&T', 'CBP', 'Other DHS', 'DHS HQ/OCIO', 'DoD', 'External']),
      )
    })

    it('returns 14 current and 13 desired links', async () => {
      const links = await (await makeProvider()).getLinks()
      expect(links.current).toHaveLength(14)
      expect(links.desired).toHaveLength(13)
    })

    it('only links systems that exist', async () => {
      const p = await makeProvider()
      const ids = new Set((await p.getSystems()).map((s) => s.id))
      const links = await p.getLinks()
      for (const l of [...links.current, ...links.desired]) {
        expect(ids.has(l.from), `link source ${l.from}`).toBe(true)
        expect(ids.has(l.to), `link target ${l.to}`).toBe(true)
      }
    })

    it('returns 11 requirements including 2 that were not kept', async () => {
      const reqs = await (await makeProvider()).getRequirements()
      expect(reqs).toHaveLength(11)
      expect(reqs.filter((r) => r.status === "Didn't keep")).toHaveLength(2)
    })

    it('leaves dropped requirements with no current systems', async () => {
      const reqs = await (await makeProvider()).getRequirements()
      for (const r of reqs.filter((x) => x.status === "Didn't keep")) {
        expect(r.current).toEqual([])
      }
    })

    it('returns a glossary with 48 acronyms', async () => {
      const g = await (await makeProvider()).getGlossary()
      expect(g.acronyms).toHaveLength(48)
      expect(g.confidence_intro).toBeTruthy()
      expect(g.out_of_scope.length).toBeGreaterThan(0)
    })

    it('returns methodology reflecting the live classifier tables', async () => {
      const m = await (await makeProvider()).getMethodology()
      expect(m.owner_rules_count).toBe(23)
      expect(m.owner_rules).toHaveLength(23)
      expect(m.high_keywords).toHaveLength(19)
      expect(m.always_soft).toContain('beacon')
    })

    it('returns coverage with both sites and the pending questions', async () => {
      const c = await (await makeProvider()).getCoverage()
      expect(Object.keys(c.sites).sort()).toEqual(['northgate', 'westfield'])
      expect(Object.keys(c.pending_review)).toHaveLength(7)
    })

    it('preserves the checked-and-absent facts', async () => {
      const c = await (await makeProvider()).getCoverage()
      const absent = c.sites.northgate.not_deployed_at_site
      expect(Object.keys(absent).length).toBe(20)
    })

    it('returns all seven lossiness dimensions', async () => {
      const l = await (await makeProvider()).getLossiness()
      expect(l.dimensions.map((d) => d.key)).toEqual([
        'requirement_attrition', 'ownership_ambiguity', 'realization_gap',
        'integration_gap', 'evidence_gap', 'orphaned_hardware', 'open_questions',
      ])
    })

    it('gives every lossiness dimension its evidence', async () => {
      const l = await (await makeProvider()).getLossiness()
      for (const d of l.dimensions) {
        expect(d.detail, `${d.key} has no detail`).toBeTypeOf('object')
        expect(['ok', 'watch', 'critical']).toContain(d.severity)
      }
    })

    it('returns the Northgate topology', async () => {
      const t = await (await makeProvider()).getTopology('northgate')
      expect(t.devices).toHaveLength(71)
      expect(t.edges).toHaveLength(86)
      expect(Object.keys(t.zones)).toHaveLength(14)
      expect(t.meta.classification).toBe('UNCLASSIFIED//SAMPLE')
    })

    it('returns the Westfield Proving Ground topology', async () => {
      const t = await (await makeProvider()).getTopology('westfield')
      expect(t.devices).toHaveLength(8)
      expect(t.edges).toHaveLength(8)
    })

    it('keeps every topology edge attached to real devices', async () => {
      const t = await (await makeProvider()).getTopology('northgate')
      const ids = new Set(t.devices.map((d) => d.id))
      for (const e of t.edges) {
        expect(ids.has(e.source), `edge source ${e.source}`).toBe(true)
        expect(ids.has(e.target), `edge target ${e.target}`).toBe(true)
      }
    })

    it('puts every device in a declared zone', async () => {
      const t = await (await makeProvider()).getTopology('northgate')
      const zones = new Set(Object.keys(t.zones))
      for (const d of t.devices) expect(zones.has(d.zone), `${d.id} zone ${d.zone}`).toBe(true)
    })

    it('maps coverage only onto devices that exist', async () => {
      const p = await makeProvider()
      const c = await p.getCoverage()
      for (const siteId of Object.keys(c.sites)) {
        const t = await p.getTopology(siteId)
        const ids = new Set(t.devices.map((d) => d.id))
        for (const [sysId, m] of Object.entries(c.sites[siteId].mappings)) {
          for (const d of m.devices) {
            expect(ids.has(d), `${siteId}.${sysId} -> ${d}`).toBe(true)
          }
        }
      }
    })

    it('rejects an unknown site rather than returning empty data', async () => {
      const p = await makeProvider()
      await expect(p.getTopology('atlantis')).rejects.toThrow()
    })

    it('returns snapshots as an array, empty being a valid answer', async () => {
      const snaps = await (await makeProvider()).getSnapshots()
      expect(Array.isArray(snaps)).toBe(true)
      for (const s of snaps) expect(s.dimensions).toHaveLength(7)
    })
  })
}
```

- [ ] **Step 2: Confirm it compiles but runs no tests yet**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npm run typecheck && npx vitest run src/data
```

Expected: typecheck clean; vitest reports `No test files found` (the suite is a function
nobody calls yet).

- [ ] **Step 3: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src/data/__tests__/contract.ts
git commit -m "app: the provider contract suite, run against every implementation"
```

---

### Task 19: StaticProvider

**Files:**
- Create: `src/data/StaticProvider.ts`
- Create: `src/data/__tests__/static.test.ts`

- [ ] **Step 1: Write the test that runs the contract against it**

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, vi } from 'vitest'

import { StaticProvider } from '../StaticProvider'
import { runProviderContract } from './contract'

const DATA = join(process.cwd(), 'public', 'data')

/**
 * Serve the committed bundles through a stubbed fetch. This exercises the real
 * StaticProvider code path — URL construction, response handling, error
 * mapping — rather than reaching around it to the filesystem.
 */
beforeAll(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const rel = url.replace(/^.*\/data\//, '')
    try {
      const body = readFileSync(join(DATA, rel), 'utf-8')
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
})

runProviderContract('StaticProvider', async () => new StaticProvider('/data'))
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/data/__tests__/static.test.ts
```

Expected: `Failed to resolve import "../StaticProvider"`.

- [ ] **Step 3: Write `StaticProvider.ts`**

```ts
import type {
  CoverageMatrix, Glossary, LinkSet, LossinessReport, Manifest, Methodology,
  Project, Requirement, SiteId, SnapshotMetrics, System, Topology,
} from '../types/atlas'
import { AtlasDataError, type AtlasDataProvider } from './provider'

/**
 * Reads the pre-built bundles emitted by the Python ingest package.
 *
 * Every response is cached for the lifetime of the provider: the bundles are
 * immutable for a given deploy, so refetching them would only add latency.
 */
export class StaticProvider implements AtlasDataProvider {
  readonly kind = 'static' as const
  private cache = new Map<string, Promise<unknown>>()

  constructor(private readonly baseUrl: string = `${import.meta.env.BASE_URL}data`) {}

  private get<T>(resource: string): Promise<T> {
    const existing = this.cache.get(resource)
    if (existing) return existing as Promise<T>

    const url = `${this.baseUrl.replace(/\/$/, '')}/${resource}`
    const request = (async () => {
      let response: Response
      try {
        response = await fetch(url)
      } catch (cause) {
        // A network failure is not "no data". Callers must be able to tell the
        // difference so a chart never renders 0 because a fetch died.
        throw new AtlasDataError(`Could not reach ${resource}`, cause, resource)
      }
      if (!response.ok) {
        throw new AtlasDataError(
          `${resource} returned ${response.status}`, undefined, resource,
        )
      }
      try {
        return (await response.json()) as T
      } catch (cause) {
        throw new AtlasDataError(`${resource} is not valid JSON`, cause, resource)
      }
    })()

    this.cache.set(resource, request)
    // A failed request must not poison the cache; a retry should be able to succeed.
    request.catch(() => this.cache.delete(resource))
    return request
  }

  getManifest() { return this.get<Manifest>('manifest.json') }
  getProject() { return this.get<Project>('project.json') }
  getSystems() { return this.get<System[]>('systems.json') }
  getLinks() { return this.get<LinkSet>('links.json') }
  getRequirements() { return this.get<Requirement[]>('crosswalk.json') }
  getGlossary() { return this.get<Glossary>('glossary.json') }
  getMethodology() { return this.get<Methodology>('methodology.json') }
  getCoverage() { return this.get<CoverageMatrix>('coverage.json') }
  getLossiness() { return this.get<LossinessReport>('lossiness.json') }

  async getTopology(siteId: SiteId): Promise<Topology> {
    const project = await this.getProject()
    if (!project.sites.some((s) => s.id === siteId)) {
      throw new AtlasDataError(
        `Unknown site '${siteId}'. Known sites: ${project.sites.map((s) => s.id).join(', ')}`,
        undefined, `sites/${siteId}.json`,
      )
    }
    return this.get<Topology>(`sites/${siteId}.json`)
  }

  async getSnapshots(): Promise<SnapshotMetrics[]> {
    // The manifest names the snapshots; globbing a static host is not possible.
    const manifest = await this.getManifest()
    const labels = manifest.snapshots ?? [manifest.built_at.split('T')[0]]
    const loaded = await Promise.all(
      labels.map((label) =>
        this.get<SnapshotMetrics>(`snapshots/${label}.json`).catch(() => null),
      ),
    )
    return loaded.filter((s): s is SnapshotMetrics => s !== null)
  }
}
```

- [ ] **Step 4: Add the snapshot index to the manifest**

`getSnapshots` needs to know which snapshots exist. Add to `bundle.py`'s manifest, just
before `_write(out_dir / "manifest.json", manifest)`:

```python
    # A static host cannot be globbed, so the manifest indexes the snapshots.
    existing = sorted(p.stem for p in (out_dir / "snapshots").glob("*.json"))
    if snapshot_date not in existing:
        existing.append(snapshot_date)
    manifest["snapshots"] = sorted(existing)
```

Move the snapshot write above the manifest write so the glob sees it, and add to
`ingest/tests/test_bundle.py`:

```python
def test_manifest_indexes_the_snapshots(out):
    m = _read(out, "manifest.json")
    assert m["snapshots"] == ["2026-08-05"]
```

Re-run `python3 -m pytest tests/test_bundle.py -q` and regenerate the bundles with the
Task 14 Step 7 command.

- [ ] **Step 5: Run the contract against StaticProvider**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/data/__tests__/static.test.ts
```

Expected: `24 passed`. Every contract assertion green.

- [ ] **Step 6: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src/data ingest/src/atlas_ingest/bundle.py ingest/tests/test_bundle.py public/data
git commit -m "app: StaticProvider passing the full provider contract"
```

---

### Task 20: LocalFileProvider

Parses the analyst's own workbook in the browser. The file never leaves the machine, which
is why this is strictly safer than the hosted path for government data.

**Files:**
- Create: `src/data/localFileParse.ts` (pure, testable)
- Create: `src/data/LocalFileProvider.ts`
- Create: `src/data/__tests__/localfile.test.ts`

The classifiers exist in Python. Rather than maintaining a second copy in TypeScript,
`localFileParse.ts` imports the tables from a generated module so there is exactly one
source of truth.

- [ ] **Step 1: Teach the ingest package to emit the classifier tables as TypeScript**

Add to `ingest/src/atlas_ingest/bundle.py`:

```python
def emit_classifier_module(out_path):
    """Emit the classification tables as TypeScript.

    LocalFileProvider classifies in the browser, and a hand-maintained second
    copy of these tables would drift from the Python one within a release. This
    is generated, committed, and checked by a test that regenerates it and
    compares.
    """
    from . import config

    def ts(value):
        return json.dumps(value, indent=2, sort_keys=False, ensure_ascii=False)

    body = f"""// GENERATED by atlas_ingest.bundle.emit_classifier_module. Do not edit.
// Regenerate: npm run ingest:tables
// Source of truth: ingest/src/atlas_ingest/config.py

export const CATEGORY_MAP: Record<string, {{ branch: string; label: string; ck: string }}> =
  {ts({k: {"branch": v["branch"], "label": v["label"].replace(chr(92) + "n", chr(10)), "ck": v["ck"]} for k, v in config.CATEGORY_MAP.items()})}

export const OWNER_RULES: ReadonlyArray<readonly [string, string, string, string]> =
  {ts([[s, g, l.replace(chr(92) + "n", chr(10)), c] for s, g, l, c in config.OWNER_RULES])}

export const ID_MAP: Record<string, string> = {ts(config.ID_MAP)}

export const LABEL_MAP: Record<string, string> =
  {ts({k: v.replace(chr(92) + "n", chr(10)) for k, v in config.LABEL_MAP.items()})}

export const SOFT_KEYWORDS: string[] = {ts(list(config.SOFT_KEYWORDS))}
export const ALWAYS_SOFT: string[] = {ts(sorted(config.ALWAYS_SOFT))}
export const NEVER_SOFT: string[] = {ts(sorted(config.NEVER_SOFT))}
export const HIGH_KEYWORDS: string[] = {ts(list(config.HIGH_KEYWORDS))}
export const LOW_KEYWORDS: string[] = {ts(list(config.LOW_KEYWORDS))}
export const MEDIUM_KEYWORDS: string[] = {ts(list(config.MEDIUM_KEYWORDS))}
export const LINK_NAME_FRAGMENTS: Record<string, string> = {ts(config.LINK_NAME_FRAGMENTS)}
export const OWNER_GROUP_DISPLAY: Record<string, string> = {ts(config.OWNER_GROUP_DISPLAY)}
"""
    Path(out_path).write_text(body, encoding="utf-8")
```

Add the npm script to `package.json`:

```json
"ingest:tables": "python3 -c \"import sys; sys.path.insert(0,'ingest/src'); from atlas_ingest.bundle import emit_classifier_module; emit_classifier_module('src/data/generated/classifierTables.ts')\""
```

Generate it:

```bash
cd /Users/aousabdo/work/Oceans/atlas && mkdir -p src/data/generated && npm run ingest:tables
```

- [ ] **Step 2: Write the drift guard**

`ingest/tests/test_generated_tables.py`:

```python
"""The committed TypeScript tables must match config.py. If this fails,
someone edited the generated file or changed config.py without regenerating.
"""
from pathlib import Path

from atlas_ingest.bundle import emit_classifier_module

COMMITTED = Path(__file__).resolve().parents[2] / "src" / "data" / "generated" / "classifierTables.ts"


def test_generated_tables_are_current(tmp_path):
    fresh = tmp_path / "classifierTables.ts"
    emit_classifier_module(fresh)
    assert fresh.read_text(encoding="utf-8") == COMMITTED.read_text(encoding="utf-8"), (
        "src/data/generated/classifierTables.ts is stale. Run: npm run ingest:tables"
    )
```

- [ ] **Step 3: Write the LocalFileProvider test**

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LocalFileProvider } from '../LocalFileProvider'
import { runProviderContract } from './contract'

const SOURCE = '$ATLAS_SOURCE_REPO/traceability/mindmap'

function file(path: string, name: string): File {
  return new File([readFileSync(path)], name)
}

async function makeLocalProvider() {
  const p = new LocalFileProvider()
  await p.load({
    matrix: file(join(SOURCE, 'matrix.xlsx'),
                 'matrix.xlsx'),
    overrides: file(join(SOURCE, 'overrides.json'), 'overrides.json'),
    glossary: file(join(SOURCE, 'glossary.json'), 'glossary.json'),
    systemDeviceMap: file(join(SOURCE, 'system_device_map.json'), 'system_device_map.json'),
    topologies: {
      northgate: file('$ATLAS_SOURCE_REPO/northgate/northgate_network.json',
                       'northgate_network.json'),
      westfield: file('$ATLAS_SOURCE_REPO/westfield/westfield_network.json',
                         'westfield_network.json'),
    },
  })
  return p
}

runProviderContract('LocalFileProvider', makeLocalProvider)

describe('LocalFileProvider upload hardening', () => {
  it('rejects a file whose magic bytes are not a zip', async () => {
    const p = new LocalFileProvider()
    await expect(
      p.load({ matrix: new File(['not a spreadsheet'], 'evil.xlsx') } as never),
    ).rejects.toThrow(/not a valid xlsx/i)
  })

  it('rejects .xlsm outright', async () => {
    const p = new LocalFileProvider()
    await expect(
      p.load({ matrix: new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'macro.xlsm') } as never),
    ).rejects.toThrow(/xlsm/i)
  })

  it('rejects a file over the size cap', async () => {
    const p = new LocalFileProvider()
    const huge = new File([new Uint8Array(60 * 1024 * 1024)], 'huge.xlsx')
    await expect(p.load({ matrix: huge } as never)).rejects.toThrow(/too large/i)
  })

  it('never accepts HTML', async () => {
    const p = new LocalFileProvider()
    await expect(
      p.load({ matrix: new File(['<html>'], 'graph.html') } as never),
    ).rejects.toThrow()
  })

  it('reports which file failed, not just that something did', async () => {
    const p = new LocalFileProvider()
    await expect(
      p.load({ matrix: new File(['x'], 'broken.xlsx') } as never),
    ).rejects.toThrow(/broken\.xlsx/)
  })
})
```

- [ ] **Step 4: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/data/__tests__/localfile.test.ts
```

Expected: `Failed to resolve import "../LocalFileProvider"`.

- [ ] **Step 5: Write `src/data/localFileParse.ts`**

Port `read_excel`, `classify_owner`, `classify_risk`, `make_id`, `make_label`,
`extract_links` and `merge_links` to TypeScript, importing every table from
`./generated/classifierTables`. The logic is a direct transliteration of the Python in
Tasks 5 through 8, so use those implementations as the reference and keep function names
identical (`makeId`, `makeLabel`, `classifyOwner`, `classifyRisk`, `readMatrixRows`,
`extractLinks`, `mergeLinks`). Two TypeScript-specific points:

```ts
import * as XLSX from 'xlsx'

import {
  ALWAYS_SOFT, CATEGORY_MAP, HIGH_KEYWORDS, ID_MAP, LABEL_MAP, LINK_NAME_FRAGMENTS,
  LOW_KEYWORDS, MEDIUM_KEYWORDS, NEVER_SOFT, OWNER_GROUP_DISPLAY, OWNER_RULES,
  SOFT_KEYWORDS,
} from './generated/classifierTables'

const MAX_BYTES = 50 * 1024 * 1024
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

/**
 * Upload hardening, applied before SheetJS sees a byte. xlsx is a zip archive,
 * so the extension proves nothing: sniff the magic bytes, cap the size, and
 * refuse macro-enabled workbooks. HTML is never accepted at all — the generated
 * network graphs are stored XSS by construction.
 */
export async function assertSafeWorkbook(file: File): Promise<ArrayBuffer> {
  if (/\.xlsm$/i.test(file.name)) {
    throw new Error(`${file.name}: .xlsm is refused because macros are executable content`)
  }
  if (/\.(html?|htm)$/i.test(file.name)) {
    throw new Error(`${file.name}: HTML is never accepted`)
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`${file.name}: too large (${file.size} bytes, cap ${MAX_BYTES})`)
  }
  const buffer = await file.arrayBuffer()
  const head = new Uint8Array(buffer.slice(0, 4))
  if (!ZIP_MAGIC.every((b, i) => head[i] === b)) {
    throw new Error(`${file.name}: not a valid xlsx (no zip signature)`)
  }
  return buffer
}

/**
 * The workbook's Matrix sheet does not start at row 1: the header is row 6,
 * under a title and a hand-written summary block. Scan for it exactly as the
 * Python does rather than assuming an offset.
 */
export function findHeaderRow(rows: unknown[][]): number {
  for (let r = 0; r < Math.min(rows.length, 10); r += 1) {
    if (rows[r]?.some((c) => typeof c === 'string' && c.includes('Project/System'))) return r
  }
  throw new Error("no header row containing 'Project/System' in the first 10 rows")
}
```

Read the sheet with `XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })` so the
row-array shape matches what `findHeaderRow` expects, and trim header keys before lookup
because `Project/System ` and `Infrastructure/Technology ` carry trailing spaces in the
source workbook.

- [ ] **Step 6: Write `src/data/LocalFileProvider.ts`**

It implements the same interface, holds parsed state in memory, and computes lossiness
with a TypeScript port of `lossiness.py`'s pure functions (`src/lib/lossiness.ts`, ported
from Task 12). `getSnapshots()` returns `[]`, which the contract explicitly allows and the
Trend view renders as "no history for a locally loaded file".

```ts
import { computeLossiness, topGaps } from '../lib/lossiness'
import { buildTreeInputs } from '../lib/tree'
import type { /* … the same types StaticProvider imports … */ } from '../types/atlas'
import {
  assertSafeWorkbook, classifyOwnerGroupDisplay, extractLinks, mergeLinks,
  readMatrixRows, readCrosswalkRows,
} from './localFileParse'
import { AtlasDataError, type AtlasDataProvider } from './provider'

export interface LocalFileInputs {
  matrix: File
  overrides?: File
  glossary?: File
  systemDeviceMap?: File
  topologies?: Record<string, File>
}

interface ParsedState {
  manifest: Manifest
  project: Project
  systems: System[]
  links: LinkSet
  requirements: Requirement[]
  glossary: Glossary
  methodology: Methodology
  coverage: CoverageMatrix
  lossiness: LossinessReport
  topologies: Record<SiteId, Topology>
}

async function readJson<T>(file: File | undefined, fallback: T): Promise<T> {
  if (!file) return fallback
  try {
    return JSON.parse(await file.text()) as T
  } catch (cause) {
    throw new AtlasDataError(`${file.name} is not valid JSON`, cause, file.name)
  }
}

export class LocalFileProvider implements AtlasDataProvider {
  readonly kind = 'local-file' as const
  private state: ParsedState | null = null

  /**
   * Parse everything up front so a partial failure never leaves the UI reading
   * from a half-built state. The file is read in this tab and never uploaded.
   */
  async load(inputs: LocalFileInputs): Promise<void> {
    const buffer = await assertSafeWorkbook(inputs.matrix)

    const systems = readMatrixRows(buffer, inputs.matrix.name)
    const overrides = await readJson(inputs.overrides, EMPTY_OVERRIDES)
    const glossary = await readJson(inputs.glossary, EMPTY_GLOSSARY)
    const sdmap = normaliseSystemDeviceMap(await readJson(inputs.systemDeviceMap, EMPTY_SDMAP))

    const topologies: Record<SiteId, Topology> = {}
    for (const [siteId, file] of Object.entries(inputs.topologies ?? {})) {
      topologies[siteId] = loadTopology(await readJson(file, null), siteId)
    }

    const links = {
      current: mergeLinks(extractLinks(systems), overrides),
      desired: (overrides.desired_links ?? []).map((d) => ({ ...d, extraction_method: 'override' as const })),
    }
    const requirements = readCrosswalkRows(buffer, inputs.matrix.name)
    const report = computeLossiness({ systems, links, requirements, sdmap, topologies })

    // Assign in one shot: a throw above leaves the previous state intact.
    this.state = {
      manifest: buildLocalManifest(inputs.matrix, systems, links, requirements, glossary, topologies),
      project: buildLocalProject(sdmap, topologies),
      systems, links, requirements, glossary,
      methodology: LOCAL_METHODOLOGY,
      coverage: buildCoverage(sdmap),
      lossiness: { ...report, top_gaps: topGaps(report, systems) },
      topologies,
    }
  }

  private require(): ParsedState {
    if (!this.state) {
      throw new AtlasDataError('No file loaded. Choose a Traceability Matrix first.')
    }
    return this.state
  }

  async getManifest() { return this.require().manifest }
  async getProject() { return this.require().project }
  async getSystems() { return this.require().systems }
  async getLinks() { return this.require().links }
  async getRequirements() { return this.require().requirements }
  async getGlossary() { return this.require().glossary }
  async getMethodology() { return this.require().methodology }
  async getCoverage() { return this.require().coverage }
  async getLossiness() { return this.require().lossiness }

  async getTopology(siteId: SiteId): Promise<Topology> {
    const { topologies } = this.require()
    const topology = topologies[siteId]
    if (!topology) {
      throw new AtlasDataError(
        `Unknown site '${siteId}'. Loaded sites: ${Object.keys(topologies).join(', ') || 'none'}`,
        undefined, siteId,
      )
    }
    return topology
  }

  /** Empty is the honest answer: a locally loaded file has no build history. */
  async getSnapshots() { return [] }
}
```

`LOCAL_METHODOLOGY` is `classifierTables` reshaped into the `Methodology` payload by the
same rules `methodology.py` uses, so the Reference tab renders identically under either
provider — which is exactly what the contract's methodology assertions check.

- [ ] **Step 7: Run the contract against LocalFileProvider**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/data
```

Expected: both provider suites green, `24 passed` each plus the 5 hardening tests. If a
contract assertion passes for `StaticProvider` and fails for `LocalFileProvider`, the
TypeScript classifier has diverged from the Python one; fix the transliteration rather
than relaxing the assertion.

- [ ] **Step 8: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src/data ingest/ package.json
git commit -m "app: LocalFileProvider with in-browser parsing and upload hardening"
```

---

### Task 21: Provider context, routes and the app shell

**Files:**
- Create: `src/data/ProviderContext.tsx`, `src/data/useAtlas.ts`
- Create: `src/components/{TabBar,ErrorBoundary,EmptyState,LoadFailed,ProvenanceChip}.tsx`
- Create: `src/routes.tsx`
- Modify: `src/App.tsx`

Tab order follows the spec: Reference & Methodology, Analytics, Lossiness, Network
Topology, Orientation Map. Routes are real paths, not hash state, so
`/map?focus=beacon` works.

- [ ] **Step 1: Write the routing test**

`src/__tests__/routes.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from '../App'

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('routes', () => {
  it('redirects the root to the reference tab', async () => {
    at('/')
    expect(await screen.findByRole('heading', { name: /Reference & Methodology/i })).toBeInTheDocument()
  })

  it.each([
    ['/reference', /Reference & Methodology/i],
    ['/analytics', /Analytics/i],
    ['/lossiness', /Lossiness/i],
    ['/network', /Network Topology/i],
    ['/map', /Orientation Map/i],
  ])('renders %s', async (path, heading) => {
    at(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('shows a not-found page for an unknown route rather than a blank screen', async () => {
    at('/nonsense')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })

  it('presents the five tabs in spec order', () => {
    at('/reference')
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual([
      'Reference & Methodology', 'Analytics', 'Lossiness', 'Network Topology', 'Orientation Map',
    ])
  })
})
```

- [ ] **Step 2: Write the error boundary test**

`src/components/__tests__/ErrorBoundary.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from '../ErrorBoundary'

function Boom(): never {
  throw new Error('chart exploded')
}

describe('ErrorBoundary', () => {
  it('contains a failure to its own tab', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <ErrorBoundary label="Analytics">
          <Boom />
        </ErrorBoundary>
        <p>the rest of the app</p>
      </div>,
    )
    expect(screen.getByText(/Analytics could not render/i)).toBeInTheDocument()
    expect(screen.getByText('the rest of the app')).toBeInTheDocument()
  })

  it('names the error so a bug report can start somewhere', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary label="Analytics">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/chart exploded/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run both, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/__tests__ src/components
```

Expected: unresolved imports for `ErrorBoundary` and missing route components.

- [ ] **Step 4: Write `ErrorBoundary.tsx`**

One per tab, so a broken visualization does not take down the app (spec §9).

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  label: string
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="m-6 rounded border border-risk-high p-4">
        <h2 className="font-semibold text-risk-high-ink">
          {this.props.label} could not render
        </h2>
        <p className="mt-2 text-sm text-muted">
          The rest of ATLAS is unaffected. This is a bug, not a statement about the data.
        </p>
        <pre className="mt-3 overflow-x-auto text-xs text-muted-2">{error.message}</pre>
      </div>
    )
  }
}
```

- [ ] **Step 5: Write `EmptyState.tsx` and `LoadFailed.tsx`**

The distinction spec §9 insists on. These are two components precisely so no one can
accidentally render one for the other's situation.

```tsx
// EmptyState.tsx — the data loaded and there is genuinely nothing to show.
export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded border border-line bg-surface p-6 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  )
}
```

```tsx
// LoadFailed.tsx — the data did NOT load. Never render a zero here.
export function LoadFailed({ resource, message, onRetry }: {
  resource: string
  message: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="rounded border border-risk-high bg-surface p-6">
      <p className="font-medium text-risk-high-ink">Could not load {resource}</p>
      <p className="mt-1 text-sm text-muted">
        This is a loading failure, not an empty result. No figure below it is trustworthy.
      </p>
      <pre className="mt-3 overflow-x-auto text-xs text-muted-2">{message}</pre>
      {onRetry && (
        <button type="button" onClick={onRetry}
                className="mt-3 rounded border border-line px-3 py-1 text-sm">
          Retry
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Write `ProviderContext.tsx` and `useAtlas.ts`**

`useAtlas` returns a discriminated union so a component cannot read `data` without having
handled the other two states:

```ts
export type AtlasState<T> =
  | { status: 'loading' }
  | { status: 'failed'; error: AtlasDataError }
  | { status: 'ready'; data: T }
```

- [ ] **Step 7: Write `routes.tsx`, `TabBar.tsx`, and wire `App.tsx`**

`TabBar` renders `role="tablist"` with five `NavLink`s in spec order, plus the theme
toggle and the export menu. Each route element is wrapped in its own `ErrorBoundary`.

- [ ] **Step 8: Run the tests, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run
```

Expected: all suites green.

- [ ] **Step 9: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src
git commit -m "app: provider context, real routes, per-tab error boundaries"
```

---

# Milestone D — The five tabs

Ported in spec order. Reference goes first because it proves the whole data pipeline with
almost no visualization risk; the radial map goes last because it is the hardest.

**Applies to every tab in this milestone:**
- Wrapped in its own `ErrorBoundary`.
- Renders `LoadFailed` when the provider throws, `EmptyState` when data is legitimately
  empty, and never a `0` that could mean either.
- Any figure derived rather than read carries a `<ProvenanceChip>`.
- No `d3.select().append()`. Geometry comes from `src/viz/`, DOM comes from React.

---

### Task 22: Reference & Methodology

Feature parity target: the five sections of the current tab, with the two provenance
fields the old tool injected but never displayed (`git_sha`, `build_command`) now shown,
and the site `classification` (`UNCLASSIFIED//SAMPLE`) surfaced rather than silently carried.

**Files:**
- Create: `src/tabs/reference/ReferenceTab.tsx`
- Create: `src/tabs/reference/{ConfidenceSection,MethodologySection,SystemsTable,AcronymsTable,BuildSection}.tsx`
- Create: `src/tabs/reference/__tests__/ReferenceTab.test.tsx`

Sections, headings verbatim from the current tool:

| Anchor | Heading | Generated from |
|---|---|---|
| `confidence` | `Confidence & caveats` | `glossary.confidence_intro`, lossiness dimensions, coverage confidence counts |
| `methodology` | `Methodology` | `methodology.json` — the live classifier tables |
| `systems` | `Systems` | `systems.json` + `coverage.json` |
| `acronyms` | `Acronyms` | `glossary.acronyms` (48) |
| `build` | `Architecture & build` | `manifest.json` |

- [ ] **Step 1: Write the test**

```tsx
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ReferenceTab } from '../ReferenceTab'
import { renderWithProvider } from '../../../test/renderWithProvider'

describe('Reference & Methodology', () => {
  it('lists all 48 acronyms', async () => {
    await renderWithProvider(<ReferenceTab />)
    const table = await screen.findByRole('table', { name: /acronyms/i })
    expect(within(table).getAllByRole('row')).toHaveLength(49) // 48 + header
  })

  it('lists all 32 systems with owner group, risk and status', async () => {
    await renderWithProvider(<ReferenceTab />)
    const table = await screen.findByRole('table', { name: /systems/i })
    expect(within(table).getAllByRole('row')).toHaveLength(33)
    expect(within(table).getByRole('columnheader', { name: 'Owner group' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Mapped at' })).toBeInTheDocument()
  })

  it('renders the risk keyword tables from the live classifier config', async () => {
    await renderWithProvider(<ReferenceTab />)
    // 19 high keywords, straight from methodology.json. If the Python table
    // changes, this display changes with it — that is the whole point.
    expect(await screen.findByText('sneakernet')).toBeInTheDocument()
    expect(screen.getByText('legacy naming')).toBeInTheDocument()
  })

  it('shows the owner rules with their priority and match mode', async () => {
    await renderWithProvider(<ReferenceTab />)
    const table = await screen.findByRole('table', { name: /owner classification rules/i })
    expect(within(table).getAllByRole('row')).toHaveLength(24) // 23 + header
    expect(within(table).getAllByText('word_boundary').length).toBeGreaterThan(0)
  })

  it('displays the build provenance the old tool hid', async () => {
    await renderWithProvider(<ReferenceTab />)
    expect(await screen.findByText(/git_sha|Commit/i)).toBeInTheDocument()
    expect(screen.getByText(/Built at/i)).toBeInTheDocument()
  })

  it('surfaces the site classification marking', async () => {
    await renderWithProvider(<ReferenceTab />)
    expect(await screen.findAllByText('UNCLASSIFIED//SAMPLE')).not.toHaveLength(0)
  })

  it('states the out-of-scope declarations', async () => {
    await renderWithProvider(<ReferenceTab />)
    const scope = await screen.findByRole('region', { name: /out of scope/i })
    expect(within(scope).getAllByRole('listitem')).toHaveLength(5)
  })

  it('filters both tables together', async () => {
    const { user } = await renderWithProvider(<ReferenceTab />)
    await user.type(screen.getByRole('searchbox', { name: /filter/i }), 'trackwell')
    const systems = screen.getByRole('table', { name: /systems/i })
    expect(within(systems).getAllByRole('row').length).toBeLessThan(33)
  })
})
```

- [ ] **Step 2: Write `src/test/renderWithProvider.tsx`**

```tsx
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { ProviderContext } from '../data/ProviderContext'
import { StaticProvider } from '../data/StaticProvider'

/** Renders against the real committed bundles, so tests assert on real data. */
export interface RenderOptions {
  /** Initial route, for tabs that read query parameters (e.g. ?focus=). */
  route?: string
}

export async function renderWithProvider(ui: ReactElement, options: RenderOptions = {}) {
  const user = userEvent.setup()
  const provider = new StaticProvider('/data')
  const result = render(
    <MemoryRouter initialEntries={[options.route ?? '/']}>
      <ProviderContext.Provider value={provider}>{ui}</ProviderContext.Provider>
    </MemoryRouter>,
  )
  return { ...result, user, provider }
}
```

The `fetch` stub from Task 19's test moves to `src/test/setup.ts` so every suite gets it.

- [ ] **Step 3: Run the test, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/tabs/reference
```

Expected: `Failed to resolve import "../ReferenceTab"`.

- [ ] **Step 4: Build the components**

`ReferenceTab` renders an `<h1>Reference & Methodology</h1>`, the subtitle
`Source-of-truth reference for the architecture, classification methods, and what we are
(and are not) certain about.`, a filter `searchbox` labelled `Filter systems and acronyms`,
anchor navigation to the five sections, and each section component below.

`ConfidenceSection` renders four cards keyed to the current tool's four, but with the
numbers now coming from `lossiness.json` rather than a separate confidence payload:

- `High confidence — directly lifted from authoritative source`
- `Moderate confidence — inference rule applied` (evidence-gap dimension, per-site
  realization figures)
- `Low confidence / pending — known unknowns` (low-confidence mappings, open questions)
- `Out of scope — what this tool deliberately doesn't claim` (`glossary.out_of_scope`,
  wrapped in `<section aria-label="Out of scope">` so the test can find it)

`MethodologySection` renders the five blocks the current tool has (`Risk classification`,
`"Mapped" definition`, `Coverage % calculation`, `Risk overlay aggregation`, `Soft
ownership detection`) plus one the old tool lacked: a table titled `Owner classification
rules` listing all 23 rules with `priority`, `match`, `match_mode` and `group_label`. That
table is why `OWNER_RULES`' order-dependence stops being invisible.

`BuildSection` renders `tool_version`, `built_at`, `git_sha`, `source_label`,
`baseline_date`, the per-site classification markings, and the counts block from the
manifest.

- [ ] **Step 5: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/tabs/reference
```

Expected: `8 passed`.

- [ ] **Step 6: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src/tabs/reference src/test
git commit -m "app: Reference & Methodology tab generated from live config"
```

---

### Task 23: Analytics Dashboard

Four cards, matching the current tool. The Requirements Coverage visual is rebuilt on
`d3-sankey` rather than the current hand-rolled three-column bezier diagram, which
measures live `getBoundingClientRect()` and therefore has to be redrawn on every tab
switch and theme change.

**Files:**
- Create: `src/viz/sankey.ts` + `src/viz/__tests__/sankey.test.ts`
- Create: `src/tabs/analytics/AnalyticsTab.tsx`
- Create: `src/tabs/analytics/{RiskHeatmap,OwnershipBars,RequirementsSankey,CoveragePanel}.tsx`
- Create: `src/tabs/analytics/__tests__/AnalyticsTab.test.tsx`

- [ ] **Step 1: Write the geometry test first**

```ts
import { describe, expect, it } from 'vitest'

import { buildRequirementsSankey } from '../sankey'

const REQS = [
  { orig: 'A', sys: 'x', current: ['CROSSLINK', 'Fathom'], status: 'Split out' as const },
  { orig: 'B', sys: 'y', current: [], status: "Didn't keep" as const },
]

describe('buildRequirementsSankey', () => {
  it('creates one source node per requirement', () => {
    const g = buildRequirementsSankey(REQS, { width: 800, height: 400 })
    expect(g.nodes.filter((n) => n.side === 'requirement')).toHaveLength(2)
  })

  it('creates one target node per distinct current system', () => {
    const g = buildRequirementsSankey(REQS, { width: 800, height: 400 })
    expect(g.nodes.filter((n) => n.side === 'system').map((n) => n.name).sort())
      .toEqual(['Fathom', 'CROSSLINK'])
  })

  it('routes dropped requirements to an explicit loss node', () => {
    const g = buildRequirementsSankey(REQS, { width: 800, height: 400 })
    const loss = g.nodes.find((n) => n.side === 'loss')
    expect(loss).toBeDefined()
    expect(g.links.some((l) => l.target === loss!.index)).toBe(true)
  })

  it('gives every node finite geometry', () => {
    const g = buildRequirementsSankey(REQS, { width: 800, height: 400 })
    for (const n of g.nodes) {
      for (const v of [n.x0, n.x1, n.y0, n.y1]) {
        expect(Number.isFinite(v), `${n.name} has non-finite geometry`).toBe(true)
      }
    }
  })

  it('returns an empty graph rather than throwing on a zero-size container', () => {
    const g = buildRequirementsSankey(REQS, { width: 0, height: 0 })
    expect(g.nodes).toEqual([])
    expect(g.links).toEqual([])
  })

  it('handles a requirement set where nothing was carried forward', () => {
    const g = buildRequirementsSankey(
      [{ orig: 'A', sys: 'x', current: [], status: "Didn't keep" as const }],
      { width: 800, height: 400 },
    )
    expect(g.nodes.some((n) => n.side === 'loss')).toBe(true)
  })
})
```

The zero-size case is here because it is the same class of bug as the network zoom trap in
Task 25: React mounts before layout, so every geometry function must tolerate a container
with no dimensions.

- [ ] **Step 2: Run it, expect failure, then write `src/viz/sankey.ts`**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/viz/__tests__/sankey.test.ts
```

Expected: `Failed to resolve import "../sankey"`. Then implement with `d3-sankey`,
returning plain node and link objects with `x0/x1/y0/y1`. It must return
`{ nodes: [], links: [] }` when `width <= 0 || height <= 0`, and the React component
renders nothing until a `ResizeObserver` reports real dimensions.

- [ ] **Step 3: Write the Analytics test**

```tsx
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AnalyticsTab } from '../AnalyticsTab'
import { renderWithProvider } from '../../../test/renderWithProvider'

describe('Analytics', () => {
  it('renders the risk heatmap with 6 groups and 3 severities', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    expect(within(table).getAllByRole('row')).toHaveLength(8) // header + 6 groups + total
    for (const h of ['High', 'Medium', 'Low', 'Total']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument()
    }
  })

  it('puts the verified counts in the right cells', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    const otherDhs = within(table).getByRole('row', { name: /^Other DHS/ })
    // Verified 2026-08-05: Other DHS is 4 high, 9 medium, 1 low, 14 total.
    expect(within(otherDhs).getAllByRole('cell').map((c) => c.textContent))
      .toEqual(['Other DHS', '4', '9', '1', '14'])
  })

  it('totals to 32 systems', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const table = await screen.findByRole('table', { name: /risk heatmap/i })
    const total = within(table).getByRole('row', { name: /^Total/ })
    expect(within(total).getAllByRole('cell').at(-1)).toHaveTextContent('32')
  })

  it('renders ownership bars for every group', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const region = await screen.findByRole('region', { name: /ownership confirmation/i })
    // Verified: DHS HQ/OCIO is 1 confirmed, 3 unconfirmed.
    expect(within(region).getByText(/DHS HQ\/OCIO/)).toBeInTheDocument()
    expect(within(region).getByText('1 confirmed')).toBeInTheDocument()
    expect(within(region).getByText('3 pending')).toBeInTheDocument()
  })

  it('shows the requirements sankey legend with all five statuses', async () => {
    await renderWithProvider(<AnalyticsTab />)
    for (const s of ['Split out', 'Renamed / split out', 'Partly carried forward',
                     'Condensed', "Didn't keep"]) {
      expect(await screen.findByText(s)).toBeInTheDocument()
    }
  })

  it('shows per-site coverage with the real mapped fraction', async () => {
    await renderWithProvider(<AnalyticsTab />)
    const region = await screen.findByRole('region', { name: /coverage/i })
    expect(within(region).getByText(/Northgate Sports Campus/)).toBeInTheDocument()
    expect(within(region).getByText(/Westfield Proving Ground/)).toBeInTheDocument()
  })

  it('says Westfield Proving Ground has no mappings instead of rendering 0%', async () => {
    await renderWithProvider(<AnalyticsTab />)
    expect(await screen.findByText(/No mappings yet/i)).toBeInTheDocument()
  })

  it('lists the 7 pending review questions', async () => {
    await renderWithProvider(<AnalyticsTab />)
    expect(await screen.findByText(/Pending review questions \(7\)/)).toBeInTheDocument()
  })

  it('filters every card at once', async () => {
    const { user } = await renderWithProvider(<AnalyticsTab />)
    await user.type(screen.getByRole('searchbox', { name: /filter/i }), 'high')
    const table = screen.getByRole('table', { name: /risk heatmap/i })
    expect(table).toHaveAttribute('data-filtered', 'true')
  })
})
```

- [ ] **Step 4: Run it, expect failure, then build the four cards**

Card headings verbatim: `Risk Heatmap — Owner Group × Severity`,
`Ownership Confirmation by Group`,
`Requirements Coverage — Original Baseline → Current Systems`,
`Multi-Site Coverage — Where Are We Really?`

`RiskHeatmap` is a plain `<table>` with Tailwind, not a chart library. `OwnershipBars` and
the coverage donuts use Recharts. `RequirementsSankey` consumes `buildRequirementsSankey`
and renders the SVG itself.

- [ ] **Step 5: Run the tests, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/tabs/analytics src/viz
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src/tabs/analytics src/viz
git commit -m "app: Analytics dashboard with a real d3-sankey"
```

---

### Task 24: Lossiness tab

New in this rebuild. Spec §5. Four views: Scorecard, Attrition Flow, Trend, Top Gaps.

**Files:**
- Create: `src/lib/lossiness.ts` (TypeScript port of the Python, for LocalFileProvider)
- Create: `src/viz/attrition.ts` + tests
- Create: `src/tabs/lossiness/LossinessTab.tsx`
- Create: `src/tabs/lossiness/{Scorecard,AttritionFlow,TrendView,TopGaps,DimensionDrawer}.tsx`
- Create: `src/tabs/lossiness/__tests__/LossinessTab.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LossinessTab } from '../LossinessTab'
import { renderWithProvider } from '../../../test/renderWithProvider'

describe('Lossiness', () => {
  it('shows all seven dimension cards', async () => {
    await renderWithProvider(<LossinessTab />)
    const cards = await screen.findAllByRole('article', { name: /dimension/i })
    expect(cards).toHaveLength(7)
  })

  it('labels every card with its dimension name', async () => {
    await renderWithProvider(<LossinessTab />)
    for (const label of ['Requirement attrition', 'Ownership ambiguity', 'Realization gap',
                         'Integration gap', 'Evidence gap', 'Orphaned hardware',
                         'Open questions']) {
      expect(await screen.findByText(label)).toBeInTheDocument()
    }
  })

  it('shows requirement attrition as 9 of 11', async () => {
    await renderWithProvider(<LossinessTab />)
    const card = await screen.findByRole('article', { name: /Requirement attrition/i })
    expect(within(card).getByText('81.8%')).toBeInTheDocument()
    expect(within(card).getByText(/9 of 11/)).toBeInTheDocument()
  })

  it('drills from a figure to the entities behind it', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    const card = await screen.findByRole('article', { name: /Ownership ambiguity/i })
    await user.click(within(card).getByRole('button', { name: /show the 9/i }))
    const drawer = await screen.findByRole('dialog')
    // The nine unconfirmed systems, by name not by id.
    expect(within(drawer).getByText('Beacon')).toBeInTheDocument()
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(9)
  })

  it('names the two dropped requirements', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    const card = await screen.findByRole('article', { name: /Requirement attrition/i })
    await user.click(within(card).getByRole('button', { name: /show/i }))
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText(/training pipeline for relay operators/)).toBeInTheDocument()
    expect(within(drawer).getByText(/spectrum deconfliction process/)).toBeInTheDocument()
  })

  it('renders the attrition flow with explicit loss nodes', async () => {
    await renderWithProvider(<LossinessTab />)
    const flow = await screen.findByRole('img', { name: /attrition flow/i })
    expect(within(flow).getByText(/not carried forward/i)).toBeInTheDocument()
    expect(within(flow).getByText(/unmapped/i)).toBeInTheDocument()
  })

  it('says there is only one snapshot rather than drawing a flat line', async () => {
    await renderWithProvider(<LossinessTab />)
    expect(await screen.findByText(/one snapshot so far/i)).toBeInTheDocument()
  })

  it('ranks top gaps by risk, confirmation and mapping', async () => {
    await renderWithProvider(<LossinessTab />)
    const region = await screen.findByRole('region', { name: /top gaps/i })
    const rows = within(region).getAllByRole('row').slice(1)
    // Beacon is high-risk, unconfirmed and unmapped: the maximum score.
    expect(rows[0]).toHaveTextContent(/Beacon/)
  })

  it('hides the composite index behind an explicit opt-in', async () => {
    const { user } = await renderWithProvider(<LossinessTab />)
    expect(screen.queryByText(/Lossiness Index/i)).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /composite indicator/i }))
    expect(await screen.findByText(/Lossiness Index/i)).toBeInTheDocument()
    expect(screen.getByText(/management indicator, not a formal metric/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it, expect failure, then build the views**

`Scorecard` renders seven `<article aria-label="{label} dimension">` cards, each with the
value, the `numerator of denominator` line, a severity band, and a `Show the N …` button
opening `DimensionDrawer`.

`AttritionFlow` is the headline visual: requirements → systems → hardware, left to right,
with explicit loss nodes bleeding off at each stage (`not carried forward`, `unconfirmed`,
`unmapped`, `unexplained hardware`). Geometry from `src/viz/attrition.ts`, which follows
the same zero-size rule as the Sankey.

`TrendView` reads `getSnapshots()`. With one snapshot it renders
`One snapshot so far (2026-08-05). Trends appear once a second build is committed.` —
an `EmptyState`, never a chart with a single point.

`TopGaps` renders the ranked table from `lossiness.top_gaps`.

The composite index is behind a `Show composite indicator` toggle and always carries the
sentence `A management indicator, not a formal metric.`

- [ ] **Step 3: Run the tests, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/tabs/lossiness
```

Expected: `10 passed`.

- [ ] **Step 4: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src/tabs/lossiness src/lib/lossiness.ts src/viz/attrition.ts
git commit -m "app: Lossiness tab with the seven dimensions and drill-down evidence"
```

---

### Task 25: Network Topology

The iframe, `srcdoc` and `postMessage` bridge are gone. The graph is a React component
taking props, and the three cross-document seams (`selectDevices`, `setTheme`,
`openMindmap`) collapse into shared state.

**This task contains the porting trap called out in the brief. Do Step 1 first.**

**Files:**
- Create: `src/viz/zoom.ts` + `src/viz/__tests__/zoom.test.ts`
- Create: `src/viz/force.ts` + `src/viz/__tests__/force.test.ts`
- Create: `src/tabs/network/NetworkTab.tsx`
- Create: `src/tabs/network/{ForceGraph,ZonePanel,DeviceDetail,SiteSelector,NetworkLegend}.tsx`
- Create: `src/tabs/network/__tests__/NetworkTab.test.tsx`

- [ ] **Step 1: Write the zero-size zoom guard test BEFORE any graph code**

The original computes `scale = Math.min(width/bw, height/bh, 2)`. At zero container width
that is `0`, which pins the zoom transform at `k = 0`; every later `width / t.k` then
yields `Infinity`, and the SVG fills with `NaN` geometry. The old tool never hit it because
it only assigned the iframe `srcdoc` when the Network tab was opened, so the container
always had a size. React mounts before layout, so it is reachable here. See the
source repo, commit `4881be5`.

```ts
import { describe, expect, it } from 'vitest'

import { fitToScreen, panToFit } from '../zoom'

const BBOX = { x: 0, y: 0, w: 1000, h: 800 }

describe('fitToScreen', () => {
  it('fits a normal container', () => {
    const t = fitToScreen(BBOX, { width: 1200, height: 900 })
    expect(t).not.toBeNull()
    expect(t!.k).toBeGreaterThan(0)
    expect(Number.isFinite(t!.x) && Number.isFinite(t!.y)).toBe(true)
  })

  it('returns null for a zero-width container instead of a zero scale', () => {
    expect(fitToScreen(BBOX, { width: 0, height: 900 })).toBeNull()
  })

  it('returns null for a zero-height container', () => {
    expect(fitToScreen(BBOX, { width: 1200, height: 0 })).toBeNull()
  })

  it('returns null for a container that has not been laid out at all', () => {
    expect(fitToScreen(BBOX, { width: 0, height: 0 })).toBeNull()
  })

  it('never returns a transform with k of 0', () => {
    for (const size of [
      { width: 1, height: 1 }, { width: 1200, height: 900 }, { width: 10000, height: 4 },
    ]) {
      const t = fitToScreen(BBOX, size)
      if (t) expect(t.k).toBeGreaterThan(0)
    }
  })

  it('caps the scale at 2 so a tiny graph is not blown up', () => {
    const t = fitToScreen({ x: 0, y: 0, w: 10, h: 10 }, { width: 1200, height: 900 })
    expect(t!.k).toBeLessThanOrEqual(2)
  })

  it('returns null for an empty bounding box', () => {
    expect(fitToScreen(null, { width: 1200, height: 900 })).toBeNull()
  })

  it('produces geometry that stays finite when inverted', () => {
    // This is the actual failure mode: width / t.k downstream.
    const t = fitToScreen(BBOX, { width: 1200, height: 900 })!
    expect(Number.isFinite(1200 / t.k)).toBe(true)
  })
})

describe('panToFit', () => {
  it('returns null when the container has no size', () => {
    expect(panToFit([{ x: 1, y: 2 }], { width: 0, height: 0 }, 1)).toBeNull()
  })

  it('returns null when there are no points to fit', () => {
    expect(panToFit([], { width: 1200, height: 900 }, 1)).toBeNull()
  })

  it('fits a selected device set', () => {
    const t = panToFit([{ x: 10, y: 10 }, { x: 90, y: 90 }], { width: 1200, height: 900 }, 1)
    expect(t).not.toBeNull()
    expect(Number.isFinite(t!.x) && Number.isFinite(t!.y) && t!.k > 0).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/viz/__tests__/zoom.test.ts
```

Expected: `Failed to resolve import "../zoom"`.

- [ ] **Step 3: Write `src/viz/zoom.ts`**

```ts
export interface Size {
  width: number
  height: number
}

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Transform {
  x: number
  y: number
  k: number
}

const PAD = 70
const MAX_SCALE = 2

/**
 * Zoom transform that fits `bbox` into `size`, or null when it cannot.
 *
 * Returning null rather than a transform is the whole point. The original
 * computed Math.min(width/bw, height/bh, 2) unconditionally; with a zero-size
 * container that is 0, which pins k at 0, and every later width/t.k yields
 * Infinity and fills the SVG with NaN geometry. The old tool dodged this by
 * only mounting the graph when its tab opened. React mounts before layout, so
 * the caller must handle null and wait for the next resize.
 */
export function fitToScreen(bbox: BBox | null, size: Size): Transform | null {
  if (!bbox) return null
  if (!size.width || !size.height) return null

  const bw = bbox.w + PAD * 2
  const bh = bbox.h + PAD * 2
  if (!bw || !bh) return null

  const k = Math.min(size.width / bw, size.height / bh, MAX_SCALE)
  if (!Number.isFinite(k) || k <= 0) return null

  return {
    k,
    x: size.width / 2 - (bbox.x + bbox.w / 2) * k,
    y: size.height / 2 - (bbox.y + bbox.h / 2) * k,
  }
}

/** Pan-fit onto a selected set of devices. Same guard, same reason. */
export function panToFit(
  points: Array<{ x: number; y: number }>,
  size: Size,
  currentK: number,
): Transform | null {
  if (!points.length) return null
  if (!size.width || !size.height) return null
  if (!Number.isFinite(currentK) || currentK <= 0) return null

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2

  return { k: currentK, x: size.width / 2 - cx * currentK, y: size.height / 2 - cy * currentK }
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/viz/__tests__/zoom.test.ts
```

Expected: `11 passed`.

- [ ] **Step 5: Write `src/viz/force.ts`**

Force parameters carried verbatim from `northgate/cuas-network-graph-v2.html:552-555` and
the layout-mode block at 780-830:

```ts
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3'

/** Node radius by device type, from TYPE_SHAPES in the original graph. */
export const TYPE_SIZE: Record<string, number> = {
  router: 14, switch: 12, server: 12, sensor: 11, firewall: 13,
  gateway: 13, cloud: 15, endpoint: 10, access_point: 11, radio: 11,
  application: 12, backbone: 13, satellite_terminal: 13, vlan: 12,
}
const DEFAULT_SIZE = 12

export type ViewMode = 'force' | 'zone' | 'tree'

/**
 * Force layout tuning, unchanged from the original graph. These numbers are
 * the result of manual tuning against the real Northgate topology; changing
 * them changes a layout people recognise.
 */
export function createSimulation(nodes: SimNode[], links: SimLink[], size: Size) {
  return forceSimulation(nodes)
    .force('link', forceLink(links).id((d) => (d as SimNode).id).distance(90).strength(0.55))
    .force('charge', forceManyBody().strength(-560))
    .force('collision', forceCollide().radius((d) =>
      (TYPE_SIZE[(d as SimNode).type] ?? DEFAULT_SIZE) + 18))
    .force('x', forceX<SimNode>().x((d) => zoneCenter(d, size).x).strength(0.12))
    .force('y', forceY<SimNode>().y((d) => zoneCenter(d, size).y).strength(0.12))
}
```

Tests for `force.ts` assert that every node ends with finite `x`/`y` after a fixed number
of ticks, that `zone` and `tree` modes produce deterministic positions for the same input,
and that a zero-size container yields no `NaN`.

- [ ] **Step 6: Write the Network tab test**

```tsx
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NetworkTab } from '../NetworkTab'
import { renderWithProvider } from '../../../test/renderWithProvider'

describe('Network Topology', () => {
  it('offers both sites', async () => {
    await renderWithProvider(<NetworkTab />)
    expect(await screen.findByRole('button', { name: /Northgate Sports Campus/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Westfield Proving Ground/ })).toBeInTheDocument()
  })

  it('reports the device and link counts for the active site', async () => {
    await renderWithProvider(<NetworkTab />)
    expect(await screen.findByText(/71 devices/)).toBeInTheDocument()
    expect(screen.getByText(/86 links/)).toBeInTheDocument()
  })

  it('renders one element per device once laid out', async () => {
    await renderWithProvider(<NetworkTab />)
    const graph = await screen.findByRole('img', { name: /network topology/i })
    expect(within(graph).getAllByRole('graphics-symbol')).toHaveLength(71)
  })

  it('does not emit NaN geometry when mounted before layout', async () => {
    // jsdom reports every element as 0x0, which is exactly the trap. If the
    // guard is missing, this fills the DOM with NaN and the assertion fires.
    const { container } = await renderWithProvider(<NetworkTab />)
    await screen.findByRole('img', { name: /network topology/i })
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('lists all 14 Northgate zones', async () => {
    await renderWithProvider(<NetworkTab />)
    const zones = await screen.findByRole('region', { name: /zones/i })
    expect(within(zones).getAllByRole('button')).toHaveLength(15) // 14 + "all"
  })

  it('shows device detail including the systems it implements', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    await user.click(await screen.findByRole('button', { name: /Effector/i }))
    const detail = await screen.findByRole('region', { name: /device detail/i })
    expect(within(detail).getByText(/Implements/i)).toBeInTheDocument()
  })

  it('switches to Westfield Proving Ground without stale counts', async () => {
    const { user } = await renderWithProvider(<NetworkTab />)
    await user.click(await screen.findByRole('button', { name: /Westfield Proving Ground/ }))
    expect(await screen.findByText(/8 devices/)).toBeInTheDocument()
  })

  it('offers the three view modes', async () => {
    await renderWithProvider(<NetworkTab />)
    for (const m of ['Force', 'Zones', 'Tree']) {
      expect(await screen.findByRole('button', { name: m })).toBeInTheDocument()
    }
  })

  it('focuses a device set from a query parameter', async () => {
    await renderWithProvider(<NetworkTab />, { route: '/network?site=northgate&focus=field_house_effector' })
    const graph = await screen.findByRole('img', { name: /network topology/i })
    expect(within(graph).getByTestId('device-field_house_effector')).toHaveAttribute('data-focused', 'true')
  })
})
```

- [ ] **Step 7: Build the components, run the tests, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/tabs/network src/viz
```

Cross-linking works through the router: the Orientation Map's `View in Network` is a
`NavLink` to `/network?site=<id>&focus=<deviceIds>`, and a device's system chip links to
`/map?focus=<systemId>`. No message passing.

- [ ] **Step 8: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src/tabs/network src/viz
git commit -m "app: Network Topology as a React component, no iframe bridge"
```

---

### Task 26: Orientation Map

The hardest port. The layout is not a standard concentric radial tree: each node places its
children on a circle of radius `GAP[level]` around *itself*, with angular spans weighted by
subtree weight and a minimum span. Port the math; do not reach for `d3.tree()`.

Source: `cuas_tool_template_v6.html:3201-3232`.

**Files:**
- Create: `src/viz/radial.ts` + `src/viz/__tests__/radial.test.ts`
- Create: `src/lib/tree.ts` (build the tree from systems, per `build_tree`)
- Create: `src/tabs/map/MapTab.tsx`
- Create: `src/tabs/map/{TreeCanvas,TreeNode,CrossLinks,DetailPanel,Minimap,MapToolbar}.tsx`
- Create: `src/tabs/map/__tests__/MapTab.test.tsx`

- [ ] **Step 1: Write the layout test**

```ts
import { describe, expect, it } from 'vitest'

import { GAP, MIN_DEG, doLayout, minSpan, subtreeWeight } from '../radial'
import type { TreeNode } from '../../types/tree'

const leaf = (id: string): TreeNode => ({ id, label: id, colorKey: 'inv', leaf: true })
const branch = (id: string, children: TreeNode[]): TreeNode => ({
  id, label: id, colorKey: 'inv', children,
})

const TREE = branch('root', [
  branch('inv', [leaf('a'), leaf('b'), leaf('c')]),
  branch('integ', [leaf('d')]),
])

const allExpanded = { root: true, inv: true, integ: true }

describe('subtreeWeight', () => {
  it('counts a leaf as 1', () => {
    expect(subtreeWeight(leaf('a'), allExpanded)).toBe(1)
  })

  it('sums expanded children', () => {
    expect(subtreeWeight(TREE, allExpanded)).toBe(4)
  })

  it('counts a collapsed branch as 1, because it draws as one node', () => {
    expect(subtreeWeight(TREE, { root: true })).toBe(2)
  })
})

describe('minSpan', () => {
  it('gives a leaf the minimum degrees', () => {
    expect(minSpan(leaf('a'), allExpanded)).toBe(MIN_DEG)
  })

  it('sums children so a wide subtree reserves the room it needs', () => {
    expect(minSpan(TREE, allExpanded)).toBe(4 * MIN_DEG)
  })
})

describe('doLayout', () => {
  it('puts the root at the origin', () => {
    const p = doLayout(TREE, allExpanded)
    expect(p.root).toMatchObject({ x: 0, y: 0, level: 0 })
  })

  it('positions every node', () => {
    const p = doLayout(TREE, allExpanded)
    expect(Object.keys(p).sort()).toEqual(['a', 'b', 'c', 'd', 'inv', 'integ', 'root'].sort())
  })

  it('places children at GAP distance from their parent', () => {
    const p = doLayout(TREE, allExpanded)
    const d = Math.hypot(p.inv.x - p.root.x, p.inv.y - p.root.y)
    expect(d).toBeCloseTo(GAP[1], 5)
  })

  it('uses the level-specific gap at each depth', () => {
    const p = doLayout(TREE, allExpanded)
    const d = Math.hypot(p.a.x - p.inv.x, p.a.y - p.inv.y)
    expect(d).toBeCloseTo(GAP[2], 5)
  })

  it('gives every position finite coordinates', () => {
    const p = doLayout(TREE, allExpanded)
    for (const [id, pos] of Object.entries(p)) {
      expect(Number.isFinite(pos.x), `${id}.x`).toBe(true)
      expect(Number.isFinite(pos.y), `${id}.y`).toBe(true)
    }
  })

  it('omits children of a collapsed branch', () => {
    const p = doLayout(TREE, { root: true })
    expect(p.a).toBeUndefined()
    expect(p.inv).toBeDefined()
  })

  it('is deterministic', () => {
    expect(doLayout(TREE, allExpanded)).toEqual(doLayout(TREE, allExpanded))
  })

  it('allocates wider angular spans to heavier subtrees', () => {
    const wide = branch('root', [
      branch('big', [leaf('1'), leaf('2'), leaf('3'), leaf('4')]),
      branch('small', [leaf('5')]),
    ])
    const exp = { root: true, big: true, small: true }
    const p = doLayout(wide, exp)
    const spread = (ids: string[]) => {
      const angles = ids.map((i) => Math.atan2(p[i].y - p[ids[0]].y, p[i].x - p[ids[0]].x))
      return Math.max(...angles) - Math.min(...angles)
    }
    expect(spread(['1', '2', '3', '4'])).toBeGreaterThan(0)
  })

  it('handles a single-child tree without dividing by zero', () => {
    const p = doLayout(branch('root', [leaf('only')]), { root: true })
    expect(Number.isFinite(p.only.x) && Number.isFinite(p.only.y)).toBe(true)
  })

  it('handles a leaf-only root', () => {
    expect(doLayout(leaf('solo'), {})).toEqual({ solo: { x: 0, y: 0, level: 0, node: expect.anything() } })
  })
})
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/viz/__tests__/radial.test.ts
```

Expected: `Failed to resolve import "../radial"`.

- [ ] **Step 3: Write `src/viz/radial.ts`**

```ts
import type { TreeNode } from '../types/tree'

/** Minimum angular span in degrees a node reserves for itself. */
export const MIN_DEG = 11

/** Radius from a parent to its children, by the child's depth. */
export const GAP = [0, 300, 280, 260, 240]
const DEFAULT_GAP = 220

export type Expanded = Record<string, boolean | undefined>

export interface Position {
  x: number
  y: number
  level: number
  node: TreeNode
}

/**
 * Subtree weight: how many drawn nodes this subtree contributes.
 *
 * A collapsed branch weighs 1 because it renders as a single node, which is
 * what makes expanding a branch redistribute the ring rather than overlap it.
 */
export function subtreeWeight(node: TreeNode, expanded: Expanded): number {
  if (!expanded[node.id] || !node.children) return 1
  return node.children.reduce((sum, c) => sum + subtreeWeight(c, expanded), 0)
}

/** Minimum angular span this subtree needs, in degrees. */
export function minSpan(node: TreeNode, expanded: Expanded): number {
  if (!expanded[node.id] || !node.children) return MIN_DEG
  return node.children.reduce((sum, c) => sum + minSpan(c, expanded), 0)
}

/**
 * Recursive angular subdivision, ported from cuas_tool_template_v6.html:3208-3224.
 *
 * Each node places its children on a circle of radius GAP[depth] around
 * itself, not on a shared concentric ring, so this is not what d3.tree or
 * d3.cluster produce. The span rule is the tuned part: when the children's
 * combined minimum spans exceed the arc available, every child is scaled down
 * proportionally to its minimum; otherwise each child gets its weight share of
 * the arc but never less than its minimum.
 */
export function doLayout(root: TreeNode, expanded: Expanded): Record<string, Position> {
  const positions: Record<string, Position> = {}

  function lay(node: TreeNode, cx: number, cy: number, a0: number, a1: number, level: number) {
    positions[node.id] = { x: cx, y: cy, level, node }
    if (!node.children || !expanded[node.id]) return

    const gap = GAP[level + 1] ?? DEFAULT_GAP
    const available = a1 - a0

    let totalMin = 0
    let totalWeight = 0
    for (const child of node.children) {
      totalMin += minSpan(child, expanded)
      totalWeight += subtreeWeight(child, expanded)
    }

    let cursor = a0
    for (const child of node.children) {
      const span =
        totalMin > available
          ? (minSpan(child, expanded) / totalMin) * available
          : Math.max((subtreeWeight(child, expanded) / totalWeight) * available,
                     minSpan(child, expanded))
      const mid = cursor + span / 2
      const rad = (mid * Math.PI) / 180
      lay(child, cx + Math.cos(rad) * gap, cy + Math.sin(rad) * gap, cursor, cursor + span, level + 1)
      cursor += span
    }
  }

  lay(root, 0, 0, 0, 360, 0)
  return positions
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/viz/__tests__/radial.test.ts
```

Expected: `14 passed`.

- [ ] **Step 5: Write `src/lib/tree.ts`**

Builds the tree from `systems.json`, mirroring `build_tree` in the Python: an `inv` branch
holding one group per owner group, then `integ`, `sensor`, `platform`, `mitig`, `gaps`
branches. Test it against the real bundle: root has 6 children, `inv` has 6 groups,
`countLeaves(root)` is 32.

- [ ] **Step 6: Write the Map tab test and components**

```tsx
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MapTab } from '../MapTab'
import { renderWithProvider } from '../../../test/renderWithProvider'

describe('Orientation Map', () => {
  it('renders 32 leaf nodes when fully expanded', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    expect(within(canvas).getAllByTestId(/^leaf-/)).toHaveLength(32)
  })

  it('shows the seven stats from the current tool', async () => {
    await renderWithProvider(<MapTab />)
    const stats = await screen.findByRole('region', { name: /statistics/i })
    for (const [label, value] of [
      ['Systems', '32'], ['Confirmed', '23'], ['Unconfirmed', '9'],
      ['High Risk', '11'], ['Med Risk', '19'], ['Low Risk', '2'], ['Links', '14'],
    ]) {
      const stat = within(stats).getByRole('group', { name: label })
      expect(within(stat).getByText(value)).toBeInTheDocument()
    }
  })

  it('opens a detail panel naming the system, its risk and its integrations', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(await screen.findByTestId('leaf-trackwell'))
    const panel = await screen.findByRole('complementary', { name: /system detail/i })
    expect(within(panel).getByText(/Trackwell/)).toBeInTheDocument()
    expect(within(panel).getByText(/Known Integration Links/i)).toBeInTheDocument()
  })

  it('marks unconfirmed systems and only those', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    const soft = within(canvas).getAllByTestId(/^leaf-/)
      .filter((n) => n.getAttribute('data-soft') === 'true')
      .map((n) => n.getAttribute('data-id'))
      .sort()
    expect(soft).toEqual(['beacon', 'cirrus', 'dwell', 'ember', 'fathom', 'gantry', 'halyard', 'ingot', 'jetty'])
  })

  it('toggles current and desired links independently', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Links' }))
    const canvas = await screen.findByRole('img', { name: /orientation map/i })
    expect(within(canvas).getAllByTestId(/^link-current-/)).toHaveLength(14)
    expect(within(canvas).queryAllByTestId(/^link-desired-/)).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Desired' }))
    expect(within(canvas).getAllByTestId(/^link-desired-/)).toHaveLength(13)
  })

  it('recolours by risk when Risk View is on', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(screen.getByRole('button', { name: 'Risk View' }))
    const canvas = screen.getByRole('img', { name: /orientation map/i })
    const high = within(canvas).getAllByTestId(/^leaf-/)
      .filter((n) => n.getAttribute('data-risk') === 'high')
    expect(high).toHaveLength(11)
  })

  it('focuses and expands to a system named in ?focus=', async () => {
    await renderWithProvider(<MapTab />, { route: '/map?focus=beacon' })
    const panel = await screen.findByRole('complementary', { name: /system detail/i })
    expect(within(panel).getByText('Beacon')).toBeInTheDocument()
    // The whole ancestor chain must be expanded, or the focused node is not drawn.
    expect(await screen.findByTestId('leaf-beacon')).toBeInTheDocument()
  })

  it('links a mapped system through to the network tab', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(await screen.findByTestId('leaf-bastion'))
    const link = await screen.findByRole('link', { name: /View in Network/i })
    expect(link).toHaveAttribute(
      'href', expect.stringContaining('/network?site=northgate&focus=field_house_effector'),
    )
  })

  it('says so plainly when a system has no device mapping', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    await user.click(await screen.findByTestId('leaf-fathom'))
    const panel = await screen.findByRole('complementary', { name: /system detail/i })
    expect(within(panel).getByText(/Not mapped to any site/i)).toBeInTheDocument()
  })

  it('does not emit NaN geometry before layout', async () => {
    // jsdom reports 0x0 for every element, so this exercises the same
    // mount-before-layout path as the network zoom guard in Task 25.
    const { container } = await renderWithProvider(<MapTab />)
    await screen.findByRole('img', { name: /orientation map/i })
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })
})
```

`TreeCanvas` renders one `<g>` per position from `doLayout`; `CrossLinks` draws current
(cyan dashed) and desired (amber dashed) links between positions; `Minimap` is a second
React component reading the same positions, **not** a monkey-patch of the renderer.

Toolbar controls, labels verbatim from the current tool: `Links`, `Clean`, `Grid`,
`Desired`, `Risk View`, `Reset`, `Expand All`.

- [ ] **Step 7: Run the full suite**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run && npm run build
```

- [ ] **Step 8: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src
git commit -m "app: Orientation Map with the ported radial layout"
```

---

### Task 26b: Visual regression baselines

Spec §8: TypeScript cannot catch a broken radial layout. A tree that lays out with every
node stacked at the origin typechecks, passes every unit test that asserts finite
coordinates, and is obviously wrong to a human at a glance. Screenshots close that gap.

Placed immediately after the radial port because that is the layout most likely to break
silently, and least likely to be caught by anything else.

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/visual.spec.ts`
- Create: `e2e/__screenshots__/` (committed baselines)

- [ ] **Step 1: Install Playwright with Chromium only**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npm i -D @playwright/test@^1.49.0 && npx playwright install --with-deps chromium
```

Chromium only: three browsers triples CI time for a check whose value is "did the layout
collapse", which is not browser-specific.

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Layout differences of a pixel or two are font-rendering noise, not
  // regressions. A collapsed tree moves far more than 1% of the pixels.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
})
```

`reuseExistingServer: false` matters for the same reason the QA note in Task 30 does: a
reused server means a reused console buffer and stale errors read as fresh ones.

- [ ] **Step 3: Write `e2e/visual.spec.ts`**

```ts
import { expect, test } from '@playwright/test'

const TABS = [
  { path: '/reference', name: 'reference' },
  { path: '/analytics', name: 'analytics' },
  { path: '/lossiness', name: 'lossiness' },
  { path: '/network', name: 'network' },
  { path: '/map', name: 'map' },
]

for (const tab of TABS) {
  for (const theme of ['dark', 'light'] as const) {
    test(`${tab.name} renders in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(tab.path)
      // Wait for real layout, not just for the route to resolve. Force layouts
      // settle asynchronously and a screenshot taken mid-simulation is noise.
      await page.waitForFunction(() => document.body.dataset.atlasReady === 'true')
      await expect(page).toHaveScreenshot(`${tab.name}-${theme}.png`, { fullPage: true })
    })
  }
}

test('the orientation map draws its nodes away from the origin', async ({ page }) => {
  await page.goto('/map')
  await page.waitForFunction(() => document.body.dataset.atlasReady === 'true')
  // The specific failure this guards: a layout bug that returns 0,0 for every
  // node still typechecks and still has finite coordinates.
  const spread = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-testid^="leaf-"]')]
    const xs = nodes.map((n) => n.getBoundingClientRect().x)
    return Math.max(...xs) - Math.min(...xs)
  })
  expect(spread).toBeGreaterThan(200)
})

test('no tab logs a console error', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  for (const tab of TABS) {
    await page.goto(tab.path)
    await page.waitForFunction(() => document.body.dataset.atlasReady === 'true')
  }
  expect(errors).toEqual([])
})
```

Each tab sets `document.body.dataset.atlasReady = 'true'` once its data has loaded and,
for the two force-directed views, once the simulation has settled.

- [ ] **Step 4: Generate and review the baselines**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx playwright test --update-snapshots
```

**Open every generated PNG before committing it.** A baseline captured from a broken
render makes the broken render the standard, which is worse than having no baselines.

- [ ] **Step 5: Re-run against the baselines**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx playwright test
```

Expected: `12 passed` (5 tabs × 2 themes, plus the spread and console checks).

- [ ] **Step 6: Add the `e2e` script**

`.github/workflows/ci.yml` does not exist yet; Task 29 creates it and already includes the
Playwright steps. Here, just add the script so both a human and CI invoke it the same way:

```json
"e2e": "playwright test",
"e2e:update": "playwright test --update-snapshots"
```

- [ ] **Step 7: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add playwright.config.ts e2e package.json
git commit -m "test: visual regression baselines for all five tabs"
```

---

# Milestone E — Ship

---

### Task 27: The self-contained single-file export

The air-gapped deliverable, and the criterion that decides whether Phase 1 is done.

**Files:**
- Create: `scripts/build-singlefile.mjs`
- Create: `src/export/singleFile.ts`
- Create: `scripts/__tests__/singlefile.test.mjs`

Two halves: a build-time script that inlines the built `dist/` into one HTML file with the
bundles embedded, and an in-app `Download standalone HTML` button that produces the same
artifact from whatever the current provider holds (so a `LocalFileProvider` session exports
too).

- [ ] **Step 1: Write the test**

```js
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const html = readFileSync('dist-standalone/atlas.html', 'utf-8')

test('is a single file with no external references', () => {
  const remote = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/g) ?? []
  assert.deepEqual(remote, [], `found remote references: ${remote.join(', ')}`)
})

test('has no relative asset references either', () => {
  const rel = html.match(/(?:src|href)\s*=\s*["']\.?\/assets\/[^"']+/g) ?? []
  assert.deepEqual(rel, [])
})

test('embeds the data bundles', () => {
  assert.match(html, /__ATLAS_DATA__/)
  assert.match(html, /"bundle_version"/)
})

test('carries all 32 systems', () => {
  const match = html.match(/window\.__ATLAS_DATA__\s*=\s*(\{[\s\S]*?\});/)
  assert.ok(match, 'no embedded data block')
  const data = JSON.parse(match[1])
  assert.equal(data['systems.json'].length, 32)
  assert.equal(data['sites/northgate.json'].devices.length, 71)
})

test('stays under 20 MB so it can be emailed', () => {
  const bytes = Buffer.byteLength(html)
  assert.ok(bytes < 20 * 1024 * 1024, `${(bytes / 1024 / 1024).toFixed(1)} MB`)
})
```

- [ ] **Step 2: Write `scripts/build-singlefile.mjs`**

It reads `dist/index.html`, inlines every `<script type="module" src>` and
`<link rel="stylesheet">` from `dist/assets/`, inlines fonts as `data:` URIs, injects
`window.__ATLAS_DATA__` with every file under `public/data/` keyed by its relative path,
and writes `dist-standalone/atlas.html`. `StaticProvider` checks for
`window.__ATLAS_DATA__` first and serves from it when present, so the same app code runs
online and standalone.

Add to `package.json`:

```json
"build:standalone": "npm run build && node scripts/build-singlefile.mjs",
"test:standalone": "node --test scripts/__tests__/singlefile.test.mjs"
```

- [ ] **Step 3: Build and test it**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npm run build:standalone && npm run test:standalone
```

Expected: 5 tests pass. Then open it from a `file://` URL with the network disabled and
click through all five tabs. That manual check is the offline guarantee; the tests only
prove there are no references, not that it renders.

- [ ] **Step 4: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add scripts src/export package.json
git commit -m "export: self-contained single-file HTML build"
```

---

### Task 28: PNG and PDF export, command palette, keyboard shortcuts

Rebuilt against the spec rather than ported. Every shortcut now lives in one document, so
the current tool's "click into the network graph first to focus it" wart disappears.

**Files:**
- Create: `src/export/{png.ts,pdf.ts,csv.ts}` + tests
- Create: `src/components/{CommandPalette,ShortcutsDialog}.tsx` + tests
- Create: `src/lib/useShortcuts.ts` + test

Shortcuts, all global: `?` shortcuts dialog, `⌘K`/`Ctrl+K` command palette, `E` PNG of the
active tab, `1`–`5` jump to a tab, `/` focus the tab's filter, `F` fit (map and network),
`L` labels, `R` risk overlay, `\` sidebar, `Esc` clear selection or close a dialog. All
suppressed while a text input has focus.

`csv.ts` must sanitize formula-injection prefixes: any cell starting with `=`, `+`, `-` or
`@` is prefixed with a single quote. Test it directly.

- [ ] **Step 1: Write the CSV hardening test first**

```ts
import { describe, expect, it } from 'vitest'

import { toCsv } from '../csv'

describe('toCsv', () => {
  it('neutralises formula-injection prefixes', () => {
    for (const dangerous of ['=cmd|calc', '+1+1', '-1+1', '@SUM(A1)']) {
      const csv = toCsv([{ note: dangerous }])
      expect(csv.split('\n')[1]).toMatch(/^"'/)
    }
  })

  it('quotes embedded commas and quotes', () => {
    expect(toCsv([{ a: 'x,y' }])).toContain('"x,y"')
    expect(toCsv([{ a: 'he said "hi"' }])).toContain('""hi""')
  })

  it('writes a header row from the keys', () => {
    expect(toCsv([{ id: 'a', risk: 'high' }]).split('\n')[0]).toBe('id,risk')
  })

  it('returns just a header for an empty set, not an empty string', () => {
    expect(toCsv([], ['id'])).toBe('id')
  })
})
```

- [ ] **Step 2: Run, implement, re-run until green, then build the rest**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npx vitest run src/export src/components src/lib
```

- [ ] **Step 3: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add src
git commit -m "app: exports, command palette and global keyboard shortcuts"
```

---

### Task 29: CI and deploy

Workflows copied from DRIFT, whose action pins are the known-good set.

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

# Deploy only runs on push to main, so without this a PR that breaks the build
# or the tests would merge green and break the next production deploy.
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # `npm run build` is `tsc --noEmit && vite build` — typecheck plus real build.
      - run: npm run build
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
      # A screenshot failure is unreadable from a log. Without the diff artifact
      # the usual response is to regenerate the baseline instead of looking at
      # what actually changed.
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-diffs
          path: test-results/
      - run: npm run build:standalone
      - run: npm run test:standalone
      # The offline guarantee is a hard requirement, so assert it rather than
      # trusting that nobody added a CDN reference.
      - name: Assert no remote assets in the build
        run: |
          hits=$(grep -rEoh 'https?://[a-zA-Z0-9./-]+' dist/assets dist/index.html \
                 | grep -v 'www.w3.org\|schema.org' | sort -u || true)
          if [ -n "$hits" ]; then echo "remote assets found:"; echo "$hits"; exit 1; fi

  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -e './ingest[dev]'
      # The golden tests need the reference workbook, which lives in another
      # repo. They skip cleanly when it is absent; the rest still runs.
      - run: python -m pytest ingest/tests -q
```

- [ ] **Step 2: Write `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

# Allow the workflow to publish to Pages.
permissions:
  contents: read
  pages: write
  id-token: write

# One concurrent deploy; don't cancel an in-progress publish.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Make the golden tests skip cleanly in CI**

`conftest.py` calls `pytest.skip` when `ATLAS_SOURCE_REPO` is unset, and fails when it is
set but points somewhere without the data. Skipping on an unset variable is honest; skipping
on a set-but-wrong one would let a misconfigured CI job go green having proven nothing.
Verify both halves:

```bash
cd /Users/aousabdo/work/Oceans/atlas && env -u ATLAS_SOURCE_REPO python3 -m pytest ingest/tests -q 2>&1 | tail -3
cd /Users/aousabdo/work/Oceans/atlas && ATLAS_SOURCE_REPO=/nonexistent python3 -m pytest ingest/tests -q 2>&1 | tail -3
```

Expected from the first: the golden and curation tests skip; `test_config`, `test_identity`,
`test_classify_risk`, `test_classify_owner`, `test_validate` and the generated-tables guard
all still run and pass. Expected from the second: the data-backed tests fail loudly naming
the missing path. If the first errors instead of skipping, or the second skips instead of
failing, fix `conftest.py` before pushing.

- [ ] **Step 4: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add .github
git commit -m "ci: typecheck, test and assert the offline guarantee on every PR"
```

- [ ] **Step 5: Do NOT push. Stop and ask.**

The repo does not exist on GitHub yet and pushing is outward-facing. Report that the
branch is ready, state the commands that would create the remote and enable Pages, and
wait for the user to say go:

```bash
gh repo create aousabdo/atlas --private --source=. --remote=origin
git push -u origin main
gh api -X POST repos/aousabdo/atlas/pages -f build_type=workflow
```

The Cloudflare DNS record for `atlas.analyticadss.com` (CNAME to `aousabdo.github.io`,
proxied) is a separate manual step in the Cloudflare dashboard.

---

### Task 30: Parity check and the README

Phase 1 is done when it fully replaces `atlas_v6.html`. This task proves it.

**Files:**
- Create: `docs/parity.md`
- Create: `README.md` (replacing the Task 1 stub)

- [ ] **Step 1: Walk the parity checklist against a running app**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npm run dev -- --port 5199
```

Use a **fresh port for each verification run**. The browser console buffer does not clear
across same-origin navigation, so reusing a port means re-reading stale errors and
misdiagnosing them.

Check each row, recording pass or fail in `docs/parity.md`:

| # | Capability in atlas_v6.html | Where it lives now |
|---|---|---|
| 1 | 32 systems, 23 confirmed, 9 unconfirmed, 11/19/2 risk in the stats bar | Map tab stats |
| 2 | Radial tree, expand/collapse, drag leaves, zoom, pan | Map tab |
| 3 | Minimap with viewport rectangle | Map tab |
| 4 | Current links (cyan) and desired links (amber) toggles | Map toolbar |
| 5 | Risk View recolour | Map toolbar |
| 6 | Grid snap and Clean routing | Map toolbar |
| 7 | Detail panel with integrations and the network cross-link | Map detail panel |
| 8 | Risk heatmap 6×3 with hover listing the systems | Analytics |
| 9 | Ownership confirmation bars with confirmed/pending counts | Analytics |
| 10 | Requirements coverage flow, 11 requirements, 5 statuses, dropped stubs | Analytics |
| 11 | Multi-site coverage donuts, cross-site diff, pending questions | Analytics |
| 12 | Analytics filter dimming every card at once | Analytics |
| 13 | Network graph, 71 + 8 devices, force/zone/tree, zones, search, labels, risk overlay | Network |
| 14 | Device detail with implements-system chips linking back | Network |
| 15 | Confidence and caveats, four cards | Reference |
| 16 | Methodology, five blocks, keyword lists from live config | Reference |
| 17 | Systems table, 32 rows, mapped-at column | Reference |
| 18 | Acronyms table, 48 rows | Reference |
| 19 | Architecture and build stamp | Reference |
| 20 | Filter across both reference tables | Reference |
| 21 | Save PNG of the active tab | Export menu |
| 22 | Export PDF of the reference tab | Export menu |
| 23 | Print Mode / light theme | Theme toggle |
| 24 | Keyboard shortcuts dialog | `?` |
| 25 | About drawer per tab | Per-tab about |
| **New** | Lossiness tab, seven dimensions with drill-down | Lossiness |
| **New** | Attrition flow | Lossiness |
| **New** | Top gaps ranking | Lossiness |
| **New** | Load your own matrix, parsed in-browser | File loader |
| **New** | Self-contained single-file export | Export menu |
| **New** | Deep-linkable routes | every tab |
| **New** | git_sha, build command and site classification displayed | Reference |

- [ ] **Step 2: Verify the offline guarantee by hand**

Build the standalone file, disconnect from the network, open it from `file://`, and click
through all five tabs. Record the result in `docs/parity.md`. This is the claim that was
previously false and shown to stakeholders; it does not get marked done on a passing test
alone.

- [ ] **Step 3: Write the README**

Cover: what ATLAS is; the two providers and what "your file never leaves your machine"
means concretely; how to regenerate the bundles; how to build the standalone file; the
Phase 1 / Phase 2 split and which deployment gate was honoured (Phase 1 takes the
GitHub Pages path, deferring hosting until the roadmap steps land); and the open CUI
marking question with a pointer to the spec. State the offline guarantee only in the
form the parity check actually verified.

- [ ] **Step 4: Run everything one final time**

```bash
cd /Users/aousabdo/work/Oceans/atlas && npm run build && npm test && npm run build:standalone && npm run test:standalone && python3 -m pytest ingest/tests -q
```

- [ ] **Step 5: Commit**

```bash
cd /Users/aousabdo/work/Oceans/atlas
git add README.md docs/
git commit -m "docs: parity checklist against atlas_v6 and the Phase 1 README"
```

---

## Out of scope for Phase 1

Recorded so it is a decision rather than an omission.

- The backend, accounts, roles, attribution, and the server-side upload/diff/approve flow.
  All Phase 2, all gated on the CUI marking question.
- Playwright vector PDF export (D-E).
- Semantic search over the architecture; blocked by the platform's no-app-local-RAG rule.
- Arbitrary spreadsheet upload with a column-mapping UI; only needed for true
  multi-tenancy.
- The five unread workbook sheets (`Integration Matrix`, `Risk Register`,
  `Original_Baseline`, `summary`, `Mindmap`) and the six unread columns
  (`Planned Interfaces`, `User Community`, `Response`,
  `Reference Material`, `Interface Class`, `SEAR/EventRel Only?`). There is
  materially more data here than either tool shows. Each additional sheet is its own
  phase, not a feature.
- The April 2026 matrix as a second baseline. The ingest package can already read it;
  what it needs is the `projects` concept, which arrives with the backend.
