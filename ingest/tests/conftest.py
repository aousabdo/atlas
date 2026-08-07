"""Paths into the read-only reference repo the sample bundle is derived from.

Nothing in the test suite writes to SOURCE_REPO. When the curated data is
eventually copied into this repo, only the constants below change.

ATLAS_SOURCE_REPO must name that repo; there is no default, because a default
pointing at one machine's checkout is a landmine for everyone else. Leaving it
unset is what lets CI run the classifier unit tests without the reference data
present: the fixtures that need it skip, the rest still run. Once it IS set, a
missing file fails rather than skips, because a run that goes green having
proven nothing is worse than a run that goes red.
"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

_SOURCE_REPO_ENV = os.environ.get("ATLAS_SOURCE_REPO")
SOURCE_REPO = Path(_SOURCE_REPO_ENV) if _SOURCE_REPO_ENV else None
MINDMAP = SOURCE_REPO / "traceability" / "mindmap" if SOURCE_REPO else None

MATRIX_XLSX = MINDMAP / "matrix.xlsx" if MINDMAP else None
OVERRIDES_JSON = MINDMAP / "overrides.json" if MINDMAP else None
GLOSSARY_JSON = MINDMAP / "glossary.json" if MINDMAP else None
SYSTEM_DEVICE_MAP_JSON = MINDMAP / "system_device_map.json" if MINDMAP else None
# Both keys always exist so that a suite iterating the sites still collects
# with the variable unset; _require turns the None into a skip.
NETWORK_JSON = {
    "northgate": SOURCE_REPO / "northgate" / "northgate_network.json" if SOURCE_REPO else None,
    "westfield": SOURCE_REPO / "westfield" / "westfield_network.json" if SOURCE_REPO else None,
}

GOLDEN = Path(__file__).parent / "fixtures" / "golden"


def _require(path):
    if SOURCE_REPO is None:
        pytest.skip("ATLAS_SOURCE_REPO is unset, so there is no reference data")
    if not Path(path).exists():
        raise AssertionError(
            f"ATLAS_SOURCE_REPO is set to {SOURCE_REPO} but {path} is missing. "
            f"Skipping here would let a misconfigured run report success."
        )
    return path


@pytest.fixture(scope="session")
def matrix_path():
    return _require(MATRIX_XLSX)


@pytest.fixture(scope="session")
def overrides():
    return json.loads(_require(OVERRIDES_JSON).read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def systems(matrix_path):
    from atlas_ingest.excel import read_excel

    return read_excel(matrix_path)


def golden(name):
    """Load a captured expected-output fixture."""
    path = GOLDEN / name
    if not path.exists():
        pytest.skip(f"golden fixture not captured: {path}")
    return json.loads(path.read_text(encoding="utf-8"))
