"""Emit the JSON bundles the React app reads.

Every file is written with sorted keys and a trailing newline so two runs on
identical inputs produce identical bytes. Non-determinism here means every
rebuild churns the git diff and real changes hide in the noise.
"""
import json
from pathlib import Path

from .classify import owner_group_display
from .curation import mapping_confidence_counts
from .lossiness import compute_lossiness, top_gaps
from .methodology import extract_methodology

SNAPSHOT_FIELDS = ("key", "label", "numerator", "denominator",
                   "value_pct", "unit", "severity")


def snapshot_payload(report, built_at, git_sha):
    """One build's snapshot: its date and commit, and the seven lossiness
    figures exactly as the report states them.

    The sample generator writes its committed snapshot through this too, so
    neither writer can restate a figure. It once recorded requirement
    attrition one requirement better than the report it claimed to record,
    so the trend view would have a delta to draw, and a rebuild of unchanged
    inputs then showed a loss that never happened.
    """
    return {
        "label": built_at.split("T")[0],
        "built_at": built_at,
        "git_sha": git_sha,
        "dimensions": [{k: d[k] for k in SNAPSHOT_FIELDS}
                       for d in report["dimensions"]],
    }

BUNDLE_VERSION = 1


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _system_payload(s):
    """The app's System shape.

    Names ship whole. The old tool truncated them to 24 characters with a '..'
    suffix for a fixed-width layout, and the truncated form leaked into the
    analytics payload; eliding is the UI's job.
    """
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


def emit_bundles(out_dir, systems, links, desired, crosswalk, glossary, sdmap,
                 networks, source_label, baseline_date, built_at, git_sha):
    """Write every bundle under out_dir. Returns the manifest."""
    out_dir = Path(out_dir)

    report = compute_lossiness(
        systems=systems, links=links, desired=desired,
        crosswalk=crosswalk, sdmap=sdmap, networks=networks,
    )

    _write(out_dir / "systems.json", [_system_payload(s) for s in systems])
    _write(out_dir / "links.json", {"current": links, "desired": desired})
    _write(out_dir / "crosswalk.json", crosswalk)
    _write(out_dir / "glossary.json", glossary)
    _write(out_dir / "methodology.json", extract_methodology())
    _write(out_dir / "lossiness.json", {
        **report,
        "top_gaps": top_gaps(report, systems),
    })
    _write(out_dir / "coverage.json", {
        "default_site": sdmap.get("default_site"),
        "sites": {
            sid: {
                "label": site.get("label", sid),
                "scope": site.get("scope", ""),
                "mappings": site.get("mappings", {}),
                "not_deployed_at_site": site.get("not_deployed_at_site", {}),
                "unclaimed_devices": site.get(
                    "unclaimed_devices", {"infrastructure": []}
                ),
            }
            for sid, site in sdmap.get("sites", {}).items()
        },
        "pending_review": sdmap.get("pending_review", {}),
        "confidence_counts": mapping_confidence_counts(sdmap),
    })

    for site_id, net in (networks or {}).items():
        _write(out_dir / "sites" / f"{site_id}.json", net)

    _write(out_dir / "project.json", {
        "slug": "dhs-cuas",
        "name": "DHS C-UAS Architecture",
        "baseline_date": baseline_date,
        "source_label": source_label,
        "sites": [
            {"id": sid,
             "label": net["meta"]["label"],
             "classification": net["meta"]["classification"],
             "device_count": net["meta"]["device_count"],
             "edge_count": net["meta"]["edge_count"],
             "updated": net["meta"]["updated"]}
            for sid, net in sorted((networks or {}).items())
        ],
        "default_site": sdmap.get("default_site"),
    })

    # Snapshots are written before the manifest so the index below sees this
    # run's file. A static host cannot be globbed, so the manifest is the only
    # way the app can discover which snapshots exist.
    snapshot = snapshot_payload(report, built_at, git_sha)
    _write(out_dir / "snapshots" / f"{snapshot['label']}.json", snapshot)

    manifest = {
        "bundle_version": BUNDLE_VERSION,
        "tool_version": "ATLAS Phase 1",
        "built_at": built_at,
        "git_sha": git_sha,
        "source_label": source_label,
        "baseline_date": baseline_date,
        "snapshots": sorted(p.stem for p in (out_dir / "snapshots").glob("*.json")),
        "counts": {
            "systems": len(systems),
            "confirmed": sum(1 for s in systems if not s["soft"]),
            "unconfirmed": sum(1 for s in systems if s["soft"]),
            "links": len(links),
            "desired_links": len(desired),
            "requirements": len(crosswalk),
            "acronyms": len(glossary.get("acronyms", [])),
            "sites": len(networks or {}),
            "devices": sum(n["meta"]["device_count"] for n in (networks or {}).values()),
        },
    }
    _write(out_dir / "manifest.json", manifest)
    return manifest


