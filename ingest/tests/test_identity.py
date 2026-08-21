import pytest

from atlas_ingest.identity import (
    ID_MAX_CHARS, LABEL_LINE_CHARS, make_id, make_label, strip_parenthetical,
)


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
    assert len(out) <= ID_MAX_CHARS


# --- the slug fallback, and why it fingerprints ------------------------------
#
# SLUG_CASES is mirrored case for case, expected id for expected id, in the
# TypeScript suite in src/data/__tests__/makeLabel.test.ts. The ids are written
# out as literals on both sides on purpose: the fingerprint is the one place
# the two implementations do arithmetic rather than string work, and a Python
# int wrapping at 32 bits and a JavaScript Math.imul agreeing is a claim that
# has to be checked rather than assumed.
#
# Names below are invented for this test.
SLUG_CASES = [
    # Short enough to fit: no fingerprint, exactly the old answer.
    ("Some Brand New System", "some_brand_new_system"),
    # Exactly at the budget: still no fingerprint.
    ("Harbour Point Relay Node Alpha", "harbour_point_relay_node_alpha"),
    # One character over: the fingerprint starts here.
    ("Harbour Point Relay Node Bravos", "harbour_point_relay_n_37a500b0"),
    # The prefix would end on an underscore, so it is trimmed and the id comes
    # out one character short of the budget rather than carrying a double.
    ("Sentinel Watch Relay North Field Array", "sentinel_watch_relay_705cddce"),
    # The pair that used to collide.
    (
        "Coastal Perimeter Surveillance and Tracking Alpha",
        "coastal_perimeter_sur_fa065cd1",
    ),
    (
        "Coastal Perimeter Surveillance and Tracking Bravo",
        "coastal_perimeter_sur_eef71871",
    ),
    ("A" * 60, "aaaaaaaaaaaaaaaaaaaaa_92b9e111"),
]


@pytest.mark.parametrize("name,expected", SLUG_CASES)
def test_make_id_slug_cases(name, expected):
    assert make_id(name) == expected


@pytest.mark.parametrize("name,_expected", SLUG_CASES)
def test_make_id_never_exceeds_the_budget(name, _expected):
    assert len(make_id(name)) <= ID_MAX_CHARS


def test_two_names_agreeing_in_their_first_30_slug_chars_get_different_ids():
    """The collision this rule exists to prevent.

    make_id used to end in [:30]. These two names slug identically for 30
    characters, so both came out "coastal_perimeter_surveillance" and nothing
    anywhere gated ids for uniqueness: the two rows became one id and whichever
    was read second replaced the first in every dict keyed by id. A system
    leaving the matrix with no message is the failure this pins shut.
    """
    alpha = make_id("Coastal Perimeter Surveillance and Tracking Alpha")
    bravo = make_id("Coastal Perimeter Surveillance and Tracking Bravo")
    assert alpha != bravo
    assert alpha.startswith("coastal_perimeter_sur")
    assert bravo.startswith("coastal_perimeter_sur")


def test_a_difference_in_the_last_character_alone_still_separates_them():
    """The fingerprint covers the WHOLE slug, not the part that survives.

    A fingerprint taken over the truncated prefix would have reproduced the
    original defect with extra steps.
    """
    a = make_id("Regional Airspace Coordination Centre East Wing A")
    b = make_id("Regional Airspace Coordination Centre East Wing B")
    assert a != b


def test_names_that_normalise_to_the_same_slug_still_share_an_id():
    """What is allowed to merge, stated so the fix cannot creep past it.

    Folding punctuation and stripping a parenthetical are deliberate: two
    names that normalise to the same slug are the same name as far as this
    tool is concerned. Only truncation collisions were the bug.
    """
    assert make_id("Ridge Watch (Legacy Variant)") == make_id("Ridge  Watch")


def test_make_id_slug_has_no_leading_or_trailing_underscores():
    assert make_id("  ...Weird Name!!!  ") == "weird_name"


def test_make_label_uses_the_label_map():
    assert make_label("Trackwell Sensor AI") == "Trackwell\nSensor AI"


def test_make_label_wraps_a_long_unmapped_name():
    assert make_label("Alpha Bravo Charlie Delta") == "Alpha Bravo\nCharlie Delta"


def test_make_label_leaves_short_unmapped_names_alone():
    assert make_label("Short One") == "Short One"


# --- the wrapping rule ------------------------------------------------------
#
# WRAP_CASES is mirrored case for case in the TypeScript suite, in
# src/data/__tests__/localfile.test.ts. The two implementations of this rule
# have to agree, and the sample vocabulary cannot prove it: every system in the
# sample is in LABEL_MAP, so every label comes back off the curated table and
# the wrap never runs. An analyst's own workbook is the opposite, nothing but
# unmapped names, which makes this the only place the two implementations of
# the fallback are held against each other.

WRAP_CASES = [
    ("Tiny", "Tiny"),
    ("Short One", "Short One"),
    ("Alpha Bravo Charlie Delta", "Alpha Bravo\nCharlie Delta"),
    (
        "Alpha Bravo Charlie Delta Echo Foxtrot",
        "Alpha Bravo\nCharlie Delta\nEcho Foxtrot",
    ),
    ("Quadrant Overwatch Node", "Quadrant\nOverwatch Node"),
    ("Perimeter Watch Grid Relay Node", "Perimeter\nWatch Grid\nRelay Node"),
    ("Unbreakablesinglewordname", "Unbreakablesinglewordname"),
    ("Ridge Watch (Legacy Variant)", "Ridge Watch"),
]


@pytest.mark.parametrize("name,expected", WRAP_CASES)
def test_make_label_wrap_cases(name, expected):
    assert make_label(name) == expected


@pytest.mark.parametrize("name,_expected", WRAP_CASES)
def test_make_label_keeps_every_line_inside_the_budget(name, _expected):
    """The rule stated as its guarantee.

    The old rule split the word list in half and said nothing about how long
    the halves came out, so "Perimeter Watch Grid Relay Node" wrapped into two
    fifteen-character lines and both of them overflowed the node. A budget the
    output is measured against is the difference between a rule and a habit.
    """
    for line in make_label(name).split("\n"):
        assert len(line) <= LABEL_LINE_CHARS or " " not in line


def test_make_label_honours_a_curated_label_verbatim_even_when_it_is_long():
    """The curated table outranks the budget, deliberately.

    An entry in LABEL_MAP is a display decision somebody made on purpose, line
    breaks included, and re-wrapping it would overrule the one place an analyst
    can say how a name should read. The node box is what guarantees the text
    fits; this guarantees the text is the text that was chosen.
    """
    assert make_label("Enterprise Common Picture") == "Enterprise Common Picture"


# An interior parenthetical used to join the words around it, because the old
# expression swallowed the whitespace on both sides: "Ridge (Legacy Variant)
# Watch" came out "RidgeWatch". The trailing shape, which is the only one the
# sample carries, always looked right, which is why it survived.
PARENTHETICAL_CASES = [
    ('Ridge (Legacy Variant) Watch', 'Ridge Watch', 'ridge_watch'),
    ('(Prefix) Name', 'Name', 'name'),
    ('A (x) B (y) C', 'A B C', 'a_b_c'),
    ('KRL (Kestrel Relay Layer)', 'KRL', 'krl'),
    ('Plain Name', 'Plain Name', 'plain_name'),
]


@pytest.mark.parametrize("name,stripped,ident", PARENTHETICAL_CASES)
def test_a_parenthetical_leaves_a_space_where_it_stood(name, stripped, ident):
    assert strip_parenthetical(name) == stripped
    assert make_id(name) == ident
