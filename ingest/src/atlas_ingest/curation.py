"""Hand-curated overlays: overrides, glossary, and the system-to-device map.

Phase 2 turns all three into tables. Here they are read, shape-normalised and
validated. One deliberate change from build_cuas_tool_v4.py:721-744 - a missing
glossary now raises instead of returning a _missing stub, because the stub let
an empty Reference tab ship unnoticed.
"""
import json
from pathlib import Path

EMPTY_OVERRIDES = {
    "cross_links": [], "suppress_links": [], "desired_links": [],
    "risk_overrides": {}, "soft_overrides": {}, "node_order": {},
}


def _read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_overrides(path):
    """Curation overlay. Absent is legitimate and means 'no curation'."""
    path = Path(path)
    if not path.exists():
        return dict(EMPTY_OVERRIDES)
    raw = _read_json(path)
    out = dict(EMPTY_OVERRIDES)
    for key in EMPTY_OVERRIDES:
        if key in raw:
            out[key] = raw[key]
    return out


def load_glossary(path):
    """Reference-tab content. Absent is fatal: a placeholder Reference tab is
    indistinguishable from a real but empty one."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(
            f"glossary not found: {path}. The Reference tab has no content "
            f"without it, and shipping an empty tab hides the failure."
        )
    data = _read_json(path)
    data.setdefault("confidence_intro", "")
    data.setdefault("out_of_scope", [])
    data.setdefault("methodology_extras", {})
    data.setdefault("acronyms", [])
    return data


def load_system_device_map(path):
    """System-to-device mappings. Accepts the legacy flat single-site shape and
    normalises it to the multi-site shape (build_cuas_tool_v4.py:526-558)."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"system_device_map not found: {path}")
    raw = _read_json(path)

    if isinstance(raw.get("sites"), dict):
        raw.setdefault("pending_review", {})
        for site in raw["sites"].values():
            site.setdefault("mappings", {})
            site.setdefault("not_deployed_at_site", {})
            site.setdefault("unclaimed_devices", {"infrastructure": []})
        return raw

    return {
        "_version": "0.2-wrapped-from-flat",
        "default_site": "northgate",
        "sites": {
            "northgate": {
                "label": "Northgate Sports Campus",
                "scope": "Northgate (wrapped from a legacy flat map)",
                "mappings": raw.get("mappings", {}),
                "not_deployed_at_site": raw.get("not_deployed_at_northgate", {}),
                "unclaimed_devices": raw.get(
                    "unclaimed_devices", {"infrastructure": []}
                ),
            }
        },
        "pending_review": raw.get("pending_review", {}),
    }


def matrix_id_set(systems):
    """The set the predicate below tests membership against."""
    return {s["id"] for s in systems}


def names_matrix_system(sys_id, entry, matrix_ids=None):
    """Does this mapping name something the matrix carries as a system?

    The Python half of namesMatrixSystem in src/lib/coverage.ts, and the same
    rule: two signals, and both must agree. `matrix_id_exists: false` is the
    curator's explicit declaration that the id is deliberately absent;
    membership in the matrix is the fact.

    validate.validate() rejects a bundle where the two disagree in EITHER
    direction - an id the matrix lacks carrying no flag, and the flag set on an
    id the matrix does carry. Only the first was gated until
    test_validate.test_matrix_id_exists_false_on_a_matrix_system_fails, and in
    that gap a mapping could pass validation and then be counted as a realized
    system by lossiness and excluded from the confidence tally here, in one
    bundle, rendered side by side in one component.

    matrix_ids is None for a caller handed the mapping file and nothing else.
    The flag then carries the whole of the matrix-membership fact, which is
    sound precisely because both directions are now gated. Pass the set
    whenever you have it: it is what makes a bundle assembled some other way
    fail closed rather than counting a non-system as coverage.
    """
    if entry.get("matrix_id_exists") is False:
        return False
    return matrix_ids is None or sys_id in matrix_ids


def is_realized_mapping(sys_id, entry, matrix_ids=None):
    """The single Python predicate. Every consumer calls this and nothing else.

    Mirrors isRealizedMapping in src/lib/coverage.ts. Realized means the
    mapping names hardware AND names a matrix system. The two exclusions are
    different facts and neither is an error:

      - no devices (homing, kite are software-only curation records),
      - not a matrix system (atak documents hardware the matrix has no row
        for, so grading it as verified coverage overstates the architecture).
    """
    return bool(entry.get("devices")) and names_matrix_system(
        sys_id, entry, matrix_ids
    )


def mapping_confidence_counts(sdmap, matrix_ids=None):
    """Confidence tally of the realized mappings, across every site.

    Realized is is_realized_mapping above, the same predicate
    lossiness._realization_gap counts with and the same one
    realizedConfidenceCounts in src/lib/coverage.ts applies in the browser.
    Grading a mapping the tabs do not count as coverage would overstate how
    much of the architecture is verified.

    matrix_ids is optional because the bundle writers hand this function the
    mapping file alone; see names_matrix_system for why the flag is then the
    whole of the fact, and test_curation for the mapping that proves the two
    readings agree.
    """
    counts = {"high": 0, "medium": 0, "low": 0, "unspecified": 0, "total": 0}
    for site in sdmap.get("sites", {}).values():
        for sys_id, entry in site.get("mappings", {}).items():
            if not is_realized_mapping(sys_id, entry, matrix_ids):
                continue
            grade = (entry.get("confidence") or "").lower()
            counts[grade if grade in counts else "unspecified"] += 1
            counts["total"] += 1
    return counts
