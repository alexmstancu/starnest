"""What somebody else already concluded, displayed beside our number and never inside it.

`reqs.md` 3.5a. The model is a film page showing its own rating with Rotten Tomatoes and
Metacritic alongside: several opinions, visibly separate, produced by different people using
different methods.

**Hard rule: an external score must never enter the weighted calculation.** Ingesting one would
import that provider's weights and normalisation, which contradicts both *nothing hardcoded*
and the principle that the criteria are the user's. It is a **separate entity rather than a
`Value` with a flag**, because a flag gets forgotten in a join and silently ends up inside a
sum -- and because a type that no scoring function accepts cannot be summed by accident.

The general rule this creates: *raw indicators become attributes; composite scores become
external scores.* Eurostat's life-satisfaction survey figure is an attribute; the World
Happiness Report's weighted composite of six factors is one of these. The test is whether
someone else has already applied weights to it.
"""

from collections.abc import Collection, Iterable
from datetime import datetime
from decimal import Decimal
from itertools import groupby

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from starnest.candidates import CandidateId
from starnest.data.identifiers import DataSourceId
from starnest.data.reference_period import ReferencePeriod


class MalformedExternalScoreError(ValueError):
    """A published figure says nothing, or says a position with nothing to be positioned in."""


class ExternalScore(BaseModel):
    """A score or rank an outside index published about one candidate.

    Which edition is current is **derived rather than stored** (`editions_of`) -- the latest per
    candidate, provider and series, on the same principle as the active value. Numbeo
    republishes annually and older editions are kept and shown as history rather than deleted
    or silently replaced.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    candidate: CandidateId
    data_source: DataSourceId = Field(
        description=(
            "Who published it -- a source, not a name in a text column. Numbeo supplies both "
            "values and a composite, and one row for it means one reliability tier and one "
            "place to record a paywall."
        )
    )
    series: str = Field(
        description=(
            "Which of the publisher's indices this is an edition of -- Numbeo's Crime Index and "
            "its Quality of Life Index are two series, and neither is the other's history (D64)."
        )
    )
    published_scale: str = Field(
        min_length=1, description="What the number means: `0-100`, `0-10`, `rank`, `index`."
    )
    reference_period: ReferencePeriod
    retrieval_date: datetime
    published_value: Decimal | None = Field(default=None, allow_inf_nan=False)
    published_rank: int | None = Field(default=None, ge=1)
    published_rank_of: int | None = Field(
        default=None, ge=1, description="The size of the field a rank is out of: 12th of 95."
    )
    methodology_url: str | None = Field(
        default=None, description="So the reader can see how it was built."
    )
    caveats: str | None = Field(default=None, description="Paywalled, discontinued, known quirks.")

    @field_validator("series")
    @classmethod
    def _refuse_a_series_that_names_nothing(cls, series: str) -> str:
        if not series.strip():
            raise MalformedExternalScoreError("an edition names the series it belongs to")
        return series

    @model_validator(mode="after")
    def _enforce_that_it_publishes_something_legible(self) -> "ExternalScore":
        if self.published_value is None and self.published_rank is None:
            raise MalformedExternalScoreError(
                "an external score publishes a value, a rank, or both -- this publishes neither"
            )
        if self.published_rank is not None:
            if self.published_rank_of is None:
                raise MalformedExternalScoreError(
                    f"12th means nothing without the field it is out of, and this is "
                    f"{self.published_rank}th of nothing"
                )
            if self.published_rank > self.published_rank_of:
                raise MalformedExternalScoreError(
                    f"{self.published_rank}th of {self.published_rank_of} is not a position"
                )
        if self.retrieval_date.tzinfo is None:
            raise MalformedExternalScoreError(
                "retrieval_date is a moment in time and must carry a timezone"
            )
        return self


class ExternalScoreListing(BaseModel):
    """One edition as it is listed: the score, and whether it is the one that stands.

    The flag lives here rather than on `ExternalScore`, as `is_active` lives on `ValueListing`:
    it is a fact about the editions beside it, and goes stale the day a newer one lands.
    """

    model_config = ConfigDict(frozen=True)

    score: ExternalScore
    is_current: bool


def editions_of(
    scores: Iterable[ExternalScore], *, switched_off: Collection[str] = ()
) -> tuple[ExternalScoreListing, ...]:
    """Every edition, in one total order, the first of each series current (ST-10, D64).

    The order is by candidate, publisher and series, then the latest period end, then the latest
    period start. **A re-read of one edition collapses** to its latest read: the same period
    read twice is one edition, not its own history. **A switched-off publisher has no current
    edition** (Q232): its editions stay listed, as history, and none stands.
    """
    latest_reads = sorted(scores, key=_the_edition_and_its_read, reverse=True)
    one_per_edition = [next(reads) for _, reads in groupby(latest_reads, key=_the_edition)]
    listed = sorted(one_per_edition, key=_the_listing_order)
    return tuple(
        ExternalScoreListing(
            score=score,
            is_current=(position == 0 and str(score.data_source) not in switched_off),
        )
        for _, series in groupby(listed, key=_the_series)
        for position, score in enumerate(series)
    )


def _the_series(score: ExternalScore) -> tuple[str, str, str]:
    return (str(score.candidate), str(score.data_source), score.series)


def _the_edition(score: ExternalScore) -> tuple[object, ...]:
    return (*_the_series(score), score.reference_period.start, score.reference_period.end)


def _the_edition_and_its_read(score: ExternalScore) -> tuple[object, ...]:
    return (*_the_edition(score), score.retrieval_date)


def _the_listing_order(score: ExternalScore) -> tuple[object, ...]:
    """Ascending by series, descending by period: dates negated through their ordinal."""
    return (
        *_the_series(score),
        -score.reference_period.end.toordinal(),
        -score.reference_period.start.toordinal(),
    )
