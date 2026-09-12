"""The half of a source adapter that is the same everywhere: one GET, JSON back.

**Every way it can fail arrives as one exception carrying a sentence.** A refusal, a timeout, a
connection that never opened and a 200 whose body is not JSON are the same fact to whoever reads
a run's failures -- the source did not answer -- and the sentence is what distinguishes them.

**And a status code is where the shared half meets the source's own.** `explain` is a hook, so
Eurostat can say "the extraction is being prepared" where a plain `403 Forbidden` would send
somebody looking for a fault in a request that had none.
"""

import asyncio

import httpx
import pytest

from starnest.data_sources.transport import JsonOverHttp, SourceUnavailableError, a_failure

BASE = "https://statistics.example/api"


def answering(handler) -> JsonOverHttp:
    return JsonOverHttp(httpx.AsyncClient(transport=httpx.MockTransport(handler)), base_url=BASE)


class TestWhatItReturns:
    async def test_the_decoded_body(self) -> None:
        endpoint = answering(lambda request: httpx.Response(200, json={"value": [1, 2]}))

        assert await endpoint.get("/indicator") == {"value": [1, 2]}

    async def test_the_path_is_appended_to_the_base(self) -> None:
        asked: list[str] = []

        def record(request: httpx.Request) -> httpx.Response:
            asked.append(str(request.url))
            return httpx.Response(200, json={})

        await answering(record).get("/indicator/42")

        assert asked == [f"{BASE}/indicator/42"]

    async def test_a_source_answering_at_its_base_needs_no_path(self) -> None:
        """Open-Meteo takes everything in the query string, so the path is empty."""
        asked: list[str] = []

        def record(request: httpx.Request) -> httpx.Response:
            asked.append(str(request.url))
            return httpx.Response(200, json={})

        await answering(record).get(params={"latitude": "38.7"})

        assert asked == [f"{BASE}?latitude=38.7"]

    async def test_parameters_are_sent_as_given(self) -> None:
        asked: list[httpx.QueryParams] = []

        def record(request: httpx.Request) -> httpx.Response:
            asked.append(request.url.params)
            return httpx.Response(200, json={})

        await answering(record).get("/x", params={"format": "JSON", "lang": "EN"})

        assert dict(asked[0]) == {"format": "JSON", "lang": "EN"}


class TestWhatItRefuses:
    async def test_a_status_error_becomes_one_exception(self) -> None:
        endpoint = answering(lambda request: httpx.Response(503, text="later"))

        with pytest.raises(SourceUnavailableError):
            await endpoint.get("/indicator")

    async def test_a_connection_that_never_opened_becomes_the_same_one(self) -> None:
        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host", request=request)

        with pytest.raises(SourceUnavailableError, match="no route to host"):
            await answering(refuse).get("/indicator")

    async def test_a_body_that_is_not_json_becomes_the_same_one(self) -> None:
        """A 200 that says nothing we can use is the same fact as not answering, and used to
        escape as a bare `ValueError` from whichever decoder read it first."""
        endpoint = answering(lambda request: httpx.Response(200, text="<html>maintenance"))

        with pytest.raises(SourceUnavailableError, match="not JSON"):
            await endpoint.get("/indicator")

    async def test_the_source_explains_its_own_status_codes(self) -> None:
        """The hook that keeps interpretation out of the transport: Eurostat's 413 means the
        extraction is being prepared, which is not a fault and reads nothing like one."""
        endpoint = JsonOverHttp(
            httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(413))),
            base_url=BASE,
            explain=lambda refused: f"being prepared, ask again ({refused.response.status_code})",
        )

        with pytest.raises(SourceUnavailableError, match=r"being prepared, ask again \(413\)"):
            await endpoint.get("/big")

    async def test_without_a_hook_the_status_speaks_for_itself(self) -> None:
        """The default. A source with nothing special to say about a code says the code."""
        endpoint = answering(lambda request: httpx.Response(404))

        with pytest.raises(SourceUnavailableError, match="404"):
            await endpoint.get("/gone")


class TestPacing:
    async def test_it_waits_for_as_long_as_it_is_told(self) -> None:
        """The pause is injected for the same reason the client is: a test that waited would be
        a test of `asyncio.sleep`."""
        waited: list[float] = []

        endpoint = JsonOverHttp(
            httpx.AsyncClient(
                transport=httpx.MockTransport(lambda r: httpx.Response(200, json={}))
            ),
            base_url=BASE,
            pause=lambda seconds: _record(waited, seconds),
        )

        await endpoint.wait(1.5)

        assert waited == [1.5]

    async def test_the_default_pause_runs_and_returns_nothing(self) -> None:
        """The default argument, executed rather than assumed. Nothing here measures a
        duration -- that would be a test of `asyncio.sleep` -- but a default that was not a
        coroutine would fail right here rather than in a run."""
        endpoint = answering(lambda request: httpx.Response(200, json={}))

        assert await endpoint.wait(0) is None


async def _record(waited: list[float], seconds: float) -> None:
    waited.append(seconds)
    await asyncio.sleep(0)


class TestAFailureItShapes:
    def test_it_names_the_attribute_and_the_reason(self) -> None:
        failure = a_failure("country.homicide_rate", "503 from the source")

        assert failure.attribute == "country.homicide_rate"
        assert failure.reason == "503 from the source"

    def test_a_whole_source_failure_names_no_candidate(self) -> None:
        """A source unreachable as a whole failed for no candidate in particular; the run
        itemises it against every candidate it asked about (`execution.py`)."""
        assert a_failure("country.homicide_rate", "unreachable").candidate is None

    def test_a_failure_for_one_candidate_carries_it(self) -> None:
        failure = a_failure("country.homicide_rate", "no alpha-3 code", candidate="country.malta")

        assert failure.candidate == "country.malta"

    def test_the_source_is_not_stamped_here(self) -> None:
        """The run stamps it, so an adapter cannot forget to (`run.py`)."""
        assert a_failure("country.homicide_rate", "unreachable").data_source is None
