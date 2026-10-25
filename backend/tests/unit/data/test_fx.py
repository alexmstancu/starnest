"""The rate a conversion used, as a record with provenance rather than a division."""

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from starnest.data import (
    EURO,
    CurrencyMismatchError,
    FxRate,
    FxRateProvider,
    FxRateStore,
    FxRateUnavailableError,
    PublishedRates,
    confirm_published,
)

CHF_TO_EUR = FxRate(
    base_currency="CHF",
    quote_currency=EURO,
    rate_date=date(2026, 7, 1),
    rate=Decimal("1.05"),
    data_source="ecb",
)


class TestConverting:
    def test_restates_an_amount_in_the_quote_currency(self) -> None:
        assert CHF_TO_EUR.convert(Decimal("2900")) == Decimal("3045.00")

    def test_does_not_round(self) -> None:
        """What a figure should look like is a display decision, made once, elsewhere."""
        assert CHF_TO_EUR.convert(Decimal("1")) == Decimal("1.05")

    def test_carries_the_source_that_published_it(self) -> None:
        assert CHF_TO_EUR.data_source == "ecb"

    def test_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            CHF_TO_EUR.rate = Decimal("2")


class TestWhatARateRefuses:
    def test_refuses_a_pair_that_does_not_convert(self) -> None:
        with pytest.raises(ValidationError) as raised:
            FxRate(
                base_currency="EUR",
                quote_currency="EUR",
                rate_date=date(2026, 7, 1),
                rate=Decimal("1"),
                data_source="ecb",
            )
        assert isinstance(raised.value.errors()[0]["ctx"]["error"], CurrencyMismatchError)

    @pytest.mark.parametrize("rate", ["0", "-1.05"])
    def test_refuses_a_rate_that_is_not_positive(self, rate: str) -> None:
        with pytest.raises(ValidationError):
            FxRate(
                base_currency="CHF",
                quote_currency="EUR",
                rate_date=date(2026, 7, 1),
                rate=Decimal(rate),
                data_source="ecb",
            )

    def test_refuses_a_rate_with_no_source(self) -> None:
        """One number in the system without provenance is exactly what 5.5 forbids."""
        with pytest.raises(ValidationError):
            FxRate(
                base_currency="CHF",
                quote_currency="EUR",
                rate_date=date(2026, 7, 1),
                rate=Decimal("1.05"),
            )


class TestTheProviderSeam:
    def test_cannot_be_used_without_being_implemented(self) -> None:
        with pytest.raises(TypeError):
            FxRateProvider()  # type: ignore[abstract]

    async def test_an_implementation_may_answer_with_an_earlier_day(self) -> None:
        """Rates are not published on Sundays, and the answer says which day it is from."""

        class LastPublishedRate(FxRateProvider):
            async def rate_for(self, *, base_currency, quote_currency, on):
                if base_currency != "CHF":
                    raise FxRateUnavailableError(f"no rate for {base_currency}")
                return CHF_TO_EUR

        provider = LastPublishedRate()
        rate = await provider.rate_for(
            base_currency="CHF", quote_currency=EURO, on=date(2026, 7, 5)
        )
        assert rate.rate_date == date(2026, 7, 1)
        with pytest.raises(FxRateUnavailableError):
            await provider.rate_for(base_currency="HUF", quote_currency=EURO, on=date(2026, 7, 5))


class RatesOnRecord(FxRateStore):
    """The store, in memory: what has been recorded, by pair and day."""

    def __init__(self, *rates: FxRate) -> None:
        self.recorded = {(r.base_currency, r.quote_currency, r.rate_date): r for r in rates}
        self.answers: dict[tuple[str, str, date], date] = {}

    async def read_rate(self, *, base_currency, quote_currency, on):
        day = on
        if (base_currency, quote_currency, on) not in self.recorded:
            day = self.answers.get((base_currency, quote_currency, on), on)
        try:
            return self.recorded[(base_currency, quote_currency, day)]
        except KeyError:
            raise FxRateUnavailableError(f"no {base_currency} rate on record for {on}") from None

    async def record_rate(self, rate: FxRate) -> FxRate:
        return self.recorded.setdefault(
            (rate.base_currency, rate.quote_currency, rate.rate_date), rate
        )

    async def record_answer(self, rate: FxRate, *, asked_for: date) -> None:
        assert (rate.base_currency, rate.quote_currency, rate.rate_date) in self.recorded
        assert rate.rate_date < asked_for
        self.answers.setdefault(
            (rate.base_currency, rate.quote_currency, asked_for), rate.rate_date
        )


