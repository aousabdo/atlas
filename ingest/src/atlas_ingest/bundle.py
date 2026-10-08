"""Emit the JSON bundles the React app reads.

Every file is written with sorted keys and a trailing newline so two runs on
identical inputs produce identical bytes. Non-determinism here means every
rebuild churns the git diff and real changes hide in the noise.
"""
import json
import re
import sys
from pathlib import Path

from .classify import owner_group_display
from .curation import mapping_confidence_counts
from .lossiness import compute_lossiness, top_gaps
from .methodology import extract_methodology

BUNDLE_VERSION = 1

SNAPSHOT_FIELDS = ("key", "label", "numerator", "denominator",
                   "value_pct", "unit", "severity")

# Lower-case words joined by single hyphens. The slug is compared byte for
# byte, here and in the browser, so it gets exactly one spelling: 'Harbor' and
# 'harbor' would otherwise read as two projects and split one history in two.
_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def check_project_slug(slug):
    """The slug, or a ValueError saying why it cannot be one."""
    if not isinstance(slug, str) or not _SLUG.fullmatch(slug):
        raise ValueError(
            f"project slug {slug!r} is not a slug: use lower-case letters and "
            f"digits joined by single hyphens, e.g. 'harbor-cuas'"
        )
    return slug


def snapshot_payload(report, built_at, git_sha, project):
    """One build's snapshot: whose it is, its date and commit, and the seven
    lossiness figures exactly as the report states them.

    `project` is the project slug, the same string project.json carries. A
    snapshot used to carry no identity at all, so a sample snapshot seeded
    into the output directory was indexed beside a real one, and the Trend
    view showed the difference between the two projects as movement.

    The sample generator writes its committed snapshot through this too, so
    neither writer can restate a figure. It once recorded requirement
    attrition one requirement better than the report it claimed to record,
    so the trend view would have a delta to draw, and a rebuild of unchanged
    inputs then showed a loss that never happened.
    """
    return {
        "project": project,
        "label": built_at.split("T")[0],
        "built_at": built_at,
        "git_sha": git_sha,
        "dimensions": [{k: d[k] for k in SNAPSHOT_FIELDS}
                       for d in report["dimensions"]],
    }


def _index_snapshots(snapshot_dir, project):
    """Labels of the snapshots in snapshot_dir that are `project`'s.

    Any other file is named on stderr and left where it is. Not indexing it
    is what keeps it out of the Trend view, since the manifest is the only way
    the app finds a snapshot. Deleting it is not this function's call: a
    snapshot is the one part of a bundle a rebuild cannot recreate.
    """
    labels = []
    for path in sorted(snapshot_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            payload = None
        if not isinstance(payload, dict):
            reason = "it could not be read as a snapshot"
        elif payload.get("project") == project:
            labels.append(path.stem)
            continue
        elif not payload.get("project"):
            # Absent, null and "" alike. TrendView reads them the same way.
            reason = ("it carries no project identity, so nothing says whose "
                      "it is")
        else:
            reason = f"it is a snapshot of project {payload['project']!r}"
        print(f"[bundle] not indexing snapshots/{path.name}: {reason}, and "
              f"this bundle is {project!r}. It is left in {snapshot_dir}; "
              f"remove it if it should not ship beside this bundle.",
              file=sys.stderr)
    return sorted(labels)


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
                 networks, source_label, baseline_date, built_at, git_sha,
                 project_slug, project_name):
    """Write every bundle under out_dir. Returns the manifest.

    project_slug is the bundle's identity: project.json carries it and so does
    every snapshot, and the manifest indexes only the snapshots that match.
    It is not the source label and baseline date, because those name a
    revision of the matrix and change at every new baseline, which is exactly
    the movement the Trend view exists to show.
    """
    check_project_slug(project_slug)
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
        "slug": project_slug,
        "name": project_name,
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
    # way the app can discover which snapshots exist, and so the index is
    # where another project's snapshot is kept out.
    snapshot = snapshot_payload(report, built_at, git_sha, project_slug)
    _write(out_dir / "snapshots" / f"{snapshot['label']}.json", snapshot)

    manifest = {
        "bundle_version": BUNDLE_VERSION,
        "tool_version": "ATLAS Phase 1",
        "built_at": built_at,
        "git_sha": git_sha,
        "source_label": source_label,
        "baseline_date": baseline_date,
        "snapshots": _index_snapshots(out_dir / "snapshots", project_slug),
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

    from .cli import add_input_args, git_sha, load_all_inputs, now_iso
    from .validate import validate

    def slug(value):
        try:
            return check_project_slug(value)
        except ValueError as e:
            raise argparse.ArgumentTypeError(str(e)) from None

    parser = argparse.ArgumentParser(description="Emit ATLAS JSON bundles")
    add_input_args(parser)
    parser.add_argument("-o", "--out", default="public/data")
    # Required, with no default. A defaulted identity is how every bundle this
    # ingest wrote came to claim the same project.
    parser.add_argument("--project-slug", required=True, type=slug,
                        help="the project this bundle and its snapshots "
                             "belong to, e.g. harbor-cuas")
    parser.add_argument("--project-name",
                        help="display name; defaults to the slug")
    args = parser.parse_args(argv)

    inputs = load_all_inputs(args)
    fails = validate(
        systems=inputs["systems"], links=inputs["links"], sdmap=inputs["sdmap"],
        networks=inputs["networks"], crosswalk=inputs["crosswalk"],
        glossary=inputs["glossary"], desired=inputs["desired"],
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
        project_slug=args.project_slug,
        project_name=args.project_name or args.project_slug,
    )
    print(f"[bundle] wrote {args.out}: " + ", ".join(
        f"{v} {k}" for k, v in manifest["counts"].items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
