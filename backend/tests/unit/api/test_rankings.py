"""How a ranked candidate is named on the way out (PL-079 item 5)."""

from decimal import Decimal

from starnest.api.rankings import _result_body
from starnest.evaluation import CandidateResult, MatchStatus


def a_result(candidate: str) -> CandidateResult:
    return CandidateResult(
        candidate=candidate, coverage=Decimal(0), match_status=MatchStatus.INSUFFICIENT_DATA
    )


class TestACandidatesName:
    def test_it_is_the_rosters_name(self) -> None:
        body = _result_body(a_result("country.portugal"), {"country.portugal": "Portugal"}, {})

        assert body.name == "Portugal"

    def test_one_that_left_the_roster_reads_as_words_never_its_id(self) -> None:
        """A saved ranking outlives its candidate's row in the roster, and freezing names would
        need a migration, so the id made readable is the honest minimum."""
        body = _result_body(a_result("country.north_macedonia"), {}, {})

        assert body.name == "North macedonia"
        assert body.candidate == "country.north_macedonia"
