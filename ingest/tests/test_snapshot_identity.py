"""A snapshot says which project it measures, and the index keeps to one.

The failure this pins was reachable through the documented workflow. `npm
test` runs scripts/seed-data.mjs, which copies fixtures/synthetic into
public/data, sample snapshot included. README "Regenerating the data" then
runs the real ingest with `-o public/data`, which is also the CLI default.
emit_bundles used to index every *.json under snapshots/, and a snapshot
carried nothing but a date, a commit and seven figures, so the sample's
snapshot was indexed beside the real one. The Trend view compares the first
snapshot with the last, and reported the difference between the sample and
the real project as movement in the architecture.

project.json could not have caught it either: its slug was the literal
'dhs-cuas' whatever the inputs were, so every bundle the ingest wrote claimed
the same project.

The identity is the project slug, passed in. Not the source label and
baseline date: those name a revision of the matrix, and they change every
time a new baseline is cut. Keying on them would orphan the whole history at
each revision, which is the one comparison the Trend view exists to make.
"""
import json
import shutil

import pytest

from atlas_ingest import bundle
from atlas_ingest.bundle import emit_bundles
from conftest import SYNTHETIC_BUNDLE

SLUG = "harbor-cuas"
NAME = "Harbor C-UAS Architecture"


@pytest.fixture(scope="module")
def emit(systems, links, desired, crosswalk, glossary, sdmap, networks):
    def run(out_dir, built_at="2026-10-08T09:30:00", project_slug=SLUG,
            project_name=NAME):
        return emit_bundles(
            out_dir=out_dir, systems=systems, links=links, desired=desired,
            crosswalk=crosswalk, glossary=glossary, sdmap=sdmap,
            networks=networks,
            source_label="Traceability Matrix 5 MAR 2026 (enhanced)",
            baseline_date="2026-03-05", built_at=built_at, git_sha="testsha",
            project_slug=project_slug, project_name=project_name,
        )
    return run


def _read(root, name):
    return json.loads((root / name).read_text(encoding="utf-8"))


def _seed_like_npm_test(target):
    """What scripts/seed-data.mjs does to public/data before every npm test."""
    shutil.copytree(SYNTHETIC_BUNDLE, target)
    return target


def test_the_snapshot_names_the_project_project_json_names(tmp_path, emit):
    emit(tmp_path)
    snapshot = _read(tmp_path, "snapshots/2026-10-08.json")
    project = _read(tmp_path, "project.json")
    assert snapshot["project"] == SLUG
    assert project["slug"] == SLUG


def test_project_json_is_the_project_the_run_was_given(tmp_path, emit):
    emit(tmp_path, project_slug="quay-cuas", project_name="Quay C-UAS")
    project = _read(tmp_path, "project.json")
    assert (project["slug"], project["name"]) == ("quay-cuas", "Quay C-UAS")


def test_the_seeded_sample_snapshot_is_not_indexed_beside_a_real_one(
        tmp_path, emit, capsys):
    """The reported failure, step for step: seed, then ingest over the seed."""
    data = _seed_like_npm_test(tmp_path / "data")

    manifest = emit(data)

    assert manifest["snapshots"] == ["2026-10-08"]
    assert _read(data, "manifest.json")["snapshots"] == ["2026-10-08"]
    err = capsys.readouterr().err
    assert "snapshots/2026-08-05.json" in err
    assert "'reference-cuas'" in err
    assert f"'{SLUG}'" in err


def test_a_foreign_snapshot_is_reported_but_never_deleted(tmp_path, emit):
    """Snapshots are the one part of a bundle a rebuild cannot recreate, so
    the ingest leaves another project's file where it found it."""
    data = _seed_like_npm_test(tmp_path / "data")
    sample = (data / "snapshots" / "2026-08-05.json").read_bytes()

    emit(data)

    assert (data / "snapshots" / "2026-08-05.json").read_bytes() == sample


