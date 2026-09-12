"""A focus candidate against its comparators, and what the differences are worth (`reqs.md` 8.5).

Pure arithmetic over a ranking that already exists. Nothing here fetches, stores or writes; a
comparison is always live, and freezing one is post-MVP.
"""

from starnest.comparison.comparison import (
    AttributeComparison,
    ComparatorCell,
    Comparison,
    ComparisonError,
    Synthesis,
    compare,
)

__all__ = [
    "AttributeComparison",
    "ComparatorCell",
    "Comparison",
    "ComparisonError",
    "Synthesis",
    "compare",
]
