"""What a ranking is made of: one result per candidate, and the row behind every number.

**These belong to the evaluation, not to the candidate** (`reqs.md` 3.4a). Score, coverage,
match status and rank all change the moment a different criteria set is applied, and none of
them is a property of the place. A `Candidate` that carried a score would be a candidate that
means something different depending on who is looking at it.

Every result carries its own breakdown, because a total nobody can take apart is a number this
application is not allowed to show. `AttributeScore` is that breakdown: what each criterion
scored, what it was actually weighted at after redistribution, and what it therefore
contributed.
"""

from collections.abc import Mapping
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from starnest.candidates import CandidateId
from starnest.data import AttributeId, ConfidenceLevel, PillarId
from starnest.evaluation.rules import NonMatch, RuleWarning


class MatchStatus(StrEnum):
    """The one vocabulary, with no synonyms (`CLAUDE.md`, `reqs.md` 5.2).

    Never "qualified", "eliminated", "screened", "passed" or "failed". The words matter because
    each of those carries a judgement the application is not making: a candidate that does not
    match is still shown, still scored, and still a candidate.
    """

    MATCHING = "matching"
    NOT_MATCHING = "not_matching"
    INSUFFICIENT_DATA = "insufficient_data"


class AttributeScore(BaseModel):
    """One criterion's part in one candidate's total.

    `effective_weight` is what the criterion counted for *after* redistribution, which is
    usually not the weight the user set -- that is the point of redistribution, and showing the
    stored weight here would make the arithmetic fail to add up on screen.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    attribute: AttributeId
    pillar: PillarId
    normalised_score: int | None = Field(
        default=None,
        description="The score this figure earned, or None when there was no figure to score.",
    )
    effective_weight: Decimal = Field(
        ge=0, description="What it counted for after redistribution, as a percentage."
    )
    contribution: Decimal = Field(
        description="score x effective_weight / 100. Zero when nothing was scored."
    )
    used_value: int | None = Field(
        default=None,
        description=(
            "The stored value this contribution was computed from. Null where nothing was "
            "scored -- it is what closes the provenance chain from a total to a source and a "
            "date, and a saved evaluation freezes it."
        ),
    )


class CandidateResult(BaseModel):
    """One candidate, as one criteria set sees it.

    **`score` is None exactly when `match_status` is `insufficient_data`**, and never otherwise.
    A candidate we cannot score honestly gets no number rather than a zero -- a zero is a claim
    that everything measured badly, which is the fabrication `reqs.md` forbids and the one a
    reader is least likely to question.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    candidate: CandidateId
    score: int | None = None
    coverage: Decimal = Field(ge=0, le=100, description="Percentage of scored weight answered.")
    coverage_by_confidence: Mapping[ConfidenceLevel, Decimal] = Field(
        default_factory=dict,
        description=(
            "How the covered weight splits between the four grades, summing to 100 (`reqs.md` "
            "5.7). Empty when nothing is covered: a split of nothing is not a split."
        ),
    )
    match_status: MatchStatus
    rank: int | None = Field(
        default=None, description="Position among the scored candidates. None when unscored."
    )
    attribute_scores: tuple[AttributeScore, ...] = ()
    insufficient_reason: str | None = Field(
        default=None,
        description="Why this candidate could not be scored, in words, for the screen to show.",
    )
    warnings: tuple[RuleWarning, ...] = Field(
        default=(),
        description=(
            "Flags that rule nothing out and never change the score: a compound rule whose "
            "outcome is a warning (`reqs.md` 3.7a)."
        ),
    )
    non_match_reasons: tuple[NonMatch, ...] = Field(
        default=(),
        description=(
            "Why this candidate does not match, from either mechanism -- a gate or a compound "
            "rule -- because both feed one reporting surface (`reqs.md` 5.4). A candidate that "
            "does not match keeps its score and stays visible."
        ),
    )
