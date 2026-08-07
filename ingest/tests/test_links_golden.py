from atlas_ingest.links import extract_links, merge_links

from conftest import golden


def _pairs(links):
    return {tuple(sorted([l["from"], l["to"]])) for l in links}


def test_auto_extraction_finds_exactly_sixteen(systems):
    assert len(extract_links(systems)) == 16


def test_auto_extraction_matches_golden(systems):
    assert _pairs(extract_links(systems)) == _pairs(golden("auto_links.json"))


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


def test_suppression_removes_exactly_four_auto_links(systems, overrides):
    """16 auto - 4 suppressed + 2 manual = 14. If this drifts, either the
    prose changed or a suppress entry stopped matching anything."""
    auto = extract_links(systems)
    suppressed = {tuple(sorted(p)) for p in overrides["suppress_links"]}
    assert len(_pairs(auto) & suppressed) == 4


def test_a_manual_link_wins_over_an_identical_auto_link(systems):
    ov = {"cross_links": [{"from": "ucop", "to": "crosslink", "label": "hand-curated"}],
          "suppress_links": []}
    merged = merge_links(extract_links(systems), ov)
    match = [l for l in merged if _pairs([l]) == {("ucop", "crosslink")}]
    assert len(match) == 1
    assert match[0]["label"] == "hand-curated"


def test_merge_with_no_overrides_returns_the_auto_links(systems):
    auto = extract_links(systems)
    assert len(merge_links(auto, {})) == len(auto)


def test_every_link_records_how_it_was_extracted(systems, overrides):
    """Phase 2 stores extraction_method and evidence per link. Setting it here
    means the provenance exists from the first bundle rather than being
    backfilled later."""
    merged = merge_links(extract_links(systems), overrides)
    assert {l["extraction_method"] for l in merged} == {"prose", "override"}
