"""Classification tables lifted from build_cuas_tool_v4.py:37-203.

Data only: no functions, no I/O, nothing mutable at import time. Phase 2 turns
these into the classification_rules / id_aliases / link_vocabulary tables, so
keep the shapes row-like and the ordering of OWNER_RULES significant.

Labels carry real newlines. The source tables double-escaped them because the
values were injected into JavaScript string literals; JSON does not need that,
and a literal backslash-n would render as visible characters in a node label.
"""

# --- Capability Gap -> branch mapping ---
CATEGORY_MAP = {
    "Deployed asset record":          {"branch": "inv",      "label": "Systems\nInventory",    "ck": "inv"},
    "Interconnect baseline":     {"branch": "integ",    "label": "Integration\nBaseline", "ck": "integ"},
    "Detection baseline":          {"branch": "sensor",   "label": "Sensor\nBaseline",      "ck": "sensor"},
    "Client platform baseline":        {"branch": "platform", "label": "Platform\nBaseline",    "ck": "platform"},
    "Response baseline":      {"branch": "mitig",    "label": "Mitigation\nBaseline",  "ck": "mitig"},
    "Enabling service baseline":  {"branch": "mitig",    "label": "Mitigation\nBaseline",  "ck": "mitig"},
    "Workflow shortfall":              {"branch": "gaps",     "label": "Operational\nGaps",     "ck": "gaps"},
    "Exchange shortfall":     {"branch": "gaps",     "label": "Operational\nGaps",     "ck": "gaps"},
}

# --- Owner Organization -> group mapping ---
# Order matters. First match wins, so more specific rules come first. The
# USCG/CBP rule sits above the bare CBP rule specifically so Beacon lands in
# DHS HQ rather than CBP; reordering this list changes classifications.
#
# Agency abbreviations are the real published ones and stay. The sub-unit
# names, the vendor name and the parenthetical qualifier are sample vocabulary
# and are invented, so the sample owner strings must be written to hit them.
# The tokens a sample owner string has to contain to keep its group:
#
#     CBP Field Analytics   -> cbp        (any string with CBP also lands cbp)
#     USCG Sector Command   -> otherdhs   (any string with USCG also lands there)
#     Ironwood Defense      -> dod
#     FBI                   -> otherdhs   (bare, so any sub-unit name works)
#     Watch Desk            -> otherdhs
#     Relay field           -> otherdhs
#     JIC                   -> otherdhs
#     Venue C-UAS           -> otherdhs
#
# The last four have no agency abbreviation to fall back on: a sample owner
# string that drops the token falls through to External rather than Other DHS.
#
# The "(confirm" qualifier is left alone on purpose. It is generic workflow
# vocabulary rather than an organisation name, and SOFT_KEYWORDS below keys
# soft ownership off the same token, so inventing it here and not there would
# quietly mark unconfirmed owners as confirmed.
OWNER_RULES = [
    # (substring to match case-insensitively, group_id, group_label, color_key)
    ("DHS S&T",      "dhs-st",   "DHS S&T",               "dhsST"),
    ("CBP Field Analytics", "cbp", "CBP",                 "cbp"),
    ("CBP (confirm", "cbp",     "CBP",                   "cbp"),
    ("USCG/CBP",     "dhshq",    "DHS HQ /\nOCIO",        "dhsHQ"),
    ("USCG Sector Command", "otherdhs", "Other DHS\nComponents", "otherDHS"),
    ("CBP",          "cbp",      "CBP",                   "cbp"),
    ("USSS",         "otherdhs", "Other DHS\nComponents", "otherDHS"),
    ("ICE",          "otherdhs", "Other DHS\nComponents", "otherDHS"),
    ("USCG",         "otherdhs", "Other DHS\nComponents", "otherDHS"),
    ("FPS",          "otherdhs", "Other DHS\nComponents", "otherDHS"),
    ("DHS HQ",       "dhshq",    "DHS HQ /\nOCIO",        "dhsHQ"),
    ("OCIO",         "dhshq",    "DHS HQ /\nOCIO",        "dhsHQ"),
    ("DHS + FBI",    "otherdhs", "Other DHS\nComponents", "otherDHS"),
    ("DoD",          "dod",      "DoD\nStakeholders",     "dod"),
    ("Ironwood Defense", "dod",  "DoD\nStakeholders",     "dod"),
    ("FAA",          "ext",      "External /\nIndustry",  "ext"),
    ("FBI",          "otherdhs", "Other DHS\nComponents", "otherDHS"),
    ("Industry",     "ext",      "External /\nIndustry",  "ext"),
    ("Multi-agency", "otherdhs", "Other DHS\nComponents", "otherDHS"),
    ("Watch Desk",   "otherdhs", "Other DHS\nComponents", "otherDHS"),
    ("Relay field",  "otherdhs", "Other DHS\nComponents", "otherDHS"),
    ("JIC",          "otherdhs", "Other DHS\nComponents", "otherDHS"),
    ("Venue C-UAS",  "otherdhs", "Other DHS\nComponents", "otherDHS"),
]

# Replaces OWNER_GROUP_MAP_RUNTIME, which the old script built by mutating a
# module global inside main(). It was only ever this six-entry lookup.
OWNER_GROUP_DISPLAY = {
    "dhs-st":   "DHS S&T",
    "cbp":      "CBP",
    "otherdhs": "Other DHS",
    "dhshq":    "DHS HQ/OCIO",
    "dod":      "DoD",
    "ext":      "External",
}

