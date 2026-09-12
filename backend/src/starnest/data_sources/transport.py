"""One JSON request over HTTP, and a refusal named in words a retry can act on.

**The protocol is shared; the interpretation never is.** Every adapter here asks a public
statistics API for JSON over the same three steps -- build a URL, `raise_for_status`, decode the
body -- and six of them had written those three steps, the two `except` clauses around them and
the failure they produce. That is transport, and transport is the same everywhere.

**What each source keeps for itself:** what its payload means. `response.py` and `jsonstat.py`
per source stay exactly where they are, because a JSON-stat cube, an OData envelope and an
SDMX-JSON dataflow have nothing in common but being bytes -- and a shared decoder would be a
lowest common denominator that fits none of them. Nothing in this module looks inside a
response.

**A status code is where the two meet**, so it is a hook rather than a rule: the transport
catches the error and asks the source to explain it. Eurostat's 413 means "the extraction is
being prepared, ask again", OECD's 403 with `cf-mitigated: challenge` means a browser challenge
rather than a withdrawn series, and Open-Meteo puts a sentence in the body. All three are worth
more than a status code to whoever reads the run's failures, and none of them belongs here.
"""

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import httpx

from starnest.data import AttributeId
from starnest.data_acquisition import AcquisitionFailure


class SourceUnavailableError(Exception):
    """The source did not answer with a body we could read.

    One exception for the whole transport, carrying a sentence rather than a status: a refusal, a
    timeout, a connection that never opened and a body that is not JSON are the same fact to
    whoever reads the run -- the source did not answer -- and they are all retryable in the same
    way. What distinguishes them is the sentence, which `explain` produced.
    """


def a_failure(
    attribute: AttributeId | str, reason: str, candidate: str | None = None
) -> AcquisitionFailure:
    """One failure, addressed. The run stamps the source; an adapter never has to.

    Written here because six adapters had written it identically, and because the shape of a
    failure is part of the contract a source answers -- not part of what its figures mean.
    """
    return AcquisitionFailure(
        attribute=AttributeId(str(attribute)), reason=reason, candidate=candidate
    )


class JsonOverHttp:
    """A source's endpoint, asked for JSON.

    Holds the client rather than making one: who opens the connection pool, with what timeout
    and what retry policy, is the composition root's business (`arch.md` 7.5) and an adapter that
    built its own would be untestable without a network.
    """

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        base_url: str,
        explain: Callable[[httpx.HTTPStatusError], str] = str,
        pause: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._client = client
        self._base_url = base_url
        self._explain = explain
        self._pause = pause

    @property
    def base_url(self) -> str:
        """Where this source answers. Read by the adapters that build a path per request."""
        return self._base_url

    async def get(self, path: str = "", *, params: Mapping[str, str] | None = None) -> Any:
        """One GET, decoded. `Any`, because the body is whatever the source publishes and
        giving it a shape is `response.py`'s job, per source.

        Raises `SourceUnavailableError` for every way that can fail, with the source's own
        explanation where it has one. The two `except` clauses this replaces sat in six adapters
        and named the same two cases each time.
        """
        url = f"{self._base_url}{path}" if path else self._base_url
        try:
            response = await self._client.get(url, params=dict(params) if params else None)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as refused:
            raise SourceUnavailableError(self._explain(refused)) from refused
        except httpx.HTTPError as unreachable:
            raise SourceUnavailableError(str(unreachable)) from unreachable
        except ValueError as unreadable:
            # A 200 whose body is not JSON. The source answered and said nothing we can use,
            # which is the same fact as not answering and is reported as such.
            raise SourceUnavailableError(
                f"{url} answered with a body that is not JSON"
            ) from unreadable

    async def wait(self, seconds: float) -> None:
        """Hold off before the next request, where a source's free tier demands it.

        The pause is injected for the same reason the client is: a test that waited would be a
        test that measured `asyncio.sleep`.
        """
        await self._pause(seconds)
