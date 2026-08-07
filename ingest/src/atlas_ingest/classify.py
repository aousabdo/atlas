"""Owner and risk classification, ported from build_cuas_tool_v4.py:236-275.

classify_owner walks OWNER_RULES in order and the first match wins, so the
ordering in config.py is load-bearing. Substrings of four characters or fewer
match on word boundaries, which is what keeps "office" out of the ICE rule.
"""
import re

from .config import (
    ALWAYS_SOFT, HIGH_KEYWORDS, LOW_KEYWORDS, MEDIUM_KEYWORDS, NEVER_SOFT,
    OWNER_GROUP_DISPLAY, OWNER_RULES, SOFT_KEYWORDS,
)
from .identity import make_id

_EXTERNAL = ("ext", "External /\nIndustry", "ext")


def classify_owner(raw_owner, system_name=""):
    """Raw owner string -> (group_id, group_label, color_key, is_soft)."""
    if not raw_owner:
        return (*_EXTERNAL, True)

    sid = make_id(system_name)
    is_soft = any(kw in raw_owner.lower() for kw in SOFT_KEYWORDS)
    if sid in ALWAYS_SOFT:
        is_soft = True
    if sid in NEVER_SOFT:
        is_soft = False

    for substring, gid, glabel, ckey in OWNER_RULES:
        if len(substring) <= 4:
            if re.search(r"\b" + re.escape(substring) + r"\b", raw_owner, re.IGNORECASE):
                return (gid, glabel, ckey, is_soft)
        elif substring.lower() in raw_owner.lower():
            return (gid, glabel, ckey, is_soft)

    return (*_EXTERNAL, is_soft)


def classify_risk(risk_text):
    """Risk prose -> high | medium | low.

    Precedence is high, then low, then medium; an unmatched non-empty string
    is medium. Note the 5MAR workbook fills Risk Level on every row, so this
    heuristic is not exercised by the golden matrix and its unit tests are the
    only coverage it has.
    """
    if not risk_text:
        return "medium"
    lo = risk_text.lower()
    for kw in HIGH_KEYWORDS:
        if kw in lo:
            return "high"
    for kw in LOW_KEYWORDS:
        if kw in lo:
            return "low"
    for kw in MEDIUM_KEYWORDS:
        if kw in lo:
            return "medium"
    return "medium"


def owner_group_display(gid):
    """Group id -> the label the analytics views show."""
    return OWNER_GROUP_DISPLAY.get(gid, "Other DHS")
