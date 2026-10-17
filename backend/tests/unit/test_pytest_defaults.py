"""What a bare `pytest` selects, read from the `addopts` it actually runs with (BE-32).

A bare run is what a developer types, and it must cost neither money nor a publisher's patience:
`live` calls real third-party sources, so a slow Eurostat fails a run that says nothing about
this code, and `live_llm` spends money. Everything else -- unit, storage, acceptance -- is the
point of running at all.

The marker expression is compiled with pytest's own parser rather than matched as text, so a
default that read right and selected wrong would still fail here. `_pytest.mark.expression` is
a private module; if a pytest upgrade moves it, this file is the one to update.
"""

import shlex
import tomllib
from pathlib import Path

from _pytest.mark.expression import Expression

PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"


def a_bare_run_selects(*markers: str) -> bool:
    """Whether a test carrying exactly these markers runs under the default `-m`."""
    addopts = tomllib.loads(PYPROJECT.read_text())["tool"]["pytest"]["ini_options"]["addopts"]
    arguments = shlex.split(addopts)
    default = Expression.compile(arguments[arguments.index("-m") + 1])
    return default.evaluate(lambda name, **_: name in markers)


def test_a_bare_run_deselects_the_live_publishers() -> None:
    assert not a_bare_run_selects("live")


def test_a_bare_run_deselects_the_paid_tests() -> None:
    assert not a_bare_run_selects("live_llm")


def test_a_test_both_live_and_paid_is_deselected() -> None:
    assert not a_bare_run_selects("live", "live_llm")


def test_a_bare_run_keeps_unit_storage_and_acceptance_tests() -> None:
    assert a_bare_run_selects()
    assert a_bare_run_selects("storage")
    assert a_bare_run_selects("acceptance")
