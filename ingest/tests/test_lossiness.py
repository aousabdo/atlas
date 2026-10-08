"""Hand-computed fixtures per dimension.

Silently drifting metrics are worse than no metrics, so every figure here was
worked out from the source data on 2026-08-05 and is asserted exactly.
"""
import pytest

from atlas_ingest.curation import mapping_confidence_counts, matrix_id_set
from atlas_ingest.lossiness import (
    _pct, composite_index, compute_lossiness, count_severity, severity_for, top_gaps,
)

@pytest.fixture(scope="module")
def report(systems, links, desired, crosswalk, sdmap, networks):
    return compute_lossiness(
        systems=systems,
        links=links,
        desired=desired,
        crosswalk=crosswalk,
        sdmap=sdmap,
        networks=networks,
    )


def _dim(report, key):
    return next(d for d in report["dimensions"] if d["key"] == key)


def test_all_seven_dimensions_present(report):
    assert [d["key"] for d in report["dimensions"]] == [
        "requirement_attrition", "ownership_ambiguity", "realization_gap",
        "integration_gap", "evidence_gap", "orphaned_hardware", "open_questions",
    ]


def test_requirement_attrition(report):
    d = _dim(report, "requirement_attrition")
    assert (d["numerator"], d["denominator"]) == (9, 11)
    assert d["value_pct"] == pytest.approx(81.8, abs=0.1)
    assert sorted(d["detail"]["dropped"]) == [
        "No spectrum deconfliction process for mitigation effectors",
        "No standing training pipeline for relay operators",
    ]


def test_ownership_ambiguity(report):
    d = _dim(report, "ownership_ambiguity")
    assert (d["numerator"], d["denominator"]) == (23, 32)
    assert sorted(d["detail"]["unconfirmed"]) == [
        "beacon", "cirrus", "dwell", "ember", "fathom", "gantry", "halyard", "ingot", "jetty",
    ]


def test_realization_gap_counts_only_matrix_systems_with_hardware(report):
    """10 of 30, not 11 of 32. Northgate has 11 device-bearing mappings, but one
    of them ('atak') carries matrix_id_exists: false and is deliberately not a
    matrix system, so it describes hardware rather than a realized system. The
    denominator leaves out the two shortfall rows, which record a gap in the
    architecture rather than a system anyone could field. Westfield Proving
    Ground has no mappings at all yet."""
    d = _dim(report, "realization_gap")
    assert (d["numerator"], d["denominator"]) == (10, 30)
    assert d["detail"]["shortfalls"] == ["dispatch", "partner"]
    assert d["detail"]["per_site"]["northgate"]["total"] == 30
    # Sorted, because lossiness._realization_gap sorts mapped_ids. This list was
    # written in curation order, which no input could ever have matched.
    assert d["detail"]["per_site"]["northgate"]["mapped_ids"] == [
        "bastion", "civair", "crosslink", "eventrel", "fpsrel", "jetty",
        "recon", "tagpoint", "ucop", "winrel",
    ]
    assert d["detail"]["per_site"]["westfield"]["mapped"] == 0
    assert len(d["detail"]["unmapped"]) == 20
    assert not {"dispatch", "partner"} & set(d["detail"]["unmapped"])


def test_realization_gap_leaves_shortfall_rows_out():
    """A shortfall row says something is missing; it is not a system that could
    be fielded, so it is neither realized nor unmapped. It is named under
    detail.shortfalls so the denominator can be checked by hand."""
    systems = [
        {"id": "alpha", "name": "Alpha", "cat": "Deployed asset record",
         "soft": False, "risk": "low", "risk_source": "explicit"},
        {"id": "gap", "name": "Gap", "cat": "Workflow shortfall",
         "soft": False, "risk": "high", "risk_source": "explicit"},
    ]
    sdmap = {"sites": {"harbor": {
        "label": "Harbor Yard",
        "mappings": {"alpha": {"devices": ["dev-1"], "confidence": "high"}},
        "not_deployed_at_site": {},
        "unclaimed_devices": {"infrastructure": []},
    }}, "pending_review": {}}

    report = compute_lossiness(systems=systems, links=[], desired=[],
                               crosswalk=[], sdmap=sdmap, networks={})
    gap = _dim(report, "realization_gap")
    assert (gap["numerator"], gap["denominator"]) == (1, 1)
    assert gap["detail"]["shortfalls"] == ["gap"]
    assert gap["detail"]["unmapped"] == []
    assert gap["detail"]["per_site"]["harbor"]["total"] == 1


