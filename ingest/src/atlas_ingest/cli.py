"""Shared CLI wiring.

Keeping input loading in one place means the validate gate and the bundle
emitter can never disagree about what the inputs are.
"""
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from .crosswalk import read_crosswalk
from .curation import load_glossary, load_overrides, load_system_device_map
from .excel import read_excel
from .links import desired_links, extract_links, merge_links
from .network import load_network


def add_input_args(parser):
    parser.add_argument("matrix", help="Traceability Matrix .xlsx")
    parser.add_argument("--overrides", required=True)
    parser.add_argument("--glossary", required=True)
    parser.add_argument("--system-device-map", required=True)
    parser.add_argument("--network-json", action="append", default=[],
                        metavar="SITE:PATH",
                        help="repeatable, e.g. --network-json northgate:../x.json")
    parser.add_argument("--source-label",
                        default="Traceability Matrix 5 MAR 2026 (enhanced)")
    parser.add_argument("--baseline-date", default="2026-03-05")


def load_all_inputs(args):
    systems = read_excel(args.matrix)
    overrides = load_overrides(args.overrides)
    networks = {}
    for spec in args.network_json:
        site_id, _, path = spec.partition(":")
        if not path:
            raise SystemExit(f"--network-json expects SITE:PATH, got {spec!r}")
        networks[site_id] = load_network(path, site_id)
    return {
        "systems": systems,
        "overrides": overrides,
        "links": merge_links(extract_links(systems), overrides),
        "desired": desired_links(overrides),
        "crosswalk": read_crosswalk(args.matrix),
        "glossary": load_glossary(args.glossary),
        "sdmap": load_system_device_map(args.system_device_map),
        "networks": networks,
    }


def git_sha():
    """Short SHA of the atlas repo, or 'unknown' outside a checkout."""
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).resolve().parents[3],
            stderr=subprocess.DEVNULL,
        ).decode("utf-8").strip()
    except Exception:
        return "unknown"


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0, tzinfo=None).isoformat()