def emit_classifier_module(out_path):
    """Emit the classification tables as TypeScript.

    LocalFileProvider classifies in the browser, and a hand-maintained second
    copy of these tables would drift from the Python one within a release. This
    file is generated, committed, and guarded by a test that regenerates it and
    compares.
    """
    from . import config

    def ts(value):
        return json.dumps(value, indent=2, ensure_ascii=False)

    owner_rules = [[s, g, l, c] for s, g, l, c in config.OWNER_RULES]

    body = f"""// GENERATED by atlas_ingest.bundle.emit_classifier_module. Do not edit.
// Regenerate: npm run ingest:tables
// Source of truth: ingest/src/atlas_ingest/config.py

export const CATEGORY_MAP: Record<string, {{ branch: string; label: string; ck: string }}> =
  {ts(config.CATEGORY_MAP)}

/** Order is load-bearing: first match wins. */
export const OWNER_RULES: ReadonlyArray<readonly [string, string, string, string]> =
  {ts(owner_rules)}

export const ID_MAP: Record<string, string> = {ts(config.ID_MAP)}

export const LABEL_MAP: Record<string, string> = {ts(config.LABEL_MAP)}

export const SOFT_KEYWORDS: string[] = {ts(list(config.SOFT_KEYWORDS))}
export const ALWAYS_SOFT: string[] = {ts(sorted(config.ALWAYS_SOFT))}
export const NEVER_SOFT: string[] = {ts(sorted(config.NEVER_SOFT))}
export const SOFT_GROUPS: string[] = {ts(sorted(config.SOFT_GROUPS))}
export const HIGH_KEYWORDS: string[] = {ts(list(config.HIGH_KEYWORDS))}
export const LOW_KEYWORDS: string[] = {ts(list(config.LOW_KEYWORDS))}
export const MEDIUM_KEYWORDS: string[] = {ts(list(config.MEDIUM_KEYWORDS))}
export const LINK_NAME_FRAGMENTS: Record<string, string> = {ts(config.LINK_NAME_FRAGMENTS)}
export const OWNER_GROUP_DISPLAY: Record<string, string> = {ts(config.OWNER_GROUP_DISPLAY)}
"""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(body, encoding="utf-8")
    return out_path


def main(argv=None):
    """CLI: validate, then emit. Never emits over a failing gate."""
    import argparse
    import sys

    from .cli import add_input_args, git_sha, load_all_inputs, now_iso
    from .validate import validate

    parser = argparse.ArgumentParser(description="Emit ATLAS JSON bundles")
    add_input_args(parser)
    parser.add_argument("-o", "--out", default="public/data")
    args = parser.parse_args(argv)

    inputs = load_all_inputs(args)
    fails = validate(
        systems=inputs["systems"], links=inputs["links"], sdmap=inputs["sdmap"],
        networks=inputs["networks"], crosswalk=inputs["crosswalk"],
        glossary=inputs["glossary"],
    )
    if fails:
        print("[bundle] refusing to emit; integrity gates failed:", file=sys.stderr)
        for f in fails:
            print(f"  - {f}", file=sys.stderr)
        return 1

    manifest = emit_bundles(
        out_dir=args.out, systems=inputs["systems"], links=inputs["links"],
        desired=inputs["desired"], crosswalk=inputs["crosswalk"],
        glossary=inputs["glossary"], sdmap=inputs["sdmap"],
        networks=inputs["networks"], source_label=args.source_label,
        baseline_date=args.baseline_date, built_at=now_iso(), git_sha=git_sha(),
    )
    print(f"[bundle] wrote {args.out}: " + ", ".join(
        f"{v} {k}" for k, v in manifest["counts"].items()))
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
