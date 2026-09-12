"""Whether the adapters and the catalog agree, checked at boot rather than mid-run.

`arch.md` 9.2 step 3. An adapter declares the attributes it can answer; the catalog declares
what each attribute *is*. When the two disagree the consequence arrives late and in disguise: an
adapter builds a `Quantity` for an attribute the catalog calls a `Ratio`, the value is refused at
write time, and the run reports a failure that reads like the source's fault.

**A pure function over what both sides declare**, so it is checked without a database and
without a network -- and so the startup sequence has something to call that cannot itself fail
for an unrelated reason.
"""

from collections.abc import Sequence

from starnest.data import Attribute, AttributeId
from starnest.data_acquisition.adapter import SourceAdapter


def declarations_that_disagree(
    adapters: Sequence[SourceAdapter], attributes: Sequence[Attribute]
) -> tuple[str, ...]:
    """Every adapter declaration the catalog does not bear out, in words a boot log can print.

    Two disagreements are possible and both are startup errors:

    - an adapter names an attribute the catalog does not have, which is a typo or a retirement
      nobody told the adapter about;
    - two adapters claim the same attribute under the same source id, which would make "which
      source answered?" unanswerable and a retry ambiguous.

    A *value type* mismatch cannot be checked here, because an adapter does not declare the type
    it will build -- it reads it off the `Attribute` it is handed, which is what makes adding an
    attribute a data change (`arch.md` 1.2). That is the invariant this check would otherwise
    be duplicating.
    """
    catalogued = {attribute.id for attribute in attributes}
    complaints: list[str] = []
    claimed: dict[tuple[str, AttributeId], list[str]] = {}

    for adapter in adapters:
        for declared in adapter.attributes:
            if declared not in catalogued:
                complaints.append(
                    f"{adapter.data_source} declares {declared}, which the catalog does not have"
                )
            claimed.setdefault((str(adapter.data_source), declared), []).append(
                type(adapter).__name__
            )

    for (source, attribute), adapters_claiming in sorted(claimed.items()):
        if len(adapters_claiming) > 1:
            complaints.append(
                f"{', '.join(sorted(adapters_claiming))} all answer {attribute} as {source}, "
                "so which one answered could not be told from a stored value"
            )

    return tuple(complaints)
