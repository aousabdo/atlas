#!/usr/bin/env python3
"""Write a fabricated source repo laid out exactly like the reference one.

make_sample_workbook.py gives the tests a matrix-shaped .xlsx. That alone is
not enough: conftest resolves five paths out of $ATLAS_SOURCE_REPO, and a
fixture that has the workbook but not the curation overlay still cannot run.
This writes all five, from the same atlas_ingest.synthetic declarations, so the
half of the suite that only ever needed a matrix-shaped input can stop being
gated on a repo nobody's CI has.

    python3 ingest/tests/fixtures/make_source_repo.py /tmp/sample-repo

Nothing here is committed. The tree is cheap to regenerate and lands in a
pytest tmp dir, because a checked-in .xlsx is the shape of the mistake this
repo purged once already.

Layout, mirroring conftest:

    traceability/mindmap/matrix.xlsx
    traceability/mindmap/overrides.json
    traceability/mindmap/glossary.json
    traceability/mindmap/system_device_map.json
    northgate/northgate_network.json
    westfield/westfield_network.json
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from atlas_ingest import synthetic  # noqa: E402

from make_sample_workbook import write_sample_workbook  # noqa: E402


def _write(path, payload):
    """Write JSON preserving key order.

    NOT sort_keys, unlike the bundle writer. pending_review is a curator's
    ordered list and the open-questions dimension reports it in file order, so
    sorting here would reorder real output and make the bundle comparison fail
    on an artefact of this writer rather than on anything in the ingest.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _network_export(net):
    """Turn a built topology back into the NetworkX-style export on disk.

    network.load_network reads `graph`/`zones`/`nodes`/`edges` and recomputes
    the counts, and it takes the site label from graph.location. Round-tripping
    through this shape is what makes the loader's own parsing part of what the
    tests exercise, rather than handing it a pre-parsed structure.
    """
    graph = dict(net["meta"])
    graph["location"] = graph.pop("label")
    del graph["device_count"]
    del graph["edge_count"]
    return {
        "graph": graph,
        "zones": net["zones"],
        "nodes": net["devices"],
        "edges": net["edges"],
    }


def write_source_repo(root):
    """Write the whole fabricated tree under `root` and return it as a Path."""
    root = Path(root)
    mindmap = root / "traceability" / "mindmap"

    write_sample_workbook(mindmap / "matrix.xlsx")

    networks = synthetic.build_networks()
    _write(mindmap / "glossary.json", synthetic.GLOSSARY)
    _write(mindmap / "system_device_map.json", synthetic.build_sdmap(networks))
    _write(mindmap / "overrides.json", {
        "cross_links": synthetic.CROSS_LINKS,
        "suppress_links": synthetic.SUPPRESS_LINKS,
        "desired_links": synthetic.DESIRED_LINKS,
        "risk_overrides": {},
        "soft_overrides": {},
        "node_order": synthetic.NODE_ORDER,
    })

    for site_id, net in networks.items():
        _write(root / site_id / f"{site_id}_network.json", _network_export(net))

    return root


if __name__ == "__main__":
    if len(sys.argv) > 2:
        sys.exit(f"usage: {sys.argv[0]} [OUTPUT_DIR]")
    if len(sys.argv) == 2:
        target = sys.argv[1]
    else:
        # Same courtesy as scripts/make-sample-workbook.mjs: with no argument,
        # pick a temp directory and say where it went, so nobody has to invent
        # a path just to look at the tree.
        import tempfile

        target = tempfile.mkdtemp(prefix="atlas-sample-source-repo-")
    print(f"wrote {write_source_repo(target)}")
