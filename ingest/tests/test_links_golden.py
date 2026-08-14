"""Link mining and merge. Every test here runs on the generated sample.

TWO COUNT TESTS USED TO LIVE HERE AND DO NOT ANY MORE

    They asserted that the reference matrix's prose mines exactly sixteen links
    and that exactly four of the curator's suppress entries hit one of them.
    Both numbers are real: they were measured with the reference repo's OWN
    build script, and re-measuring with that script today still gives 16 and 4.

    Neither has ever been reproducible HERE, and neither can be. Mining depends
    on atlas_ingest.config.LINK_NAME_FRAGMENTS, ID_MAP and LABEL_MAP, and this
    repo carries a fabricated vocabulary in all three on purpose: the real one
    is the controlled content that was purged, and scripts/check-no-real-data.mjs
    exists to refuse it back. Pointed at the reference matrix, this extractor
    matches the sample's fragments against real prose and mines a number that
    means nothing. The two tests were marked reference_data and never ran, so
    the mismatch stayed invisible; the moment path resolution was fixed they
    would have gone red for a reason no change to this repo could clear.

    They are gone rather than restated. The fidelity question they were
    standing in for - does this port mine what the script it replaced mined -
    is a real one, and it is open: it cannot be settled inside this repo,
    because settling it needs the vocabulary this repo refuses to hold. It is
    not a test here, because a test that cannot pass on any correct code is a
    permanent red light nobody can act on. What reference data CAN honestly
    check is in test_source_layout.py.

The rules below hold for any matrix and run on every push.
"""
from atlas_ingest.links import extract_links, merge_links

from conftest import golden


def _pairs(links):
    return {tuple(sorted([l["from"], l["to"]])) for l in links}


def test_auto_extraction_matches_golden(systems):
    assert _pairs(extract_links(systems)) == _pairs(golden("auto_links.json"))


def test_auto_extraction_count_matches_the_frozen_capture(systems):
    """The count check that CAN run everywhere: not a claim about the real
    baseline, a claim that the miner still agrees with its captured output."""
    assert len(extract_links(systems)) == len(golden("auto_links.json"))


def test_a_system_never_links_to_itself(systems):
    assert all(l["from"] != l["to"] for l in extract_links(systems))


def test_each_pair_appears_once(systems):
    links = extract_links(systems)
    assert len(_pairs(links)) == len(links)


def test_merge_produces_fourteen(systems, overrides):
    merged = merge_links(extract_links(systems), overrides)
    assert len(merged) == 14


def test_merge_keeps_all_manual_links(systems, overrides):
    merged = merge_links(extract_links(systems), overrides)
    for m in overrides["cross_links"]:
        assert tuple(sorted([m["from"], m["to"]])) in _pairs(merged)


def test_merge_drops_every_suppressed_pair(systems, overrides):
    merged = merge_links(extract_links(systems), overrides)
    for pair in overrides["suppress_links"]:
        assert tuple(sorted(pair)) not in _pairs(merged)


def test_the_merge_law_accounts_for_every_link(systems, overrides):
    """WHAT THIS DOES AND DOES NOT COVER, because it claimed more than it did.

    It restates merge_links as a set expression - hand-curated, plus the mined
    pairs that are neither hand-curated nor suppressed - and asserts the
    implementation agrees. That is a mirror: the expression below is the same
    rule the implementation applies, so a change made in both places passes
    here by construction. Mutation testing confirmed it: deleting the
    manual-wins dedupe from merge_links left this test green.

    It survives as a total-accounting statement - no merged pair comes from
    nowhere, and none of the three inputs is dropped wholesale - and nothing
    more. The `len` line looks like a duplicate guard but cannot act as one on
    this input: none of the sample's hand-curated pairs is also mined, so the
    two sides have the same length whether or not the dedupe exists. The test
    below supplies the overlap that makes the branches differ, and is the one
    that actually holds the dedupe in place.
    """
    auto = extract_links(systems)
    manual = {tuple(sorted([m["from"], m["to"]])) for m in overrides["cross_links"]}
    suppressed = {tuple(sorted(p)) for p in overrides["suppress_links"]}

    merged = merge_links(auto, overrides)
    expected = manual | (_pairs(auto) - manual - suppressed)

    assert _pairs(merged) == expected
    assert len(merged) == len(expected)


