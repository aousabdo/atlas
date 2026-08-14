"""Where the suite's inputs come from, and what it admits it has not checked.

THE GENERATED SAMPLE REPO (always available, drives the whole suite)

    fixtures/make_source_repo.py writes a fabricated tree with the same layout
    and the same sheet structure as a real one, filled from the sample
    vocabulary in atlas_ingest.synthetic. Every test that exercises LOGIC -
    that the header scan finds a header that is not on row 1, that the
    Confirmed column outranks the soft-id sets, that a suppressed pair drops
    out of the merge, that lossiness divides by the right denominator - reads
    that tree, in EVERY mode, whether or not reference data is present. Those
    tests only ever needed a matrix-shaped input, and this is it.

THE REFERENCE REPO (named by $ATLAS_SOURCE_REPO, absent almost everywhere)

    A read-only repo of real controlled data. A GitHub runner does not have it
    and must never be given it. A handful of tests assert facts about THAT
    tree - that it still lays out the five inputs the ingest resolves, that its
    workbook still opens through this reader. They are marked `reference_data`,
    they skip without it, and the terminal summary below says so in as many
    words.

WHY SETTING $ATLAS_SOURCE_REPO NO LONGER MOVES THE WHOLE SUITE

    It used to. Every fixture below resolved out of the reference repo the
    moment the variable was set, which meant that pointing at real reference
    data turned 99 tests into errors: source_paths() looked for `matrix.xlsx`
    and `northgate/` and `westfield/`, which are the GENERATED tree's names,
    and a real checkout names its workbook for the baseline it was cut from and
    its site directories for its sites. A developer with the reference data got
    a red suite, which is the state most likely to get a suite ignored.

    Two things fix it. The sample now drives the default fixtures in both
    modes, so setting the variable ADDS the reserved tests instead of
    redirecting the other 200-odd. And the resolver below discovers the real
    names by layout and by shape instead of assuming the synthetic ones, so the
    reserved tests read the files that are actually there.

    Note the deeper limit this exposed, because it is the reason no test here
    asserts a link COUNT measured on the reference matrix. atlas_ingest.config
    carries a fabricated ID_MAP, LABEL_MAP and LINK_NAME_FRAGMENTS, on purpose:
    the real vocabulary is exactly the controlled content this repo purged and
    scripts/check-no-real-data.mjs refuses to let back in. So this ingest cannot
    reproduce the reference repo's own link mining, and a test that asserted it
    could would be asserting something the repo is built to prevent. What
    reference data can honestly tell this repo is whether the upstream tree
    still has the SHAPE the ingest reads, and that is what the reserved tests
    check.

WHY THE SUMMARY EXISTS

    98 of 213 tests used to skip whenever ATLAS_SOURCE_REPO was unset, which
    is everywhere except one laptop. Half the suite proved nothing on every
    push and the run still printed a green line, because a skip reads as a
    pass. Those tests did not need real data at all, and now do not ask for it.
    The few that genuinely do are counted out loud at the end of every run, so
    the gap is a number somebody can see rather than a silence.
"""
import json
import os
import sys
from pathlib import Path

import pytest

TESTS = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS.parent / "src"))
sys.path.insert(0, str(TESTS / "fixtures"))

REPO = TESTS.parents[1]
SYNTHETIC_BUNDLE = REPO / "fixtures" / "synthetic"
GOLDEN = TESTS / "fixtures" / "golden"

_SOURCE_REPO_ENV = os.environ.get("ATLAS_SOURCE_REPO")
SOURCE_REPO = Path(_SOURCE_REPO_ENV) if _SOURCE_REPO_ENV else None

REFERENCE_MARK = "reference_data"

# The reason string CI greps for when it checks that nothing skipped for any
# other cause. Keep the two in step.
RESERVED_SKIP_REASON = "reserved for the reference data"

# Excel writes a lock file beside an open workbook. It is not a workbook.
_LOCK_PREFIX = "~$"
WORKBOOK_SUFFIXES = (".xlsx", ".xlsm")

_RESERVED_KEY = pytest.StashKey[list]()


class SourceLayoutError(AssertionError):
    """A source repo does not carry the inputs the ingest needs, or carries
    them ambiguously.

    An AssertionError rather than a bare Exception so a misconfigured run reads
    as a failure with a message that names the directory it searched, instead
    of an unexplained collection error somebody reads as "the tests are broken".
    """


