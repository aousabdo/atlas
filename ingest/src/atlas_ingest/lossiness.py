"""The seven dimensions where information dies between intent and deployment.

Spec section 5. Every dimension returns numerator, denominator, a percentage,
a severity band, and a detail block naming the offending entities. The detail
block is the point: it is what lets the UI drill from a figure to the rows
behind it, and what stops a metric from becoming an unfalsifiable claim.

Dimensions 4 and 6 are the differentiated ones. 4 is a gap map of integrations
that were wanted and still do not exist; 6 is its inverse, hardware in the rack
that no architecture document explains.
"""

from .config import CATEGORY_MAP
from .curation import is_realized_mapping, matrix_id_set

# The category-map branch the matrix files its gap rows under.
SHORTFALL_BRANCH = "gaps"


def is_shortfall(system):
    """A row the matrix files as a shortfall ('Workflow shortfall', 'Exchange
    shortfall'): it records that something is missing, not a system anyone
    could field. Read from the shared category map, which the browser's
    isShortfall reads too, so both engines answer the same."""
    category = system.get("cat", system.get("category"))
    return CATEGORY_MAP.get(category, {}).get("branch") == SHORTFALL_BRANCH

DIMENSION_ORDER = [
    "requirement_attrition", "ownership_ambiguity", "realization_gap",
    "integration_gap", "evidence_gap", "orphaned_hardware", "open_questions",
]

DIMENSION_LABELS = {
    "requirement_attrition": "Requirement attrition",
    "ownership_ambiguity": "Ownership ambiguity",
    "realization_gap": "Realization gap",
    "integration_gap": "Integration gap",
    "evidence_gap": "Evidence gap",
    "orphaned_hardware": "Orphaned hardware",
    "open_questions": "Open questions",
}

# Percentage bands for "higher is better" dimensions. Count dimensions
# (4, 6, 7) use count_severity instead, because there is no meaningful
# denominator for "how much hardware should be unexplained".
OK_AT = 90.0
WATCH_AT = 60.0


def severity_for(pct):
    """Band a percentage where higher is better."""
    if pct >= OK_AT:
        return "ok"
    if pct >= WATCH_AT:
        return "watch"
    return "critical"


def count_severity(count, watch_at=1, critical_at=10):
    """Band a raw count where lower is better."""
    if count >= critical_at:
        return "critical"
    if count >= watch_at:
        return "watch"
    return "ok"


def _round_ratio(num, den):
    """Round num/den to the nearest integer, breaking an exact tie to even.

    THE ROUNDING RULE, and it is shared: roundRatio in src/lib/lossiness.ts is
    the same function, statement for statement.

    Ties break to even because that is the rule every figure this repo has
    already published was rounded by. Python's round() is half-to-even, the
    committed sample bundle and everything baselined from it were built with
    it, and JavaScript's Math.round - half away from zero - was the half with
    no persisted output to contradict. Unifying the other way would have
    restated shipped figures (10 of 32 moving from 31.2 to 31.3) to settle a
    tiebreak no reader can observe on a single number. Tie-to-even also does
    not drift one way when the percentage dimensions are averaged into the
    composite indicator, which half-up would.

    The tie is decided on integers rather than on a float, which is the part
    round() could not give us. 100.0 * num / den lands a hair off the boundary
    for most ratios, and deciding the tie on that would make the two languages
    agree only as far as their division does. Numerator and denominator here
    are counts, so neither is negative.
    """
    whole, remainder = divmod(num, den)
    twice_remainder = 2 * remainder
    if twice_remainder > den:
        return whole + 1
    if twice_remainder < den:
        return whole
    return whole if whole % 2 == 0 else whole + 1


def _pct(num, den):
    """A percentage to one decimal place, under the rounding rule above."""
    return _round_ratio(1000 * num, den) / 10 if den else 0.0


def _dimension(key, numerator, denominator, severity, detail, unit="pct"):
    return {
        "key": key,
        "label": DIMENSION_LABELS[key],
        "numerator": numerator,
        "denominator": denominator,
        "value_pct": _pct(numerator, denominator) if unit == "pct" else None,
        "unit": unit,
        "severity": severity,
        "detail": detail,
    }


def _tally(values):
    out = {}
    for v in values:
        out[v] = out.get(v, 0) + 1
    return out


def _requirement_attrition(crosswalk):
    dropped = [r["orig"] for r in crosswalk if r["status"] == "Didn't keep"]
    carried = len(crosswalk) - len(dropped)
    return _dimension(
        "requirement_attrition", carried, len(crosswalk),
        severity_for(_pct(carried, len(crosswalk))),
        {"dropped": dropped, "by_status": _tally(r["status"] for r in crosswalk)},
    )


def _ownership_ambiguity(systems):
    unconfirmed = sorted(s["id"] for s in systems if s["soft"])
    confirmed = len(systems) - len(unconfirmed)
    return _dimension(
        "ownership_ambiguity", confirmed, len(systems),
        severity_for(_pct(confirmed, len(systems))),
        {"unconfirmed": unconfirmed},
    )


