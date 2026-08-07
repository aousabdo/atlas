"""The port is correct when this file passes.

Golden fixtures come from the previous implementation (capture_golden.py), so a
green run means the new package reproduces the old one field for field.
"""
import collections

import pytest

from conftest import golden

ESCAPED_NEWLINE_FIELDS = {"label", "glabel"}


def test_system_count(systems):
    assert len(systems) == 32


def test_confirmed_split(systems):
    confirmed = sum(1 for s in systems if not s["soft"])
    unconfirmed = sum(1 for s in systems if s["soft"])
    assert (confirmed, unconfirmed) == (23, 9)


def test_risk_distribution(systems):
    counts = collections.Counter(s["risk"] for s in systems)
    assert dict(counts) == {"high": 11, "medium": 19, "low": 2}


def test_every_risk_on_this_matrix_is_explicit(systems):
    """The 5MAR workbook fills Risk Level on every row. If this ever fails, the
    heuristic path has started firing and classify_risk's unit tests, not this
    file, are what protect the output."""
    assert {s["risk_source"] for s in systems} == {"explicit"}


def test_owner_group_distribution(systems):
    counts = collections.Counter(s["gid"] for s in systems)
    assert dict(counts) == {
        "dhs-st": 2, "cbp": 6, "otherdhs": 14, "dhshq": 4, "ext": 5, "dod": 1,
    }


def test_unconfirmed_ids_exactly(systems):
    assert sorted(s["id"] for s in systems if s["soft"]) == [
        "beacon", "cirrus", "dwell", "ember", "fathom", "gantry", "halyard", "ingot", "jetty",
    ]


def test_high_risk_ids_exactly(systems):
    assert sorted(s["id"] for s in systems if s["risk"] == "high") == [
        "orbit", "scan", "beacon", "cirrus", "dwell", "partner", "fpsrel",
        "halyard", "dispatch", "ingot", "bastion",
    ]


def test_low_risk_ids_exactly(systems):
    assert sorted(s["id"] for s in systems if s["risk"] == "low") == ["homing", "enterprise"]


def test_ids_are_unique(systems):
    ids = [s["id"] for s in systems]
    assert len(ids) == len(set(ids))


def test_the_confirmed_column_beats_always_soft(systems):
    """'scan' is in ALWAYS_SOFT, yet the workbook marks it Confirmed=Yes and the
    column wins. Precedence: Confirmed column > ALWAYS_SOFT/NEVER_SOFT >
    soft keywords."""
    scan = next(s for s in systems if s["id"] == "scan")
    assert scan["soft"] is False


def test_the_confirmed_column_beats_never_soft(systems):
    """The mirror case: 'gantry' is in NEVER_SOFT and is still unconfirmed,
    because the workbook says Confirmed=No."""
    gantry = next(s for s in systems if s["id"] == "gantry")
    assert gantry["soft"] is True


def test_the_workbook_summary_row_agrees_with_what_we_parsed(matrix_path, systems):
    """The Matrix sheet carries a hand-written summary above the data: labels
    on row 3, values on row 4. A mismatch means either that summary is stale or
    our parse is wrong, and either way a human needs to look.

    Read by label rather than by column position: B3:B4 is a merged "Summary"
    caption, so the values start at C and an offset assumption reads a blank.
    """
    import openpyxl

    wb = openpyxl.load_workbook(matrix_path, data_only=True)
    try:
        ws = wb["Matrix"]
        summary = {
            str(ws.cell(row=3, column=c).value).strip(): ws.cell(row=4, column=c).value
            for c in range(2, 12)
            if ws.cell(row=3, column=c).value
        }
    finally:
        wb.close()

    assert summary["Total Systems"] == len(systems)
    assert summary["Confirmed"] == sum(1 for s in systems if not s["soft"])
    assert summary["Unconfirmed"] == sum(1 for s in systems if s["soft"])
    assert summary["High Risk"] == sum(1 for s in systems if s["risk"] == "high")
    assert summary["Med Risk"] == sum(1 for s in systems if s["risk"] == "medium")
    assert summary["Low Risk"] == sum(1 for s in systems if s["risk"] == "low")


@pytest.mark.parametrize("field", [
    "id", "name", "label", "cat", "gid", "glabel", "gck", "ck",
    "soft", "risk", "risk_source", "detail", "integ",
])
def test_matches_golden_field_for_field(systems, field):
    """Field-level equality against the previous implementation.

    label and glabel are normalised because the old code carried literal
    backslash-n through a JS string injection that JSON does not need. Every
    other field must match exactly.
    """
    def norm(value):
        if field in ESCAPED_NEWLINE_FIELDS and isinstance(value, str):
            return value.replace("\\n", "\n")
        return value

    expected = {s["id"]: norm(s[field]) for s in golden("systems.json")}
    actual = {s["id"]: s[field] for s in systems}
    assert actual == expected


def test_missing_matrix_sheet_raises_rather_than_exiting(tmp_path):
    """A library must not call sys.exit. Ingest failures have to be catchable."""
    import openpyxl as _openpyxl

    from atlas_ingest.excel import MatrixError, read_excel

    path = tmp_path / "wrong.xlsx"
    wb = _openpyxl.Workbook()
    wb.active.title = "NotTheMatrix"
    wb.save(path)

    with pytest.raises(MatrixError, match="no 'Matrix' sheet"):
        read_excel(path)


def test_matrix_sheet_without_the_header_raises(tmp_path):
    import openpyxl as _openpyxl

    from atlas_ingest.excel import MatrixError, read_excel

    path = tmp_path / "headerless.xlsx"
    wb = _openpyxl.Workbook()
    wb.active.title = "Matrix"
    wb.active["A1"] = "nothing useful here"
    wb.save(path)

    with pytest.raises(MatrixError, match="Project/System"):
        read_excel(path)
