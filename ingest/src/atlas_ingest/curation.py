"""Hand-curated overlays: overrides, glossary, and the system-to-device map.

Phase 2 turns all three into tables. Here they are read, shape-normalised and
validated. One deliberate change from build_cuas_tool_v4.py:721-744 - a missing
glossary now raises instead of returning a _missing stub, because the stub let
an empty Reference tab ship unnoticed.
"""
import json
from pathlib import Path

from .config import CATEGORY_MAP

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
    """System-to-device mappings, read from a file and normalised."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"system_device_map not found: {path}")
    return normalise_system_device_map(_read_json(path))


def _or_default(value, default):
    """`value ?? default`, as the browser reads the map: null is absent."""
    return value if value is not None else default


def normalise_system_device_map(raw):
    """The parsed map in the multi-site shape (build_cuas_tool_v4.py:526-558).

    Accepts the legacy flat single-site shape and wraps it as one site. A site
    may also carry its absences under the legacy key not_deployed_at_northgate.
    normaliseSystemDeviceMap in src/data/LocalFileProvider.ts reads the same
    file the same way, and fixtures/parity/curation holds both to it. Every key
    this does not fill is passed through, review fields included. The input is
    not modified.
    """
    if isinstance(raw.get("sites"), dict):
        sites = {}
        for site_id, block in raw["sites"].items():
            site = dict(block)
            site["mappings"] = _or_default(site.get("mappings"), {})
            site["not_deployed_at_site"] = _or_default(
                site.get("not_deployed_at_site"),
                _or_default(site.get("not_deployed_at_northgate"), {}),
            )
            site["unclaimed_devices"] = _or_default(
                site.get("unclaimed_devices"), {"infrastructure": []}
            )
            sites[site_id] = site
        return {
            **raw,
            "sites": sites,
            "pending_review": _or_default(raw.get("pending_review"), {}),
        }

    return {
        "_version": "0.2-wrapped-from-flat",
        "default_site": "northgate",
        "sites": {
            "northgate": {
                "label": "Northgate Sports Campus",
                "scope": "Northgate (wrapped from a legacy flat map)",
                "mappings": _or_default(raw.get("mappings"), {}),
                "not_deployed_at_site": _or_default(raw.get("not_deployed_at_northgate"), {}),
                "unclaimed_devices": _or_default(
                    raw.get("unclaimed_devices"), {"infrastructure": []}
                ),
            }
        },
        "pending_review": _or_default(raw.get("pending_review"), {}),
    }


# Keys the canonical map writes itself, so the file's own copies are not kept.
_MAP_KEYS = ("default_site", "sites", "pending_review", "confidence_counts")
# The legacy flat map keeps one site at the top level; wrapped, they move into it.
_FLAT_KEYS = ("mappings", "not_deployed_at_northgate", "unclaimed_devices")
_SITE_KEYS = (
    "label", "scope", "mappings", "not_deployed_at_site", "not_deployed_at_northgate",
    "unclaimed_devices", "decision_roots", "confidence_counts",
)


def canonical_map_json(raw):
    """The map written the one canonical way, as text.

    The same bytes canonicalMapJson in src/curation/serialise.ts writes, which
    is what lets a file the browser exported be re-serialised here unchanged;
    fixtures/parity/curation holds both to it, case by case. Keys the loaders
    do not know are kept, at the top level and on each site, so an analyst's
    own notes survive. confidence_counts is never written: every reader
    recomputes it. Each site is normalised as the browser normalises it: the
    label defaults to the site id, the scope to '', and a mapping with no
    devices names none. The input is not modified.
    """
    sdmap = normalise_system_device_map(raw)
    dropped = _MAP_KEYS if isinstance(raw.get("sites"), dict) else _MAP_KEYS + _FLAT_KEYS
    out = {key: value for key, value in raw.items() if key not in dropped}

    sites = {}
    for site_id, site in sdmap["sites"].items():
        block = {key: value for key, value in site.items() if key not in _SITE_KEYS}
        block["label"] = _or_default(site.get("label"), site_id)
        block["scope"] = _or_default(site.get("scope"), "")
        block["mappings"] = {
            sys_id: {**entry, "devices": _or_default(entry.get("devices"), [])}
            for sys_id, entry in site["mappings"].items()
        }
        block["not_deployed_at_site"] = site["not_deployed_at_site"]
        block["unclaimed_devices"] = site["unclaimed_devices"]
        if "decision_roots" in site:
            block["decision_roots"] = site["decision_roots"]
        sites[site_id] = block

    out["default_site"] = _or_default(raw.get("default_site"), next(iter(sites), None))
    out["sites"] = sites
    out["pending_review"] = sdmap["pending_review"]
    return json.dumps(out, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


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


# The category-map branch the matrix files its gap rows under.
SHORTFALL_BRANCH = "gaps"


def is_shortfall(system):
    """A row the matrix files as a shortfall ('Workflow shortfall', 'Exchange
    shortfall'): it records that something is missing, not a system anyone
    could field.

    Mirrors isShortfall in src/lib/coverage.ts, and both read the same
    generated category map. Lives here beside is_realized_mapping because the
    two are read together: lossiness leaves shortfall rows out of realization,
    and validate refuses a mapping that gives one hardware, which is what keeps
    the confidence tally from counting a row realization has left out.
    Parsed rows carry the category as `cat`, bundled rows as `category`.
    """
    category = system.get("cat", system.get("category"))
    return CATEGORY_MAP.get(category, {}).get("branch") == SHORTFALL_BRANCH


# Strongest first. "unspecified" is anything the file did not grade.
CONFIDENCE_GRADES = ("high", "medium", "low", "unspecified")


def confidence_grade(entry):
    """The grade a mapping carries, read one way everywhere. Mirrors
    confidenceGrade in src/lib/coverage.ts."""
    raw = entry.get("confidence")
    grade = raw.lower() if isinstance(raw, str) else ""
    return grade if grade in CONFIDENCE_GRADES else "unspecified"


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
            counts[confidence_grade(entry)] += 1
            counts["total"] += 1
    return counts
