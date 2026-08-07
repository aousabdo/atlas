"""Reflect the live classification constants into a UI payload.

The Reference tab renders exactly these values, so the documented behaviour
cannot drift from the implemented behaviour. Ported from
build_cuas_tool_v4.py:747-761 and extended with the tables the old payload
omitted, notably the owner rules themselves: their order is load-bearing and
was previously invisible to anyone reading the tool.
"""
from . import config


def extract_methodology():
    return {
        "high_keywords": list(config.HIGH_KEYWORDS),
        "low_keywords": list(config.LOW_KEYWORDS),
        "medium_keywords": list(config.MEDIUM_KEYWORDS),
        "soft_keywords": list(config.SOFT_KEYWORDS),
        "always_soft": sorted(config.ALWAYS_SOFT),
        "never_soft": sorted(config.NEVER_SOFT),
        "soft_groups": sorted(config.SOFT_GROUPS),
        "owner_rules_count": len(config.OWNER_RULES),
        "owner_rules": [
            {
                "priority": i,
                "match": sub,
                "group_id": gid,
                "group_label": glabel.replace("\n", " "),
                "match_mode": "word_boundary" if len(sub) <= 4 else "substring",
            }
            for i, (sub, gid, glabel, _ck) in enumerate(config.OWNER_RULES)
        ],
        "category_map": {
            k: {"branch": v["branch"], "label": v["label"].replace("\n", " ")}
            for k, v in config.CATEGORY_MAP.items()
        },
        "link_fragment_count": len(config.LINK_NAME_FRAGMENTS),
        "id_alias_count": len(config.ID_MAP),
    }
