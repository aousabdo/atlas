"""Generate the synthetic sample bundle this repo ships instead of real data.

The bundle has cross-file referential integrity: coverage device ids must exist
in the topology, link endpoints must exist in systems.json, lossiness detail
blocks must name the same ids the rosters do, and project.json counts must
equal the topology lengths. Hand-written JSON drifts the first time any of that
changes, so the bundle is generated and the generator is the thing under review.

Determinism is a hard requirement: no randomness, no clock. BUILT_AT and
GIT_SHA are constants, so re-running writes byte-identical files and a rebuild
produces an empty diff.

The derived files are computed by the real ingest code (compute_lossiness,
top_gaps, mapping_confidence_counts) rather than restated here, so a bug in the
metrics shows up in the sample bundle the same way it would in a real one.
"""
import json
from pathlib import Path

from .bundle import snapshot_payload
from .classify import classify_owner
from .config import CATEGORY_MAP
from .curation import mapping_confidence_counts
from .lossiness import compute_lossiness, top_gaps
from .methodology import extract_methodology

# --- Provenance. Constants, because a timestamp would churn every rebuild. ---
BUILT_AT = "2026-08-05T00:00:00"
SNAPSHOT_LABEL = BUILT_AT.split("T")[0]
GIT_SHA = "0f1e2d3"
BUNDLE_VERSION = 1
TOOL_VERSION = "ATLAS Phase 1"
SOURCE_LABEL = "Sample Traceability Matrix"
BASELINE_DATE = "2026-03-05"
PROJECT_NAME = "Reference C-UAS Architecture"
PROJECT_SLUG = "reference-cuas"
CLASSIFICATION = "UNCLASSIFIED//SAMPLE"

SITE_A = "northgate"
SITE_A_LABEL = "Northgate Sports Campus"
SITE_B = "westfield"
SITE_B_LABEL = "Westfield Proving Ground"

# --- Display labels, mirroring config.LABEL_MAP -----------------------------
# Duplicated deliberately: this generator must keep producing the same bundle
# while config.py is edited, so it does not read the classifier's label table.
LABELS = {
    "ucop": "UAS Common Picture",
    "recon": "Recon Systems",
    "orbit": "ORBIT",
    "cbprel": "CBP Relay",
    "ussrel": "USSS Relay",
    "icerel": "ICE Relay",
    "uscgrel": "USCG Relay",
    "fpsrel": "FPS Relay",
    "trackwell": "Trackwell\nSensor AI",
    "beacon": "Beacon",
    "fathom": "Fathom",
    "ember": "Ember",
    "crosslink": "CROSSLINK",
    "ingot": "INGOT / DATA\nDATAVIEW",
    "skyward": "Skyward Shield",
    "halyard": "Halyard",
    "cirrus": "Cirrus",
    "dwell": "Dwell",
    "enterprise": "Enterprise Common Picture",
    "civair": "Civil Air Radar",
    "cbpsen": "CBP Sentinel",
    "scan": "SCAN",
    "gantry": "GANTRY",
    "eventrel": "Event Relay\nServer",
    "jetty": "Jetty C-UAS\nEngine",
    "tagpoint": "TagPoint\nSensors",
    "homing": "Relay Homing\nPlugin",
    "winrel": "WinRelay",
    "bastion": "Bastion Effector",
    "kite": "KITE Relay\nPlugin",
    "dispatch": "Dispatch / CAD",
    "partner": "Partner Agency\nData Sharing",
}

# The five soft-ownership id sets. config.py carries the same values; they are
# system ids, so they belong to the sample vocabulary rather than to the
# classifier, and pinning them here keeps the bundle stable either way.
ALWAYS_SOFT = {"scan", "beacon", "ember", "fathom", "halyard", "jetty"}
NEVER_SOFT = {"gantry"}

INV = "Deployed asset record"

