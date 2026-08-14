import pytest

from atlas_ingest.identity import strip_parenthetical, LABEL_LINE_CHARS, make_id, make_label


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
