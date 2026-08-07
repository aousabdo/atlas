"""classify_risk is untested by the golden matrix, which fills Risk Level on
every row. These synthetic cases are the only coverage the heuristic has.
"""
import pytest

from atlas_ingest.classify import classify_risk


def test_empty_text_defaults_to_medium():
    assert classify_risk("") == "medium"
    assert classify_risk(None) == "medium"


@pytest.mark.parametrize("text", [
    "Single point of failure at the relay",
    "No documented owner for this interface",
    "Unverified interface to the effector",
    "Undocumented dependency on the site link",
    "No rollback path once the cutover starts",
])
def test_high_keywords_win(text):
    assert classify_risk(text) == "high"


@pytest.mark.parametrize("text", [
    "Cosmetic label mismatch in the console",
    "Minor documentation lag behind the build",
    "Duplicate catalogue entry for this sensor",
])
def test_low_keywords(text):
    assert classify_risk(text) == "low"


@pytest.mark.parametrize("text", [
    "Scope undefined for the transition",
    "Coverage unclear at the second site",
    "Interface unspecified for this hop",
    "Awaiting validation from the owner",
])
def test_medium_keywords(text):
    assert classify_risk(text) == "medium"


def test_high_beats_low_when_both_appear():
    """Precedence is high, then low, then medium. A string carrying both must
    resolve high."""
    assert classify_risk(
        "Cosmetic label mismatch and a single point of failure") == "high"


def test_low_beats_medium_when_both_appear():
    assert classify_risk("Minor documentation lag, coverage unclear") == "low"


def test_matching_is_case_insensitive():
    assert classify_risk("SINGLE POINT OF FAILURE AT THE RELAY") == "high"


def test_unrecognised_text_defaults_to_medium():
    assert classify_risk("Everything is entirely fine here") == "medium"