# --- The Matrix sheet, one tuple per workbook row ---------------------------
# Column order matches make_sample_workbook.py, which writes exactly these
# values into the fabricated .xlsx, so the workbook and the bundle cannot drift.
# (id, category, name, infrastructure, owner, confirmed, integrations, risk
#  narrative, risk level)
MATRIX_ROWS = [
    (
        "ucop", INV, "UAS Common Picture",
        "Application tier in the government cloud region", "DHS S&T", True,
        "Runs on the CROSSLINK transition stack before release to operations",
        "Release gates between the research stack and operations are undocumented",
        "Medium",
    ),
    (
        "recon", INV, "Recon Systems",
        "Airborne ISR application group with an on-premises analysis enclave",
        "CBP Field Analytics", True,
        "Publishes ISR track products into the UAS Common Picture",
        "The child applications under this group have never been enumerated",
        "Medium",
    ),
    (
        "orbit", INV, "ORBIT",
        "Air surveillance suite on the regional watch floor",
        "CBP Field Analytics", True,
        "Correlates CBP Sentinel returns with the Civil Air Radar track feed",
        "Feeds are wired straight to each consumer with no brokered routing tier",
        "High",
    ),
    (
        "cbprel", INV, "CBP Relay",
        "TAK server instance run for CBP field teams", "CBP", True,
        "Present in the current relay federation drawing",
        "The set of subscribing units has never been written down", "Medium",
    ),
    (
        "ussrel", INV, "USSS Relay",
        "TAK server instance run for protective details", "USSS", True,
        "Appears in the relay federation drawing for the current baseline",
        "Message profiles and release rules differ from the other component relays",
        "Medium",
    ),
    (
        "icerel", INV, "ICE Relay",
        "TAK server instance run for field offices", "ICE", True,
        "Shown inside the relay federation for the current baseline",
        "Client builds in the field trail the server by more than one release",
        "Medium",
    ),
    (
        "uscgrel", INV, "USCG Relay",
        "TAK server instance run for cutters and small boats", "USCG", True,
        "Shown inside the relay federation for the current baseline",
        "Afloat units fall out of the federation whenever the satellite path degrades",
        "Medium",
    ),
    (
        "fpsrel", INV, "FPS Relay",
        "TAK server instance run from the mobile command fleet", "FPS", True,
        "Subscribes to Trackwell Sensor AI detections and pushes them to field clients",
        "Incident handoff to the duty desk still happens by phone", "High",
    ),
    (
        "trackwell", INV, "Trackwell Sensor AI",
        "Component-operated detection service in a vendor-managed cloud region",
        "FPS", True,
        "Normalized inside the Jetty C-UAS Integration Engine alongside TagPoint "
        "Sensors, Skyward Shield and the Relay Homing Plugin",
        "The licence covers one component, so sharing detections outward is unresolved",
        "Medium",
    ),
    (
        "beacon", INV, "Beacon",
        "Maritime and land data holdings service",
        "USCG/CBP shared context (confirm the owning component)", False,
        "Drawn among the other DHS holdings in the current baseline",
        "Nobody has stated what this system contributes to the airspace mission",
        "High",
    ),
    (
        "fathom", INV, "Fathom",
        "Federated information-sharing services for cross-component posting",
        "DHS HQ/OCIO (awaiting sign-off)", False,
        "Shares a session and entitlement chain with Ember, awaiting sign-off",
        "How entitlements pass between the two services is not written down",
        "Medium",
    ),
    (
        "ember", INV, "Ember",
        "Attribute-based identity and access service",
        "DHS HQ/OCIO (awaiting sign-off)", False,
        "Issues the tokens the relay ecosystem and Fathom both rely on",
        "Component attribute names do not line up, so policy is hand mapped",
        "Medium",
    ),
    (
        "crosslink", INV, "CROSSLINK",
        "Research-to-operations transition and accreditation gate",
        "DHS S&T", True,
        "Carries the UAS Common Picture stack through type accreditation",
        "Transition artifacts differ from one hand-off to the next",
        "Medium",
    ),
    (
        "ingot", INV, "Ingot Sensor Suite (INGOT) / DATA VIEW",
        "Defense-side sensor holdings and analytic platform",
        "Defense stakeholder (owning office not yet identified)", False,
        "Named on the defense side of the current baseline drawing",
        "Interface facts depend on a defense data call nobody has scheduled", "High",
    ),
    (
        "skyward", INV, "Skyward Shield",
        "Commercial detection service delivered from the vendor cloud",
        "Industry vendor with DHS component consumers", True,
        "Sold as a subscription feed into the operational ecosystem",
        "Unclear whether the vendor or the component owns the deployed instance",
        "Medium",
    ),
    (
        "halyard", INV, "Halyard",
        "Candidate defense mitigation platform",
        "DoD / Ironwood Defense program office (awaiting sign-off)", False,
        "Raised as an active defense platform during the architecture update",
        "No authoritative interface description has been produced", "High",
    ),
    (
        "cirrus", INV, "Cirrus",
        "Candidate defense sensor platform",
        "Defense stakeholder (awaiting sign-off)", False,
        "Listed as a defense-side candidate with no confirmed interfaces",
        "Where it is fielded and what it exposes are both unknown", "High",
    ),
    (
        "dwell", INV, "Dwell",
        "Candidate defense effects management block",
        "Defense stakeholder (awaiting sign-off)", False,
        "Requested as an added defense block in the architecture update",
        "Whether this belongs in the current or the desired view is unsettled",
        "High",
    ),
    (
        "enterprise", INV, "Enterprise Common Picture",
        "Department-wide geospatial picture service", "DHS HQ", True,
        "Carries the Skyward Shield subscription feed under the enterprise "
        "service model",
        "Two earlier product names are still in circulation in briefings", "Low",
    ),
    (
        "civair", INV, "Civil Air Radar",
        "Civil aviation surveillance feed from an external provider", "FAA", True,
        "Long-standing feed carried over from the previous baseline",
        "Which operational consumers still read this feed is not recorded", "Medium",
    ),
    (
        "cbpsen", INV, "CBP Sentinel",
        "Operational tracking and case management system", "CBP", True,
        "Still in service and drawn in the current baseline",
        "The live interface list has never been enumerated", "Medium",
    ),
    (
        "scan", INV, "SCAN (Screening and Alerting Node)",
        "Screening and alerting mission node", "CBP", True,
        "Proposed host for the INGOT / DATA VIEW insertion",
        "What role this node plays in the airspace mission is still being argued",
        "High",
    ),
    (
        "gantry", INV, "GANTRY (Ground Antenna Towers)",
        "Fixed ground antenna tower sites", "CBP (confirm the owning office)", False,
        "Asked for as a new block in the architecture update",
        "No integration description exists for these sites", "Medium",
    ),
    (
        "eventrel", "Interconnect baseline", "Event Relay Server",
        "Federated relay server built for scheduled event support",
        "DHS + FBI joint event working group", True,
        "Stood up per event with federation to partner relays enabled",
        "Certificate and channel setup is redone by hand for every event",
        "Medium",
    ),
    (
        "jetty", "Interconnect baseline", "Jetty C-UAS Integration Engine",
        "Hosted correlation and message normalization layer",
        "JIC integration cell, event support (confirm the transition owner)",
        False,
        "Correlates TagPoint Sensors, Skyward Shield and Relay Homing Plugin "
        "reports into a single track set",
        "Correlation quality falls off wherever sensor coverage overlaps poorly",
        "Medium",
    ),
    (
        "tagpoint", "Detection baseline", "TagPoint Sensors",
        "Fixed and portable detection sensors drawn from an event pool",
        "Venue C-UAS sensor operations cell",
        True,
        "Reports over an API into the Jetty C-UAS Integration Engine",
        "One sensor type dominates the picture in cluttered RF", "Medium",
    ),
    (
        "homing", "Detection baseline", "Relay Homing Plugin",
        "Handheld direction finding delivered as an ATAK plugin",
        "Relay field users / plugin support teams", True,
        "Runs on the handheld and reports into the Jetty C-UAS Integration Engine",
        "Continuous use drains the handset battery inside one shift", "Low",
    ),
    (
        "winrel", "Client platform baseline", "WinRelay",
        "Primary desktop display platform on the watch floor",
        "Watch Desk operations", True,
        "Operator desktop views, dashboards and sync jobs",
        "Sync jobs stall and group membership has to be reapplied by hand", "Medium",
    ),
    (
        "bastion", "Response baseline", "Bastion Effector",
        "Directional mitigation platform fielded with maritime response units",
        "USCG Sector Command", True,
        "Cued from the handheld through the KITE Relay Plugin",
        "Readiness depends on power and antenna hardware that keeps failing", "High",
    ),
    (
        "kite", "Enabling service baseline", "KITE Relay Plugin",
        "Handheld plugin that drives the mitigation workflow",
        "USCG Sector Command", True,
        "Paired with the handheld and the Bastion Effector during response runs",
        "Delivered with almost no documentation and no support contact", "Medium",
    ),
    (
        "dispatch", "Workflow shortfall", "Dispatch Management System (DMS/CAD)",
        "Incident intake and dispatch workflow for airspace events",
        "Multi-agency incident coordination board", True,
        "No system in place today; shift logs are kept on paper and rekeyed",
        "Every hand-off between the watch floor and the field is retyped", "High",
    ),
    (
        "partner", "Exchange shortfall", "Partner Agency Data Sharing",
        "Interagency sharing arrangements and operator proficiency",
        "FBI + multi-agency watch floor leadership",
        True,
        "Detections stayed inside each agency, so the shared picture was thin",
        "Proficiency varies widely and nobody can see the whole federation", "High",
    ),
]


def build_systems():
    """The Matrix rows as parsed system dicts, in workbook row order.

    Mirrors excel._build_system: same detail assembly, same category-to-colour
    rule, and the Confirmed column outranking the soft-id sets. Owner group
    comes from the live classifier, so a change to OWNER_RULES is visible here.
    """
    systems = []
    for (sid, cat, name, infra, owner, confirmed, integ, risk_text,
         risk_level) in MATRIX_ROWS:
        gid, glabel, gck, _soft = classify_owner(owner, name)
        cat_info = CATEGORY_MAP[cat]
        detail_parts = [infra, "Owner: " + owner, "Risk: " + risk_text]
        detail = ". ".join(detail_parts)
        if not detail.endswith("."):
            detail += "."
        systems.append({
            "id": sid,
            "name": name,
            "label": LABELS[sid],
            "cat": cat,
            "gid": gid,
            "glabel": glabel,
            "gck": gck,
            "ck": cat_info["ck"] if cat_info["branch"] != "inv" else gck,
            "soft": not confirmed,
            "risk": risk_level.lower(),
            "risk_source": "explicit",
            "detail": detail,
            "integ": integ,
        })
    return systems


# --- Link extraction --------------------------------------------------------
# A local copy of config.LINK_NAME_FRAGMENTS and links.extract_links, for the
# same reason as LABELS: the generator must not change its output because the
# classifier tables are mid-edit. The alias keys are the sample vocabulary's
# own nicknames, not the classifier's, so they are written out here rather
# than imported.
LINK_FRAGMENTS = {
    "sentinel": "cbpsen",
    "orbit": "orbit",
    "trackwell": "trackwell",
    "jetty": "jetty",
    "tagpoint": "tagpoint",
    "relay homing": "homing",
    "skyward": "skyward",
    "skyward shield": "skyward",
    "ember": "ember",
    "winrel": "winrel",
    "kite": "kite",
    "bastion": "bastion",
    "fathom": "fathom",
    "civair radar": "civair",
    "eventrel": "eventrel",
    "uas common picture": "ucop",
    "crosslink": "crosslink",
    "halyard": "halyard",
    "cirrus": "cirrus",
    "dwell": "dwell",
    "data dataview": "ingot",
}

CROSS_LINKS = [
    {"from": "dispatch", "to": "fpsrel", "label": "DMS gap > FPS Relay"},
    {"from": "jetty", "to": "eventrel", "label": "Jetty > Event Relay Server"},
]

SUPPRESS_LINKS = [
    ["skyward", "trackwell"],
    ["scan", "ingot"],
    ["trackwell", "homing"],
    ["trackwell", "tagpoint"],
]