class APublisher(FxRateProvider):
    """Answers with one rate, or with none, and counts how often it was asked."""

    def __init__(self, answer: FxRate | None) -> None:
        self.answer = answer
        self.asked = 0

    async def rate_for(self, *, base_currency, quote_currency, on):
        self.asked += 1
        if self.answer is None:
            raise FxRateUnavailableError("the publisher had nothing for that day")
        return self.answer


def chf_on(day: date) -> FxRate:
    return CHF_TO_EUR.model_copy(update={"rate_date": day})


THURSDAY, FRIDAY, SATURDAY, SUNDAY = (date(2026, 7, day) for day in (2, 3, 4, 5))
GOOD_FRIDAY, MAUNDY_THURSDAY = date(2026, 4, 3), date(2026, 4, 2)
LONG_AFTER = date(2026, 12, 31)


class TheEcb(FxRateProvider):
    """The ECB, faked: it answers a day with the last rate it published on or before it, and
    counts how often it was asked. Unreachable, it refuses as the real adapter does."""

    def __init__(self, *published: date, reachable: bool = True) -> None:
        self.published = published
        self.reachable = reachable
        self.asked = 0

    async def rate_for(self, *, base_currency, quote_currency, on):
        self.asked += 1
        if not self.reachable:
            raise FxRateUnavailableError("the ECB did not answer when asked for the rate")
        return chf_on(max(day for day in self.published if day <= on))


class TestADayWithoutARateOfItsOwn:
    """PL-170: a weekend or a holiday is answered with an earlier day's rate, and that answer is
    recorded, so the ECB is reached once for the day -- never with a rate it would not use."""

    @staticmethod
    def rates(store: RatesOnRecord, ecb: TheEcb, *, today: date = LONG_AFTER) -> PublishedRates:
        return PublishedRates(store, publisher=ecb, today=lambda: today)

    async def test_a_saturday_asked_twice_reaches_the_ecb_once(self) -> None:
        store, ecb = RatesOnRecord(), TheEcb(THURSDAY, FRIDAY)
        rates = self.rates(store, ecb)

        first = await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=SATURDAY)
        again = await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=SATURDAY)

        assert first == again == chf_on(FRIDAY)
        assert ecb.asked == 1
        assert list(store.recorded.values()) == [chf_on(FRIDAY)]

    async def test_a_holiday_is_answered_with_the_day_before_and_asked_once(self) -> None:
        store, ecb = RatesOnRecord(), TheEcb(MAUNDY_THURSDAY)
        rates = self.rates(store, ecb)

        await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=GOOD_FRIDAY)
        rate = await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=GOOD_FRIDAY)

        assert rate.rate_date == MAUNDY_THURSDAY
        assert ecb.asked == 1

    async def test_an_older_rate_on_record_does_not_answer_a_later_day(self) -> None:
        """Thursday's rate on record says nothing about whether Friday had one; the ECB does."""
        store, ecb = RatesOnRecord(chf_on(THURSDAY)), TheEcb(THURSDAY, FRIDAY)

        rate = await self.rates(store, ecb).rate_for(
            base_currency="CHF", quote_currency=EURO, on=SATURDAY
        )

        assert rate == chf_on(FRIDAY)
        assert ecb.asked == 1

    async def test_one_days_answer_does_not_answer_another(self) -> None:
        store, ecb = RatesOnRecord(), TheEcb(FRIDAY)
        rates = self.rates(store, ecb)

        await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=SATURDAY)
        await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=SUNDAY)

        assert ecb.asked == 2

    @pytest.mark.parametrize(
        "today", [pytest.param(SATURDAY, id="today"), pytest.param(FRIDAY, id="a future day")]
    )
    async def test_a_day_not_yet_over_is_asked_again(self, today: date) -> None:
        """Before the day's rate is published the ECB answers with yesterday's; later it will
        not, so that answer is not the day's and is not recorded as it."""
        store, ecb = RatesOnRecord(), TheEcb(FRIDAY)
        rates = self.rates(store, ecb, today=today)

        await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=SATURDAY)
        await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=SATURDAY)

        assert ecb.asked == 2
        assert store.answers == {}

    async def test_the_ecb_unreachable_is_refused_and_records_nothing(self) -> None:
        store = RatesOnRecord(chf_on(THURSDAY))

        with pytest.raises(FxRateUnavailableError, match="did not answer"):
            await self.rates(store, TheEcb(reachable=False)).rate_for(
                base_currency="CHF", quote_currency=EURO, on=SATURDAY
            )
        assert list(store.recorded.values()) == [chf_on(THURSDAY)]
        assert store.answers == {}

    async def test_a_typed_saturday_is_still_refused_once_saturday_is_answered(self) -> None:
        """The answer is Friday's rate, dated Friday; a claim dated Saturday was never published."""
        store, ecb = RatesOnRecord(), TheEcb(FRIDAY)
        rates = self.rates(store, ecb)
        await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=SATURDAY)

        with pytest.raises(FxRateUnavailableError, match="2026-07-04"):
            await confirm_published(chf_on(SATURDAY), rates=rates)
        assert ecb.asked == 1