def test_a_hand_curated_pair_that_is_also_mined_appears_once(systems):
    """The overlap case, which no fixture in this repo produces.

    The sample's curated cross_links name pairs the prose does not mine, so the
    merge never reaches its dedupe branch and a build that dropped the branch
    entirely passed the whole suite. Rather than wait for a curator to write an
    overlapping pair, this takes a pair the miner just found and hands it back
    as hand curation, which guarantees the overlap on any input.

    The curated row must REPLACE the mined one, not join it: two rows for one
    pair draw two edges between the same nodes, and the second carries the
    miner's generated label instead of the curator's.
    """
    auto = extract_links(systems)
    assert auto, "the sample matrix must mine at least one link for this test"

    mined = auto[0]
    pair = tuple(sorted([mined["from"], mined["to"]]))
    ov = {"cross_links": [{"from": mined["from"], "to": mined["to"],
                           "label": "hand-curated"}],
          "suppress_links": []}

    merged = merge_links(auto, ov)
    rows = [l for l in merged if tuple(sorted([l["from"], l["to"]])) == pair]

    assert len(rows) == 1
    assert rows[0]["label"] == "hand-curated"
    assert rows[0]["extraction_method"] == "override"
    assert len(merged) == len(auto)


def test_suppressing_a_pair_that_is_also_hand_curated_keeps_the_curated_link(systems):
    """The documented precedence, stated as behaviour rather than as the
    expression that implements it: suppression speaks to the MINED set, so a
    curator who lists a pair in both cross_links and suppress_links has asked
    for their own link and against the miner's, and gets theirs.

    Untested until now, and the merge law above cannot cover it: that test
    derives its expectation from the same expression, so it agrees with
    whichever way the precedence goes.
    """
    auto = extract_links(systems)
    assert auto, "the sample matrix must mine at least one link for this test"

    mined = auto[0]
    pair = tuple(sorted([mined["from"], mined["to"]]))
    ov = {"cross_links": [{"from": mined["from"], "to": mined["to"],
                           "label": "hand-curated"}],
          "suppress_links": [list(pair)]}

    merged = merge_links(auto, ov)
    rows = [l for l in merged if tuple(sorted([l["from"], l["to"]])) == pair]

    assert len(rows) == 1
    assert rows[0]["extraction_method"] == "override"


def test_suppressing_a_mined_pair_that_nobody_curated_drops_it(systems):
    """The other half of the precedence, so the test above cannot be satisfied
    by a merge that ignores suppress_links altogether."""
    auto = extract_links(systems)
    assert auto, "the sample matrix must mine at least one link for this test"

    pair = tuple(sorted([auto[0]["from"], auto[0]["to"]]))
    merged = merge_links(auto, {"cross_links": [], "suppress_links": [list(pair)]})

    assert pair not in _pairs(merged)
    assert len(merged) == len(auto) - 1


def test_a_manual_link_wins_over_an_identical_auto_link(systems):
    """The expected pair is written in sorted order because _pairs sorts. It
    used to be written unsorted, so the filter matched nothing and the
    assertion compared 0 to 1 on every possible input."""
    ov = {"cross_links": [{"from": "ucop", "to": "crosslink", "label": "hand-curated"}],
          "suppress_links": []}
    merged = merge_links(extract_links(systems), ov)
    match = [l for l in merged if _pairs([l]) == {("crosslink", "ucop")}]
    assert len(match) == 1
    assert match[0]["label"] == "hand-curated"
    assert match[0]["extraction_method"] == "override"


def test_merge_with_no_overrides_returns_the_auto_links(systems):
    auto = extract_links(systems)
    assert len(merge_links(auto, {})) == len(auto)


def test_every_link_records_how_it_was_extracted(systems, overrides):
    """Phase 2 stores extraction_method and evidence per link. Setting it here
    means the provenance exists from the first bundle rather than being
    backfilled later."""
    merged = merge_links(extract_links(systems), overrides)
    assert {l["extraction_method"] for l in merged} == {"prose", "override"}
