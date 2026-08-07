"""Integration links mined from the Existing Interfaces prose, then merged
with hand curation.

extract_links is build_cuas_tool_v4.py:387-420; merge_links is the link-merge
half of build_tree at 501-521, lifted out so it can be tested on its own.

Extraction is substring matching over system names plus a curated fragment
vocabulary, deduplicated by unordered pair. It is lossy by nature, which is
why every link records how it was derived.
"""
import re

from .config import LABEL_MAP, LINK_NAME_FRAGMENTS


def _fragment_index(systems):
    """fragment -> system id. Curated fragments first, then every system's full
    name and its parenthetical-stripped short form."""
    frag_to_id = dict(LINK_NAME_FRAGMENTS)
    for s in systems:
        raw = s["name"]
        frag_to_id[raw.lower()] = s["id"]
        short = re.sub(r"\s*\(.*?\)\s*", "", raw).strip()
        if short.lower() != raw.lower() and len(short) > 3:
            frag_to_id[short.lower()] = s["id"]
    return frag_to_id


def _display(sid, systems):
    if sid in LABEL_MAP:
        return LABEL_MAP[sid].replace("\n", " ")
    match = next((x for x in systems if x["id"] == sid), None)
    return match["name"] if match else sid


def extract_links(systems):
    """Mine each system's integration prose for mentions of other systems."""
    frag_to_id = _fragment_index(systems)
    links, seen = [], set()

    for s in systems:
        text = (s.get("integ") or "").lower()
        if not text:
            continue
        src = s["id"]
        for frag, tid in frag_to_id.items():
            if tid == src or frag not in text:
                continue
            pair = tuple(sorted([src, tid]))
            if pair in seen:
                continue
            seen.add(pair)
            links.append({
                "from": src,
                "to": tid,
                "label": f"{_display(src, systems)} - {_display(tid, systems)}",
                "extraction_method": "prose",
            })
    return links


def merge_links(auto_links, overrides):
    """Hand-curated links win; suppressed pairs are dropped from the auto set.

    Order matters for reproducibility: manual links first in file order, then
    surviving auto links in extraction order.
    """
    overrides = overrides or {}
    manual = [dict(m, extraction_method="override")
              for m in overrides.get("cross_links", [])]
    manual_pairs = {tuple(sorted([m["from"], m["to"]])) for m in manual}
    suppressed = {tuple(sorted(p)) for p in overrides.get("suppress_links", [])}

    kept = [
        a for a in auto_links
        if (pair := tuple(sorted([a["from"], a["to"]]))) not in manual_pairs
        and pair not in suppressed
    ]
    return manual + kept


def desired_links(overrides):
    """To-be integrations. These are pure curation; nothing mines them."""
    return [dict(d, extraction_method="override")
            for d in (overrides or {}).get("desired_links", [])]
