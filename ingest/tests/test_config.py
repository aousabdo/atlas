"""config.py is data. Anything mutable at module scope is a bug: the old
OWNER_GROUP_MAP_RUNTIME was a module global mutated in main() and read during
rendering, which cannot survive concurrent use.
"""
import types

from atlas_ingest import config


def test_owner_group_display_covers_every_rule_target():
    targets = {gid for _, gid, _, _ in config.OWNER_RULES}
    assert targets <= set(config.OWNER_GROUP_DISPLAY)


def test_owner_group_display_is_exactly_the_six_known_groups():
    assert config.OWNER_GROUP_DISPLAY == {
        "dhs-st": "DHS S&T",
        "cbp": "CBP",
        "otherdhs": "Other DHS",
        "dhshq": "DHS HQ/OCIO",
        "dod": "DoD",
        "ext": "External",
    }


def test_no_mutable_module_state():
    """Every public module attribute is either immutable or a container the
    package never writes to. Guards against a runtime map creeping back in."""
    banned = []
    for name in dir(config):
        if name.startswith("_"):
            continue
        value = getattr(config, name)
        if isinstance(value, types.ModuleType):
            continue
        if not isinstance(value, (str, int, float, bool, tuple, frozenset, dict, list, set)):
            banned.append(name)
    assert banned == []


def test_table_sizes_match_the_source_script():
    """Counted from build_cuas_tool_v4.py on 2026-08-05. A table that silently
    loses a row changes classification for whichever systems it covered."""
    assert len(config.OWNER_RULES) == 23
    assert len(config.ID_MAP) == 36
    assert len(config.LABEL_MAP) == 32
    assert len(config.LINK_NAME_FRAGMENTS) == 21
    assert len(config.CATEGORY_MAP) == 8
    assert len(config.HIGH_KEYWORDS) == 19
    assert len(config.LOW_KEYWORDS) == 3
    assert len(config.MEDIUM_KEYWORDS) == 9
    assert config.ALWAYS_SOFT == {"scan", "beacon", "ember", "fathom", "halyard", "jetty"}
    assert config.NEVER_SOFT == {"gantry"}
    assert config.SOFT_GROUPS == {"dod", "ext"}


def test_labels_carry_real_newlines_not_js_escapes():
    """The old tables double-escaped newlines to survive Python-to-JS string
    injection. JSON transports them directly, so a literal backslash-n here
    would render as visible characters in a node label."""
    for value in config.LABEL_MAP.values():
        assert "\\n" not in value
    for _, _, glabel, _ in config.OWNER_RULES:
        assert "\\n" not in glabel
    for entry in config.CATEGORY_MAP.values():
        assert "\\n" not in entry["label"]
