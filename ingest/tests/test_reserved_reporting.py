"""The terminal summary is a CI contract, so it is tested like one.

.github/workflows/ci.yml greps four things out of this suite's output: the
section header, the sentence admitting the reserved tests did not run, the
machine-readable ATLAS_RESERVED= line, and the reserved count itself. Those
greps are the only thing standing between "CI is green" and "CI is green
because half the suite quietly stopped running", which is the state this repo
was actually in for 98 tests.

Nothing else asserts that wording. Reword the summary and CI keeps passing
while asserting nothing, or starts failing on its own guard with no failing
test to explain why. These tests fail on either.
"""
import pytest

import conftest


class _Reporter:
    """Enough of pytest's TerminalReporter for the summary hook."""

    def __init__(self, collected=228):
        self.lines = []
        self._numcollected = collected

    def write_line(self, line, **kwargs):
        self.lines.append(line)

    def write_sep(self, sep, title=None, **kwargs):
        self.lines.append(f"{sep * 8} {title} {sep * 8}")

    @property
    def text(self):
        return "\n".join(self.lines)


class _Config:
    def __init__(self, reserved):
        self.stash = pytest.Stash()
        self.stash[conftest._RESERVED_KEY] = list(reserved)


def _summary(monkeypatch, *, source_repo, reserved, collected=228):
    monkeypatch.setattr(conftest, "SOURCE_REPO", source_repo)
    reporter = _Reporter(collected)
    conftest.pytest_terminal_summary(reporter, 0, _Config(reserved))
    return reporter.text


TWO = ["tests/test_source_layout.py::test_a", "tests/test_source_layout.py::test_b"]


def test_the_header_ci_greps_for_is_printed_without_reference_data(monkeypatch):
    assert "reference-data coverage" in _summary(
        monkeypatch, source_repo=None, reserved=TWO,
    )


def test_the_header_ci_greps_for_is_printed_with_reference_data(monkeypatch):
    """Printed in BOTH modes. A summary that appears only in one of them is a
    summary somebody can lose by fixing their environment."""
    assert "reference-data coverage" in _summary(
        monkeypatch, source_repo="/somewhere/reference", reserved=TWO,
    )


def test_the_machine_readable_line_says_the_count_and_that_it_did_not_run(monkeypatch):
    """The exact string ci.yml pins. Raising the reserved count is meant to be
    a diff somebody looks at, which only works if the number is in the output
    in a form a grep can hold onto."""
    assert "ATLAS_RESERVED=2 ran=no source=none" in _summary(
        monkeypatch, source_repo=None, reserved=TWO,
    )


def test_the_machine_readable_line_says_when_the_reserved_tests_did_run(monkeypatch):
    out = _summary(monkeypatch, source_repo="/somewhere/reference", reserved=TWO)
    assert "ATLAS_RESERVED=2 ran=yes source=/somewhere/reference" in out


def test_the_summary_admits_out_loud_what_the_run_did_not_check(monkeypatch):
    """The other sentence ci.yml greps. A skip reads as a pass, so the run has
    to say in words that it did not check what those tests claim."""
    assert "this run has NOT checked what they claim" in _summary(
        monkeypatch, source_repo=None, reserved=TWO,
    )


def test_every_reserved_test_is_named_not_just_counted(monkeypatch):
    out = _summary(monkeypatch, source_repo=None, reserved=TWO)
    for nodeid in TWO:
        assert nodeid in out


def test_the_reserved_tests_are_named_when_they_do_run_too(monkeypatch):
    out = _summary(monkeypatch, source_repo="/somewhere/reference", reserved=TWO)
    for nodeid in TWO:
        assert nodeid in out


def test_zero_reserved_is_stated_rather_than_left_silent(monkeypatch):
    """"0 reserved" is the fact worth stating: it is the difference between
    full coverage and a selection that collected none of them."""
    out = _summary(monkeypatch, source_repo=None, reserved=[])
    assert "ATLAS_RESERVED=0 ran=no source=none" in out
    assert "0 tests are reserved" in out


def test_both_modes_say_the_rest_ran_against_the_generated_sample(monkeypatch):
    """The claim that changed when $ATLAS_SOURCE_REPO stopped redirecting the
    whole suite. With reference data set, the other 200-odd tests still read
    the fabricated workbook, and the summary has to say so or a reader will
    assume the opposite."""
    for source in (None, "/somewhere/reference"):
        out = _summary(monkeypatch, source_repo=source, reserved=TWO)
        assert "generated sample" in out


def test_the_skip_reason_is_the_one_ci_recognises():
    """ci.yml counts any SKIPPED line whose reason is not this string as a test
    that has quietly stopped running. conftest applies the marker with this
    same constant, so the two cannot drift apart."""
    assert conftest.RESERVED_SKIP_REASON == "reserved for the reference data"
