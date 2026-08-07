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


def mapping_confidence_counts(sdmap):
    """Confidence tally of the realized mappings, across every site.

    Realized means the same thing here as in lossiness._realization_gap and in
    src/lib/coverage.ts: the mapping names hardware AND names a matrix system.
    Two exclusions, and they are different facts:

      - no devices (homing, kite are software-only curation records),
      - not a matrix system (atak documents hardware the matrix has no row
        for, so grading it as verified coverage overstates the architecture).

    The matrix id is tested through the curator's matrix_id_exists flag rather
    than a systems list, because validate.validate already refuses any bundle
    where a mapping names an id the matrix lacks without that flag. The
    two tests therefore cannot disagree on a bundle that builds, and the tally
    stays computable from the mapping file alone.
    """
    counts = {"high": 0, "medium": 0, "low": 0, "unspecified": 0, "total": 0}
    for site in sdmap.get("sites", {}).values():
        for entry in site.get("mappings", {}).values():
            if not entry.get("devices"):
                continue
            if entry.get("matrix_id_exists") is False:
                continue
            grade = (entry.get("confidence") or "").lower()
            counts[grade if grade in counts else "unspecified"] += 1
            counts["total"] += 1
    return counts
