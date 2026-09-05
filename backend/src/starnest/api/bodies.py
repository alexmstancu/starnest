"""The base every response body extends, and the one thing it does.

**Absent and null are different claims, and the design distinguishes them.** A field typed
`[string, "null"]` means null is a value the client should expect; a field typed `string` and
left out of `required` means *omit it when there is nothing to say* -- and the interface's
generated client types those two differently, optional versus nullable. Sending null where the
design expects absence satisfies Python and lies to the client.

Pydantic has no per-field "omit when None", and `exclude_none` on a whole model is too blunt: it
would also drop `score` from a ranking, which is required AND nullable, and whose absence would
be a different lie. So each body names the fields the design wants absent rather than null.

Three fields need it today -- a criterion's `reducer_mode`, a pillar's `description` and an
attribute's `description` -- and each was found by validating a real response against the
design rather than by reading the schema carefully.
"""

from typing import Any, ClassVar

from pydantic import BaseModel, SerializerFunctionWrapHandler, model_serializer


class ContractBody(BaseModel):
    """A response body that omits the fields the design wants absent rather than null."""

    omit_when_absent: ClassVar[frozenset[str]] = frozenset()

    @model_serializer(mode="wrap")
    def _omit_what_the_design_wants_absent(
        self, serialise: SerializerFunctionWrapHandler
    ) -> dict[str, Any]:
        serialised = serialise(self)
        for field in self.omit_when_absent:
            if serialised.get(field) is None:
                serialised.pop(field, None)
        return serialised
