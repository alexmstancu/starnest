"""No sentence the server writes about a candidate is machine text (PL-067, M4).

Every reason kind is built here from real catalog ids, and none may carry an identifier, a
vocabulary token, a Python repr, "to any", or a figure with more than two decimals. The reasons
are read verbatim on screen and frozen into saved rankings, so one that slips is shown for ever.
"""

import re
from decimal import Decimal

import pytest

from starnest.criteria import (
    BooleanThreshold,
    LabelThreshold,
    NormalisationMethod,
    RangeThreshold,
    ShareThreshold,
)
from starnest.data import (
    Boolean,
    CompoundRule,
    CompoundRuleCondition,
    CompoundRuleShape,
    LabelSet,
    MatchResult,
    MatchRuleResult,
    Quantity,
    RuleOutcome,
    Share,
    ShareComposition,
    ValueType,
)
from starnest.evaluation import (
    gates_that_rule_out,
    judgements_of,
    rank_candidates,
    thresholds_that_rule_out,
)
from starnest.evaluation.wording import Names, readable_identifier, stored_text_in_words

from .builders import a_criterion, a_set, a_value, values_for

HEAT = "country.projected_summer_heat_days"
CLIMATE = "country.climate_zone"
ENGLISH = "country.english_proficiency"
TAX = "country.total_tax_rate_effective"
GATE = "uk_skilled_worker"

NAMES = Names(
    attributes={
        HEAT: "Projected summer heat days",
        CLIMATE: "Climate zone",
        ENGLISH: "English proficiency",
    },
    units={HEAT: "days per year", TAX: "%"},
    gates={GATE: "UK skilled worker visa"},
)

MACHINE_TEXT = {
    "an identifier": re.compile(r"(country|city)\.[a-z0-9_]+"),
    "a vocabulary token": re.compile(
        r"\b(not_matching|insufficient_data|percentile|as_is|target_range)\b"
    ),
    "a repr": re.compile(r"'[^']*'"),
    "an open band": re.compile(r"to any"),
    "more than two decimals": re.compile(r"\d\.\d{3,}"),
}


def _threshold_reasons(names: Names) -> list[str]:
    heat = Quantity(magnitude=Decimal("36.91234"), unit="days_per_year")
    cases = [
        (HEAT, ValueType.QUANTITY, RangeThreshold(max_value=Decimal("25.5")), heat),
        (HEAT, ValueType.QUANTITY, RangeThreshold(min_value=Decimal("40.125")), heat),
        (
            CLIMATE,
            ValueType.LABEL_SET,
            LabelThreshold(label="Cfb", containment_rule="must_contain"),
            LabelSet(labels=("Csa",)),
        ),
        (
            CLIMATE,
            ValueType.LABEL_SET,
            LabelThreshold(label="Csa", containment_rule="must_not_contain"),
            LabelSet(labels=("Csa",)),
        ),
        (ENGLISH, ValueType.BOOLEAN, BooleanThreshold(required_value=True), Boolean(value=False)),
    ]
    shares = ShareComposition(
        shares=(
            Share(label="oceanic", share=Decimal("33.3333")),
            Share(label="other", share=Decimal("66.6667")),
        )
    )
    cases += [
        (
            CLIMATE,
            ValueType.SHARE_COMPOSITION,
            ShareThreshold(label="oceanic", max_share=Decimal(10)),
            shares,
        ),
        (
            CLIMATE,
            ValueType.SHARE_COMPOSITION,
            ShareThreshold(label="oceanic", min_share=Decimal(50)),
            shares,
        ),
    ]
    reasons = []
    for attribute, value_type, threshold, payload in cases:
        criterion = a_criterion(
            attribute=attribute, value_type=value_type, matching_threshold=threshold
        )
        value = a_value(attribute=attribute, value_type=value_type, payload=payload)
        (out,) = thresholds_that_rule_out([criterion], [value], names)
        reasons.append(out.reason_detail)
    return reasons


def _gate_reasons(names: Names) -> list[str]:
    from datetime import UTC, datetime

    answer = MatchRuleResult(
        candidate="country.portugal",
        match_rule=GATE,
        match_result=MatchResult.NOT_MATCHING,
        data_source="manual",
        retrieval_date=datetime(2026, 8, 1, tzinfo=UTC),
    )
    (out,) = gates_that_rule_out(enforced=[GATE], answers=[answer], names=names)
    return [out.reason_detail]


