from atlas_ingest.classify import classify_owner, owner_group_display


def test_empty_owner_is_external_and_soft():
    assert classify_owner("") == ("ext", "External /\nIndustry", "ext", True)


def test_first_match_wins_dhs_st_before_anything_else():
    gid, _, _, _ = classify_owner("DHS S&T and CBP jointly")
    assert gid == "dhs-st"


def test_uscg_cbp_routes_to_dhs_hq_not_cbp():
    """The USCG/CBP rule sits above the bare CBP rule specifically so Beacon
    lands in DHS HQ. Reordering OWNER_RULES breaks this."""
    gid, _, _, _ = classify_owner("USCG/CBP", "Beacon")
    assert gid == "dhshq"


def test_short_substrings_match_on_word_boundaries_only():
    """'office' must not match the ICE rule."""
    gid, _, _, _ = classify_owner("Some office of coordination")
    assert gid == "ext"


def test_ice_matches_as_a_whole_word():
    gid, _, _, _ = classify_owner("ICE HSI")
    assert gid == "otherdhs"


def test_soft_keyword_marks_ownership_unconfirmed():
    _, _, _, soft = classify_owner("CBP (confirm)", "some_system")
    assert soft is True


def test_always_soft_overrides_a_clean_owner_string():
    _, _, _, soft = classify_owner("DHS HQ", "Beacon")
    assert soft is True


def test_never_soft_overrides_a_soft_keyword():
    _, _, _, soft = classify_owner("Industry, awaiting sign-off",
                                   "GANTRY (Ground Antenna Towers)")
    assert soft is False


def test_unknown_owner_falls_through_to_external():
    gid, label, ck, _ = classify_owner("Ministry of Silly Walks")
    assert (gid, ck) == ("ext", "ext")
    assert label == "External /\nIndustry"


def test_owner_group_display_is_a_pure_lookup():
    assert owner_group_display("dhshq") == "DHS HQ/OCIO"
    assert owner_group_display("nonsense") == "Other DHS"