def test_realization_gap_keeps_the_checked_and_absent_facts(report):
    """"We checked and it is genuinely not here" is different information from
    "we have not looked yet", and almost no tool models that distinction."""
    d = _dim(report, "realization_gap")
    assert len(d["detail"]["per_site"]["northgate"]["checked_absent"]) == 20


def test_every_desired_integration_is_still_missing(report):
    """All 13 desired links are absent from the 14 current ones. That is the
    gap map: what was wanted and still does not exist."""
    d = _dim(report, "integration_gap")
    assert (d["numerator"], d["denominator"]) == (13, 13)
    assert d["unit"] == "count"
    current = {tuple(sorted(p)) for p in d["detail"]["current_pairs"]}
    for pair in d["detail"]["missing_pairs"]:
        assert tuple(sorted(pair)) not in current


def test_evidence_gap_is_fully_explicit_on_this_baseline(report):
    d = _dim(report, "evidence_gap")
    assert (d["numerator"], d["denominator"]) == (32, 32)
    assert d["value_pct"] == 100.0
    assert d["detail"]["inferred"] == []
    assert d["severity"] == "ok"


def test_orphaned_hardware_counts_both_sites(report):
    d = _dim(report, "orphaned_hardware")
    assert d["numerator"] == 59
    assert d["denominator"] == 79
    assert d["detail"]["by_site"] == {"northgate": 51, "westfield": 8}


def test_open_questions(report):
    d = _dim(report, "open_questions")
    assert d["numerator"] == 7
    assert len(d["detail"]["questions"]) == 7


def test_every_dimension_carries_its_evidence(report):
    """Spec section 5: no number without its evidence. A dimension whose detail
    is empty while its numerator is non-zero is a bug, not a clean bill."""
    for d in report["dimensions"]:
        assert isinstance(d["detail"], dict)
        assert d["detail"], f"{d['key']} has an empty detail block"
        assert d["severity"] in {"ok", "watch", "critical"}


def test_severity_thresholds_are_explicit():
    assert severity_for(95.0) == "ok"
    assert severity_for(90.0) == "ok"
    assert severity_for(80.0) == "watch"
    assert severity_for(60.0) == "watch"
    assert severity_for(40.0) == "critical"


def test_count_severity_bands():
    assert count_severity(0) == "ok"
    assert count_severity(5) == "watch"
    assert count_severity(10) == "critical"


def test_no_composite_index_by_default(report):
    """Spec section 5's honesty guardrail: a single number invites the false
    precision this tool exists to prevent. Show the seven; keep the composite
    opt-in."""
    assert "lossiness_index" not in report


def test_composite_index_available_on_request(report):
    """Averages only the percentage dimensions. Folding in the counts would
    manufacture precision they do not have."""
    value = composite_index(report)
    # The mean of 81.8, 71.9, 33.3 and 100: realization is 10 of the 30
    # systems that could be fielded, the two shortfall rows left out.
    assert value == pytest.approx(71.8, abs=0.1)
    assert 0.0 <= value <= 100.0


def test_top_gaps_ranks_high_risk_unconfirmed_and_unmapped_first(report, systems):
    """Five systems are simultaneously high-risk, unconfirmed and unmapped, so
    they all score the maximum 5 and ties break on id. These five are the
    actionable list: the ones where the architecture is both important and
    least pinned down."""
    gaps = top_gaps(report, systems, limit=100)
    worst = [g["id"] for g in gaps if g["score"] == 5]
    assert worst == ["beacon", "cirrus", "dwell", "halyard", "ingot"]
    for g in gaps[:5]:
        assert g["risk"] == "high"
        assert g["unconfirmed"] and g["unmapped"]


def test_top_gaps_is_sorted_by_descending_score(report, systems):
    scores = [g["score"] for g in top_gaps(report, systems, limit=100)]
    assert scores == sorted(scores, reverse=True)


def test_top_gaps_respects_its_limit(report, systems):
    assert len(top_gaps(report, systems, limit=3)) == 3


def test_top_gaps_excludes_systems_with_no_gap(report, systems):
    gaps = top_gaps(report, systems, limit=100)
    assert all(g["score"] > 0 for g in gaps)


def test_a_project_with_nothing_dropped_scores_ok():
    """Guard the arithmetic against the happy path, not just today's data."""
    report = compute_lossiness(
        systems=[{"id": "a", "name": "A", "soft": False, "risk": "low",
                  "risk_source": "explicit"}],
        links=[], desired=[],
        crosswalk=[{"orig": "r", "sys": "s", "current": ["A"], "status": "Condensed"}],
        sdmap={"sites": {}, "pending_review": {}}, networks={},
    )
    assert _dim(report, "requirement_attrition")["value_pct"] == 100.0
    assert _dim(report, "ownership_ambiguity")["severity"] == "ok"
    assert _dim(report, "open_questions")["numerator"] == 0


