from atlas_ingest.validate import validate


def _inputs(**over):
    base = {
        "systems": [{"id": "ucop", "name": "UAS Common Picture", "risk": "high",
                     "risk_source": "explicit", "soft": False}],
        "links": [],
        "sdmap": {"sites": {}, "pending_review": {}},
        "networks": {},
        "crosswalk": [{"orig": "r", "sys": "s", "current": ["UAS Common Picture"],
                       "status": "Condensed"}],
        "glossary": {"acronyms": [{"acr": "A", "meaning": "B"}], "out_of_scope": [],
                     "confidence_intro": "x", "methodology_extras": {}},
    }
    base.update(over)
    return base


def _site(**over):
    site = {"mappings": {}, "not_deployed_at_site": {},
            "unclaimed_devices": {"infrastructure": []}}
    site.update(over)
    return {"sites": {"northgate": site}, "pending_review": {}}


def test_clean_inputs_produce_no_failures():
    assert validate(**_inputs()) == []


def test_a_mapping_to_an_unknown_system_fails():
    sdmap = _site(mappings={"ghost": {"devices": ["d1"]}})
    assert any("ghost" in f for f in validate(**_inputs(sdmap=sdmap)))


def test_matrix_id_exists_false_exempts_a_mapping():
    """The escape hatch is a documented negative fact, not a loophole to be
    closed. 'atak' uses it legitimately."""
    sdmap = _site(mappings={"atak": {"devices": ["d1"], "matrix_id_exists": False}})
    assert validate(**_inputs(sdmap=sdmap)) == []


def test_a_not_deployed_entry_for_an_unknown_system_fails():
    sdmap = _site(not_deployed_at_site={"ghost": "checked"})
    assert any("ghost" in f for f in validate(**_inputs(sdmap=sdmap)))


def test_a_mapping_to_an_unknown_device_fails():
    sdmap = _site(mappings={"ucop": {"devices": ["nosuchdevice"]}})
    networks = {"northgate": {"site_id": "northgate", "devices": [{"id": "d1"}],
                               "edges": [], "zones": {}, "meta": {"device_count": 1}}}
    fails = validate(**_inputs(sdmap=sdmap, networks=networks))
    assert any("nosuchdevice" in f for f in fails)


def test_device_checks_are_skipped_when_no_topology_was_supplied():
    """Without the site's topology there is nothing to check against, and
    inventing a failure would block a legitimate partial build."""
    sdmap = _site(mappings={"ucop": {"devices": ["anything"]}})
    assert validate(**_inputs(sdmap=sdmap, networks={})) == []


def test_an_unclaimed_device_that_does_not_exist_fails():
    sdmap = _site(unclaimed_devices={"infrastructure": ["ghostdevice"]})
    networks = {"northgate": {"site_id": "northgate", "devices": [{"id": "d1"}],
                               "edges": [], "zones": {}, "meta": {"device_count": 1}}}
    assert any("ghostdevice" in f for f in validate(**_inputs(sdmap=sdmap, networks=networks)))


def test_a_link_to_an_unknown_system_fails():
    fails = validate(**_inputs(links=[{"from": "ucop", "to": "ghost", "label": "x"}]))
    assert any("ghost" in f for f in fails)


def test_a_crosswalk_row_naming_an_unknown_system_fails():
    cw = [{"orig": "r", "sys": "s", "current": ["Nonexistent System"],
           "status": "Split out"}]
    assert any("Nonexistent System" in f for f in validate(**_inputs(crosswalk=cw)))


def test_a_dropped_crosswalk_row_needs_no_systems():
    cw = [{"orig": "r", "sys": "s", "current": [], "status": "Didn't keep"}]
    assert validate(**_inputs(crosswalk=cw)) == []


def test_an_empty_glossary_fails():
    assert any("acronym" in f.lower() for f in validate(
        **_inputs(glossary={"acronyms": [], "out_of_scope": [],
                            "confidence_intro": "", "methodology_extras": {}})))


def test_all_failures_are_collected_not_just_the_first():
    """Fixing one problem per run is how a five-error dataset takes five
    builds to clean up."""
    sdmap = _site(
        mappings={"ghost1": {"devices": ["d"]}, "ghost2": {"devices": ["d"]}},
        not_deployed_at_site={"ghost3": "x"},
    )
    assert len(validate(**_inputs(sdmap=sdmap))) >= 3


def test_validate_is_pure_and_returns_strings():
    out = validate(**_inputs())
    assert isinstance(out, list)
    assert all(isinstance(f, str) for f in out)


def test_this_run_s_dataset_passes_every_gate(
    systems, links, sdmap, networks, crosswalk, glossary,
):
    """The dataset this run read must clear its own gates, or the gates are
    wrong.

    That dataset is the generated sample workbook, in every mode. This used to
    say "and against the reference data when ATLAS_SOURCE_REPO names it", which
    was never true: with the variable set, this test errored along with 98
    others because the fixtures resolved paths a real checkout does not carry.
    Reference data now adds the reserved tests in test_source_layout.py rather
    than redirecting this one.
    """
    fails = validate(
        systems=systems,
        links=links,
        sdmap=sdmap,
        networks=networks,
        crosswalk=crosswalk,
        glossary=glossary,
    )
    assert fails == []
