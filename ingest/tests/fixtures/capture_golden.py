#!/usr/bin/env python3
"""Freeze the CURRENT build script's output as golden fixtures.

Run once, before any porting. Re-run only when a classifier change is
intentional, and review the fixture diff as part of that change.

    ATLAS_SOURCE_REPO=/path/to/reference-repo \
        python3 ingest/tests/fixtures/capture_golden.py --allow-real

This is the one command that can refill the fixtures with whatever the source
repo holds. If that repo is a real, controlled dataset, running it commits real
records to this tree, so the write is gated behind --allow-real rather than
being the default. There is no default source repo for the same reason.
"""
import argparse
import collections
import importlib.util
import json
import os
import sys
from pathlib import Path

OUT = Path(__file__).parent / "golden"


def source_paths():
    repo = os.environ.get("ATLAS_SOURCE_REPO")
    if not repo:
        sys.exit(
            "ATLAS_SOURCE_REPO is not set. Point it at the reference repo whose "
            "output you want frozen; there is no default."
        )
    mindmap = Path(repo) / "traceability" / "mindmap"
    return mindmap, mindmap / "build_cuas_tool_v4.py", mindmap / "matrix.xlsx"


def load_old_module(build):
    spec = importlib.util.spec_from_file_location("old_build", build)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--allow-real",
        action="store_true",
        help="confirm that whatever ATLAS_SOURCE_REPO holds may be written into "
        "the checked-in fixtures",
    )
    args = parser.parse_args()
    if not args.allow_real:
        sys.exit(
            "refusing to write fixtures without --allow-real: this copies the "
            "source repo's records into version control."
        )

    mindmap, build, xlsx = source_paths()
    OUT.mkdir(parents=True, exist_ok=True)
    old = load_old_module(build)

    systems = old.read_excel(str(xlsx))
    auto_links = old.extract_links(systems)
    crosswalk = old._read_crosswalk(str(xlsx))
    overrides = json.loads((mindmap / "overrides.json").read_text(encoding="utf-8"))

    counts = {
        "systems": len(systems),
        "confirmed": sum(1 for s in systems if not s["soft"]),
        "unconfirmed": sum(1 for s in systems if s["soft"]),
        "risk": dict(collections.Counter(s["risk"] for s in systems)),
        "risk_source": dict(collections.Counter(s["risk_source"] for s in systems)),
        "owner_group": dict(collections.Counter(s["gid"] for s in systems)),
        "auto_links": len(auto_links),
        "desired_links": len(overrides.get("desired_links", [])),
        "crosswalk_rows": len(crosswalk),
    }

    for name, payload in [
        ("systems.json", systems),
        ("auto_links.json", auto_links),
        ("crosswalk.json", crosswalk),
        ("counts.json", counts),
    ]:
        (OUT / name).write_text(
            json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {name}")

    print(json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()