def test_a_snapshot_with_no_identity_is_not_indexed(tmp_path, emit, capsys):
    """Every snapshot written before this change. Nothing in it says whose it
    is, so it cannot be compared with anything."""
    legacy = _read(SYNTHETIC_BUNDLE, "snapshots/2026-08-05.json")
    legacy.pop("project", None)
    (tmp_path / "snapshots").mkdir()
    (tmp_path / "snapshots" / "2026-07-01.json").write_text(
        json.dumps(legacy), encoding="utf-8")

    manifest = emit(tmp_path)

    assert manifest["snapshots"] == ["2026-10-08"]
    err = capsys.readouterr().err
    assert "snapshots/2026-07-01.json" in err
    assert "no project identity" in err


@pytest.mark.parametrize("empty", [None, ""])
def test_an_empty_identity_is_no_identity(tmp_path, emit, capsys, empty):
    """The browser reads null and "" as no identity too, so the two sides
    describe the same file the same way."""
    legacy = _read(SYNTHETIC_BUNDLE, "snapshots/2026-08-05.json")
    legacy["project"] = empty
    (tmp_path / "snapshots").mkdir()
    (tmp_path / "snapshots" / "2026-07-01.json").write_text(
        json.dumps(legacy), encoding="utf-8")

    assert emit(tmp_path)["snapshots"] == ["2026-10-08"]
    assert "no project identity" in capsys.readouterr().err


def test_an_unreadable_snapshot_is_not_indexed(tmp_path, emit, capsys):
    (tmp_path / "snapshots").mkdir()
    (tmp_path / "snapshots" / "2026-07-01.json").write_text(
        "{ not json", encoding="utf-8")

    manifest = emit(tmp_path)

    assert manifest["snapshots"] == ["2026-10-08"]
    assert "snapshots/2026-07-01.json" in capsys.readouterr().err


def test_the_projects_own_history_stays_indexed(tmp_path, emit, capsys):
    """The filter must not cost a project its own trend."""
    emit(tmp_path, built_at="2026-09-02T08:00:00")
    emit(tmp_path, built_at="2026-10-08T09:30:00")

    assert _read(tmp_path, "manifest.json")["snapshots"] == [
        "2026-09-02", "2026-10-08",
    ]
    assert capsys.readouterr().err == ""


@pytest.mark.parametrize("slug", ["", "  ", "DHS C-UAS", "harbor_cuas", "-harbor"])
def test_an_unusable_slug_is_refused_before_anything_is_written(
        tmp_path, emit, slug):
    """The slug is compared byte for byte, here and in the browser. 'Harbor'
    and 'harbor' would read as two projects and split one history in two, so
    only one spelling of a slug is accepted."""
    with pytest.raises(ValueError, match="slug"):
        emit(tmp_path / "out", project_slug=slug)
    assert not (tmp_path / "out").exists()


# --- The CLI the README documents ------------------------------------------
def _cli_args(paths, out_dir, *extra):
    args = [
        str(paths["matrix"]),
        "--overrides", str(paths["overrides"]),
        "--glossary", str(paths["glossary"]),
        "--system-device-map", str(paths["sdmap"]),
    ]
    for site_id, path in sorted(paths["networks"].items()):
        args += ["--network-json", f"{site_id}:{path}"]
    return args + ["-o", str(out_dir), *extra]


def test_the_cli_requires_a_project_slug(paths, tmp_path, capsys):
    """A defaulted identity is how 'dhs-cuas' became every bundle's."""
    with pytest.raises(SystemExit) as exit_:
        bundle.main(_cli_args(paths, tmp_path / "out"))
    assert exit_.value.code == 2
    assert "--project-slug" in capsys.readouterr().err
    assert not (tmp_path / "out").exists()


def test_the_cli_writes_the_slug_it_was_given(paths, tmp_path):
    out = tmp_path / "out"
    assert bundle.main(_cli_args(
        paths, out, "--project-slug", SLUG, "--project-name", NAME)) == 0

    project = _read(out, "project.json")
    assert (project["slug"], project["name"]) == (SLUG, NAME)
    [label] = _read(out, "manifest.json")["snapshots"]
    assert _read(out, f"snapshots/{label}.json")["project"] == SLUG


def test_the_cli_names_the_project_by_its_slug_when_no_name_is_given(paths, tmp_path):
    out = tmp_path / "out"
    assert bundle.main(_cli_args(paths, out, "--project-slug", SLUG)) == 0
    assert _read(out, "project.json")["name"] == SLUG
