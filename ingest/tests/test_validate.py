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


def test_matrix_id_exists_false_on_a_matrix_system_fails():
    """The inverse of the gate above, and it went unchecked for longer.

    The flag and matrix membership are two readings of one fact, and the gate
    only ever looked for an id the matrix lacked. A mapping declaring
    matrix_id_exists false for an id the matrix DOES carry passed validation,
    and then every consumer downstream read whichever signal it happened to
    test: lossiness._realization_gap counted the mapping, and
    curation.mapping_confidence_counts excluded it. Reproduced end to end in
    test_lossiness.test_realization_gap_ignores_a_flag_that_contradicts_the_matrix,
    where both figures were rendered in one card.
    """
    sdmap = _site(mappings={"ucop": {"devices": ["d1"], "matrix_id_exists": False}})
    fails = validate(**_inputs(sdmap=sdmap))
    assert len(fails) == 1
    assert "ucop" in fails[0]
    assert "does carry" in fails[0]


def test_a_mapping_with_no_flag_at_all_is_still_fine():
    """The gate is about disagreement, not about requiring the flag. Almost
    every mapping names a matrix id and carries no flag."""
    sdmap = _site(mappings={"ucop": {"devices": ["d1"]}})
    assert validate(**_inputs(sdmap=sdmap)) == []


def test_matrix_id_exists_true_on_a_matrix_system_is_fine():
    """Only `is False` is the curator's declaration of absence. An explicit
    true agrees with the matrix and must not be read as a disagreement."""
    sdmap = _site(mappings={"ucop": {"devices": ["d1"], "matrix_id_exists": True}})
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


GAP_ROW = {"id": "gap", "name": "Gap", "cat": "Workflow shortfall", "risk": "high",
           "risk_source": "explicit", "soft": False}


def test_hardware_mapped_to_a_shortfall_row_fails():
    """A shortfall row records that no system exists, so naming devices for it
    contradicts the row. Left through, the realization gap would leave it out
    while the confidence tally and the Network tab counted it as realized."""
    systems = _inputs()["systems"] + [GAP_ROW]
    sdmap = _site(mappings={"gap": {"devices": ["d1"]}})
    fails = validate(**_inputs(systems=systems, sdmap=sdmap))
    assert len(fails) == 1
    assert "gap" in fails[0]
    assert "shortfall" in fails[0]


def test_a_shortfall_row_mapped_with_no_devices_fails_too():
    """An empty mapping reads as a survey gap: a system someone recorded with no
    hardware found yet. A shortfall row can never have hardware, so that label
    would be false. A checked absence goes under not_deployed_at_site."""
    systems = _inputs()["systems"] + [GAP_ROW]
    sdmap = _site(mappings={"gap": {"devices": []}})
    fails = validate(**_inputs(systems=systems, sdmap=sdmap))
    assert len(fails) == 1
    assert "not_deployed_at_site" in fails[0]


def test_a_shortfall_row_checked_absent_is_fine():
    systems = _inputs()["systems"] + [GAP_ROW]
    sdmap = _site(not_deployed_at_site={"gap": "checked, absent"})
    assert validate(**_inputs(systems=systems, sdmap=sdmap)) == []


def test_a_planned_link_to_an_unknown_system_fails():
    """Planned links are curation, and a typo in one used to reach the planning
    view as a link to nothing, with its facts made up. Same gate as current links."""
    desired = [{"from": "ucop", "to": "ghost", "label": "x", "extraction_method": "override"}]
    fails = validate(**_inputs(), desired=desired)
    assert fails == ["desired link ucop->ghost: 'ghost' is not a matrix system id"]


def test_a_planned_link_between_known_systems_is_fine():
    desired = [{"from": "ucop", "to": "ucop2", "label": "x", "extraction_method": "override"}]
    systems = _inputs()["systems"] + [{"id": "ucop2", "name": "Second", "risk": "low",
                                       "risk_source": "explicit", "soft": False}]
    assert validate(**_inputs(systems=systems), desired=desired) == []


# --- decision_roots: where decisions are made, a curated judgement ----------
NET = {"northgate": {"site_id": "northgate", "devices": [{"id": "d1"}, {"id": "d2"}],
                     "edges": [], "zones": {}, "meta": {"device_count": 2}}}
GOOD_ROOTS = {"devices": ["d1", "d2"], "assumed": ["d2"], "note": "Chosen by the site lead."}