DESIRED_LINKS = [
    {"from": "cbprel", "to": "orbit", "label": "CBP Relay ↔ ORBIT"},
    {"from": "cbprel", "to": "cbpsen", "label": "CBP Relay ↔ Sentinel"},
    {"from": "ussrel", "to": "icerel", "label": "USSS ↔ ICE Relay federation"},
    {"from": "ussrel", "to": "uscgrel", "label": "USSS ↔ USCG Relay federation"},
    {"from": "ussrel", "to": "fpsrel", "label": "USSS ↔ FPS Relay federation"},
    {"from": "ussrel", "to": "cbprel", "label": "USSS ↔ CBP Relay federation"},
    {"from": "beacon", "to": "orbit", "label": "Beacon ↔ ORBIT exchange"},
    {"from": "beacon", "to": "enterprise", "label": "Beacon ↔ Enterprise exchange"},
    {"from": "gantry", "to": "orbit", "label": "GANTRY → ORBIT/ISR"},
    {"from": "gantry", "to": "ucop", "label": "GANTRY → COP"},
    {"from": "recon", "to": "orbit", "label": "ISR ↔ ORBIT"},
    {"from": "ingot", "to": "jetty", "label": "INGOT → DHS operational"},
    {"from": "dispatch", "to": "eventrel", "label": "DMS ↔ Relay CoT auto-populate"},
]

NODE_ORDER = {"dhshq": ["enterprise", "fathom", "ember", "beacon"]}


def _display(sid):
    return LABELS[sid].replace("\n", " ")


def extract_links(systems):
    """Mine each system's integration prose for mentions of other systems."""
    frag_to_id = dict(LINK_FRAGMENTS)
    for s in systems:
        frag_to_id[s["name"].lower()] = s["id"]

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
                "label": f"{_display(src)} - {_display(tid)}",
            })
    return links


def merge_links(auto):
    """Hand curation wins; suppressed pairs drop out of the mined set."""
    manual = [dict(m, extraction_method="override") for m in CROSS_LINKS]
    manual_pairs = {tuple(sorted([m["from"], m["to"]])) for m in manual}
    suppressed = {tuple(sorted(p)) for p in SUPPRESS_LINKS}
    kept = [
        dict(a, extraction_method="prose")
        for a in auto
        if (pair := tuple(sorted([a["from"], a["to"]]))) not in manual_pairs
        and pair not in suppressed
    ]
    return manual + kept


def desired_links():
    return [dict(d, extraction_method="override") for d in DESIRED_LINKS]


# --- The original_to_current_crosswalk sheet --------------------------------
# (original requirement, original system, current representation, status, note)
CROSSWALK_ROWS = [
    (
        "No reciprocity for software accreditation between components",
        "CORDON", "CROSSLINK; Fathom; Ember", "Split out",
        "Split across the transition boundary, the sharing services and the "
        "identity service that each hold part of the accreditation package.",
    ),
    (
        "Detection coverage and service levels are never published",
        "CORDON, Watchline", "Enterprise Common Picture; Skyward Shield",
        "Renamed / split out",
        "The enterprise picture carries the published coverage layer; the "
        "subscription feed is now called out on its own row.",
    ),
    (
        "No sustainment path for prototype sensors after transition",
        "CORDON, Lodestar", "CROSSLINK", "Partly carried forward",
        "The transition row survives. Lodestar, the sustainment funding line, "
        "was never given a row of its own.",
    ),
    (
        "No common track identifier across air surveillance systems",
        "Skywatch, Lodestar", "ORBIT; CBP Sentinel; Beacon", "Split out",
        "One combined row became three operational system rows, each of which "
        "mints its own track numbers today.",
    ),
    (
        "No retained audit trail of who read a detection record",
        "CORDON", "CROSSLINK; Fathom; Ember", "Split out",
        "Logging sits partly in the sharing services and partly in the identity "
        "service, so the row was broken across both plus the transition row.",
    ),
    (
        "No store-and-forward cache for relay clients during an outage",
        "Shoreline Relay, Overland Relay", "USCG Relay; CBP Relay",
        "Renamed / split out",
        "Shoreline Relay is now the USCG relay row. Overland Relay is covered "
        "under the CBP relay row.",
    ),
    (
        "Data-sharing agreements are not machine-readable at request time",
        "CORDON, Keelson", "Ember; Fathom; CROSSLINK", "Split out",
        "Agreement terms are enforced by the identity and sharing services, so "
        "the row follows them rather than staying whole.",
    ),
    (
        "Timing and clock discipline between fused feeds are unspecified",
        "CORDON, Rampart", "CROSSLINK; Enterprise Common Picture",
        "Partly carried forward",
        "The timing requirement survives against two rows. Rampart, the reference "
        "clock service, is not shown as a system.",
    ),
    (
        "Range test results never return to the architecture baseline",
        "CORDON", "CROSSLINK", "Condensed",
        "Folded into the transition row rather than carried as a separate "
        "test-and-evaluation row.",
    ),
    (
        "No standing training pipeline for relay operators",
        "CORDON PMO", "No matching system row", "didn’t keep as system row",
        "Training was treated as a programme activity and left off the system list.",
    ),
    (
        "No spectrum deconfliction process for mitigation effectors",
        "CORDON", "No matching system row", "didn’t keep as system row",
        "Spectrum coordination is handled outside the architecture and was not "
        "given a system row.",
    ),
]

_NO_EQUIVALENT = "no matching system row"


def build_crosswalk():
    """The sheet rows as crosswalk.read_crosswalk would parse them."""
    rows = []
    for orig, sys_name, current, status, _note in CROSSWALK_ROWS:
        lowered = status.lower().replace("’", "'")
        rows.append({
            "orig": orig,
            "sys": sys_name,
            "current": (
                [] if _NO_EQUIVALENT in current.lower()
                else [c.strip() for c in current.split(";") if c.strip()]
            ),
            "status": "Didn't keep" if "didn't keep" in lowered else status,
        })
    return rows


# --- Reference tab content --------------------------------------------------
ACRONYMS = [
    ("CUAS", "Counter-Unmanned Aircraft Systems"),
    ("TAK", "Team Awareness Kit, US Army situational-awareness platform"),
    ("ATAK", "Android Team Awareness Kit"),
    ("WinRelay", "Windows Relay Client, the desktop relay display platform in "
                 "this sample"),
    ("iTAK", "iOS Team Awareness Kit"),
    ("EventRel", "Event Relay, the federated relay server stood up per event in "
                 "this sample"),
    ("COP", "Common Operating Picture"),
    ("CROSSLINK", "Cross-Domain Linking Service, the DHS S&T "
                  "research-to-operations transition boundary in this sample"),
    ("DHS S&T",
     "Department of Homeland Security Science and Technology Directorate"),
    ("OCIO", "Office of the Chief Information Officer"),
    ("FPS", "Federal Protective Service (DHS component)"),
    ("CBP", "U.S. Customs and Border Protection"),
    ("USSS", "U.S. Secret Service"),
    ("ICE", "U.S. Immigration and Customs Enforcement"),
    ("USCG", "U.S. Coast Guard"),
    ("JIC", "Joint Integration Cell, the event integration team that owns the "
            "fusion engine in this sample"),
    ("ORBIT", "Operational Radar and Beacon Integrated Tracking, the CBP air "
              "surveillance suite in this sample"),
    ("KITE", "Kinetic Interdiction Tasking Extension, the handheld mitigation "
             "plugin in this sample"),
    ("ISR", "Intelligence, Surveillance, Reconnaissance"),
    ("DoD", "Department of Defense"),
    ("INGOT", "Integrated Ground Observation Toolkit, the defense-side sensor "
              "holdings suite in this sample"),
    ("SCAN", "Screening and Alerting Node"),
    ("FAA", "Federal Aviation Administration"),
    ("FBI", "Federal Bureau of Investigation"),
    ("GANTRY", "Ground Antenna Towers, the fixed tower sites in this sample"),
    ("DMS", "Dispatch Management System"),
    ("CAD", "Computer-Aided Dispatch"),
    ("IdAM", "Identity and Access Management"),
    ("AIS", "Automatic Identification System (maritime vessel tracking)"),
    ("NTP", "Network Time Protocol"),
    (CLASSIFICATION,
     "Sample marking. Every record in this bundle is fabricated reference data "
     "and carries no control."),
    ("GovRegion", "Government-region public cloud tenancy"),
    ("ADS-B", "Automatic Dependent Surveillance-Broadcast"),
    ("VLAN", "Virtual Local Area Network"),
    ("MCV", "Mobile Command Vehicle (FPS)"),
    ("SOC", "Security Operations Center"),
    ("USS", "UAS Service Supplier (FAA UTM concept)"),
    ("DSS", "Discovery and Synchronization Service"),
    ("CoT", "Cursor on Target, the TAK message format"),
    ("AAR", "After Action Report"),
    ("DaaS", "Detection-as-a-Service"),
    ("RDT&E", "Research, Development, Test & Evaluation"),
    ("NOC", "Network Operations Center"),
    ("PoE", "Power over Ethernet"),
    ("SNAP", "Sensor Network Access Point"),
    ("PTZ", "Pan-Tilt-Zoom (camera)"),
    ("EO/IR", "Electro-Optical / Infrared (sensor)"),
    ("RF", "Radio Frequency"),
]

