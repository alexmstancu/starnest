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

import ast
import tomllib
from collections.abc import Iterator
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


# arch.md 6.1's "May import" column, policy module by policy module. The empty set is a module
# that imports no other -- `candidates/` is the stable core.
ALLOWED_IMPORTS = {
    "candidates": frozenset(),
    "data": frozenset({"candidates"}),
    "household": frozenset({"candidates"}),
    "criteria": frozenset({"candidates", "data", "household"}),
    "data_acquisition": frozenset({"candidates", "data"}),
    "evaluation": frozenset({"candidates", "data", "household", "criteria"}),
    "comparison": frozenset({"candidates", "data", "evaluation"}),
}
POLICY_MODULES = frozenset(ALLOWED_IMPORTS)


def _policy_module_of(module: str) -> str | None:
    """The policy module a dotted name belongs to -- `starnest.data.attribute` is `data` -- or
    None for anything outside the policy core (the API, a plugin, a top-level file)."""
    parts = module.split(".")
    return (
        parts[1] if len(parts) > 1 and parts[0] == PACKAGE and parts[1] in POLICY_MODULES else None
    )


@pytest.mark.parametrize("module", sorted(ALLOWED_IMPORTS))
def test_each_policy_module_imports_only_what_the_table_allows(
    module: str, graph: grimp.ImportGraph
) -> None:
    """arch.md 6.2 rule 2: the import table of 6.1 is exhaustive, so a direct import it does not
    list is a violation -- which the layers contract cannot say, because it forbids only *upward*
    imports and a table-forbidden edge can run downward. `comparison` reaching into `criteria`
    for a shared constant was exactly such an edge, below the layering and so invisible to it
    (BE-31).

    Judged on **direct** imports: a module reaching a forbidden one THROUGH an allowed one --
    `comparison` -> `evaluation` -> `criteria` -- is not the forbidden direct edge and must not be
    read as one, which is why a transitive `forbidden` contract cannot express this and a test
    on the graph's direct edges can.
    """
    prefix = f"{PACKAGE}.{module}"
    its_files = {m for m in graph.modules if m == prefix or m.startswith(f"{prefix}.")}
    imports = {
        _policy_module_of(target)
        for source in its_files
        for target in graph.find_modules_directly_imported_by(source)
    }
    cross_module = {policy for policy in imports if policy is not None and policy != module}

    assert cross_module <= ALLOWED_IMPORTS[module], (
        f"{module}/ directly imports {sorted(cross_module - ALLOWED_IMPORTS[module])}, which "
        f"arch.md 6.1 does not list among its allowed imports "
        f"({sorted(ALLOWED_IMPORTS[module]) or 'nothing'})"
    )


def test_the_layering_names_nothing_that_has_gone() -> None:
    """A layer naming a module nobody has any more constrains nothing and reads as though it
    does. `import-linter` treats an unknown module as an error, so this mostly guards the
    spelling in this file's own parser."""
    assert _layered_modules() - _modules_that_exist() == set()


REPOSITORY = Path(__file__).resolve().parents[3]
THE_SANITY_SPEC = REPOSITORY / "ui" / "e2e" / "sanity.spec.ts"


def test_both_sides_agree_on_what_marks_a_test_made_evaluation() -> None:
    """The one string the backend and the interface both have to know, pinned from here.

    **A guard, not a dependency.** `arch.md` 6.1 keeps `backend/` and `ui/` as peers that share
    no code -- not even DTO definitions -- so the marker cannot be imported across. Nothing in
    `src/` reaches over this boundary; this test reads a file and compares two literals, which
    is the only way an agreement between two languages can be held to.

    **Why it has to be held.** The interface writes the marker when the browser suite saves a
    ranking; the boot sequence discards what carries it. If one side changes the string and the
    other does not, the sweep silently stops finding anything -- and the failure shows up weeks
    later as a sidebar full of test rows, with nothing having gone red in between.
    """
    from starnest.storage.evaluation_store import TEST_EVALUATION_MARKER

    spec = THE_SANITY_SPEC.read_text(encoding="utf-8")

    assert f'"{TEST_EVALUATION_MARKER}"' in spec, (
        f"the browser suite no longer writes {TEST_EVALUATION_MARKER!r}, so the boot sweep in "
        f"main.py would discard nothing and saved test rankings would accumulate for ever"
    )


# --- every reader of a figure says what it makes of a declared scale (C06, G2) ---------------

FIGURE_READERS = frozenset(
    {"figure_of", "magnitude_of", "declared_scale", "share_of_its_scale", "threshold_reading"}
)
"""What hands out a value's figure, or the scale that figure sits on."""