def _roots(**over):
    return {**GOOD_ROOTS, **over}


def test_declared_decision_roots_pass():
    assert validate(**_inputs(sdmap=_site(decision_roots=GOOD_ROOTS), networks=NET)) == []


def test_empty_decision_roots_fail():
    fails = validate(**_inputs(sdmap=_site(decision_roots=_roots(devices=[], assumed=[])),
                               networks=NET))
    assert fails == ["system_device_map.sites.northgate.decision_roots: devices is empty; "
                     "omit decision_roots to measure from the drawing's entry points"]


def test_a_decision_root_not_in_the_topology_fails():
    fails = validate(**_inputs(sdmap=_site(decision_roots=_roots(devices=["d1", "ghost"], assumed=[])),
                               networks=NET))
    assert fails == ["system_device_map.sites.northgate.decision_roots: device 'ghost' is "
                     "not in the northgate topology"]


def test_a_decision_root_listed_twice_fails():
    fails = validate(**_inputs(sdmap=_site(decision_roots=_roots(devices=["d1", "d1"], assumed=[])),
                               networks=NET))
    assert fails == ["system_device_map.sites.northgate.decision_roots: device 'd1' is listed twice"]


def test_an_assumed_root_that_is_not_declared_fails():
    fails = validate(**_inputs(sdmap=_site(decision_roots=_roots(assumed=["d9"])), networks=NET))
    assert fails == ["system_device_map.sites.northgate.decision_roots.assumed: 'd9' is not "
                     "one of its devices"]


def test_decision_roots_without_a_note_fail():
    fails = validate(**_inputs(sdmap=_site(decision_roots=_roots(note="  ")), networks=NET))
    assert fails == ["system_device_map.sites.northgate.decision_roots: no note; say who "
                     "chose these positions and why"]


def test_a_note_of_characters_only_one_engine_calls_space_is_blank_in_both():
    """str.strip() and String.trim() disagree on U+FEFF, U+001C-001F and U+0085.
    Both engines refuse all of them, and accept a note with a real word."""
    for blank in ["\ufeff", "\u001c", "\u001f", "\u0085", "\u00a0\u3000"]:
        fails = validate(**_inputs(sdmap=_site(decision_roots=_roots(note=blank)), networks=NET))
        assert fails == ["system_device_map.sites.northgate.decision_roots: no note; say who "
                         "chose these positions and why"], repr(blank)
    assert validate(**_inputs(sdmap=_site(decision_roots=_roots(note="\ufeffSite lead")),
                              networks=NET)) == []


def test_decision_roots_are_checked_without_a_topology_except_for_existence():
    """Only the existence check needs the drawing. The rest are facts about the
    block itself, so a partial build still refuses a block that cannot be right."""
    assert validate(**_inputs(sdmap=_site(decision_roots=_roots(devices=["ghost"], assumed=[])),
                              networks={})) == []
    fails = validate(**_inputs(sdmap=_site(decision_roots=_roots(note="")), networks={}))
    assert len(fails) == 1 and "no note" in fails[0]


def test_decision_roots_that_are_not_an_object_fail():
    fails = validate(**_inputs(sdmap=_site(decision_roots=["d1"]), networks=NET))
    assert fails == ["system_device_map.sites.northgate.decision_roots: must be an object "
                     "with devices, assumed and note"]


def test_decision_root_devices_that_are_not_a_list_of_ids_fail():
    for bad in ("d1", {"d1": True}, [1, 2]):
        fails = validate(**_inputs(sdmap=_site(decision_roots=_roots(devices=bad, assumed=[])),
                                   networks=NET))
        assert fails == ["system_device_map.sites.northgate.decision_roots: devices must be a "
                         "list of device ids"], bad


def test_assumed_that_is_not_a_list_of_ids_fails():
    fails = validate(**_inputs(sdmap=_site(decision_roots=_roots(assumed={"d2": True})), networks=NET))
    assert fails == ["system_device_map.sites.northgate.decision_roots.assumed: must be a list "
                     "of device ids"]


def test_an_assumption_listed_twice_fails():
    fails = validate(**_inputs(sdmap=_site(decision_roots=_roots(assumed=["d2", "d2"])), networks=NET))
    assert fails == ["system_device_map.sites.northgate.decision_roots.assumed: 'd2' is listed twice"]
