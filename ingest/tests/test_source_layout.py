"""Resolving a source repo's five inputs under whatever names it gives them.

This file exists because of a measured failure. Every fixture in conftest used
to resolve `traceability/mindmap/matrix.xlsx`, `northgate/northgate_network.json`
and `westfield/westfield_network.json` - the GENERATED sample's names - out of
whatever tree $ATLAS_SOURCE_REPO pointed at. Setting the variable to a real
checkout therefore turned 99 tests into errors, because a real checkout names
its workbook for the baseline it was cut from and its site directories for its
sites. The mode was offered, documented, and could not work.

The tests below run everywhere. They build fabricated trees whose names have
nothing in common with the sample's, and assert the resolver finds the inputs
anyway - by layout for the curation files, by directory and by shape for the
workbook and the topologies. Every one of them fails against a resolver that
hardcodes a filename.

Two tests at the bottom are reserved for a machine with the reference data.
They are the only honest question reference data can answer for this repo:
does the upstream tree still have the SHAPE this ingest reads? It cannot
answer whether the ingest reproduces that tree's own analysis, because
atlas_ingest.config deliberately carries a fabricated vocabulary in place of
the real one.
"""
import json
from pathlib import Path

import pytest

from conftest import (
    SourceLayoutError, declared_site_ids, find_site_topologies, find_workbook,
    flatten_paths, source_paths,
)

# Names chosen to share nothing with the generated sample's names, so a
# resolver that still hardcodes those cannot pass by coincidence.
WORKBOOK = "baseline_workbook_2027.xlsx"
SITES = ("siteone", "sitetwo", "sitethree")


def _json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _topology():
    return {"graph": {}, "zones": {"z": {"label": "Z"}},
            "nodes": [{"id": "d1", "label": "D1", "zone": "z", "type": "server",
                       "ip": None, "subnet": None, "description": None}],
            "edges": []}


def _tree(root, *, workbook=WORKBOOK, sites=SITES, topology_name="full_export.json"):
    """A source-repo-shaped tree with deliberately unfamiliar names."""
    root = Path(root)
    mindmap = root / "traceability" / "mindmap"
    mindmap.mkdir(parents=True, exist_ok=True)
    if workbook:
        (mindmap / workbook).write_bytes(b"not a real workbook")
    _json(mindmap / "overrides.json", {})
    _json(mindmap / "glossary.json", {})
    _json(mindmap / "system_device_map.json",
          {"sites": {s: {"mappings": {}} for s in sites}})
    for site in sites:
        _json(root / site / topology_name, _topology())
    return root


# --- the workbook ------------------------------------------------------------
def test_the_workbook_is_found_under_whatever_name_it_carries(tmp_path):
    """The one assertion the old resolver could not make. It looked for
    matrix.xlsx, which is the generated sample's name and nobody else's."""
    root = _tree(tmp_path)
    assert find_workbook(root / "traceability" / "mindmap").name == WORKBOOK


def test_an_open_workbook_is_not_mistaken_for_the_workbook(tmp_path):
    """Excel drops a ~$-prefixed lock file beside a workbook somebody has open.
    Counting it makes the resolver ambiguous exactly while the matrix is being
    edited, which is when the suite most needs to run."""
    root = _tree(tmp_path)
    mindmap = root / "traceability" / "mindmap"
    (mindmap / f"~${WORKBOOK}").write_bytes(b"lock")
    assert find_workbook(mindmap).name == WORKBOOK


def test_a_mindmap_with_no_workbook_names_the_directory_it_searched(tmp_path):
    root = _tree(tmp_path, workbook=None)
    with pytest.raises(SourceLayoutError, match="no .xlsx"):
        find_workbook(root / "traceability" / "mindmap")


def test_two_workbooks_is_an_error_rather_than_a_guess(tmp_path):
    """Taking the first alphabetically would read whichever baseline sorts
    first and report a pass for it."""
    root = _tree(tmp_path)
    mindmap = root / "traceability" / "mindmap"
    (mindmap / "another_workbook_2028.xlsx").write_bytes(b"also not real")
    with pytest.raises(SourceLayoutError, match="2 workbooks"):
        find_workbook(mindmap)


def test_a_tree_with_no_mindmap_directory_is_not_a_source_repo(tmp_path):
    with pytest.raises(SourceLayoutError, match="not a directory"):
        find_workbook(tmp_path / "traceability" / "mindmap")


# --- the sites ---------------------------------------------------------------
def test_site_ids_come_from_the_overlay_rather_than_a_hardcoded_pair(tmp_path):
    """Three sites, none of them named like the sample's two. A resolver
    carrying a literal pair of site ids resolves two paths that do not exist
    and reports every network fixture as an error."""
    root = _tree(tmp_path)
    sdmap = root / "traceability" / "mindmap" / "system_device_map.json"
    assert declared_site_ids(sdmap) == list(SITES)
    assert set(find_site_topologies(root, sdmap)) == set(SITES)


def test_a_topology_is_found_by_shape_not_by_filename(tmp_path):
    """The sample writes <site>/<site>_network.json. Nothing obliges a real
    checkout to, and the ones this repo reads do not, so the file is
    identified by carrying 'nodes' and 'edges'."""
    root = _tree(tmp_path, topology_name="exported_graph_v3.json")
    sdmap = root / "traceability" / "mindmap" / "system_device_map.json"
    found = find_site_topologies(root, sdmap)
    assert {p.name for p in found.values()} == {"exported_graph_v3.json"}


