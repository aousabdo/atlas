"""One set of curation cases, read by both engines.

Every file in fixtures/parity/curation is read here and by
src/curation/__tests__/parity.test.ts, so adding a case adds it to both and
the two cannot drift the way a pair of hand-mirrored tables can. Each holds a
map as the analyst's file has it, the systems and drawings it is read against,
and the expected refusals word for word. A file both engines accept also
states the realization it produces.

Only the system_device_map lines are compared, as the browser harness does:
validate() also gates the glossary, which the browser deliberately does not,
so the glossary handed in here is one that passes.
"""
import json
from pathlib import Path

import pytest

from atlas_ingest import lossiness
from atlas_ingest.curation import normalise_system_device_map
from atlas_ingest.validate import validate

CASES = Path(__file__).resolve().parents[2] / "fixtures" / "parity" / "curation"

GLOSSARY_THAT_PASSES = {
    "acronyms": [{"acr": "A", "meaning": "B"}],
    "confidence_intro": "x",
    "out_of_scope": [],
    "methodology_extras": {},
}


def _case_files():
    return sorted(
        p for p in CASES.glob("*.json") if not p.name.endswith(".out.json")
    )


def test_there_are_at_least_twenty_cases():
    assert len(_case_files()) >= 20


@pytest.mark.parametrize("path", _case_files(), ids=lambda p: p.stem)
def test_case(path):
    case = json.loads(path.read_text(encoding="utf-8"))
    systems = case["systems"]
    sdmap = normalise_system_device_map(case["map"])
    networks = {
        site_id: {"devices": [{"id": d} for d in ids]}
        for site_id, ids in case["topology_devices"].items()
    }

    fails = validate(systems, [], sdmap, networks, [], GLOSSARY_THAT_PASSES)
    assert [f for f in fails if f.startswith("system_device_map.")] == case["expect"]["failures"]

    expected = case["expect"].get("realization")
    if expected is not None:
        gap = lossiness._realization_gap(systems, sdmap)
        assert {
            "numerator": gap["numerator"],
            "per_site": {
                site_id: {
                    "mapped_ids": site["mapped_ids"],
                    "checked_absent": site["checked_absent"],
                }
                for site_id, site in gap["detail"]["per_site"].items()
            },
            "by_confidence": gap["detail"]["by_confidence"],
        } == expected
