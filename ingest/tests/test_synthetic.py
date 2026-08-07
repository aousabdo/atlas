"""The sample bundle is load-bearing, so the generator gets its own gates.

Three things are checked here that nothing else can check: that the generator
is deterministic, that the committed bundle under fixtures/synthetic is what
the generator currently produces rather than something hand-edited, and that
the cross-file references inside the bundle all resolve. A bundle that fails
any of those breaks the app, 354 frontend tests and the visual suite at once.
"""
import json
import sys
from pathlib import Path

import pytest

from atlas_ingest import synthetic
from atlas_ingest.crosswalk import read_crosswalk

REPO = Path(__file__).resolve().parents[2]
COMMITTED = REPO / "fixtures" / "synthetic"
GOLDEN = Path(__file__).parent / "fixtures" / "golden"

sys.path.insert(0, str(Path(__file__).parent / "fixtures"))


def read(directory, name):
    return json.loads((Path(directory) / name).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def generated(tmp_path_factory):
    out = tmp_path_factory.mktemp("bundle")
    synthetic.emit(out)
    return out


@pytest.fixture(scope="module")
def systems():
    return read(COMMITTED, "systems.json")


@pytest.fixture(scope="module")
def coverage():
    return read(COMMITTED, "coverage.json")


@pytest.fixture(scope="module")
def topologies():
    return {
        site: read(COMMITTED, f"sites/{site}.json")
        for site in (synthetic.SITE_A, synthetic.SITE_B)
    }


# --- the generator itself ---------------------------------------------------

def test_two_runs_produce_identical_bytes(tmp_path):
    """No clock, no randomness. If this fails, every rebuild churns the diff
    and a real data change hides in the noise."""
    first, second = tmp_path / "a", tmp_path / "b"
    synthetic.emit(first)
    synthetic.emit(second)
    for path in sorted(first.rglob("*.json")):
        assert path.read_bytes() == (second / path.relative_to(first)).read_bytes()


def test_the_committed_bundle_is_what_the_generator_emits(generated):
    """Guards against someone patching fixtures/synthetic by hand. A hand edit
    survives until the next regeneration and then silently disappears."""
    emitted = sorted(p.relative_to(generated) for p in generated.rglob("*.json"))
    committed = sorted(p.relative_to(COMMITTED) for p in COMMITTED.rglob("*.json"))
    assert emitted == committed
    for relative in emitted:
        assert (COMMITTED / relative).read_text(encoding="utf-8") == (
            generated / relative
        ).read_text(encoding="utf-8"), f"{relative} is not what the generator emits"


def test_the_golden_fixtures_are_what_the_generator_emits(tmp_path):
    synthetic.emit_golden(tmp_path)
    for name in ("systems.json", "auto_links.json", "crosswalk.json", "counts.json"):
        assert (GOLDEN / name).read_text(encoding="utf-8") == (
            tmp_path / name
        ).read_text(encoding="utf-8"), f"golden/{name} is stale"


# --- shape and counts -------------------------------------------------------

def test_systems_counts(systems):
    assert len(systems) == 32
    assert len({s["id"] for s in systems}) == 32
    assert sum(1 for s in systems if s["confirmed"]) == 23
    assert sum(1 for s in systems if not s["confirmed"]) == 9


def test_risk_distribution(systems):
    counts = {r: sum(1 for s in systems if s["risk"] == r)
              for r in ("high", "medium", "low")}
    assert counts == {"high": 11, "medium": 19, "low": 2}


def test_owner_groups_are_exactly_the_six(systems):
    assert {s["owner_group"] for s in systems} == {
        "DHS S&T", "CBP", "Other DHS", "DHS HQ/OCIO", "DoD", "External",
    }


def test_no_system_name_is_truncated(systems):
    """The tool being replaced elided names to 24 characters with a '..'
    suffix and let the truncated form leak into its analytics payload."""
    for s in systems:
        assert not s["name"].endswith("..")


def test_link_counts_and_extraction_methods():
    links = read(COMMITTED, "links.json")
    assert len(links["current"]) == 14
    assert len(links["desired"]) == 13
    methods = {link["extraction_method"] for link in links["current"]}
    assert methods == {"prose", "override"}


def test_every_link_endpoint_is_a_system(systems):
    ids = {s["id"] for s in systems}
    links = read(COMMITTED, "links.json")
    for link in links["current"] + links["desired"]:
        assert link["from"] in ids, link
        assert link["to"] in ids, link


def test_crosswalk_counts_and_dropped_rows():
    rows = read(COMMITTED, "crosswalk.json")
    assert len(rows) == 11
    dropped = [r for r in rows if r["status"] == "Didn't keep"]
    assert len(dropped) == 2
    for row in dropped:
        assert row["current"] == []


def test_every_crosswalk_current_system_exists(systems):
    """A name that matches nothing draws a sankey node for a system that is not
    in the matrix, which reads as a system nobody can find."""
    names = {s["name"] for s in systems}
    for row in read(COMMITTED, "crosswalk.json"):
        for current in row["current"]:
            assert current in names, current


def test_glossary_shape():
    glossary = read(COMMITTED, "glossary.json")
    assert len(glossary["acronyms"]) == 48
    assert glossary["confidence_intro"]
    assert len(glossary["out_of_scope"]) == 5
    assert set(glossary["methodology_extras"]) == {
        "risk_caveat", "mapping_confidence_scale", "soft_ownership_note",
    }
    for entry in glossary["acronyms"]:
        assert set(entry) == {"acr", "meaning"}
        assert entry["acr"] and entry["meaning"]


def test_the_glossary_carries_no_reviewer_and_no_person():
    """The curated file named an individual in a pending-review field and in
    three acronym meanings. A sample bundle names nobody."""
    glossary = read(COMMITTED, "glossary.json")
    assert "_reviewer_pending" not in glossary
    blob = json.dumps(glossary).lower()
    assert "confirm with" not in blob
    assert "confirm scope with" not in blob


def test_methodology_reflects_the_classifier_tables():
    methodology = read(COMMITTED, "methodology.json")
    assert methodology["owner_rules_count"] == 23
    assert len(methodology["owner_rules"]) == 23
    assert len(methodology["high_keywords"]) == 19
    assert len(methodology["medium_keywords"]) == 9
    assert len(methodology["low_keywords"]) == 3
    assert len(methodology["soft_groups"]) == 2
    assert len(methodology["soft_keywords"]) == 2
    assert len(methodology["never_soft"]) == 1
    assert len(methodology["category_map"]) == 8
    assert "beacon" in methodology["always_soft"]


def test_exactly_one_short_owner_rule_is_a_word_boundary_match():
    """A substring match on a three-letter agency abbreviation corrupts
    unrelated words, which is why the rule exists at all."""
    rules = read(COMMITTED, "methodology.json")["owner_rules"]
    ice = next(r for r in rules if r["match"] == "ICE")
    assert ice["match_mode"] == "word_boundary"


def test_coverage_counts(coverage):
    assert sorted(coverage["sites"]) == [synthetic.SITE_A, synthetic.SITE_B]
    assert len(coverage["pending_review"]) == 7
    site = coverage["sites"][synthetic.SITE_A]
    assert len(site["not_deployed_at_site"]) == 20
    assert len(site["mappings"]) == 13
    with_devices = [m for m in site["mappings"].values() if m["devices"]]
    without = [m for m in site["mappings"].values() if not m["devices"]]
    assert len(with_devices) == 11
    assert len(without) == 2
    outside = [m for m in site["mappings"].values()
               if m.get("matrix_id_exists") is False]
    assert len(outside) == 1


def test_coverage_confidence_counts_exclude_software_only_mappings(coverage):
    assert coverage["confidence_counts"] == {
        "high": 6, "medium": 3, "low": 2, "unspecified": 0, "total": 11,
    }


def test_coverage_only_names_devices_that_exist(coverage, topologies):
    for site_id, site in coverage["sites"].items():
        ids = {d["id"] for d in topologies[site_id]["devices"]}
        for system_id, mapping in site["mappings"].items():
            for device in mapping["devices"]:
                assert device in ids, f"{site_id}.{system_id} -> {device}"
        for device in site["unclaimed_devices"]["infrastructure"]:
            assert device in ids, device


def test_checked_absent_systems_are_matrix_systems(coverage, systems):
    ids = {s["id"] for s in systems}
    for site in coverage["sites"].values():
        for system_id in site["not_deployed_at_site"]:
            assert system_id in ids, system_id


def test_lossiness_dimensions_in_order():
    report = read(COMMITTED, "lossiness.json")
    assert [d["key"] for d in report["dimensions"]] == [
        "requirement_attrition", "ownership_ambiguity", "realization_gap",
        "integration_gap", "evidence_gap", "orphaned_hardware", "open_questions",
    ]


def test_every_dimension_carries_evidence_and_a_severity():
    for dimension in read(COMMITTED, "lossiness.json")["dimensions"]:
        assert isinstance(dimension["detail"], dict)
        assert dimension["detail"], f"{dimension['key']} detail is empty"
        assert dimension["severity"] in {"ok", "watch", "critical"}


@pytest.mark.parametrize("key,numerator,denominator", [
    ("requirement_attrition", 9, 11),
    ("ownership_ambiguity", 23, 32),
    ("realization_gap", 10, 32),
    ("orphaned_hardware", 59, 79),
])
def test_headline_lossiness_figures(key, numerator, denominator):
    dimension = next(d for d in read(COMMITTED, "lossiness.json")["dimensions"]
                     if d["key"] == key)
    assert (dimension["numerator"], dimension["denominator"]) == (numerator, denominator)


def test_top_gaps_are_ranked_descending():
    gaps = read(COMMITTED, "lossiness.json")["top_gaps"]
    assert gaps
    assert [g["score"] for g in gaps] == sorted(
        (g["score"] for g in gaps), reverse=True)


def test_lossiness_device_rosters_match_the_unclaimed_lists(coverage):
    orphaned = next(d for d in read(COMMITTED, "lossiness.json")["dimensions"]
                    if d["key"] == "orphaned_hardware")
    for site_id, devices in orphaned["detail"]["device_ids"].items():
        assert devices == coverage["sites"][site_id]["unclaimed_devices"][
            "infrastructure"]


@pytest.mark.parametrize("site,devices,edges,zones", [
    (synthetic.SITE_A, 71, 86, 14),
    (synthetic.SITE_B, 8, 8, 2),
])
def test_topology_sizes(topologies, site, devices, edges, zones):
    topology = topologies[site]
    assert len(topology["devices"]) == devices
    assert len(topology["edges"]) == edges
    assert len(topology["zones"]) == zones
    assert topology["meta"]["classification"] == synthetic.CLASSIFICATION


def test_every_device_is_in_a_declared_zone(topologies):
    for site_id, topology in topologies.items():
        zones = set(topology["zones"])
        for device in topology["devices"]:
            assert device["zone"] in zones, f"{site_id}.{device['id']}"


def test_every_edge_attaches_to_a_real_device(topologies):
    for site_id, topology in topologies.items():
        ids = {d["id"] for d in topology["devices"]}
        for edge in topology["edges"]:
            assert edge["source"] in ids, f"{site_id}: {edge}"
            assert edge["target"] in ids, f"{site_id}: {edge}"


def test_project_counts_equal_the_topologies(topologies):
    project = read(COMMITTED, "project.json")
    assert project["default_site"] == synthetic.SITE_A
    assert [s["id"] for s in project["sites"]] == [synthetic.SITE_A, synthetic.SITE_B]
    for site in project["sites"]:
        topology = topologies[site["id"]]
        assert site["device_count"] == len(topology["devices"])
        assert site["edge_count"] == len(topology["edges"])


def test_manifest_provenance_is_fabricated_and_well_formed():
    import re

    manifest = read(COMMITTED, "manifest.json")
    assert re.match(r"^\d{4}-\d{2}-\d{2}T", manifest["built_at"])
    assert manifest["source_label"] == "Sample Traceability Matrix"
    assert manifest["bundle_version"] >= 1
    assert manifest["counts"] == {
        "systems": 32, "confirmed": 23, "unconfirmed": 9, "links": 14,
        "desired_links": 13, "requirements": 11, "acronyms": 48, "sites": 2,
        "devices": 79,
    }


def test_the_snapshot_is_not_a_copy_of_the_live_report():
    """One snapshot is not a trend, but it is the baseline the next build is
    compared against, so it has to be a distinct measurement."""
    snapshot = read(COMMITTED, f"snapshots/{synthetic.SNAPSHOT_LABEL}.json")
    assert len(snapshot["dimensions"]) == 7
    recorded = next(d for d in snapshot["dimensions"]
                    if d["key"] == "requirement_attrition")
    assert (recorded["numerator"], recorded["denominator"]) == (10, 11)
    live = next(d for d in read(COMMITTED, "lossiness.json")["dimensions"]
                if d["key"] == "requirement_attrition")
    assert recorded["numerator"] != live["numerator"]


def test_the_snapshot_is_indexed_by_the_manifest():
    """A static host cannot be globbed, so an unindexed snapshot is invisible."""
    manifest = read(COMMITTED, "manifest.json")
    assert manifest["snapshots"] == [synthetic.SNAPSHOT_LABEL]


# --- the sample workbook ----------------------------------------------------

def test_the_sample_workbook_is_not_committed():
    """*.xlsx is gitignored: a tracked spreadsheet is the shape of the mistake
    this bundle exists to undo. It is regenerated into a tmp dir instead."""
    assert not list(Path(__file__).parent.rglob("*.xlsx"))


@pytest.fixture(scope="module")
def sample_workbook(tmp_path_factory):
    from make_sample_workbook import write_sample_workbook

    return write_sample_workbook(tmp_path_factory.mktemp("workbook") / "matrix.xlsx")


def test_the_workbook_carries_the_sheets_the_ingest_looks_for(sample_workbook):
    import openpyxl

    wb = openpyxl.load_workbook(sample_workbook, data_only=True)
    try:
        assert "Matrix" in wb.sheetnames
        assert any("crosswalk" in name.lower() for name in wb.sheetnames)
    finally:
        wb.close()


def test_the_workbook_has_32_data_rows_under_a_scanned_header(sample_workbook):
    import openpyxl

    wb = openpyxl.load_workbook(sample_workbook, data_only=True)
    try:
        ws = wb["Matrix"]
        header = next(
            r for r in range(1, 11)
            if any(c.value and "Project/System" in str(c.value) for c in ws[r])
        )
        # Not row 1: a title and a hand-written summary sit above it, and the
        # reader scans rather than assuming an offset.
        assert header > 1
        column = next(c.column for c in ws[header]
                      if c.value and "Project/System" in str(c.value))
        names = [ws.cell(row=r, column=column).value
                 for r in range(header + 1, ws.max_row + 1)]
        assert len([n for n in names if n]) == 32
    finally:
        wb.close()


def test_the_workbook_summary_block_agrees_with_the_rows(sample_workbook):
    """The reader cross-checks this block against what it parsed, so a workbook
    whose summary disagrees has to be caught here, not there."""
    import openpyxl

    wb = openpyxl.load_workbook(sample_workbook, data_only=True)
    try:
        ws = wb["Matrix"]
        summary = {
            str(ws.cell(row=3, column=c).value).strip(): ws.cell(row=4, column=c).value
            for c in range(2, 12)
            if ws.cell(row=3, column=c).value
        }
    finally:
        wb.close()
    assert summary["Total Systems"] == 32
    assert summary["Confirmed"] == 23
    assert summary["Unconfirmed"] == 9
    assert summary["High Risk"] == 11
    assert summary["Med Risk"] == 19
    assert summary["Low Risk"] == 2


def test_the_workbook_crosswalk_parses_to_the_committed_rows(sample_workbook):
    """The one end-to-end check that does not depend on the classifier tables:
    the crosswalk reader run over the fabricated workbook must reproduce
    crosswalk.json exactly."""
    assert read_crosswalk(sample_workbook) == read(COMMITTED, "crosswalk.json")
