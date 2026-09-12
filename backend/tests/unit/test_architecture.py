"""The architecture as something a build fails on, not a diagram somebody remembers.

`arch.md` 6.1 and 6.2 are enforced by `import-linter` (`make boundaries`, part of `make check`),
and two things that enforcement could not see are checked here:

**Cycles below the module level.** A `layers` contract makes a cycle between the ten modules
impossible -- every cycle needs one upward import, and upward imports are what a layers contract
forbids. It says nothing about two files *inside* one module importing each other, which Python
tolerates in several shapes (a function-level import, a `TYPE_CHECKING` block) and which no
contract in `pyproject.toml` would notice.

**Whether the layering is exhaustive.** Contract 2 has always claimed it is. A module missing
from the list is simply unconstrained, silently -- so the claim is compared here against the
packages that actually exist, which is what turns it into a check.
"""

import tomllib
from pathlib import Path

import grimp
import pytest

PACKAGE = "starnest"
SOURCE = Path(__file__).resolve().parents[2] / "src" / PACKAGE
PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"
LAYERS_CONTRACT = "2. The dependency graph is layered, and the layering is exhaustive"


@pytest.fixture(scope="module")
def graph() -> grimp.ImportGraph:
    """The import graph of the whole package, built once: it costs about a second."""
    return grimp.build_graph(PACKAGE)


def _cycles(graph: grimp.ImportGraph) -> list[list[str]]:
    """Every group of modules that can reach each other -- Tarjan, iteratively.

    Iterative rather than recursive because the graph is a hundred modules deep in the worst
    case and a test that fails with a `RecursionError` would report the wrong fault.
    """
    index: dict[str, int] = {}
    lowest: dict[str, int] = {}
    on_stack: dict[str, bool] = {}
    stack: list[str] = []
    found: list[list[str]] = []
    counter = 0

    def imported_by(module: str) -> list[str]:
        return sorted(
            imported
            for imported in graph.find_modules_directly_imported_by(module)
            if imported.startswith(PACKAGE)
        )

    for start in sorted(module for module in graph.modules if module.startswith(PACKAGE)):
        if start in index:
            continue
        work: list[tuple[str, list[str]]] = [(start, imported_by(start))]
        index[start] = lowest[start] = counter
        counter += 1
        stack.append(start)
        on_stack[start] = True

        while work:
            module, remaining = work[-1]
            descended = False
            while remaining:
                imported = remaining.pop(0)
                if imported not in index:
                    index[imported] = lowest[imported] = counter
                    counter += 1
                    stack.append(imported)
                    on_stack[imported] = True
                    work.append((imported, imported_by(imported)))
                    descended = True
                    break
                if on_stack.get(imported):
                    lowest[module] = min(lowest[module], index[imported])
            if descended:
                continue

            work.pop()
            if work:
                lowest[work[-1][0]] = min(lowest[work[-1][0]], lowest[module])
            if lowest[module] == index[module]:
                component = []
                while True:
                    member = stack.pop()
                    on_stack[member] = False
                    component.append(member)
                    if member == module:
                        break
                if len(component) > 1:
                    found.append(sorted(component))

    return found


def test_no_module_takes_part_in_an_import_cycle(graph: grimp.ImportGraph) -> None:
    """Two files that import each other are one file pretending to be two.

    This is the check the layers contract cannot make: it constrains the ten modules of
    `arch.md` 6.1 against each other, and a cycle between `evaluation.ranking` and
    `evaluation.rules` lives entirely inside one of them.
    """
    assert _cycles(graph) == []


def test_a_cycle_would_be_found(graph: grimp.ImportGraph) -> None:
    """The detector, on a graph that does contain a cycle.

    Without this the test above passes for two reasons that look identical: there are no cycles,
    and the search is broken.
    """
    with_a_cycle = grimp.build_graph(PACKAGE)
    with_a_cycle.add_import(importer="starnest.candidates.candidate", imported="starnest.api.runs")
    with_a_cycle.add_import(importer="starnest.api.runs", imported="starnest.candidates.candidate")

    cycles = _cycles(with_a_cycle)

    assert any(
        {"starnest.api.runs", "starnest.candidates.candidate"} <= set(cycle) for cycle in cycles
    )


def _layered_modules() -> set[str]:
    contracts = tomllib.loads(PYPROJECT.read_text())["tool"]["importlinter"]["contracts"]
    layered = next(contract for contract in contracts if contract["name"] == LAYERS_CONTRACT)
    return {
        module.strip()
        for layer in layered["layers"]
        for module in layer.replace("|", ":").split(":")
    }


def _modules_that_exist() -> set[str]:
    packages = {
        f"{PACKAGE}.{path.name}"
        for path in SOURCE.iterdir()
        if path.is_dir() and (path / "__init__.py").exists()
    }
    top_level_files = {
        f"{PACKAGE}.{path.stem}"
        for path in SOURCE.glob("*.py")
        if path.stem not in {"__init__", "__main__"}
    }
    return packages | top_level_files


def test_the_layering_names_every_module_that_exists() -> None:
    """A module missing from contract 2 is unconstrained, and nothing else would say so.

    This is what makes the contract's own name true: a new module added to `src/starnest/`
    fails here until somebody decides where in the order it belongs -- which is a decision, and
    the point at which to make it is when the module is created.
    """
    assert _modules_that_exist() - _layered_modules() == set()


def test_the_layering_names_nothing_that_has_gone() -> None:
    """A layer naming a module nobody has any more constrains nothing and reads as though it
    does. `import-linter` treats an unknown module as an error, so this mostly guards the
    spelling in this file's own parser."""
    assert _layered_modules() - _modules_that_exist() == set()
