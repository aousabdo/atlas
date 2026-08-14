import pytest

from atlas_ingest.crosswalk import CrosswalkError, read_crosswalk


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
        "No spectrum deconfliction process for mitigation effectors",
        "No standing training pipeline for relay operators",
    ]


def test_current_systems_are_split_on_semicolons(crosswalk):
    """The sheet writes several current systems into one cell, separated by
    semicolons. They have to come back as a list or the requirement looks like
    it landed on a single system named 'A; B; C'."""
    row = next(r for r in crosswalk
               if r["orig"] == "No retained audit trail of who read a detection record")
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


def test_curly_apostrophe_in_the_source_is_normalised():
    """The sheet writes "not carried as a system row" with U+2019. A byte
    comparison against a straight apostrophe would silently miss it and leave
    two requirements looking carried forward."""
    from atlas_ingest.crosswalk import _normalise_status

    assert _normalise_status("didn’t keep as system row") == "Didn't keep"
    assert _normalise_status("didn't keep as system row") == "Didn't keep"
    assert _normalise_status("did not keep") == "Didn't keep"


def test_a_workbook_without_the_sheet_raises(tmp_path):
    import openpyxl

    path = tmp_path / "nocrosswalk.xlsx"
    wb = openpyxl.Workbook()
    wb.active.title = "Matrix"
    wb.save(path)

    with pytest.raises(CrosswalkError, match="crosswalk"):
        read_crosswalk(path)
