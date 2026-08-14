"""Prove the fabricated inputs and the committed sample bundle agree.

fixtures/synthetic is written by atlas_ingest.synthetic, which carries its own
copies of the link vocabulary and the extraction and merge rules. The ingest
package reads the same declarations back out of a generated .xlsx and applies
the REAL classifier, link table and lossiness code to them. So running the
ingest over the sample source repo and diffing against fixtures/synthetic is an
independent check: the two halves would only agree by accident if one of them
were wrong in exactly the same way.

It is also the load-bearing test for everything else in this suite. Once these
two agree, every fixture that used to need the reference workbook can be fed
the generated one instead and still be asserting about real ingest output.
"""
import json

import pytest

from conftest import SYNTHETIC_BUNDLE, build_bundle_from

# Every bundle file the ingest must reproduce exactly. project.json and the
# snapshot are excluded here and checked below, each for a stated reason.
MUST_MATCH = [
    "systems.json", "links.json", "crosswalk.json", "glossary.json",
    "methodology.json", "lossiness.json", "coverage.json", "manifest.json",
    "sites/northgate.json", "sites/westfield.json",
]


@pytest.fixture(scope="module")
def rebuilt(tmp_path_factory, sample_source_repo):
    return build_bundle_from(sample_source_repo, tmp_path_factory.mktemp("rebuilt"))


def _read(root, name):
    return json.loads((root / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", MUST_MATCH)
def test_the_rebuilt_bundle_matches_the_committed_one(rebuilt, name):
    assert _read(rebuilt, name) == _read(SYNTHETIC_BUNDLE, name), name


def test_no_committed_bundle_file_is_left_unchecked():
    """A file added to fixtures/synthetic without a line in MUST_MATCH would be
    compared against nothing, which is how a bundle drifts quietly."""
    committed = {
        str(p.relative_to(SYNTHETIC_BUNDLE))
        for p in SYNTHETIC_BUNDLE.rglob("*.json")
    }
    accounted = set(MUST_MATCH) | {"project.json", "snapshots/2026-08-05.json"}
    assert committed == accounted


def test_the_committed_snapshot_is_deliberately_one_requirement_ahead(rebuilt):
    """synthetic._snapshot records requirement attrition one requirement better
    than the live figure so the trend view has a delta to draw. That is the
    ONLY dimension allowed to differ; anything else is drift."""
    live = _read(rebuilt, "snapshots/2026-08-05.json")
    committed = _read(SYNTHETIC_BUNDLE, "snapshots/2026-08-05.json")

    differing = [
        a["key"] for a, b in zip(live["dimensions"], committed["dimensions"])
        if a != b
    ]
    assert differing == ["requirement_attrition"]
    assert [d["key"] for d in live["dimensions"]] == [
        d["key"] for d in committed["dimensions"]
    ]


def test_the_bundle_and_the_generator_disagree_only_about_the_project_name(rebuilt):
    """A real finding, pinned rather than papered over.

    bundle.emit_bundles hard-codes slug 'dhs-cuas' and name 'DHS C-UAS
    Architecture'; synthetic.py names the sample project 'reference-cuas' /
    'Reference C-UAS Architecture'. So the shipped sample bundle and anything
    the ingest emits carry different project identities, and the ingest's
    identity is the pre-rename one. Every other field agrees.
    """
    live = _read(rebuilt, "project.json")
    committed = _read(SYNTHETIC_BUNDLE, "project.json")

    assert {k for k in live if live[k] != committed[k]} == {"slug", "name"}
    assert (live["slug"], live["name"]) == ("dhs-cuas", "DHS C-UAS Architecture")
    assert (committed["slug"], committed["name"]) == (
        "reference-cuas", "Reference C-UAS Architecture",
    )