class TestPublishedRates:
    """ST-18 (D63): a rate is read from what was recorded, and asked of its publisher once."""

    async def test_a_rate_on_record_is_read_without_asking_the_publisher(self) -> None:
        publisher = APublisher(None)
        rates = PublishedRates(RatesOnRecord(CHF_TO_EUR), publisher=publisher)

        rate = await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=date(2026, 7, 1))

        assert rate == CHF_TO_EUR
        assert publisher.asked == 0

    async def test_a_rate_not_on_record_is_asked_for_and_recorded(self) -> None:
        store = RatesOnRecord()
        publisher = APublisher(CHF_TO_EUR)
        rates = PublishedRates(store, publisher=publisher)

        first = await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=date(2026, 7, 1))
        again = await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=date(2026, 7, 1))

        assert first == again == CHF_TO_EUR
        assert publisher.asked == 1
        assert list(store.recorded.values()) == [CHF_TO_EUR]

    async def test_a_rate_nobody_published_is_unavailable_and_nothing_is_recorded(self) -> None:
        store = RatesOnRecord()
        rates = PublishedRates(store, publisher=APublisher(None))

        with pytest.raises(FxRateUnavailableError):
            await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=date(2026, 7, 1))
        assert store.recorded == {}

    async def test_without_a_publisher_only_the_record_answers(self) -> None:
        rates = PublishedRates(RatesOnRecord())

        with pytest.raises(FxRateUnavailableError):
            await rates.rate_for(base_currency="CHF", quote_currency=EURO, on=date(2026, 7, 1))


class TestConfirmingARateWasPublished:
    async def test_the_rate_its_publisher_published_is_confirmed(self) -> None:
        await confirm_published(CHF_TO_EUR, rates=PublishedRates(RatesOnRecord(CHF_TO_EUR)))

    @pytest.mark.parametrize(
        "claimed",
        [
            pytest.param({"rate": Decimal("1.06")}, id="another number"),
            pytest.param({"data_source": "manual"}, id="another publisher"),
        ],
    )
    async def test_a_rate_that_differs_from_the_published_one_is_refused(
        self, claimed: dict
    ) -> None:
        with pytest.raises(FxRateUnavailableError, match="published"):
            await confirm_published(
                CHF_TO_EUR.model_copy(update=claimed),
                rates=PublishedRates(RatesOnRecord(CHF_TO_EUR)),
            )

    async def test_a_day_the_publisher_answered_for_with_an_earlier_one_is_refused(self) -> None:
        """Asked about a Sunday, the publisher answers with Friday: the claim named Sunday."""
        sunday = CHF_TO_EUR.model_copy(update={"rate_date": date(2026, 7, 5)})

        with pytest.raises(FxRateUnavailableError, match="2026-07-05"):
            await confirm_published(
                sunday, rates=PublishedRates(RatesOnRecord(), publisher=APublisher(CHF_TO_EUR))
            )

    async def test_a_rate_nobody_published_is_refused(self) -> None:
        with pytest.raises(FxRateUnavailableError):
            await confirm_published(CHF_TO_EUR, rates=PublishedRates(RatesOnRecord()))