# --- Resolving a source repo's inputs under whatever names it gives them -----
def find_workbook(mindmap):
    """The traceability workbook in `mindmap`, under whatever it is called.

    The generated sample calls it matrix.xlsx. A real checkout names it for the
    baseline it was cut from, so the name cannot be hardcoded: hardcoding it is
    what made every fixture in this file resolve to a path that does not exist,
    and what turned "point at the reference data" into 99 errors.

    Exactly one workbook, or an error naming what was found. Picking the first
    of several is how a run reads the wrong baseline and still reports a pass.
    """
    mindmap = Path(mindmap)
    if not mindmap.is_dir():
        raise SourceLayoutError(
            f"{mindmap} is not a directory, so this is not a source repo: a "
            f"source repo carries its matrix and curation under "
            f"traceability/mindmap/."
        )
    found = sorted(
        p for p in mindmap.iterdir()
        if p.is_file()
        and p.suffix.lower() in WORKBOOK_SUFFIXES
        and not p.name.startswith(_LOCK_PREFIX)
    )
    if len(found) == 1:
        return found[0]
    if not found:
        raise SourceLayoutError(
            f"no {' or '.join(WORKBOOK_SUFFIXES)} workbook in {mindmap}. The "
            f"traceability matrix is the one input nothing else can stand in "
            f"for."
        )
    raise SourceLayoutError(
        f"{len(found)} workbooks in {mindmap}: "
        f"{[p.name for p in found]}. Which one is the traceability matrix is a "
        f"guess, and a guess here reads a baseline nobody chose."
    )


def _is_topology(path):
    """Does this JSON file look like a NetworkX-style topology export?

    By shape, not by name. The sample writes <site>/<site>_network.json; the
    site directories of a real checkout are named for their sites and their
    topology files are not, so a name pattern resolves to nothing there.
    """
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return isinstance(raw, dict) and "nodes" in raw and "edges" in raw


def declared_site_ids(sdmap_path):
    """The site ids a source repo declares, read from its curation overlay.

    Read rather than hardcoded. The suite used to carry a literal pair of
    sample site ids and look for a directory per id, so against any tree whose
    sites are named anything else it resolved two paths that do not exist and
    every network fixture errored.
    """
    sdmap_path = Path(sdmap_path)
    if not sdmap_path.is_file():
        raise SourceLayoutError(
            f"{sdmap_path} is missing, so there is no declaration of which "
            f"sites this repo covers and no list of topologies to look for."
        )
    raw = json.loads(sdmap_path.read_text(encoding="utf-8"))
    sites = raw.get("sites")
    if not isinstance(sites, dict) or not sites:
        raise SourceLayoutError(
            f"{sdmap_path} declares no sites. Defaulting to a site id here "
            f"would invent coverage the overlay does not claim."
        )
    return list(sites)


def find_site_topologies(root, sdmap_path):
    """site id -> topology JSON path, for every site the overlay declares."""
    root = Path(root)
    resolved = {}
    for site_id in declared_site_ids(sdmap_path):
        site_dir = root / site_id
        if not site_dir.is_dir():
            raise SourceLayoutError(
                f"{sdmap_path} declares site '{site_id}' but {site_dir} does "
                f"not exist, so its topology cannot be read."
            )
        found = sorted(p for p in site_dir.glob("*.json") if _is_topology(p))
        if len(found) == 1:
            resolved[site_id] = found[0]
            continue
        if not found:
            raise SourceLayoutError(
                f"no topology export in {site_dir}: no JSON file there carries "
                f"both 'nodes' and 'edges'. Site '{site_id}' is declared in "
                f"{sdmap_path}, so a missing topology is a broken tree rather "
                f"than an absent site."
            )
        raise SourceLayoutError(
            f"{len(found)} topology exports in {site_dir}: "
            f"{[p.name for p in found]}. Picking one would silently choose "
            f"which devices site '{site_id}' has."
        )
    return resolved


def source_paths(root):
    """The five inputs a source repo has to carry, wherever it came from.

    The three curation files keep fixed names because this project's own
    tooling writes them. The workbook and the topologies do not: they are
    resolved by layout and by shape, so the same function reads the generated
    sample and a real checkout without either one having to be renamed.
    """
    root = Path(root)
    mindmap = root / "traceability" / "mindmap"
    sdmap = mindmap / "system_device_map.json"
    return {
        "matrix": find_workbook(mindmap),
        "overrides": mindmap / "overrides.json",
        "glossary": mindmap / "glossary.json",
        "sdmap": sdmap,
        "networks": find_site_topologies(root, sdmap),
    }