def _warnings(names: Names) -> list[str]:
    bands = [(Decimal(25), None), (None, Decimal("40.5")), (Decimal(25), Decimal(40))]
    details = []
    for minimum, maximum in bands:
        rule = CompoundRule(
            id="mild_now_brutal_later",
            name="Mild now, brutal later",
            level="country",
            shape=CompoundRuleShape.ALL_CONDITIONS_HOLD,
            outcome=RuleOutcome.WARNING,
            conditions=(
                CompoundRuleCondition(
                    ordinal=1, attribute=HEAT, threshold_min=minimum, threshold_max=maximum
                ),
            ),
        )
        (warning,), _ = judgements_of(
            rules=[rule], figures={HEAT: Decimal("36.912345")}, level="country", names=names
        )
        details.append(warning.detail)
    return details


def _insufficient_reasons(names: Names) -> list[str]:
    def reason(criteria, values, **settings) -> str:
        results = rank_candidates(
            criteria=criteria,
            level="country",
            values=values,
            score_scale_max=10,
            names=names,
            **settings,
        )
        found = {str(result.candidate): result for result in results}
        return found["country.portugal"].insufficient_reason or ""

    blocking = a_set([a_criterion(attribute=ENGLISH, blocks_if_missing=True)])
    unplaceable = a_set(
        [
            a_criterion(
                attribute=ENGLISH,
                blocks_if_missing=True,
                normalisation_method=NormalisationMethod.FIXED,
            )
        ]
    )
    plain = a_set([a_criterion(attribute=ENGLISH)])
    english = {
        candidate: tuple(value.model_copy(update={"attribute": ENGLISH}) for value in values)
        for candidate, values in values_for(portugal=42, spain=17).items()
    }
    alone = {"country.portugal": english["country.portugal"]}
    return [
        reason(blocking, {"country.portugal": (), "country.spain": english["country.spain"]}),
        reason(unplaceable, english),
        reason(plain, alone),
        reason(plain, {"country.portugal": ()}),
        reason(
            plain,
            {"country.portugal": (), "country.spain": english["country.spain"]},
            min_coverage=Decimal(50),
        ),
    ]


@pytest.mark.parametrize("names", [NAMES, Names()], ids=["named", "unnamed"])
def test_no_reason_carries_machine_text(names: Names) -> None:
    reasons = (
        _threshold_reasons(names)
        + _gate_reasons(names)
        + _warnings(names)
        + _insufficient_reasons(names)
    )

    found = {
        reason: kind
        for reason in reasons
        for kind, pattern in MACHINE_TEXT.items()
        if pattern.search(reason)
    }
    assert found == {}
    assert len(reasons) == 16


def test_the_catalog_names_are_used_where_they_were_given() -> None:
    (above, *_rest) = _threshold_reasons(NAMES)

    assert above == (
        "Projected summer heat days is 36.91 days per year, above your maximum of "
        "25.5 days per year"
    )


def test_a_name_nobody_gave_reads_as_words() -> None:
    assert readable_identifier("country.climate_zone") == "Climate zone"


class TestAStoredReasonIsServedInWords:
    """Values are append-only, so text stored before reasons were worded is named at read time
    (PL-072, N3)."""

    def test_an_identifier_is_replaced_by_its_name(self) -> None:
        stored = "93 is outside the credible range 0 to 80 declared for country.english_proficiency"

        assert stored_text_in_words(stored, {ENGLISH: "English proficiency"}) == (
            "93 is outside the credible range 0 to 80 declared for English proficiency"
        )

    def test_an_id_that_prefixes_another_never_takes_part_of_it(self) -> None:
        names = {"country.rent": "Rent", "country.rent_share": "Rent share"}

        assert stored_text_in_words("country.rent_share and country.rent", names) == (
            "Rent share and Rent"
        )

    def test_a_note_to_developers_is_taken_out(self) -> None:
        stored = (
            "Dated as the day it was fetched rather than the period it describes "
            "(known-issues.md P37). The figure may be right."
        )

        assert stored_text_in_words(stored, {}) == (
            "Dated as the day it was fetched rather than the period it describes. "
            "The figure may be right."
        )

    def test_text_with_nothing_to_name_is_unchanged(self) -> None:
        assert stored_text_in_words("no sponsor", {ENGLISH: "English proficiency"}) == (
            "no sponsor"
        )