# --- Hand-crafted short node ids ---
ID_MAP = {
    "UAS Common Picture":                              "ucop",
    "Recon Systems":                            "recon",
    "ORBIT":                                  "orbit",
    "CBP Relay":                                "cbprel",
    "USSS Relay":                               "ussrel",
    "ICE Relay":                                "icerel",
    "USCG Relay":                               "uscgrel",
    "FPS Relay":                                "fpsrel",
    "Trackwell Sensor AI":                     "trackwell",
    "BEACON":                                   "beacon",
    "Fathom":                                   "fathom",
    "Ember":                             "ember",
    "CROSSLINK":                                  "crosslink",
    "Ingot Sensor Suite (INGOT) / DATA VIEW": "ingot",
    "INGOT / DATA VIEW":                      "ingot",
    "Skyward Shield":                            "skyward",
    "Halyard":                                "halyard",
    "Cirrus":                                 "cirrus",
    "Dwell":                                    "dwell",
    "Enterprise Common Picture":                          "enterprise",
    "Civil Air Radar":                              "civair",
    "CBP Sentinel":                           "cbpsen",
    "SCAN (Screening and Alerting Node)":       "scan",
    "SCAN":                                    "scan",
    "GANTRY (Ground Antenna Towers)": "gantry",
    "GANTRY":                                    "gantry",
    "WinRelay":                                 "winrel",
    "Event Relay Server":                        "eventrel",
    "Jetty C-UAS Integration Engine":         "jetty",
    "TagPoint Sensors":                       "tagpoint",
    "Relay Homing Plugin":                 "homing",
    "Bastion Effector":                          "bastion",
    "KITE Relay Plugin":                      "kite",
    "Dispatch Management System (DMS/CAD)":   "dispatch",
    "Dispatch / CAD":                              "dispatch",
    "Partner Agency Data Sharing":              "partner",
}

# --- Display labels (short names for node rendering) ---
LABEL_MAP = {
    'ucop': 'UAS Common Picture',
    'recon': 'Recon Systems',
    'orbit': 'ORBIT',
    'cbprel': 'CBP Relay',
    'ussrel': 'USSS Relay',
    'icerel': 'ICE Relay',
    'uscgrel': 'USCG Relay',
    'fpsrel': 'FPS Relay',
    'trackwell': 'Trackwell\nSensor AI',
    'beacon': 'Beacon',
    'fathom': 'Fathom',
    'ember': 'Ember',
    'crosslink': 'CROSSLINK',
    'ingot': 'INGOT / DATA\nDATAVIEW',
    'skyward': 'Skyward Shield',
    'halyard': 'Halyard',
    'cirrus': 'Cirrus',
    'dwell': 'Dwell',
    'enterprise': 'Enterprise Common Picture',
    'civair': 'Civil Air Radar',
    'cbpsen': 'CBP Sentinel',
    'scan': 'SCAN',
    'gantry': 'GANTRY',
    'eventrel': 'Event Relay\nServer',
    'jetty': 'Jetty C-UAS\nEngine',
    'tagpoint': 'TagPoint\nSensors',
    'homing': 'Relay Homing\nPlugin',
    'winrel': 'WinRelay',
    'bastion': 'Bastion Effector',
    'kite': 'KITE Relay\nPlugin',
    'dispatch': 'Dispatch / CAD',
    'partner': 'Partner Agency\nData Sharing',
}

# --- Soft ownership: detected from text, then overridden by the id sets ---
SOFT_KEYWORDS = ["awaiting sign-off", "(confirm"]
ALWAYS_SOFT = {"scan", "beacon", "ember", "fathom", "halyard", "jetty"}
NEVER_SOFT = {"gantry"}
# Parent group nodes rendered as soft.
SOFT_GROUPS = {"dod", "ext"}

# --- Risk heuristics, checked high first, then low, then medium ---
# These are deliberately generic architecture-review vocabulary rather than
# phrases cut from any one matrix. A keyword list built from the narrative it
# was harvested from only ever classifies that narrative: it scores 100% on the
# corpus it came from and near zero on the next one. Generic terms also keep
# the table publishable, since the Reference tab renders it verbatim.
HIGH_KEYWORDS = [
    "single point of failure", "no documented owner",
    "unverified interface", "no failover",
    "unsupported platform", "end of life",
    "no rollback path", "undocumented dependency",
    "hard-coded configuration", "no monitoring in place",
    "capacity exceeded", "authoritative source unclear",
    "no interface contract", "cannot be reproduced",
    "no continuity plan", "unresolved safety concern",
    "outage risk during transition", "no validated backup",
    "no accreditation on record",
]
LOW_KEYWORDS = [
    "cosmetic label mismatch", "minor documentation lag",
    "duplicate catalogue entry",
]
MEDIUM_KEYWORDS = [
    "partially documented", "pending review", "scope undefined",
    "interface unspecified", "coverage unclear", "awaiting validation",
    "inconsistent field definitions", "no target date", "requires follow-up",
]

# --- Cross-link extraction: known system name fragments ---
LINK_NAME_FRAGMENTS = {
    'sentinel': 'cbpsen',
    'orbit': 'orbit',
    'trackwell': 'trackwell',
    'jetty': 'jetty',
    'tagpoint': 'tagpoint',
    'relay homing': 'homing',
    'skyward': 'skyward',
    'skyward shield': 'skyward',
    'ember': 'ember',
    'winrel': 'winrel',
    'kite': 'kite',
    'bastion': 'bastion',
    'fathom': 'fathom',
    'civair radar': 'civair',
    'eventrel': 'eventrel',
    'uas common picture': 'ucop',
    'crosslink': 'crosslink',
    'halyard': 'halyard',
    'cirrus': 'cirrus',
    'dwell': 'dwell',
    'data dataview': 'ingot',
}
