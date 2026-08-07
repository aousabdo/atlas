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