def _realization_gap(systems, sdmap):
    """Systems with at least one device somewhere.

    Mappings naming a system that is not in the matrix (atak, which carries
    matrix_id_exists: false) do not count: they describe hardware, not a
    realized matrix system.

    "Realized" is curation.is_realized_mapping and nothing local, because this
    dimension and curation.mapping_confidence_counts are read side by side in
    one component (src/tabs/reference/ConfidenceSection.tsx) and used to
    disagree there. This counted a mapping on matrix membership alone while the
    tally excluded it on the flag alone, so a mapping carrying
    matrix_id_exists: false for an id the matrix DOES hold was counted here and
    excluded there, in the same bundle.

    Shortfall rows are left out of the denominator. They record a gap in the
    architecture, not a system that could be fielded, so they can be neither
    realized nor unmapped. They are named under detail.shortfalls, so the
    denominator can still be checked against the matrix by hand.
    """
    matrix_ids = matrix_id_set(systems)
    shortfalls = sorted(s["id"] for s in systems if is_shortfall(s))
    fieldable = matrix_ids - set(shortfalls)
    total = len(fieldable)
    per_site, mapped_anywhere = {}, set()
    for site_id, site in sdmap.get("sites", {}).items():
        mapped = sorted(
            sid for sid, entry in site.get("mappings", {}).items()
            if sid in fieldable and is_realized_mapping(sid, entry, matrix_ids)
        )
        mapped_anywhere.update(mapped)
        per_site[site_id] = {
            "label": site.get("label", site_id),
            "mapped": len(mapped),
            "total": total,
            "pct": _pct(len(mapped), total),
            "mapped_ids": mapped,
            "checked_absent": sorted(site.get("not_deployed_at_site", {})),
        }
    unmapped = sorted(fieldable - mapped_anywhere)
    return _dimension(
        "realization_gap", len(mapped_anywhere), total,
        severity_for(_pct(len(mapped_anywhere), total)),
        {"per_site": per_site, "unmapped": unmapped, "shortfalls": shortfalls},
    )


def _integration_gap(links, desired):
    current = {tuple(sorted([l["from"], l["to"]])) for l in links}
    missing = [
        {"from": d["from"], "to": d["to"], "label": d.get("label", "")}
        for d in desired
        if tuple(sorted([d["from"], d["to"]])) not in current
    ]
    return _dimension(
        "integration_gap", len(missing), len(desired),
        count_severity(len(missing), watch_at=1, critical_at=10),
        {"missing_pairs": [[m["from"], m["to"]] for m in missing],
         "missing": missing,
         "current_pairs": [list(p) for p in sorted(current)]},
        unit="count",
    )


def _evidence_gap(systems):
    inferred = sorted(s["id"] for s in systems if s["risk_source"] == "inferred")
    explicit = sum(1 for s in systems if s["risk_source"] == "explicit")
    override = sorted(s["id"] for s in systems if s["risk_source"] == "override")
    return _dimension(
        "evidence_gap", explicit, len(systems),
        severity_for(_pct(explicit, len(systems))),
        {"inferred": inferred, "override": override},
    )


def _orphaned_hardware(sdmap, networks):
    by_site, ids = {}, {}
    for site_id, site in sdmap.get("sites", {}).items():
        unclaimed = site.get("unclaimed_devices", {}).get("infrastructure", [])
        by_site[site_id] = len(unclaimed)
        ids[site_id] = list(unclaimed)
    total_devices = sum(n["meta"]["device_count"] for n in (networks or {}).values())
    return _dimension(
        "orphaned_hardware", sum(by_site.values()), total_devices,
        count_severity(sum(by_site.values()), watch_at=1, critical_at=25),
        {"by_site": by_site, "device_ids": ids},
        unit="count",
    )


def _open_questions(sdmap):
    pending = sdmap.get("pending_review", {})
    return _dimension(
        "open_questions", len(pending), len(pending),
        count_severity(len(pending), watch_at=1, critical_at=10),
        {"questions": [{"subject": k, "question": v} for k, v in pending.items()]},
        unit="count",
    )


def compute_lossiness(systems, links, desired, crosswalk, sdmap, networks=None):
    """-> {dimensions: [...]}. Deliberately has no composite index; see
    composite_index() and the spec's honesty guardrail."""
    return {
        "dimensions": [
            _requirement_attrition(crosswalk),
            _ownership_ambiguity(systems),
            _realization_gap(systems, sdmap),
            _integration_gap(links, desired),
            _evidence_gap(systems),
            _orphaned_hardware(sdmap, networks),
            _open_questions(sdmap),
        ]
    }


def composite_index(report):
    """Opt-in management indicator, never a formal metric.

    Averages the percentage-valued dimensions only. Count dimensions have no
    denominator that makes a percentage honest, so folding them in would
    manufacture precision. Callers must label the result as an indicator.
    """
    pcts = [d["value_pct"] for d in report["dimensions"]
            if d["unit"] == "pct" and d["value_pct"] is not None]
    if not pcts:
        return 0.0
    # Averaged in tenths, so the mean is rounded by the same rule as the
    # figures it averages. value_pct already carries at most one decimal, so
    # scaling it back to an integer never lands on a tiebreak of its own, and
    # the mean is again a ratio of two counts.
    return _round_ratio(sum(round(v * 10) for v in pcts), len(pcts)) / 10


def _find(report, key):
    return next(d for d in report["dimensions"] if d["key"] == key)


def top_gaps(report, systems, limit=10):
    """High-risk, unconfirmed and unmapped, ranked. Spec section 5's Top Gaps."""
    unconfirmed = set(_find(report, "ownership_ambiguity")["detail"]["unconfirmed"])
    unmapped = set(_find(report, "realization_gap")["detail"]["unmapped"])
    scored = []
    for s in systems:
        score = ((s["risk"] == "high") * 3) + (s["id"] in unconfirmed) + (s["id"] in unmapped)
        if score:
            scored.append({
                "id": s["id"], "name": s["name"], "risk": s["risk"],
                "unconfirmed": s["id"] in unconfirmed,
                "unmapped": s["id"] in unmapped,
                "score": score,
            })
    scored.sort(key=lambda r: (-r["score"], r["id"]))
    return scored[:limit]
