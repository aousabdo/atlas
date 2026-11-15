"""A walk recorded in the browser, read back by the ingest.

The Site walk tab exports the system to device map as a file. This is the
other half of that loop: the file the browser writes for the Westfield walk in
SAMPLE_WALK (fixtures/parity/sample-walk/system_device_map.json) goes back into
a source repo in place of the analyst's own map, and the ingest has to accept
it at every gate and produce the figures the browser showed before it was
exported. e2e/walk.spec.ts proves the browser half; this proves an analyst who
runs the ingest over the exported file gets the same answer.
"""
import json
import shutil
from pathlib import Path

from atlas_ingest.crosswalk import read_crosswalk
from atlas_ingest.curation import (
    load_glossary, load_overrides, load_system_device_map,
)
from atlas_ingest.excel import read_excel
from atlas_ingest.links import desired_links, extract_links, merge_links
from atlas_ingest.network import load_network
from atlas_ingest.validate import validate
from conftest import REPO, build_bundle_from, source_paths

EXPORTED_WALK = REPO / "fixtures" / "parity" / "sample-walk" / "system_device_map.json"


def _read(root, name):
    return json.loads((Path(root) / name).read_text(encoding="utf-8"))


def _gates(resolved):
    """Every gate validate() runs, over the inputs as the ingest CLI reads them."""
    systems = read_excel(resolved["matrix"])
    overrides = load_overrides(resolved["overrides"])
    return validate(
        systems=systems,
        links=merge_links(extract_links(systems), overrides),
        sdmap=load_system_device_map(resolved["sdmap"]),
        networks={
            sid: load_network(p, sid) for sid, p in resolved["networks"].items()
        },
        crosswalk=read_crosswalk(resolved["matrix"]),
        glossary=load_glossary(resolved["glossary"]),
        desired=desired_links(overrides),
    )


def test_an_exported_walk_ingests_to_the_same_figures(sample_source_repo, tmp_path):
    repo = tmp_path / "source"
    shutil.copytree(sample_source_repo, repo)
    resolved = source_paths(repo)
    shutil.copyfile(EXPORTED_WALK, resolved["sdmap"])

    assert _gates(resolved) == []

    out = build_bundle_from(repo, tmp_path / "bundle")

    lossiness = _read(out, "lossiness.json")
    gap = next(d for d in lossiness["dimensions"] if d["key"] == "realization_gap")
    assert gap["numerator"] == 13
    assert gap["detail"]["per_site"]["westfield"]["mapped_ids"] == [
        "beacon", "scan", "trackwell",
    ]

    coverage = _read(out, "coverage.json")
    beacon = coverage["sites"]["westfield"]["mappings"]["beacon"]
    assert beacon["reviewed_by"] == "Site lead"
