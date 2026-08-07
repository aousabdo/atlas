import json

import pytest

from atlas_ingest.bundle import BUNDLE_VERSION, emit_bundles

from conftest import (
    GLOSSARY_JSON, MATRIX_XLSX, NETWORK_JSON, SYSTEM_DEVICE_MAP_JSON, _require,
)


def _emit(target, systems, overrides):
    from atlas_ingest.crosswalk import read_crosswalk
    from atlas_ingest.curation import load_glossary, load_system_device_map
    from atlas_ingest.links import desired_links, extract_links, merge_links
    from atlas_ingest.network import load_network

    return emit_bundles(
        out_dir=target,
        systems=systems,
        links=merge_links(extract_links(systems), overrides),
        desired=desired_links(overrides),
        crosswalk=read_crosswalk(_require(MATRIX_XLSX)),
        glossary=load_glossary(_require(GLOSSARY_JSON)),
        sdmap=load_system_device_map(_require(SYSTEM_DEVICE_MAP_JSON)),
        networks={sid: load_network(_require(p), sid) for sid, p in NETWORK_JSON.items()},
        source_label="Traceability Matrix 5 MAR 2026 (enhanced)",
        baseline_date="2026-03-05",
        built_at="2026-08-05T12:00:00",
        git_sha="testsha",
    )


@pytest.fixture(scope="module")
def out(tmp_path_factory, systems, overrides):
    target = tmp_path_factory.mktemp("data")
    _emit(target, systems, overrides)
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


def test_manifest_counts_are_the_golden_numbers(out):
    counts = _read(out, "manifest.json")["counts"]
    assert counts == {
        "systems": 32, "confirmed": 23, "unconfirmed": 9,
        "links": 14, "desired_links": 13, "requirements": 11,
        "acronyms": 48, "sites": 2, "devices": 79,
    }


def test_manifest_indexes_the_snapshots(out):
    """A static host cannot be globbed, so this index is the only way the app
    can discover which snapshots exist."""
    assert _read(out, "manifest.json")["snapshots"] == ["2026-08-05"]


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


def test_systems_expose_confirmed_rather_than_soft(out):
    """'soft' is the old internal spelling. The app reads confirmed, which is
    the way a human states it."""
    systems = _read(out, "systems.json")
    assert sum(1 for s in systems if s["confirmed"]) == 23
    assert all("soft" not in s for s in systems)


def test_a_snapshot_is_written_for_this_build(out):
    snaps = list((out / "snapshots").glob("*.json"))
    assert len(snaps) == 1
    snap = json.loads(snaps[0].read_text(encoding="utf-8"))
    assert len(snap["dimensions"]) == 7
    assert snap["built_at"] == "2026-08-05T12:00:00"


def test_snapshots_omit_the_detail_blocks(out):
    """Trend history only needs the figures. Carrying every detail block would
    grow the committed history by the size of the dataset every build."""
    snap = json.loads((out / "snapshots" / "2026-08-05.json").read_text(encoding="utf-8"))
    for d in snap["dimensions"]:
        assert "detail" not in d


def test_site_bundle_shape(out):
    ngate = _read(out, "sites/northgate.json")
    assert len(ngate["devices"]) == 71
    assert len(ngate["edges"]) == 86
    assert len(ngate["zones"]) == 14
    assert ngate["meta"]["classification"] == "UNCLASSIFIED//SAMPLE"


def test_project_lists_both_sites_with_their_marking(out):
    project = _read(out, "project.json")
    assert [s["id"] for s in project["sites"]] == ["northgate", "westfield"]
    assert all(s["classification"] == "UNCLASSIFIED//SAMPLE" for s in project["sites"])
    assert project["default_site"] == "northgate"


def test_methodology_reflects_the_real_constants(out):
    """Docs generated from the code cannot drift from it."""
    from atlas_ingest import config

    meth = _read(out, "methodology.json")
    assert meth["owner_rules_count"] == len(config.OWNER_RULES)
    assert meth["high_keywords"] == list(config.HIGH_KEYWORDS)
    assert meth["always_soft"] == sorted(config.ALWAYS_SOFT)
    assert len(meth["owner_rules"]) == 23
    assert meth["owner_rules"][0]["priority"] == 0
    assert any(r["match_mode"] == "word_boundary" for r in meth["owner_rules"])


def test_lossiness_bundle_carries_dimensions_and_top_gaps(out):
    loss = _read(out, "lossiness.json")
    assert len(loss["dimensions"]) == 7
    assert loss["top_gaps"]
    assert all("detail" in d for d in loss["dimensions"])


def test_coverage_keeps_the_negative_facts(out):
    cov = _read(out, "coverage.json")
    assert len(cov["sites"]["northgate"]["not_deployed_at_site"]) == 20
    assert len(cov["pending_review"]) == 7


def test_bundles_are_deterministic(out, tmp_path, systems, overrides):
    """Two runs on the same inputs must produce byte-identical files, or every
    rebuild churns the git diff and real changes get lost in the noise."""
    second = tmp_path / "again"
    _emit(second, systems, overrides)
    for name in ["systems.json", "links.json", "lossiness.json", "manifest.json",
                 "coverage.json", "project.json", "methodology.json"]:
        assert (out / name).read_bytes() == (second / name).read_bytes(), name


def test_generated_typescript_tables_match_config(tmp_path):
    """LocalFileProvider classifies in the browser from these tables. A
    hand-edited copy would drift from the Python within a release."""
    from atlas_ingest.bundle import emit_classifier_module

    path = emit_classifier_module(tmp_path / "classifierTables.ts")
    text = path.read_text(encoding="utf-8")
    assert "export const OWNER_RULES" in text
    assert "Do not edit" in text
    # Real newlines survive into the TS as escaped \n inside JSON strings.
    assert '"Systems\\nInventory"' in text
