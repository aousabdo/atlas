"""System name -> short id and display label.

Ported from build_cuas_tool_v4.py:210-233 with no behaviour change; labels
carry real newlines instead of the JS-escaped form the old string injection
required.
"""
import re

from .config import ID_MAP, LABEL_MAP


def make_id(name):
    """Map a system name to its short id, falling back to a slug.

    The second lookup exists because several matrix names carry a
    parenthetical that the curated table omits, e.g. "SCAN (Automated Targeting
    System)" resolves only after the parenthetical is stripped.
    """
    n = name.strip()
    if n in ID_MAP:
        return ID_MAP[n]
    short = re.sub(r"\s*\(.*?\)\s*", "", n).strip()
    if short in ID_MAP:
        return ID_MAP[short]
    return re.sub(r"[^a-z0-9]+", "_", short.lower()).strip("_")[:30]


def make_label(name):
    """Display label: the curated short name, else the name wrapped at its
    midpoint so a long label fits inside a node."""
    sid = make_id(name)
    if sid in LABEL_MAP:
        return LABEL_MAP[sid]
    s = re.sub(r"\s*\(.*?\)\s*", "", name).strip()
    if len(s) < 3:
        s = name.strip()
    if len(s) > 14 and " " in s:
        words = s.split()
        mid = len(words) // 2
        s = " ".join(words[:mid]) + "\n" + " ".join(words[mid:])
    return s
