"""What asking a source would cost, before anything is asked (`reqs.md` 6.3).

**A run is estimated so that a mistake is caught before it is paid for**, and the cap is what
catches whatever the estimate got wrong (Q22). The two are deliberately different mechanisms:
this one is arithmetic over a plan, and `spend.py` is arithmetic over what actually happened.

**An estimate says what it rests on.** `basis` travels with the numbers because a euro figure
with no stated assumptions is the plausible-looking number this application exists to avoid: a
reader who knows a call was priced at a ceiling can judge the total, and one who does not has to
trust it. Free sources return `NOTHING`, whose basis is empty -- there is nothing to explain
about zero.
"""

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Estimate:
    """Paid calls, what they would cost, and the assumptions behind the figure."""

    calls: int = 0
    cost_eur: Decimal = Decimal(0)
    basis: str = ""

    def __add__(self, other: "Estimate") -> "Estimate":
        """Two estimates, summed, keeping each distinct basis once.

        Two adapters sharing one model share one basis, and repeating it per source would read
        as two different assumptions.
        """
        bases = [basis for basis in (self.basis, other.basis) if basis]
        seen = list(dict.fromkeys(bases))
        return Estimate(
            calls=self.calls + other.calls,
            cost_eur=self.cost_eur + other.cost_eur,
            basis="; ".join(seen),
        )


NOTHING = Estimate()
"""What a free source estimates. Named, so an adapter that charges nothing says so once."""