THE_READER = "attaches the scale the payload declares"
MAPPED = "scored: mapped from the scale the figure declares"
A_SHARE_OF_ITS_SCALE = "ranked: by its share of the scale it declares"
PROBE = "probe: asks only whether there is a figure"
A_PERCENTAGE_OF_ITS_SCALE = (
    "judged: an assigned score as a percentage of its own scale, anything else raw (C06-S1)"
)
SAME_SCALE_ONLY = "compared: a raw gap only between figures on one declared scale (C06-S2)"

READERS_OF_A_FIGURE = {
    ("starnest.evaluation.magnitudes", "figure_of"): THE_READER,
    ("starnest.evaluation.normalisation", "_mapped"): MAPPED,
    ("starnest.evaluation.normalisation", "_as_a_fraction_of_its_own_scale"): A_SHARE_OF_ITS_SCALE,
    ("starnest.evaluation.ranking", "_readings_by_criterion"): MAPPED,
    ("starnest.evaluation.ranking", "_figure_sources_of"): PROBE,
    ("starnest.evaluation.magnitudes", "threshold_reading"): THE_READER,
    ("starnest.evaluation.ranking", "_magnitudes_of"): A_PERCENTAGE_OF_ITS_SCALE,
    ("starnest.evaluation.rules", "_crosses"): A_PERCENTAGE_OF_ITS_SCALE,
    ("starnest.api.comparisons", "_magnitudes"): SAME_SCALE_ONLY,
}
"""Every function that reads a figure, and what it does with a scale the figure declares."""


def _owners_in(tree: ast.Module) -> Iterator[tuple[str, ast.AST]]:
    """Each top-level function and method by its qualified name, anything else as `<module>`."""
    for node in tree.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            yield node.name, node
        elif isinstance(node, ast.ClassDef):
            for member in node.body:
                named = isinstance(member, ast.FunctionDef | ast.AsyncFunctionDef)
                yield (f"{node.name}.{member.name}" if named else node.name), member
        else:
            yield "<module>", node


def _names_a_reader(node: ast.AST) -> bool:
    return (isinstance(node, ast.Name) and node.id in FIGURE_READERS) or (
        isinstance(node, ast.Attribute) and node.attr in FIGURE_READERS
    )


def _readers_of_a_figure() -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for path in sorted(SOURCE.rglob("*.py")):
        module = ".".join(path.relative_to(SOURCE.parent).with_suffix("").parts)
        for owner, node in _owners_in(ast.parse(path.read_text(encoding="utf-8"))):
            if any(_names_a_reader(each) for each in ast.walk(node)):
                found.add((module.removesuffix(".__init__"), owner))
    return found


def test_every_reader_of_a_figure_says_what_it_makes_of_a_declared_scale() -> None:
    """**UF-071 was a reader nobody had listed.** An assigned score's range reached storage and
    was dropped by the one function that decided which figures carry a scale, and nothing knew
    every place a figure is read -- so nothing asked whether each one honoured its scale.

    A new reader fails here until somebody writes down what it makes of a declared scale, which
    is the moment to decide it.
    """
    found = _readers_of_a_figure()

    assert found == READERS_OF_A_FIGURE.keys(), (
        f"read a figure and are not listed: {sorted(found - READERS_OF_A_FIGURE.keys())}; "
        f"listed and no longer read one: {sorted(READERS_OF_A_FIGURE.keys() - found)}"
    )


CLOCK_READS = {("datetime", "now"), ("datetime", "utcnow"), ("date", "today"), ("time", "time")}
"""Every way a module could ask what time it is."""


def _clock_reads_in(tree: ast.Module) -> list[str]:
    return [
        f"{node.value.id}.{node.attr}"
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and (node.value.id, node.attr) in CLOCK_READS
    ]


def test_evaluation_reads_no_clock() -> None:
    """`evaluation/__init__.py` promises "no clock", and `ranking.py` broke it (PL-064).

    Which figures have aged is the active-value view's answer, read through the value store and
    handed in as `stale_values`; a clock read here would be a second, day-counting answer to the
    same question, and the two disagree a day or two either side of every expiry.
    """
    found = {
        str(path.relative_to(SOURCE)): reads
        for path in sorted((SOURCE / "evaluation").rglob("*.py"))
        if (reads := _clock_reads_in(ast.parse(path.read_text(encoding="utf-8"))))
    }

    assert found == {}


def test_a_clock_read_would_be_found() -> None:
    """The control, so the test above cannot pass by finding nothing anywhere."""
    assert _clock_reads_in(ast.parse("from datetime import datetime\nx = datetime.now(UTC)\n")) == [
        "datetime.now"
    ]