def test_empty_inputs_do_not_divide_by_zero():
    report = compute_lossiness(
        systems=[], links=[], desired=[], crosswalk=[],
        sdmap={"sites": {}, "pending_review": {}}, networks={},
    )
    for d in report["dimensions"]:
        assert d["value_pct"] in (0.0, None)


# THE MIRRORED TABLE. src/lib/__tests__/lossiness.test.ts carries the same one
# under the same name, and the two must stay identical line for line.
#
# Nothing else compares the ingest's arithmetic against the browser's. The
# provider contract runs the same assertions against both providers, but it
# asserts counts and shapes and not a single percentage, so when the two
# engines rounded 10 of 32 to 31.2 and 31.3 the whole suite stayed green and
# the app printed both figures.
#
# Every ratio here whose denominator is 32 and whose numerator is even but not
# a multiple of four lands EXACTLY on a half at the tenth place, which is the
# only place the two rules could ever differ:
#
#   10 of 32 is 31.25, and rounds DOWN to 31.2, because 2 is even.
#    6 of 32 is 18.75, and rounds UP   to 18.8, because 7 is odd.
#
# Both directions are here on purpose. A table of ties that all fell the same
# way would pass just as happily against half-up.
PCT_CASES = [
    (0, 0, 0),
    (0, 32, 0),
    (32, 32, 100),
    (9, 11, 81.8),
    (1, 3, 33.3),
    (2, 32, 6.2),
    (6, 32, 18.8),
    (10, 32, 31.2),
    (14, 32, 43.8),
    (18, 32, 56.2),
    (22, 32, 68.8),
    (26, 32, 81.2),
    (30, 32, 93.8),
]


@pytest.mark.parametrize("num,den,expected", PCT_CASES)
def test_pct_matches_the_browser_case_for_case(num, den, expected):
    assert _pct(num, den) == expected


def test_pct_breaks_a_tie_to_even_in_both_directions():
    """The half-away-from-zero rule the browser used returned 31.3 and 18.8.
    Asserting both ties is what stops a future "just use round()" from
    passing, since round() agrees on one of them by accident."""
    assert _pct(10, 32) == 31.2
    assert _pct(6, 32) == 18.8


def test_pct_leaves_an_empty_denominator_at_zero():
    assert _pct(3, 0) == 0.0


def test_composite_index_averages_in_tenths_tie_to_even():
    """31.2 and 31.3 average to 31.25, a tie at the tenth place. 312 is even,
    so it stands. The browser's half-up mean returned 31.3."""
    report = {"dimensions": [
        {"key": "requirement_attrition", "unit": "pct", "value_pct": 31.2},
        {"key": "ownership_ambiguity", "unit": "pct", "value_pct": 31.3},
    ]}
    assert composite_index(report) == 31.2


def test_realization_gap_ignores_a_flag_that_contradicts_the_matrix():
    """The bundle that used to be counted two ways at once.

    A mapping declaring matrix_id_exists false for an id the matrix DOES carry
    passed validate, and then this dimension counted it (it tested membership
    alone) while curation.mapping_confidence_counts dropped it (it tested the
    flag alone). Both figures render in one card in ConfidenceSection. The
    inverse gate in validate now refuses such a bundle; this asserts that if
    one reaches here anyway, the two agree on excluding it.
    """
    systems = [
        {"id": "alpha", "name": "Alpha", "soft": False, "risk": "low",
         "risk_source": "explicit"},
        {"id": "bravo", "name": "Bravo", "soft": False, "risk": "low",
         "risk_source": "explicit"},
    ]
    sdmap = {"sites": {"harbor": {
        "label": "Harbor Yard",
        "mappings": {
            "alpha": {"devices": ["dev-1"], "matrix_id_exists": False,
                      "confidence": "high"},
            "bravo": {"devices": ["dev-2"], "confidence": "high"},
        },
        "not_deployed_at_site": {},
        "unclaimed_devices": {"infrastructure": []},
    }}, "pending_review": {}}

    report = compute_lossiness(systems=systems, links=[], desired=[],
                               crosswalk=[], sdmap=sdmap, networks={})
    gap = _dim(report, "realization_gap")
    assert gap["numerator"] == 1
    assert gap["detail"]["per_site"]["harbor"]["mapped_ids"] == ["bravo"]
    assert mapping_confidence_counts(sdmap)["total"] == gap["numerator"]
    assert mapping_confidence_counts(sdmap, matrix_id_set(systems))["total"] == 1