GLOSSARY = {
    "_comment": (
        "Written by hand for the Reference tab. Everything else on that tab "
        "(the system glossary, the keyword tables, the confidence counts and "
        "the build stamp) is computed at build time from the workbook, the "
        "system-to-device map and the classifier constants, so it is not "
        "restated here."
    ),
    "_last_reviewed": "2026-06-02",
    "_version": "0.1-sample",
    "acronyms": [{"acr": acr, "meaning": meaning} for acr, meaning in ACRONYMS],
    "confidence_intro": (
        "Nothing on these tabs is typed in by hand. ATLAS reads four inputs "
        "and computes the rest: the Sample Traceability Matrix workbook, the "
        "two site topology files for Northgate Sports Campus and Westfield "
        "Proving Ground, the curated map that ties systems to devices, and the "
        "classifier constants. Any figure you can see should be traceable to a "
        "row in one of those four. Two things are worth knowing before you "
        "read a number: some risk levels are read off narrative text rather "
        "than stated outright, and the Westfield site has no system mapping at "
        "all yet. Both are called out where they bite. Every record here is "
        "fabricated and describes no real deployment."
    ),
    "methodology_extras": {
        "mapping_confidence_scale": (
            "Each system-to-device mapping is graded. High means somebody saw "
            "the box, on a drawing or in a write-up afterwards. Medium means "
            "the role makes it near certain but nobody has checked. Low means "
            "an educated guess waiting on the team. The grade rides along with "
            "the mapping and is shown in the coverage panel and beside each "
            "system in the glossary."
        ),
        "risk_caveat": (
            "Treat the risk column as a working judgement rather than a score. "
            "Where the matrix states a Risk Level, that wins. Where it is "
            "blank, the ingest reads the Risk/Challenge narrative for known "
            "phrases and picks a level from those. A curation override on an "
            "individual system beats both."
        ),
        "soft_ownership_note": (
            "A system is marked soft when the matrix hedges about who owns it. "
            "The ingest looks for the hedging phrases the workbook actually "
            "uses ('awaiting sign-off', '(confirm') and then applies two "
            "override lists from the classifier constants, one forcing soft "
            "and one forbidding it. Soft systems wear a yellow question mark "
            "on the orientation map."
        ),
    },
    "out_of_scope": [
        "Live telemetry. This is the architecture as of a date, not a feed.",
        "Software dependency graphs inside a system. Nothing below the system "
        "boundary is modelled.",
        "Auditing device classification. Whatever marking a topology file "
        "carries is copied through untouched and never checked.",
        "Confirming inter-site links by inspection. Where a source drawing "
        "says there is a 60 GHz microwave hop between the mobile unit and the "
        "south stand, the hop is taken on trust.",
        "Programmatic risk. Cost and schedule are absent; only the technical "
        "risk read out of the matrix appears anywhere.",
    ],
}


# --- Site A topology --------------------------------------------------------
# A plausible venue network rather than 71 identical boxes: a cloud tier, a WAN
# edge with two carriers, a core, three building closets, segmented sensor and
# radio nets, an operations net, a guest net and a mobile unit.
ZONES_A = {
    "cloud": {
        "label": "Cloud / Backbone",
        "description": "Government-region cloud tenancy, the mission COP "
                       "application tier and the secure enterprise backbone",
    },
    "wan": {
        "label": "WAN / Internet",
        "description": "Dual carrier: Northwind Telecom (192.0.2.8/29) and "
                       "Crestline Broadband (192.0.2.16/29), plus a satellite "
                       "terminal for the mobile unit",
    },
    "core": {
        "label": "Core Routing",
        "description": "Core routing, aggregation and the perimeter firewall "
                       "pair (198.51.100.0/27)",
    },
    "mgmt": {
        "label": "Server / Management",
        "description": "Server rack and out-of-band management "
                       "(198.51.100.64/27): storage, two hypervisors, time and "
                       "a jump host",
    },
    "annex_closet": {
        "label": "Annex Data Closet",
        "description": "Annex building closet (172.31.10.0/24): access switch, "
                       "PoE injector, wireless and a microwave uplink",
    },
    "field_house": {
        "label": "Field House",
        "description": "Field house closet (172.31.20.0/24): access switch, "
                       "mitigation effector pair, wireless and an operator "
                       "display",
    },
    "north_stand": {
        "label": "North Stand",
        "description": "North stand closet (172.31.30.0/24): access switch, "
                       "PoE injector, wireless and a PTZ camera",
    },
    "south_stand": {
        "label": "South Stand",
        "description": "South stand closet (172.31.40.0/24): access switch, "
                       "PoE injector, wireless and a PTZ camera",
    },
    "sensor_net": {
        "label": "Sensor Net",
        "description": "Detection segment behind its own firewall "
                       "(203.0.113.0/26): radar, RF array, EO/IR, PTZ and a "
                       "remote-ID receiver",
    },
    "radio_net": {
        "label": "Radio Net",
        "description": "Radio segment (203.0.113.64/26): two 60 GHz microwave "
                       "links, a repeater and an ADS-B receiver",
    },
    "ops_net": {
        "label": "Operations Net",
        "description": "Operations floor (203.0.113.128/26): TAK server, "
                       "operator workstations, video wall and a laptop cart",
    },
    "guest_net": {
        "label": "Guest Net",
        "description": "Segregated field-device wireless (203.0.113.192/26) "
                       "for ATAK and iTAK handhelds",
    },
    "mobile_unit": {
        "label": "Mobile Command Unit",
        "description": "Mobile command vehicle (172.31.50.0/24): router, "
                       "switch, sensor gateway, mitigation pair and displays",
    },
    "perimeter": {
        "label": "Perimeter",
        "description": "Fence-line detection: one radar and one camera on the "
                       "campus boundary",
    },
}

