"""System name -> short id and display label.

Ported from build_cuas_tool_v4.py:210-233 with no behaviour change; labels
carry real newlines instead of the JS-escaped form the old string injection
required.
"""
import re

from .config import ID_MAP, LABEL_MAP

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
    """
    n = name.strip()
    if n in ID_MAP:
        return ID_MAP[n]
    short = strip_parenthetical(n)
    if short in ID_MAP:
        return ID_MAP[short]
    return re.sub(r"[^a-z0-9]+", "_", short.lower()).strip("_")[:30]


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
