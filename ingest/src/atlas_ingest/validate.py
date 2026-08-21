"""Cross-file integrity gates. Fails closed.

validate() is pure and returns a list of failure strings; main() does the I/O
and owns the exit code. That split is what makes the gates unit-testable.

Replaces build_cuas_tool_v4.py:617-720, which warned and continued. Warning and
continuing is how stale data shipped, so every check here is an error.
"""
import sys


def validate(systems, links, sdmap, networks, crosswalk, glossary):
    """-> list of failure strings. Empty means every gate passed.

    Collects all failures rather than bailing on the first, so one run tells
    you everything that needs fixing.
    """
    fails = []
    matrix_ids = {s["id"] for s in systems}
    system_names = {s["name"] for s in systems}

    for site_id, site in (sdmap.get("sites") or {}).items():
        device_ids = None
        net = (networks or {}).get(site_id)
        if net:
            device_ids = {d["id"] for d in net["devices"]}

        for sys_id, entry in (site.get("mappings") or {}).items():
            # matrix_id_exists: false is a documented negative fact, not a
            # loophole: it records that someone checked and the system is
            # deliberately absent from the matrix.
            #
            # Both directions are gated, because the flag and matrix
            # membership are two readings of one fact and every consumer
            # downstream picks one of them. Gating only the first direction
            # let a mapping declare matrix_id_exists:false for an id the
            # matrix DOES carry: validate passed it, the realization gap
            # counted it (membership), the confidence tally dropped it (flag),
            # and the Reference tab printed both figures in one card.
            if sys_id not in matrix_ids and entry.get("matrix_id_exists") is not False:
                fails.append(
                    f"system_device_map.sites.{site_id}.mappings.{sys_id}: not a matrix "
                    f"system id; add it to the workbook or set matrix_id_exists:false"
                )
            if sys_id in matrix_ids and entry.get("matrix_id_exists") is False:
                fails.append(
                    f"system_device_map.sites.{site_id}.mappings.{sys_id}: "
                    f"matrix_id_exists:false, but the matrix does carry that system "
                    f"id; drop the flag or rename the mapping"
                )
            if device_ids is not None:
                for device in entry.get("devices") or []:
                    if device not in device_ids:
                        fails.append(
                            f"system_device_map.sites.{site_id}.mappings.{sys_id}: "
                            f"device '{device}' is not in the {site_id} topology"
                        )

        for sys_id in site.get("not_deployed_at_site") or {}:
            if sys_id not in matrix_ids:
                fails.append(
                    f"system_device_map.sites.{site_id}.not_deployed_at_site.{sys_id}: "
                    f"not a matrix system id"
                )

        if device_ids is not None:
            for device in (site.get("unclaimed_devices") or {}).get("infrastructure", []):
                if device not in device_ids:
                    fails.append(
                        f"system_device_map.sites.{site_id}.unclaimed_devices: "
                        f"device '{device}' is not in the {site_id} topology"
                    )

    for link in links or []:
        for end in ("from", "to"):
            if link[end] not in matrix_ids:
                fails.append(
                    f"link {link['from']}->{link['to']}: "
                    f"'{link[end]}' is not a matrix system id"
                )

    for row in crosswalk or []:
        for name in row.get("current") or []:
            if name not in system_names:
                fails.append(
                    f"crosswalk '{row['orig'][:40]}...': current system '{name}' "
                    f"does not match any Project/System name in the matrix"
                )

    if not (glossary or {}).get("acronyms"):
        fails.append("glossary: no acronyms; the Reference tab would ship empty")
    if not (glossary or {}).get("confidence_intro"):
        fails.append("glossary: no confidence_intro; the Confidence section would ship empty")

    return fails


def main(argv=None):
    """CLI gate. Exits 1 on any failure, 0 with a one-line summary otherwise."""
    import argparse

    from .cli import add_input_args, load_all_inputs

    parser = argparse.ArgumentParser(description="ATLAS ingest integrity gates")
    add_input_args(parser)
    args = parser.parse_args(argv)

    inputs = load_all_inputs(args)
    fails = validate(
        systems=inputs["systems"], links=inputs["links"], sdmap=inputs["sdmap"],
        networks=inputs["networks"], crosswalk=inputs["crosswalk"],
        glossary=inputs["glossary"],
    )
    if fails:
        print("[validate] FAILED:", file=sys.stderr)
        for f in fails:
            print(f"  - {f}", file=sys.stderr)
        print(
            f"\n{len(fails)} integrity failure(s). No bundle is written; "
            f"the deployed data is unchanged.",
            file=sys.stderr,
        )
        return 1
    print(f"[validate] all gates passed ({len(inputs['systems'])} systems, "
          f"{len(inputs['networks'])} site(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
