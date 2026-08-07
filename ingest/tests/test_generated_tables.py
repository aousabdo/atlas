"""The committed TypeScript tables must match config.py.

LocalFileProvider classifies in the browser from a generated copy of the same
tables the Python uses. If this fails, either someone edited the generated file
by hand or changed config.py without regenerating, and the two providers will
quietly disagree about which systems are confirmed.
"""
from pathlib import Path

from atlas_ingest.bundle import emit_classifier_module

COMMITTED = (
    Path(__file__).resolve().parents[2] / "src" / "data" / "generated" / "classifierTables.ts"
)


def test_generated_tables_are_current(tmp_path):
    if not COMMITTED.exists():
        import pytest

        pytest.skip(f"not generated yet: {COMMITTED}")

    fresh = emit_classifier_module(tmp_path / "classifierTables.ts")
    assert fresh.read_text(encoding="utf-8") == COMMITTED.read_text(encoding="utf-8"), (
        "src/data/generated/classifierTables.ts is stale. Run: npm run ingest:tables"
    )