def flatten_paths(resolved):
    """Every path in a source_paths() result, as a flat list."""
    flat = [v for k, v in resolved.items() if k != "networks"]
    flat.extend(resolved["networks"].values())
    return flat


# --- The inputs the suite runs on: the generated sample, in every mode -------
@pytest.fixture(scope="session")
def sample_source_repo(tmp_path_factory):
    """The fabricated tree, built once per run into a temp directory."""
    from make_source_repo import write_source_repo

    return write_source_repo(tmp_path_factory.mktemp("sample-source-repo"))


@pytest.fixture(scope="session")
def paths(sample_source_repo):
    """The generated sample's five inputs, whether or not reference data exists.

    Deliberately NOT switched by $ATLAS_SOURCE_REPO. Everything downstream of
    this fixture asserts a number that is a property of the sample - 48
    acronyms, 14 zones, 13 mappings - so pointing it at another tree does not
    test that tree, it just fails. The tests that genuinely want reference data
    ask for `reference_paths` instead, and are marked so they are counted.
    """
    return source_paths(sample_source_repo)


@pytest.fixture(scope="session")
def matrix_path(paths):
    return paths["matrix"]


@pytest.fixture(scope="session")
def overrides(paths):
    return json.loads(paths["overrides"].read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def systems(matrix_path):
    from atlas_ingest.excel import read_excel

    return read_excel(matrix_path)


@pytest.fixture(scope="session")
def glossary(paths):
    from atlas_ingest.curation import load_glossary

    return load_glossary(paths["glossary"])


@pytest.fixture(scope="session")
def sdmap(paths):
    from atlas_ingest.curation import load_system_device_map

    return load_system_device_map(paths["sdmap"])


@pytest.fixture(scope="session")
def networks(paths):
    from atlas_ingest.network import load_network

    return {sid: load_network(p, sid) for sid, p in paths["networks"].items()}


@pytest.fixture(scope="session")
def crosswalk(matrix_path):
    from atlas_ingest.crosswalk import read_crosswalk

    return read_crosswalk(matrix_path)


@pytest.fixture(scope="session")
def links(systems, overrides):
    from atlas_ingest.links import extract_links, merge_links

    return merge_links(extract_links(systems), overrides)


@pytest.fixture(scope="session")
def desired(overrides):
    from atlas_ingest.links import desired_links

    return desired_links(overrides)


# --- The reference repo, for the handful of tests reserved for it ------------
@pytest.fixture(scope="session")
def reference_repo():
    """$ATLAS_SOURCE_REPO, or a skip carrying the reason CI recognises.

    Belt and braces: the reference_data marker already skips these at
    collection when the variable is unset, so reaching the skip below means
    somebody asked for reference data without the marker that gets it counted.
    """
    if SOURCE_REPO is None:
        pytest.skip(RESERVED_SKIP_REASON)
    if not SOURCE_REPO.is_dir():
        raise AssertionError(
            f"ATLAS_SOURCE_REPO is set to {SOURCE_REPO}, which is not a "
            f"directory. Skipping here would let a misconfigured run report "
            f"success."
        )
    return SOURCE_REPO


@pytest.fixture(scope="session")
def reference_paths(reference_repo):
    """The reference repo's five inputs, resolved under its own names.

    A missing file fails rather than skips, because a run that goes green
    having proven nothing is worse than a run that goes red.
    """
    resolved = source_paths(reference_repo)
    missing = [str(p) for p in flatten_paths(resolved) if not Path(p).exists()]
    if missing:
        raise AssertionError(
            f"ATLAS_SOURCE_REPO is set to {reference_repo} but these resolved "
            f"inputs are missing: {missing}."
        )
    return resolved


def build_bundle_from(root, out_dir):
    """Run the whole ingest over a source repo. Returns the output directory.

    Provenance is pinned to the synthetic generator's constants so the manifest
    this produces can be compared against the committed one.
    """
    from atlas_ingest import synthetic
    from atlas_ingest.bundle import emit_bundles
    from atlas_ingest.crosswalk import read_crosswalk
    from atlas_ingest.curation import (
        load_glossary, load_overrides, load_system_device_map,
    )
    from atlas_ingest.excel import read_excel
    from atlas_ingest.links import desired_links, extract_links, merge_links
    from atlas_ingest.network import load_network

    resolved = source_paths(root)
    parsed = read_excel(resolved["matrix"])
    curation = load_overrides(resolved["overrides"])

    emit_bundles(
        out_dir=out_dir,
        systems=parsed,
        links=merge_links(extract_links(parsed), curation),
        desired=desired_links(curation),
        crosswalk=read_crosswalk(resolved["matrix"]),
        glossary=load_glossary(resolved["glossary"]),
        sdmap=load_system_device_map(resolved["sdmap"]),
        networks={
            sid: load_network(p, sid) for sid, p in resolved["networks"].items()
        },
        source_label=synthetic.SOURCE_LABEL,
        baseline_date=synthetic.BASELINE_DATE,
        built_at=synthetic.BUILT_AT,
        git_sha=synthetic.GIT_SHA,
    )
    return Path(out_dir)


def golden(name):
    """Load a captured expected-output fixture.

    A missing fixture raises rather than skips. It used to skip, which is the
    same failure mode this file exists to remove: the fixtures are committed
    and regenerated by `python -m atlas_ingest.synthetic`, so an absent one is
    a broken checkout, and quietly not comparing against it would report a pass
    for a comparison that never happened.
    """
    path = GOLDEN / name
    if not path.exists():
        raise AssertionError(
            f"golden fixture {path} is missing. Regenerate the fixtures with "
            f"`python -m atlas_ingest.synthetic`; skipping here would let the "
            f"comparison silently not happen."
        )
    return json.loads(path.read_text(encoding="utf-8"))


# --- Saying out loud what this run did not check ----------------------------
_RESERVED_WHY = (
    "They assert facts about the reference repo itself, so no fabricated tree "
    "can stand in for it. Running them needs ATLAS_SOURCE_REPO pointing at "
    "that repo. A GitHub runner has no reference data and must never be given "
    "any, so CI cannot ever run these and this run has NOT checked what they "
    "claim."
)

_SAMPLE_NOTE = (
    "Every other test in this suite ran against the generated sample "
    "workbook, which is fabricated and carries no controlled content."
)


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        f"{REFERENCE_MARK}: asserts a fact about the reference repo itself; "
        f"runs only where ATLAS_SOURCE_REPO names that repo",
    )