# (id, zone, type, label, ip, subnet, description)
DEVICES_A = [
    ("cloud_tak_server", "cloud", "server", "Cloud TAK Server", None, None,
     "Cloud-hosted relay server for handheld coordination across the campus"),
    ("secure_backbone", "cloud", "backbone", "Secure Enterprise Backbone", None, None,
     "Encrypted enterprise backbone between the campus and the cloud tenancy"),
    ("gov_cloud", "cloud", "cloud", "Government Cloud Tenancy", None, None,
     "Government-region cloud tenancy hosting the mission COP tiers"),
    ("cop_application", "cloud", "application", "Mission COP Application", None, None,
     "Airspace picture served to the watch floor and the field"),
    ("cloud_identity", "cloud", "application", "Cloud Identity Service", None, None,
     "Single sign-on and attribute release for the COP tiers"),

    ("internet", "wan", "cloud", "Internet", None, None,
     "Public internet, reached through both carrier circuits"),
    ("northwind_gw", "wan", "gateway", "Northwind Telecom GW", "192.0.2.9",
     "192.0.2.8/29", "Primary carrier circuit, terminated in the core closet"),
    ("crestline_gw", "wan", "gateway", "Crestline Broadband GW", "192.0.2.17",
     "192.0.2.16/29", "Secondary carrier circuit, also serving the mobile unit"),
    ("wan_demarc_panel", "wan", "router", "Carrier Demarcation Panel", "192.0.2.25",
     "192.0.2.24/29", "Where both carrier handoffs land before the edge router"),
    ("wan_edge_router", "wan", "router", "WAN Edge Router", "192.0.2.26",
     "192.0.2.24/29", "Policy routing and failover between the two carriers"),
    ("satellite_terminal", "wan", "satellite_terminal", "Satellite Terminal", None,
     None, "Backup path for the mobile command unit when both circuits are down"),

    ("core_firewall", "core", "firewall", "Core Firewall", "198.51.100.1",
     "198.51.100.0/27", "Campus perimeter firewall, north of everything else"),
    ("core_router", "core", "router", "Core Router", "198.51.100.2",
     "198.51.100.0/27", "Campus core router and inter-zone gateway"),
    ("core_switch", "core", "switch", "Core Switch", "198.51.100.3",
     "198.51.100.0/27", "Core distribution switch; every segment uplinks here"),
    ("core_ips", "core", "firewall", "Core IPS Appliance", "198.51.100.4",
     "198.51.100.0/27", "Inline intrusion prevention between core and backbone"),
    ("core_backbone", "core", "backbone", "Core Backbone Trunk", None, None,
     "Fibre trunk between the core closet and the cloud handoff"),
    ("core_agg_switch", "core", "switch", "Core Aggregation Switch", "198.51.100.5",
     "198.51.100.0/27", "Aggregates the three building closet uplinks"),
    ("core_edge_switch", "core", "switch", "Core Edge Switch", "198.51.100.6",
     "198.51.100.0/27", "Edge ports for the annex closet and the guest segment"),
    ("core_console", "core", "endpoint", "Core Console Server", "198.51.100.7",
     "198.51.100.0/27", "Serial console access to the core devices"),

    ("mgmt_switch", "mgmt", "switch", "Management Switch", "198.51.100.65",
     "198.51.100.64/27", "Out-of-band management switch for the server rack"),
    ("mgmt_storage", "mgmt", "server", "Rack Storage Array", "198.51.100.66",
     "198.51.100.64/27", "Shared storage for the hypervisor pair"),
    ("mgmt_host_a", "mgmt", "server", "Hypervisor Host A", "198.51.100.67",
     "198.51.100.64/27", "First hypervisor in the on-campus virtualization pair"),
    ("mgmt_host_b", "mgmt", "server", "Hypervisor Host B", "198.51.100.68",
     "198.51.100.64/27", "Second hypervisor in the on-campus virtualization pair"),
    ("mgmt_vm_pool", "mgmt", "vlan", "Virtual Machine Pool", None,
     "198.51.100.96/27", "Guest VLAN carrying the on-campus service VMs"),
    ("mgmt_ntp", "mgmt", "server", "Time Server", "198.51.100.69",
     "198.51.100.64/27", "Stratum-2 NTP source for the campus"),
    ("mgmt_jump", "mgmt", "endpoint", "Administration Jump Host", "198.51.100.70",
     "198.51.100.64/27", "The only host permitted to reach the management VLAN"),

    ("annex_switch", "annex_closet", "switch", "Annex Access Switch", "172.31.10.2",
     "172.31.10.0/24", "Access switch in the annex building data closet"),
    ("annex_poe_switch", "annex_closet", "switch", "Annex PoE Switch", "172.31.10.3",
     "172.31.10.0/24", "Powers the annex wireless and door hardware"),
    ("annex_ap", "annex_closet", "access_point", "Annex Access Point", "172.31.10.4",
     "172.31.10.0/24", "Staff wireless coverage for the annex building"),
    ("annex_printer", "annex_closet", "endpoint", "Annex Printer", "172.31.10.5",
     "172.31.10.0/24", "Shared printer on the annex access VLAN"),
    ("annex_uplink_radio", "annex_closet", "radio", "Annex Microwave Uplink",
     "172.31.10.6", "172.31.10.0/24",
     "60 GHz link to the radio segment where fibre was not run"),

    ("field_house_switch", "field_house", "switch", "Field House Access Switch",
     "172.31.20.2", "172.31.20.0/24",
     "Access switch in the field house data closet"),
    ("field_house_effector", "field_house", "sensor",
     "2x Directional Effector (Pair)", "172.31.20.3", "172.31.20.0/24",
     "Paired directional mitigation effectors covering the field house approach"),
    ("field_house_ap", "field_house", "access_point", "Field House Access Point",
     "172.31.20.4", "172.31.20.0/24", "Operations wireless inside the field house"),
    ("field_house_display", "field_house", "endpoint", "Field House Operator Display",
     "172.31.20.5", "172.31.20.0/24",
     "Wall display mirroring the operations floor picture"),

    ("north_stand_switch", "north_stand", "switch", "North Stand Access Switch",
     "172.31.30.2", "172.31.30.0/24", "Access switch in the north stand closet"),
    ("north_stand_poe", "north_stand", "switch", "North Stand PoE Injector",
     "172.31.30.3", "172.31.30.0/24", "Powers the north stand camera and wireless"),
    ("north_stand_camera", "north_stand", "sensor", "North Stand PTZ Camera",
     "172.31.30.4", "172.31.30.0/24",
     "Pan-tilt-zoom camera covering the north approach"),
    ("north_stand_ap", "north_stand", "access_point", "North Stand Access Point",
     "172.31.30.5", "172.31.30.0/24", "Concourse wireless on the north side"),

    ("south_stand_switch", "south_stand", "switch", "South Stand Access Switch",
     "172.31.40.2", "172.31.40.0/24", "Access switch in the south stand closet"),
    ("south_stand_poe", "south_stand", "switch", "South Stand PoE Injector",
     "172.31.40.3", "172.31.40.0/24", "Powers the south stand camera and wireless"),
    ("south_stand_camera", "south_stand", "sensor", "South Stand PTZ Camera",
     "172.31.40.4", "172.31.40.0/24",
     "Pan-tilt-zoom camera covering the south approach"),
    ("south_stand_ap", "south_stand", "access_point", "South Stand Access Point",
     "172.31.40.5", "172.31.40.0/24", "Concourse wireless on the south side"),

    ("sensor_net_firewall", "sensor_net", "firewall", "Sensor Net Firewall",
     "203.0.113.1", "203.0.113.0/26",
     "Keeps the detection segment separate from the operations floor"),
    ("sensor_net_switch", "sensor_net", "switch", "Sensor Net Switch",
     "203.0.113.2", "203.0.113.0/26", "Aggregates every fixed detection sensor"),
    ("sensor_net_radar", "sensor_net", "sensor", "Detection Radar (Rooftop)",
     "203.0.113.3", "203.0.113.0/26",
     "Primary rooftop detection radar covering the campus bowl"),
    ("sensor_net_rf_array", "sensor_net", "sensor", "RF Detection Array",
     "203.0.113.4", "203.0.113.0/26",
     "Phased RF array for controller and airframe signature detection"),
    ("sensor_net_eoir", "sensor_net", "sensor", "EO/IR Tracking Head",
     "203.0.113.5", "203.0.113.0/26",
     "Electro-optical and infrared head slaved to the radar track"),
    ("sensor_net_ptz", "sensor_net", "sensor", "Sensor Net PTZ Camera",
     "203.0.113.6", "203.0.113.0/26",
     "Visual confirmation camera for the detection segment"),
    ("remote_id_receiver", "sensor_net", "sensor", "Remote ID Receiver",
     "203.0.113.7", "203.0.113.0/26",
     "Picks up broadcast remote-ID beacons from cooperative airframes"),

    ("radio_net_switch", "radio_net", "switch", "Radio Net Switch", "203.0.113.65",
     "203.0.113.64/26", "Aggregates the microwave links and the ADS-B receiver"),
    ("radio_net_link_north", "radio_net", "radio", "North 60 GHz Link",
     "203.0.113.66", "203.0.113.64/26",
     "60 GHz microwave hop toward the north stand roof"),
    ("radio_net_link_south", "radio_net", "radio", "South 60 GHz Link",
     "203.0.113.67", "203.0.113.64/26",
     "60 GHz microwave hop toward the mobile command unit"),
    ("radio_net_repeater", "radio_net", "radio", "Radio Repeater", "203.0.113.68",
     "203.0.113.64/26", "Relays the annex uplink into the radio segment"),
    ("adsb_receiver", "radio_net", "sensor", "ADS-B Receiver", "203.0.113.69",
     "203.0.113.64/26",
     "Receives cooperative flight tracks for the airspace picture"),

    ("ops_net_switch", "ops_net", "switch", "Operations Switch", "203.0.113.129",
     "203.0.113.128/26", "Access switch for the operations floor"),
    ("ops_tak_server", "ops_net", "server", "Operations Fusion Server",
     "203.0.113.130", "203.0.113.128/26",
     "On-campus fusion and normalization server feeding the TAK picture"),
    ("ops_workstation_a", "ops_net", "endpoint", "Operator Workstation A",
     "203.0.113.131", "203.0.113.128/26",
     "Primary operator position running the WinRelay desktop client"),
    ("ops_workstation_b", "ops_net", "endpoint", "Operator Workstation B",
     "203.0.113.132", "203.0.113.128/26", "Secondary operator position"),
    ("ops_video_wall", "ops_net", "endpoint", "Operations Video Wall",
     "203.0.113.133", "203.0.113.128/26",
     "Shared display wall carrying the common operating picture"),
    ("ops_laptop_cart", "ops_net", "endpoint", "Operations Laptop Cart",
     "203.0.113.134", "203.0.113.128/26",
     "Rugged laptops issued to floor supervisors during an event"),

    ("guest_net_switch", "guest_net", "switch", "Guest Net Switch", "203.0.113.193",
     "203.0.113.192/26", "Segregated switch for field-device wireless"),
    ("guest_net_ap", "guest_net", "access_point", "Field Device Access Point",
     "203.0.113.194", "203.0.113.192/26",
     "Wireless serving handheld field devices only"),
    ("field_client_devices", "guest_net", "endpoint", "ATAK / iTAK Field Devices", None,
     "203.0.113.192/26",
     "Handheld Android and iOS devices carried by field teams"),

    ("mcv_router", "mobile_unit", "router", "Mobile Unit Router", "172.31.50.1",
     "172.31.50.0/24", "Router in the mobile command vehicle"),
    ("mcv_switch", "mobile_unit", "switch", "Mobile Unit Switch", "172.31.50.2",
     "172.31.50.0/24", "Switch in the mobile command vehicle"),
    ("mcv_sensor_gateway", "mobile_unit", "gateway", "Mobile Unit Sensor Gateway",
     "172.31.50.3", "172.31.50.0/24",
     "Normalizes vehicle sensor feeds before they reach the TAK picture"),
    ("mcv_mitigation", "mobile_unit", "sensor", "2x RF Mitigation Unit (Mobile)",
     "172.31.50.4", "172.31.50.0/24",
     "Vehicle-mounted RF detection and mitigation pair"),
    ("mcv_display", "mobile_unit", "endpoint", "Mobile Unit Displays", "172.31.50.5",
     "172.31.50.0/24",
     "Tactical, operational and strategic displays inside the vehicle"),

    ("perimeter_radar", "perimeter", "sensor", "Perimeter Radar", "203.0.113.8",
     "203.0.113.0/26", "Fence-line radar covering the campus boundary"),
    ("perimeter_camera", "perimeter", "sensor", "Perimeter Camera", "203.0.113.9",
     "203.0.113.0/26", "Fence-line camera slaved to the perimeter radar"),
]

