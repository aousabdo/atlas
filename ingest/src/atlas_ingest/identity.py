"""System name -> short id and display label.

Ported from build_cuas_tool_v4.py:210-233 with no behaviour change; labels
carry real newlines instead of the JS-escaped form the old string injection
required.
"""
import re

from .config import ID_MAP, LABEL_MAP

#: Longest id make_id will emit.
#:
#: An id keys every mapping, every link end, every DOM id and every cross-file
#: reference, so it is kept short enough to read in a URL and in a JSON key.
ID_MAX_CHARS = 30

#: Hex digits of the fingerprint appended when a slug will not fit the budget.
#:
#: 32 bits of FNV-1a. The budget spends 21 characters on readable prefix and 9
#: on the separator and the fingerprint, which lands exactly on ID_MAX_CHARS.
_FINGERPRINT_CHARS = 8

_FNV_OFFSET_BASIS = 0x811C9DC5
_FNV_PRIME = 0x01000193
_UINT32 = 0xFFFFFFFF


def _fingerprint(slug):
    """FNV-1a over the whole slug, as 8 hex digits.

    The slug is [a-z0-9_] by construction, so its UTF-8 bytes are its code
    points and the JavaScript twin can hash charCodeAt directly and get the
    same answer. Mirrored by fingerprint in src/data/localFileParse.ts, and
    pinned to literal ids in both suites so neither can drift.
    """
    h = _FNV_OFFSET_BASIS
    for byte in slug.encode("utf-8"):
        h ^= byte
        h = (h * _FNV_PRIME) & _UINT32
    return format(h, "0%dx" % _FINGERPRINT_CHARS)


#: Character budget for one line of a wrapped label.
#:
#: Aesthetic, not a fit guarantee: a character count cannot know how wide a
#: glyph is, and the node box is what actually guarantees the text fits (see
#: geometryFor in src/tabs/map/TreeNode.tsx). What this buys is a label shaped
#: like a label, a few short lines rather than one long ribbon, for names
#: nobody has curated. 14 is the threshold the previous rule used, and most of
#: the curated table was already written to it.
LABEL_LINE_CHARS = 14


# The parenthetical strip, and why it leaves a space behind.
#
# The old expression was r"\s*\(.*?\)\s*" replaced with "", which eats the
# whitespace on BOTH sides. A trailing parenthetical, which is the common shape
# and the only one the sample carries, came out right; an interior one joined
# the words around it, so "Ridge (Legacy Variant) Watch" became "RidgeWatch".
# Replacing with a single space and collapsing afterwards is correct for both
# positions, and the trailing case still trims to the same answer.
#
# Mirrored by stripParenthetical in src/data/localFileParse.ts.
_PARENTHETICAL = re.compile(r"\s*\([^)]*\)\s*")


def strip_parenthetical(name):
    return re.sub(r"\s+", " ", _PARENTHETICAL.sub(" ", name)).strip()

def make_id(name):
    """Map a system name to its short id, falling back to a slug.

    The second lookup exists because several matrix names carry a
    parenthetical that the curated table omits, e.g. "SCAN (Automated Targeting
    System)" resolves only after the parenthetical is stripped.

    Why the fallback fingerprints instead of truncating.

    The rule used to be slug[:30], and a plain truncation is not injective:
    "Coastal Perimeter Surveillance and Tracking Alpha" and the same name
    ending "Bravo" both came out "coastal_perimeter_surveillance". Nothing
    anywhere gated ids for uniqueness, so the two rows became one id and
    whichever was read second replaced the first in every dict keyed by id.
    That is a system disappearing from the matrix with no message.

    A slug over the budget therefore keeps a readable prefix and carries a
    fingerprint of the WHOLE slug, so two names that differ anywhere differ
    here. It stays a pure function of one name, which is what lets the
    TypeScript twin be a transliteration rather than a second gate that has to
    be wired into a second call site and kept in step by hand.

    What still merges is only what is meant to: two names that normalise to the
    same slug are the same name as far as this tool is concerned, which is the
    point of stripping the parenthetical and folding punctuation.
    """
    n = name.strip()
    if n in ID_MAP:
        return ID_MAP[n]
    short = strip_parenthetical(n)
    if short in ID_MAP:
        return ID_MAP[short]
    slug = re.sub(r"[^a-z0-9]+", "_", short.lower()).strip("_")
    if len(slug) <= ID_MAX_CHARS:
        return slug
    keep = slug[: ID_MAX_CHARS - _FINGERPRINT_CHARS - 1].rstrip("_")
    return keep + "_" + _fingerprint(slug)


def wrap_label(text):
    """Greedy word wrap to LABEL_LINE_CHARS, transliterated in makeLabel.

    The guarantee is the point: no line comes out over the budget unless it is
    a single word that cannot be broken at a space. The rule it replaces split
    the word list down the middle and made no claim about the halves, so a
    five-word name became two fifteen-character lines and both overflowed.

    Long names are allowed as many lines as they need. Capping the line count
    would mean either dropping words or letting the last line run long, and the
    first loses information while the second gives back the guarantee.
    """
    lines = []
    line = ""
    for word in text.split():
        if not line:
            line = word
        elif len(line) + 1 + len(word) <= LABEL_LINE_CHARS:
            line += " " + word
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return "\n".join(lines)


def make_label(name):
    """Display label: the curated short name, else the name wrapped to fit.

    A curated label is returned exactly as written, line breaks included, even
    when it is longer than the budget. That table is where a human says how a
    name should read, and re-wrapping it here would overrule the only place
    that decision can be made. Nothing is lost by honouring it: the node box
    sizes itself to whatever label it is handed.
    """
    sid = make_id(name)
    if sid in LABEL_MAP:
        return LABEL_MAP[sid]
    s = strip_parenthetical(name)
    if len(s) < 3:
        s = name.strip()
    return wrap_label(s)
