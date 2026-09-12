"""The startup sequence, checked piece by piece (`arch.md` 9.2).

**Two of the steps are worth having and this is why**: both catch, at boot, a class of problem
that would otherwise appear hours later as a corrupted value or a run that failed for a reason
that reads like a source's fault.

The schema comparison is a storage test (it needs a database); what is here is the pure half --
which declarations disagree, and what the boot log must never contain.
"""

from collections.abc import Sequence

from starnest.candidates import Candidate
from starnest.data import Attribute, DataSourceId, RatioParameters, ValueType
from starnest.data_acquisition import Acquired, SourceAdapter, declarations_that_disagree
from starnest.main import Environment

OVERBURDEN = "country.housing_cost_overburden_rate"
OVERCROWDING = "country.overcrowding_rate"


def an_attribute(identifier: str) -> Attribute:
    return Attribute(
        id=identifier,
        name=identifier,
        level="country",
        value_type=ValueType.RATIO,
        pillar="housing",
        ratio_parameters=RatioParameters(basis="households"),
    )


class StubSource(SourceAdapter):
    def __init__(self, source: str, declares: tuple[str, ...]) -> None:
        self._source = source
        self._declares = declares

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId(self._source)

    @property
    def attributes(self) -> tuple:
        return self._declares

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        return Acquired()


class AnotherStubSource(StubSource):
    """A second class under the same source id, which is the ambiguity worth catching."""


THE_CATALOG = [an_attribute(OVERBURDEN), an_attribute(OVERCROWDING)]


class TestTheDeclarationsAdaptersMake:
    def test_a_registry_that_agrees_with_the_catalog_has_nothing_to_say(self) -> None:
        adapters = [
            StubSource("eurostat", (OVERBURDEN, OVERCROWDING)),
            StubSource("world_bank", (OVERCROWDING,)),
        ]

        assert declarations_that_disagree(adapters, THE_CATALOG) == ()

    def test_an_attribute_the_catalog_does_not_have_is_named(self) -> None:
        """A typo, or an attribute retired without telling the adapter. Either way the run
        would ask for something nothing can store."""
        adapters = [StubSource("eurostat", ("country.rent_by_moonlight",))]

        (complaint,) = declarations_that_disagree(adapters, THE_CATALOG)

        assert "country.rent_by_moonlight" in complaint
        assert "eurostat" in complaint

    def test_two_adapters_answering_as_one_source_are_named(self) -> None:
        """Which source answered would be unanswerable from a stored value, and a retry could
        not know whom to ask again (`0461`)."""
        adapters = [
            StubSource("eurostat", (OVERBURDEN,)),
            AnotherStubSource("eurostat", (OVERBURDEN,)),
        ]

        (complaint,) = declarations_that_disagree(adapters, THE_CATALOG)

        assert "AnotherStubSource" in complaint
        assert "StubSource" in complaint
        assert OVERBURDEN in complaint

    def test_the_same_attribute_from_two_different_sources_is_fine(self) -> None:
        """The control, and the case that must not be reported: two sources answering one
        attribute is the ordinary state the active-value rule exists for (`reqs.md` 3.6)."""
        adapters = [
            StubSource("oecd", (OVERBURDEN,)),
            StubSource("eurostat_estimate", (OVERBURDEN,)),
        ]

        assert declarations_that_disagree(adapters, THE_CATALOG) == ()

    def test_an_empty_registry_disagrees_with_nothing(self) -> None:
        assert declarations_that_disagree([], THE_CATALOG) == ()

    def test_every_disagreement_is_reported_not_just_the_first(self) -> None:
        """A boot that names one fault and hides the next costs a second restart to find it."""
        adapters = [
            StubSource("eurostat", ("country.nobody_measures_this", "country.nor_this")),
        ]

        assert len(declarations_that_disagree(adapters, THE_CATALOG)) == 2


class TestWhatTheBootLogMustNeverCarry:
    def test_the_environment_never_renders_the_api_key(self) -> None:
        """`arch.md` 9.4: never the API key. `Environment` reaches logs and tracebacks, so the
        redaction is on the object rather than on every place that might print one."""
        environment = Environment(
            database_url="postgresql://someone:a-real-password@localhost/starnest",
            anthropic_api_key="sk-ant-a-real-key-that-must-not-appear",
        )

        rendered = f"{environment!r} {environment!s}"

        assert "sk-ant-a-real-key-that-must-not-appear" not in rendered
        assert "a-real-password" not in rendered

    def test_the_redaction_says_what_it_hid(self) -> None:
        """A redaction that renders nothing at all reads as a missing value."""
        environment = Environment(database_url="postgresql://localhost/starnest")

        assert "redacted" in repr(environment)
