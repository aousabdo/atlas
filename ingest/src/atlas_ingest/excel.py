"""Read the Matrix sheet into system dicts.

Ported from build_cuas_tool_v4.py:289-384. Two behaviour changes, both
deliberate: missing sheets and missing headers raise instead of calling
sys.exit, because this runs as a library; and the workbook opens read_only to
bound memory on a hostile file.

The header scan tolerates the workbook's "Existing Interfaces" typo. Do not
"fix" it: the source file spells it that way and the correct spelling is
already handled as a fallback.
"""
import openpyxl

from .classify import classify_owner, classify_risk
from .config import CATEGORY_MAP
from .identity import make_id, make_label


class MatrixError(ValueError):
    """The workbook is not a Traceability Matrix we can read."""


def _find_header_row(ws):
    """The Matrix sheet does not start at row 1: a title and a hand-written
    summary block sit above the header. Scan rather than assume an offset."""
    for r in range(1, 11):
        for cell in ws[r]:
            if cell.value and "Project/System" in str(cell.value):
                return r
    raise MatrixError("no header row containing 'Project/System' in the first 10 rows")


def read_excel(filepath):
    """Matrix sheet -> list of system dicts, in workbook row order."""
    wb = openpyxl.load_workbook(filepath, data_only=True)
    try:
        if "Matrix" not in wb.sheetnames:
            raise MatrixError(f"no 'Matrix' sheet; found {wb.sheetnames}")
        ws = wb["Matrix"]
        hrow = _find_header_row(ws)

        # Header cells carry trailing spaces in the source workbook
        # ("Project/System "), so strip before matching.
        hdrs = {c.value.strip(): c.column - 1 for c in ws[hrow] if c.value}
        ci = {
            "cat":   hdrs.get("Capability Gap/Requirement"),
            "name":  hdrs.get("Project/System"),
            "infra": hdrs.get("Infrastructure/Technology"),
            "owner": hdrs.get("Owner Organization"),
            "integ": hdrs.get("Existing Interfaces") or hdrs.get("Existing Interfaces"),
            "risk":  hdrs.get("Risk/Challenge"),
        }
        if ci["name"] is None:
            raise MatrixError("no 'Project/System' column")
        col_risk_level = hdrs.get("Risk Level")
        col_confirmed = hdrs.get("Confirmed")

        systems = []
        for row in ws.iter_rows(min_row=hrow + 1, max_row=ws.max_row, values_only=True):
            if not row[ci["name"]]:
                continue
            systems.append(_build_system(row, ci, col_risk_level, col_confirmed))
        return systems
    finally:
        wb.close()


def _cell(row, idx):
    if idx is None:
        return ""
    return str(row[idx] or "").strip()


def _build_system(row, ci, col_risk_level, col_confirmed):
    name = str(row[ci["name"]]).strip()
    cat = _cell(row, ci["cat"])
    owner = _cell(row, ci["owner"])
    risk_text = _cell(row, ci["risk"])
    infra = _cell(row, ci["infra"])
    integ = _cell(row, ci["integ"])

    explicit_risk = None
    if col_risk_level is not None:
        v = row[col_risk_level]
        if v and str(v).strip().lower() in ("high", "medium", "low"):
            explicit_risk = str(v).strip().lower()

    explicit_confirmed = None
    if col_confirmed is not None:
        v = row[col_confirmed]
        if v and str(v).strip().lower() in ("yes", "no"):
            explicit_confirmed = str(v).strip().lower() == "yes"

    gid, glabel, gck, is_soft = classify_owner(owner, name)
    # The Confirmed column outranks ALWAYS_SOFT and NEVER_SOFT.
    if explicit_confirmed is not None:
        is_soft = not explicit_confirmed

    if explicit_risk:
        risk, risk_source = explicit_risk, "explicit"
    else:
        risk, risk_source = classify_risk(risk_text), "inferred"

    cat_info = CATEGORY_MAP.get(cat, CATEGORY_MAP["Deployed asset record"])
    node_ck = cat_info["ck"] if cat_info["branch"] != "inv" else gck

    detail_parts = [infra] if infra else []
    if owner:
        detail_parts.append("Owner: " + owner)
    if risk_text:
        detail_parts.append("Risk: " + risk_text)
    detail = ". ".join(filter(None, detail_parts))
    if detail and not detail.endswith("."):
        detail += "."

    return {
        "id": make_id(name),
        "name": name,
        "label": make_label(name),
        "cat": cat,
        "gid": gid,
        "glabel": glabel,
        "gck": gck,
        "ck": node_ck,
        "soft": is_soft,
        "risk": risk,
        "risk_source": risk_source,
        "detail": detail,
        "integ": integ,
    }