# (source, target, link_type, label)
EDGES_A = [
    ("internet", "northwind_gw", "wan", None),
    ("internet", "crestline_gw", "wan", None),
    ("internet", "satellite_terminal", "satellite", None),
    ("northwind_gw", "wan_demarc_panel", "ethernet", "Carrier A handoff"),
    ("crestline_gw", "wan_demarc_panel", "ethernet", "Carrier B handoff"),
    ("satellite_terminal", "wan_edge_router", "satellite", None),
    ("wan_demarc_panel", "wan_edge_router", "ethernet", None),
    ("wan_edge_router", "core_firewall", "ethernet", None),
    ("core_firewall", "core_router", "ethernet", None),
    ("core_router", "core_switch", "ethernet", None),
    ("core_router", "core_ips", "ethernet", None),
    ("core_ips", "core_backbone", "ethernet", None),
    ("core_backbone", "core_agg_switch", "ethernet", None),
    ("core_agg_switch", "core_switch", "ethernet", None),
    ("core_switch", "core_edge_switch", "ethernet", None),
    ("core_switch", "core_console", "ethernet", None),
    ("core_console", "mgmt_jump", "ethernet", "Console to jump host"),
    ("core_router", "secure_backbone", "wan", "Campus to backbone"),
    ("secure_backbone", "gov_cloud", "vlan", "Backbone to cloud tenancy"),
    ("gov_cloud", "cop_application", "vlan", None),
    ("gov_cloud", "cloud_tak_server", "vlan", None),
    ("gov_cloud", "cloud_identity", "vlan", None),
    ("cop_application", "cloud_identity", "vlan", "Attribute release"),

    ("core_switch", "mgmt_switch", "ethernet", None),
    ("mgmt_switch", "mgmt_storage", "ethernet", None),
    ("mgmt_switch", "mgmt_host_a", "ethernet", None),
    ("mgmt_switch", "mgmt_host_b", "ethernet", None),
    ("mgmt_host_a", "mgmt_vm_pool", "vlan", None),
    ("mgmt_host_b", "mgmt_vm_pool", "vlan", None),
    ("mgmt_switch", "mgmt_ntp", "ethernet", None),
    ("mgmt_switch", "mgmt_jump", "ethernet", None),

    ("core_edge_switch", "annex_switch", "ethernet", None),
    ("annex_switch", "annex_poe_switch", "ethernet", None),
    ("annex_poe_switch", "annex_ap", "ethernet", None),
    ("annex_switch", "annex_printer", "ethernet", None),
    ("annex_switch", "annex_uplink_radio", "ethernet", None),
    ("annex_uplink_radio", "radio_net_repeater", "microwave_60ghz", "Annex uplink"),

    ("core_agg_switch", "field_house_switch", "ethernet", None),
    ("field_house_switch", "field_house_effector", "ethernet", None),
    ("field_house_switch", "field_house_ap", "ethernet", None),
    ("field_house_switch", "field_house_display", "ethernet", None),

    ("core_agg_switch", "north_stand_switch", "ethernet", None),
    ("north_stand_switch", "north_stand_poe", "ethernet", None),
    ("north_stand_poe", "north_stand_camera", "ethernet", None),
    ("north_stand_switch", "north_stand_ap", "ethernet", None),
    ("north_stand_switch", "radio_net_link_north", "microwave_60ghz", None),

    ("core_agg_switch", "south_stand_switch", "ethernet", None),
    ("south_stand_switch", "south_stand_poe", "ethernet", None),
    ("south_stand_poe", "south_stand_camera", "ethernet", None),
    ("south_stand_switch", "south_stand_ap", "ethernet", None),

    ("core_switch", "sensor_net_firewall", "ethernet", None),
    ("sensor_net_firewall", "sensor_net_switch", "ethernet", None),
    ("sensor_net_switch", "sensor_net_radar", "ethernet", None),
    ("sensor_net_switch", "sensor_net_rf_array", "ethernet", None),
    ("sensor_net_switch", "sensor_net_eoir", "ethernet", None),
    ("sensor_net_switch", "sensor_net_ptz", "ethernet", None),
    ("sensor_net_switch", "remote_id_receiver", "ethernet", None),
    ("sensor_net_radar", "sensor_net_eoir", "vlan", "Track handoff"),
    ("sensor_net_switch", "perimeter_radar", "ethernet", None),
    ("sensor_net_switch", "perimeter_camera", "ethernet", None),
    ("perimeter_radar", "perimeter_camera", "vlan", "Slew to cue"),

    ("core_switch", "radio_net_switch", "ethernet", None),
    ("radio_net_switch", "radio_net_link_north", "ethernet", None),
    ("radio_net_switch", "radio_net_link_south", "ethernet", None),
    ("radio_net_switch", "radio_net_repeater", "ethernet", None),
    ("radio_net_switch", "adsb_receiver", "ethernet", None),
    ("adsb_receiver", "ops_tak_server", "vlan", "Cooperative tracks"),

    ("core_switch", "ops_net_switch", "ethernet", None),
    ("ops_net_switch", "ops_tak_server", "ethernet", None),
    ("ops_net_switch", "ops_workstation_a", "ethernet", None),
    ("ops_net_switch", "ops_workstation_b", "ethernet", None),
    ("ops_net_switch", "ops_video_wall", "ethernet", None),
    ("ops_net_switch", "ops_laptop_cart", "ethernet", None),
    ("ops_net_switch", "sensor_net_firewall", "vlan", "Detection feed"),
    ("ops_tak_server", "cloud_tak_server", "vlan", "Server federation"),
    ("cop_application", "ops_video_wall", "vlan", "COP to video wall"),

    ("core_edge_switch", "guest_net_switch", "ethernet", None),
    ("guest_net_switch", "guest_net_ap", "ethernet", None),
    ("guest_net_ap", "field_client_devices", "wireless", None),
    ("cloud_tak_server", "field_client_devices", "vlan", "Handheld check-in"),

    ("crestline_gw", "mcv_router", "wan", "Vehicle circuit"),
    ("mcv_router", "mcv_switch", "ethernet", None),
    ("mcv_switch", "mcv_sensor_gateway", "ethernet", None),
    ("mcv_switch", "mcv_mitigation", "ethernet", None),
    ("mcv_switch", "mcv_display", "ethernet", None),
    ("mcv_router", "radio_net_link_south", "microwave_60ghz", "Vehicle backhaul"),
]

