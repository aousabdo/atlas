import json

import pytest

from atlas_ingest.curation import (
    load_glossary, load_overrides, load_system_device_map, mapping_confidence_counts,
)

from conftest import GLOSSARY_JSON, OVERRIDES_JSON, SYSTEM_DEVICE_MAP_JSON, _require


@pytest.fixture(scope="module")
def gloss():
    return load_glossary(_require(GLOSSARY_JSON))


@pytest.fixture(scope="module")
def sdmap():
    return load_system_device_map(_require(SYSTEM_DEVICE_MAP_JSON))


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
    ov = load_overrides(_require(OVERRIDES_JSON))
    assert len(ov["cross_links"]) == 2
    assert len(ov["suppress_links"]) == 4
    assert len(ov["desired_links"]) == 13
    assert ov["risk_overrides"] == {}
    assert ov["soft_overrides"] == {}
    assert list(ov["node_order"]) == ["dhshq"]


def test_suppress_links_are_pairs():
    ov = load_overrides(_require(OVERRIDES_JSON))
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
    ngate = sdmap["sites"]["northgate"]
    assert len(ngate["mappings"]) == 13
    assert len(ngate["not_deployed_at_site"]) == 20
    assert len(ngate["unclaimed_devices"]["infrastructure"]) == 51


def test_westfield_has_no_mappings_yet(sdmap):
    sp = sdmap["sites"]["westfield"]
    assert sp["mappings"] == {}
    assert len(sp["unclaimed_devices"]["infrastructure"]) == 8


def test_pending_review_has_seven_open_questions(sdmap):
    assert len(sdmap["pending_review"]) == 7


def test_two_northgate_mappings_are_software_only(sdmap):
    """homing and kite are ATAK plugins: real curation records, but they name no
    hardware. They must not count toward device coverage."""
    ngate = sdmap["sites"]["northgate"]["mappings"]
    assert sorted(k for k, v in ngate.items() if not v.get("devices")) == ["homing", "kite"]


def test_confidence_counts_grade_only_the_realized_mappings(sdmap):
    """Verified against the real file on 2026-08-05: 13 mappings, of which 11
    name at least one device. The two excluded for naming none (homing, kite)
    are themselves graded high, so counting all 13 would report 8 high.

    One of the remaining 11, 'atak', is graded high but declares
    matrix_id_exists: false, so it documents hardware the matrix carries no
    system for. It was counted here until the tabs were reconciled, which is
    why the Reference tab said 11 while Analytics and the realization gap said
    10. The arithmetic below is that correction and nothing else: 11 device
    bearing mappings minus the one outside the matrix, and 6 high minus that
    same one.
    """
    site = sdmap["sites"]["northgate"]["mappings"]
    with_devices = [e for e in site.values() if e.get("devices")]
    outside = [e for e in with_devices if e.get("matrix_id_exists") is False]
    assert len(with_devices) == 11
    assert [e["confidence"] for e in outside] == ["high"]

    assert mapping_confidence_counts(sdmap) == {
        "high": 5, "medium": 3, "low": 2, "unspecified": 0, "total": 10,
    }


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