def pytest_collection_modifyitems(config, items):
    reserved = [i for i in items if i.get_closest_marker(REFERENCE_MARK)]
    config.stash[_RESERVED_KEY] = [i.nodeid for i in reserved]
    if SOURCE_REPO is not None:
        return
    skip = pytest.mark.skip(reason=RESERVED_SKIP_REASON)
    for item in reserved:
        item.add_marker(skip)


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    """Report the reserved tests as a count, not as a row of green dots.

    Printed on every run, in both modes, including -q, and printed even when
    the number is zero, because "0 reserved" is itself the fact worth stating.
    The ATLAS_RESERVED= line is the one CI greps, so a change to this wording
    cannot quietly change what CI is asserting.
    """
    reserved = config.stash.get(_RESERVED_KEY, [])
    write = terminalreporter.write_line
    terminalreporter.write_sep("=", "reference-data coverage", bold=True)

    if SOURCE_REPO is not None:
        write(f"ATLAS_RESERVED={len(reserved)} ran=yes source={SOURCE_REPO}")
        write(
            f"{len(reserved)} reference-data tests RAN against {SOURCE_REPO}. "
            f"They check that its layout and its workbook still have the shape "
            f"this ingest reads."
        )
        for nodeid in reserved:
            write(f"  ran: {nodeid}")
        write(_SAMPLE_NOTE)
        return

    write(f"ATLAS_RESERVED={len(reserved)} ran=no source=none")
    if not reserved:
        write(
            "0 tests are reserved for the reference data: every test in this "
            "selection ran against the generated sample workbook."
        )
        return

    write(
        f"{len(reserved)} of {terminalreporter._numcollected} tests did NOT "
        f"run: they are reserved for a machine with the reference data."
    )
    for line in _RESERVED_WHY.split(". "):
        write(f"  {line.strip().rstrip('.')}.")
    for nodeid in reserved:
        write(f"  reserved: {nodeid}")
    write(_SAMPLE_NOTE)