# --- Site B topology --------------------------------------------------------
ZONES_B = {
    # 'site' is deliberately absent from the zone-token table in
    # src/tabs/network/zones.ts, which is what keeps the ring-fallback path
    # exercised by a real bundle rather than only by a unit test.
    "site": {
        "label": "Proving Ground Site",
        "description": "Everything inside the fence line (172.31.60.0/24)",
    },
    "wan": {
        "label": "WAN / Internet",
        "description": "Northwind Telecom and Crestline Broadband circuits "
                       "(192.0.2.32/29)",
    },
}

DEVICES_B = [
    ("wf_firewall", "site", "firewall", "Site Firewall Appliance", "172.31.60.1",
     "172.31.60.0/24", "Single appliance guarding the whole proving ground site"),
    ("wf_server", "site", "server", "Site Server", "172.31.60.2", "172.31.60.0/24",
     "Local server holding test range configuration and recordings"),
    ("wf_gate_sensor", "site", "sensor", "Gate Detection Sensor", "172.31.60.3",
     "172.31.60.0/24", "Detection sensor covering the range entry gate"),
    ("wf_ap", "site", "access_point", "Site Access Point", "172.31.60.4",
     "172.31.60.0/24", "Wireless coverage across the range apron"),
    ("wf_laptop", "site", "endpoint", "Range Laptop", "172.31.60.5",
     "172.31.60.0/24", "Operator laptop used during range runs"),
    ("wf_northwind_gw", "wan", "gateway", "Northwind Telecom GW", "192.0.2.33",
     "192.0.2.32/29", "Primary circuit into the proving ground"),
    ("wf_crestline_gw", "wan", "gateway", "Crestline Broadband GW", "192.0.2.34",
     "192.0.2.32/29", "Secondary circuit into the proving ground"),
    ("wf_internet", "wan", "cloud", "Internet", None, None,
     "Public internet, reached through either circuit"),
]

EDGES_B = [
    ("wf_firewall", "wf_server", "ethernet", None),
    ("wf_firewall", "wf_gate_sensor", "ethernet", None),
    ("wf_firewall", "wf_ap", "ethernet", None),
    ("wf_laptop", "wf_ap", "ethernet", None),
    ("wf_ap", "wf_northwind_gw", "ethernet", None),
    ("wf_firewall", "wf_crestline_gw", "ethernet", None),
    ("wf_northwind_gw", "wf_internet", "wan", None),
    ("wf_crestline_gw", "wf_internet", "wan", None),
]


def _topology(site_id, label, name, description, updated, zones, devices, edges,
              visio_tabs, source_images):
    device_records = [
        {"id": did, "zone": zone, "type": dtype, "label": dlabel, "ip": ip,
         "subnet": subnet, "description": desc}
        for did, zone, dtype, dlabel, ip, subnet, desc in devices
    ]
    edge_records = [
        {"source": src, "target": dst, "link_type": link_type, "label": elabel}
        for src, dst, link_type, elabel in edges
    ]
    meta = {
        "label": label,
        "name": name,
        "description": description,
        "classification": CLASSIFICATION,
        "version": "2.0",
        "updated": updated,
        "source_images": source_images,
        "visio_tabs": visio_tabs,
        "device_count": len(device_records),
        "edge_count": len(edge_records),
    }
    return {
        "site_id": site_id,
        "meta": meta,
        "zones": zones,
        "devices": device_records,
        "edges": edge_records,
    }


def build_networks():
    return {
        SITE_A: _topology(
            SITE_A, SITE_A_LABEL,
            f"C-UAS Network Architecture — {SITE_A_LABEL}",
            "Sample campus topology: cloud tier, dual-carrier WAN edge, core "
            "and management closets, three building closets, segmented sensor, "
            "radio, operations and guest networks, and a mobile command unit. "
            "Fabricated reference data.",
            "2026-04-21", ZONES_A, DEVICES_A, EDGES_A,
            ["Network Diagram", "Management", "Sensor Net", "Radio Net",
             "Operations", "Mobile Unit", "Power Distribution",
             "Rack Elevation"],
            20,
        ),
        SITE_B: _topology(
            SITE_B, SITE_B_LABEL,
            f"C-UAS Network Architecture — {SITE_B_LABEL}",
            "Sample proving-ground topology: one firewall, one server, one "
            "gate sensor, wireless, and two carrier circuits. Fabricated "
            "reference data.",
            "2026-04-21", ZONES_B, DEVICES_B, EDGES_B,
            [], None,
        ),
    }


# --- Curated system-to-device map ------------------------------------------
# The 13 Site A mappings. Two (homing, kite) are software-only curation records
# that name no hardware, and 'atak' records a deliberate absence from the
# matrix rather than an oversight.
MAPPINGS_A = {
    "atak": {
        "confidence": "high",
        "devices": ["field_client_devices"],
        "matrix_id_exists": False,
        "note": "ATAK and iTAK field devices. No matrix system id covers them, "
                "so this row records the hardware rather than a system",
    },
    "ucop": {
        "confidence": "high",
        "devices": ["cop_application", "gov_cloud", "mcv_display"],
        "note": "Common picture application in the cloud tenancy, plus the "
                "three display heads in the mobile unit",
    },
    "homing": {
        "confidence": "high",
        "devices": [],
        "note": "Relay Homing Plugin: client software, no dedicated hardware",
    },
    "tagpoint": {
        "confidence": "low",
        "devices": ["remote_id_receiver"],
        "note": "The remote-ID receiver is the only campus device that hears "
                "this class of sensor",
    },
    "civair": {
        "confidence": "medium",
        "devices": ["adsb_receiver"],
        "note": "The ADS-B receiver carries the same cooperative flight tracks "
                "this feed supplies",
    },
    "fpsrel": {
        "confidence": "high",
        "devices": ["mcv_router", "mcv_switch", "mcv_sensor_gateway",
                    "mcv_mitigation", "mcv_display"],
        "note": "Mobile command vehicle: the relay-backed operational stack",
    },
    "recon": {
        "confidence": "medium",
        "devices": ["sensor_net_radar", "sensor_net_rf_array", "sensor_net_eoir",
                    "sensor_net_ptz", "perimeter_radar"],
        "note": "Detection sensors: rooftop and fence-line radar, the RF array, "
                "the EO/IR head and the segment PTZ",
    },
    "crosslink": {
        "confidence": "high",
        "devices": ["cop_application", "gov_cloud"],
        "note": "Carries the common picture application tier inside the cloud "
                "tenancy",
    },
    "eventrel": {
        "confidence": "high",
        "devices": ["cloud_tak_server"],
        "note": "Cloud relay server that federates the event picture",
    },
    "kite": {
        "confidence": "high",
        "devices": [],
        "note": "KITE Relay Plugin: client software, no dedicated hardware",
    },
    "bastion": {
        "confidence": "high",
        "devices": ["field_house_effector"],
        "note": "Mitigation effector pair in the field house closet",
    },
    "jetty": {
        "confidence": "low",
        "devices": ["ops_tak_server"],
        "note": "The operations fusion server is the likely home for this "
                "engine, pending an integration review",
    },
    "winrel": {
        "confidence": "medium",
        "devices": ["ops_workstation_a", "ops_laptop_cart"],
        "note": "WinRelay desktop clients on the operator position and the "
                "laptop cart",
    },
}

NOT_DEPLOYED_A = [
    "skyward", "orbit", "scan", "beacon", "cbprel", "cirrus", "trackwell", "dwell",
    "ember", "fathom", "partner", "gantry", "enterprise", "halyard", "icerel", "dispatch",
    "ingot", "cbpsen", "uscgrel", "ussrel",
]

