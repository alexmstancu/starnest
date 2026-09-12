"""What a run is allowed to cost, and what it has cost so far (`reqs.md` 6.3).

**Every source shipped today is free, and that is exactly why this exists now.** The LLM path
is the first thing that can spend money, and a cap decided after the first surprising bill is
not a cap. The rules are three:

1. **A run that can cost money and has no cap refuses to start** -- unless the household says,
   in that request, that it accepts an uncapped run. A provisional number is never invented
   here (`devplan.md` 0.3 rule 2), and `settings.run_spend_cap_eur` ships unset.
2. **The cap halts the run rather than failing it.** In-flight work finishes and commits, the
   run is recorded `halted_on_spend_cap`, and everything fetched is kept (`reqs.md` 6.3).
3. **Spend is accumulated as it happens**, so a halt is never a surprise and the log can show
   the approach (`arch.md` 9.4).

Pure policy: no clock, no database, no HTTP. The store writes the totals; this decides.
"""

from dataclasses import dataclass, field
from decimal import Decimal


class SpendCapNotSetError(ValueError):
    """A run that can cost money, with no cap, and nobody has accepted that.

    A `ValueError` like every other refusal here, because that is what the API maps to a 409
    (`api/errors.py`): the request asked for something the application will not do, which is a
    statement about the request rather than a fault in the code.

    Refused rather than defaulted: a cap invented here would be this application deciding what
    the household can afford. The request may say it accepts an uncapped run, which is a
    deliberate act -- a different thing from a missing setting.
    """


@dataclass
class CostMeter:
    """One run's spend against its cap.

    Mutable on purpose: a run accumulates. Everything that reads it is a question about the
    total so far, and the only thing that changes it is `spent`.
    """

    cap_eur: Decimal | None
    """`None` means no ceiling was set. Whether that is allowed is `refuse_unless_capped`'s
    question, asked once before anything is fetched."""

    spent_eur: Decimal = field(default=Decimal(0))
    calls: int = 0

    def spent(self, *, cost_eur: Decimal, calls: int = 1) -> None:
        """Record what a completed call cost. Called after the call, because a call that failed
        halfway still cost whatever the provider charged for it."""
        self.spent_eur += cost_eur
        self.calls += calls

    @property
    def is_exhausted(self) -> bool:
        """Whether the cap has been reached. An uncapped run is never exhausted."""
        return self.cap_eur is not None and self.spent_eur >= self.cap_eur

    @property
    def remaining_eur(self) -> Decimal | None:
        if self.cap_eur is None:
            return None
        return max(Decimal(0), self.cap_eur - self.spent_eur)

    def describe(self) -> str:
        """One line for the log, so the approach to a halt is visible before it happens."""
        if self.cap_eur is None:
            return f"{self.calls} call(s), {self.spent_eur} EUR spent, no cap set"
        return (
            f"{self.calls} call(s), {self.spent_eur} of {self.cap_eur} EUR spent, "
            f"{self.remaining_eur} remaining"
        )


def refuse_unless_capped(
    *, costs_money: bool, cap_eur: Decimal | None, uncapped_is_accepted: bool
) -> None:
    """The check before anything is fetched.

    **A free run is never refused**: six of the seven sources cost nothing, and a cap is
    meaningless to them. Only a run that can spend needs one -- and the household may say, in
    the request, that it accepts spending without a ceiling. That acceptance is not a setting
    and is not remembered: it is a sentence in one request, about one run.
    """
    if not costs_money or cap_eur is not None or uncapped_is_accepted:
        return
    raise SpendCapNotSetError(
        "this run would ask a source that charges, and no spend cap is set. Set "
        "`run_spend_cap_eur` in Settings, or accept an uncapped run in this request -- nothing "
        "here invents a ceiling on your behalf (reqs.md 6.3)."
    )