def test_a_json_beside_the_topology_that_is_not_one_is_ignored(tmp_path):
    """Site directories carry other JSON. Only a file with both 'nodes' and
    'edges' is a topology, so a settings file next door is not ambiguity."""
    root = _tree(tmp_path)
    _json(root / SITES[0] / "render_settings.json", {"zoom": 1})
    sdmap = root / "traceability" / "mindmap" / "system_device_map.json"
    assert find_site_topologies(root, sdmap)[SITES[0]].name == "full_export.json"


def test_a_declared_site_with_no_directory_is_an_error(tmp_path):
    root = _tree(tmp_path)
    sdmap = root / "traceability" / "mindmap" / "system_device_map.json"
    _json(sdmap, {"sites": {s: {} for s in list(SITES) + ["siteghost"]}})
    with pytest.raises(SourceLayoutError, match="siteghost"):
        find_site_topologies(root, sdmap)


def test_a_declared_site_with_no_topology_is_an_error(tmp_path):
    root = _tree(tmp_path)
    (root / SITES[0] / "full_export.json").unlink()
    sdmap = root / "traceability" / "mindmap" / "system_device_map.json"
    with pytest.raises(SourceLayoutError, match="no topology export"):
        find_site_topologies(root, sdmap)


def test_two_topologies_in_one_site_directory_is_an_error(tmp_path):
    """Choosing one would silently choose which devices that site has."""
    root = _tree(tmp_path)
    _json(root / SITES[0] / "older_export.json", _topology())
    sdmap = root / "traceability" / "mindmap" / "system_device_map.json"
    with pytest.raises(SourceLayoutError, match="2 topology exports"):
        find_site_topologies(root, sdmap)


def test_an_overlay_declaring_no_sites_is_an_error(tmp_path):
    """Falling back to a default site id would invent coverage the curation
    overlay does not claim."""
    root = _tree(tmp_path)
    sdmap = root / "traceability" / "mindmap" / "system_device_map.json"
    _json(sdmap, {"sites": {}})
    with pytest.raises(SourceLayoutError, match="declares no sites"):
        declared_site_ids(sdmap)


def test_a_missing_overlay_is_an_error(tmp_path):
    with pytest.raises(SourceLayoutError, match="is missing"):
        declared_site_ids(tmp_path / "system_device_map.json")


# --- the whole resolution ----------------------------------------------------
def test_the_five_inputs_resolve_out_of_an_unfamiliar_tree(tmp_path):
    resolved = source_paths(_tree(tmp_path))
    assert set(resolved) == {"matrix", "overrides", "glossary", "sdmap", "networks"}
    assert resolved["matrix"].name == WORKBOOK
    assert set(resolved["networks"]) == set(SITES)
    assert all(Path(p).exists() for p in flatten_paths(resolved))


def test_the_generated_sample_resolves_through_the_same_function(sample_source_repo):
    """One resolver for both trees. Two would let the reference path rot
    unexercised, which is how it came to point at nothing."""
    resolved = source_paths(sample_source_repo)
    assert all(Path(p).exists() for p in flatten_paths(resolved))
    assert resolved["networks"], "the sample declares sites; they must resolve"


def test_the_default_inputs_are_the_sample_whatever_ATLAS_SOURCE_REPO_says(
    paths, sample_source_repo,
):
    """The regression test for the 99 errors.

    Setting $ATLAS_SOURCE_REPO used to redirect every fixture in the suite at
    the reference repo, where the numbers these tests assert - 48 acronyms, 14
    zones, 13 mappings - are not true of anything. Setting it must ADD the
    reserved tests, never move the rest. Run this file with and without the
    variable set; both must pass.
    """
    sample = Path(sample_source_repo).resolve()
    for path in flatten_paths(paths):
        assert Path(path).resolve().is_relative_to(sample), (
            f"{path} is outside the generated sample tree at {sample}"
        )


# --- reserved for a machine with the reference data --------------------------
@pytest.mark.reference_data
def test_the_reference_repo_resolves_to_its_own_file_names(reference_paths):
    """The reference repo carries the five inputs, under its own names.

    This is the test that had no equivalent, which is why nobody noticed that
    the reference mode resolved to files that do not exist. It asserts the
    layout contract and nothing about the content: that a workbook is there and
    unambiguous, that the three curation files are there, and that every site
    the overlay declares has exactly one topology export.
    """
    for path in flatten_paths(reference_paths):
        assert Path(path).exists(), f"{path} does not exist"
    assert reference_paths["matrix"].suffix.lower() in (".xlsx", ".xlsm")
    assert reference_paths["networks"], "the overlay declares no sites"


@pytest.mark.reference_data
def test_the_reference_matrix_still_opens_through_this_reader(reference_paths):
    """The upstream workbook still has the sheet and the header this reader
    scans for.

    A shape check, deliberately. It does NOT check that this ingest reproduces
    the reference repo's own link mining or ids: atlas_ingest.config carries a
    fabricated ID_MAP, LABEL_MAP and LINK_NAME_FRAGMENTS in place of the real
    vocabulary, because that vocabulary is the controlled content this repo
    purged and scripts/check-no-real-data.mjs refuses to readmit. Any test
    asserting the two agree would be asserting something the repo is built to
    prevent. What this catches is upstream drift: a renamed sheet, a moved
    header row, a retitled Project/System column - each of which makes
    read_excel raise here rather than silently return nothing later.
    """
    from atlas_ingest.excel import read_excel

    systems = read_excel(reference_paths["matrix"])
    assert systems, "the Matrix sheet yielded no rows"
    for s in systems:
        assert s["id"] and s["name"]
        assert set(s) >= {"id", "name", "label", "cat", "gid", "risk", "soft"}