PENDING_REVIEW = {
    "ucop": "Does the cloud relay server also count under ucop, or strictly "
            "under eventrel?",
    "jetty": "Does Jetty run on the operations fusion server, or on hardware "
             "that is not drawn yet?",
    "cbpsen": "Perimeter radar on the campus boundary: is there any CBP "
              "Sentinel integration?",
    "recon": "Establish which sensors sit under the ISR programme and which "
             "were added ad hoc",
    "winrel": "Which of the operator laptops actually run the WinRelay desktop "
              "client?",
    "atak": "The matrix has no 'atak' system id. Should handhelds get a row of "
            "their own, or hang off the relay rows that issue them?",
    "westfield_all": "Nothing is mapped at Westfield Proving Ground yet. Walk "
                     "the range with the site lead and fill the site in",
}


def build_sdmap(networks):
    """The curated overlay, with the unclaimed rosters derived from the map.

    Deriving rather than restating is the point: a device added to a topology
    and not mapped shows up as orphaned hardware on the next run, which is the
    behaviour the lossiness tab exists to report.
    """
    claimed = {d for m in MAPPINGS_A.values() for d in m["devices"]}
    unclaimed_a = [d["id"] for d in networks[SITE_A]["devices"]
                   if d["id"] not in claimed]
    unclaimed_b = [d["id"] for d in networks[SITE_B]["devices"]]
    return {
        "_version": "0.2-sample",
        "default_site": SITE_A,
        "sites": {
            SITE_A: {
                "label": SITE_A_LABEL,
                "scope": "Campus network, cloud tier and the mobile command unit",
                "mappings": MAPPINGS_A,
                "not_deployed_at_site": {
                    sid: "checked, absent" for sid in NOT_DEPLOYED_A
                },
                "unclaimed_devices": {"infrastructure": unclaimed_a},
            },
            SITE_B: {
                "label": SITE_B_LABEL,
                "scope": "Proving ground site network",
                "mappings": {},
                "not_deployed_at_site": {},
                "unclaimed_devices": {"infrastructure": unclaimed_b},
            },
        },
        "pending_review": PENDING_REVIEW,
    }


# --- Emission ---------------------------------------------------------------
def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _system_payload(s):
    from .classify import owner_group_display

    return {
        "id": s["id"],
        "name": s["name"],
        "label": s["label"],
        "category": s["cat"],
        "owner_group_id": s["gid"],
        "owner_group": owner_group_display(s["gid"]),
        "color_key": s["ck"],
        "confirmed": not s["soft"],
        "risk": s["risk"],
        "risk_source": s["risk_source"],
        "detail": s["detail"],
        "integrations_prose": s["integ"],
    }


def _methodology():
    """The live classifier payload, with the soft-id sets pinned.

    config.py carries the same two sets, but it is scrubbed independently of
    this generator, so reading them from here keeps the bundle reproducible
    while that edit is in flight.
    """
    payload = extract_methodology()
    payload["always_soft"] = sorted(ALWAYS_SOFT)
    payload["never_soft"] = sorted(NEVER_SOFT)
    return payload


def _snapshot(report):
    """The committed snapshot for this build: this build's own figures.

    One snapshot is not a trend, and the Trend view says so. A sample that
    should show movement needs a second, genuinely different set of inputs,
    never an edited figure.
    """
    return snapshot_payload(report, BUILT_AT, GIT_SHA)


def emit(out_dir):
    """Write the whole bundle under out_dir. Returns the manifest."""
    out_dir = Path(out_dir)
    systems = build_systems()
    auto = extract_links(systems)
    links = merge_links(auto)
    desired = desired_links()
    crosswalk = build_crosswalk()
    networks = build_networks()
    sdmap = build_sdmap(networks)

    report = compute_lossiness(
        systems=systems, links=links, desired=desired,
        crosswalk=crosswalk, sdmap=sdmap, networks=networks,
    )

    _write(out_dir / "systems.json", [_system_payload(s) for s in systems])
    _write(out_dir / "links.json", {"current": links, "desired": desired})
    _write(out_dir / "crosswalk.json", crosswalk)
    _write(out_dir / "glossary.json", GLOSSARY)
    _write(out_dir / "methodology.json", _methodology())
    _write(out_dir / "lossiness.json",
           {**report, "top_gaps": top_gaps(report, systems)})
    _write(out_dir / "coverage.json", {
        "default_site": sdmap["default_site"],
        "sites": {
            sid: {
                "label": site["label"],
                "scope": site["scope"],
                "mappings": site["mappings"],
                "not_deployed_at_site": site["not_deployed_at_site"],
                "unclaimed_devices": site["unclaimed_devices"],
            }
            for sid, site in sdmap["sites"].items()
        },
        "pending_review": sdmap["pending_review"],
        "confidence_counts": mapping_confidence_counts(sdmap),
    })

    for site_id, net in networks.items():
        _write(out_dir / "sites" / f"{site_id}.json", net)

    _write(out_dir / "project.json", {
        "slug": PROJECT_SLUG,
        "name": PROJECT_NAME,
        "baseline_date": BASELINE_DATE,
        "source_label": SOURCE_LABEL,
        "sites": [
            {"id": sid,
             "label": net["meta"]["label"],
             "classification": net["meta"]["classification"],
             "device_count": net["meta"]["device_count"],
             "edge_count": net["meta"]["edge_count"],
             "updated": net["meta"]["updated"]}
            for sid, net in sorted(networks.items())
        ],
        "default_site": sdmap["default_site"],
    })

    _write(out_dir / "snapshots" / f"{SNAPSHOT_LABEL}.json", _snapshot(report))

    manifest = {
        "bundle_version": BUNDLE_VERSION,
        "tool_version": TOOL_VERSION,
        "built_at": BUILT_AT,
        "git_sha": GIT_SHA,
        "source_label": SOURCE_LABEL,
        "baseline_date": BASELINE_DATE,
        "snapshots": [SNAPSHOT_LABEL],
        "counts": {
            "systems": len(systems),
            "confirmed": sum(1 for s in systems if not s["soft"]),
            "unconfirmed": sum(1 for s in systems if s["soft"]),
            "links": len(links),
            "desired_links": len(desired),
            "requirements": len(crosswalk),
            "acronyms": len(GLOSSARY["acronyms"]),
            "sites": len(networks),
            "devices": sum(n["meta"]["device_count"] for n in networks.values()),
        },
    }
    _write(out_dir / "manifest.json", manifest)
    return manifest


def emit_golden(out_dir):
    """Rewrite ingest/tests/fixtures/golden from the sample workbook's rows.

    The four fixtures are a verbatim dump of what the ingest reads out of the
    matrix workbook, so they are regenerated from the same declarations
    make_sample_workbook.py writes into the .xlsx.
    """
    import collections

    out_dir = Path(out_dir)
    systems = build_systems()
    auto = extract_links(systems)
    counts = {
        "systems": len(systems),
        "confirmed": sum(1 for s in systems if not s["soft"]),
        "unconfirmed": sum(1 for s in systems if s["soft"]),
        "risk": dict(collections.Counter(s["risk"] for s in systems)),
        "risk_source": dict(collections.Counter(s["risk_source"] for s in systems)),
        "owner_group": dict(collections.Counter(s["gid"] for s in systems)),
        "auto_links": len(auto),
        "desired_links": len(DESIRED_LINKS),
        "crosswalk_rows": len(CROSSWALK_ROWS),
    }
    _write(out_dir / "systems.json", systems)
    _write(out_dir / "auto_links.json", auto)
    _write(out_dir / "crosswalk.json", build_crosswalk())
    _write(out_dir / "counts.json", counts)
    return counts


def main(argv=None):
    import argparse

    repo = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-o", "--out", default=str(repo / "fixtures" / "synthetic"))
    parser.add_argument(
        "--golden", default=str(repo / "ingest" / "tests" / "fixtures" / "golden"),
        help="where to rewrite the golden fixtures; empty string skips them",
    )
    args = parser.parse_args(argv)

    manifest = emit(args.out)
    print(f"[synthetic] wrote {args.out}: " + ", ".join(
        f"{v} {k}" for k, v in manifest["counts"].items()))
    if args.golden:
        emit_golden(args.golden)
        print(f"[synthetic] wrote {args.golden}")
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
