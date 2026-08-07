#!/usr/bin/env python3
"""Write the fabricated Traceability Matrix workbook the ingest tests read.

The workbook is NOT committed: .gitignore excludes *.xlsx, because a tracked
spreadsheet in this repo is exactly the shape of the mistake being purged. It
is cheap to regenerate, so every consumer builds it into a temporary directory
first.

    python3 ingest/tests/fixtures/make_sample_workbook.py /tmp/sample.xlsx

The cell values come from atlas_ingest.synthetic, so the workbook, the sample
bundle and the golden fixtures cannot disagree about what the matrix says.

Sheet structure mirrors the real workbook, because the reader depends on it:
a title row, a hand-written summary block with a merged caption at B3:B4, a
header row that is not row 1, and the "Existing Interfaces" spelling the
header scan tolerates. Do not tidy any of that up.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

import openpyxl  # noqa: E402

from atlas_ingest.synthetic import CROSSWALK_ROWS, MATRIX_ROWS  # noqa: E402

HEADERS = [
    "Capability Gap/Requirement",
    "Project/System ",
    "Infrastructure/Technology ",
    "Owner Organization",
    "Confirmed",
    "User Community",
    "Existing Interfaces",
    "Planned Interfaces",
    "Risk/Challenge",
    "Response",
    "Reference Material",
    "Risk Level",
    "Owner Group",
    "Interface Class",
]

HEADER_ROW = 6
FIRST_COLUMN = 2

CROSSWALK_HEADERS = [
    "Original Capability Gap/Requirement",
    "Original Project/System",
    "Present Record",
    "Status",
    "Notes",
]

SUMMARY_LABELS = [
    "Total Systems", "Confirmed", "Unconfirmed", "High Risk", "Med Risk",
    "Low Risk",
]


def _summary_values():
    """The hand-written block above the header, as a curator would fill it.

    Derived rather than restated: test_excel_golden compares this block against
    the parsed rows, and a summary that cannot disagree is a summary that
    cannot catch a stale workbook. Deriving it here is still honest, because
    the check that matters is on the reader's side.
    """
    levels = [row[8].lower() for row in MATRIX_ROWS]
    confirmed = sum(1 for row in MATRIX_ROWS if row[5])
    return [
        len(MATRIX_ROWS),
        confirmed,
        len(MATRIX_ROWS) - confirmed,
        levels.count("high"),
        levels.count("medium"),
        levels.count("low"),
    ]


def _write_matrix(wb):
    ws = wb.active
    ws.title = "Matrix"
    ws.cell(row=1, column=2, value="Sample Traceability Matrix")

    ws.merge_cells("B3:B4")
    ws.cell(row=3, column=2, value="Summary")
    for offset, (label, value) in enumerate(zip(SUMMARY_LABELS, _summary_values())):
        ws.cell(row=3, column=3 + offset, value=label)
        ws.cell(row=4, column=3 + offset, value=value)

    for offset, header in enumerate(HEADERS):
        ws.cell(row=HEADER_ROW, column=FIRST_COLUMN + offset, value=header)

    for index, row in enumerate(MATRIX_ROWS):
        (_sid, category, name, infrastructure, owner, confirmed, integrations,
         risk_text, risk_level) = row
        values = [
            category,
            name,
            infrastructure,
            owner,
            "Yes" if confirmed else "No",
            "User community not recorded for this sample row",
            integrations,
            "See the desired-integration overlay",
            risk_text,
            "Tracked in the sample architecture review",
            "Sample architecture review materials",
            risk_level,
            "",
            "System",
        ]
        for offset, value in enumerate(values):
            ws.cell(row=HEADER_ROW + 1 + index, column=FIRST_COLUMN + offset,
                    value=value)


def _write_crosswalk(wb):
    ws = wb.create_sheet("original_to_current_crosswalk")
    for offset, header in enumerate(CROSSWALK_HEADERS):
        ws.cell(row=1, column=1 + offset, value=header)
    for index, row in enumerate(CROSSWALK_ROWS):
        for offset, value in enumerate(row):
            ws.cell(row=2 + index, column=1 + offset, value=value)


def write_sample_workbook(path):
    """Write the workbook to `path` and return it as a Path."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()
    try:
        _write_matrix(wb)
        _write_crosswalk(wb)
        wb.save(path)
    finally:
        wb.close()
    return path


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(f"usage: {sys.argv[0]} OUTPUT.xlsx")
    print(f"wrote {write_sample_workbook(sys.argv[1])}")
