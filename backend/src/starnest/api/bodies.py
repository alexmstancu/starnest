"""The bases the bodies extend: what a response omits, and what a partial change refuses.

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

**The same distinction runs the other way on a request** (BE-23): `NullRefusingBody` refuses a
null the design never gives, and `PartialChangeBody` adds "left out means leave it as it is".

**The generated contract says the same as the wire** (NEW-62). Python holds an absent field as
`None`, which Pydantic describes as "or null"; both bases take that branch out of the description
of every field they name, so `openapi.implemented.yaml` never offers a null the server never sends
or never takes.
"""

from typing import Any, ClassVar

from pydantic import (
    BaseModel,
    ConfigDict,
    SerializerFunctionWrapHandler,
    ValidationInfo,
    field_validator,
    model_serializer,
)
from pydantic_core import PydanticCustomError


def _without_null(schema: dict[str, Any], fields: frozenset[str]) -> None:
    """Drop null from the generated description of each of `fields`.

    The fields stay `X | None` in Python, because a field left out has to be held as something;
    the contract a client reads must still say what the field carries, and that is never null.
    """
    for name in fields:
        field = schema.get("properties", {}).get(name, {})
        kept = [branch for branch in field.pop("anyOf", []) if branch != {"type": "null"}]
        if len(kept) == 1:
            field.update(kept[0])
        elif kept:
            field["anyOf"] = kept


def _described_as_omitted(schema: dict[str, Any], body: type["ContractBody"]) -> None:
    _without_null(schema, body.omit_when_absent)


class ContractBody(BaseModel):
    """A response body that omits the fields the design wants absent rather than null."""

    model_config = ConfigDict(json_schema_extra=_described_as_omitted)

    omit_when_absent: ClassVar[frozenset[str]] = frozenset()

    # **No return annotation, deliberately** (P92). Pydantic reads one as the serialisation
    # schema and replaces the model's own with it, so `-> dict[str, Any]` made every body
    # extending this class document as a bare `{"type": "object", "additionalProperties":
    # true}`. Seven of them did: Attribute, Criterion, Pillar, Run, RunDetail and both
    # comparison bodies -- the four largest payloads this API serves, described nowhere in
    # `openapi.implemented.yaml`, whose entire job is to make the gap between the design and
    # the code countable. Without the annotation Pydantic falls back to the fields, which is
    # the honest description: this serialiser only ever *omits* a null, it never changes a
    # shape. The `noqa` is for the missing annotation, which is the point.
    @model_serializer(mode="wrap")
    def _omit_what_the_design_wants_absent(self, serialise: SerializerFunctionWrapHandler):
        serialised = serialise(self)
        for field in self.omit_when_absent:
            if serialised.get(field) is None:
                serialised.pop(field, None)
        return serialised


def _described_without_null(schema: dict[str, Any], body: type["NullRefusingBody"]) -> None:
    _without_null(schema, body.not_nullable)


class NullRefusingBody(BaseModel):
    """A request body that refuses a null the design never gives, and any field it never declared.

    `not_nullable` names each field the design types without null; a null sent for one is refused
    as a malformed request, naming the field, where it used to be coerced or taken for "left out"
    (BE-23, NEW-61). Leaving the field out keeps its documented meaning. A field nobody declared
    is refused too, rather than dropped: a misspelled field accepted and ignored is a change the
    household asked for and the application discarded.
    """

    model_config = ConfigDict(extra="forbid", json_schema_extra=_described_without_null)

    not_nullable: ClassVar[frozenset[str]] = frozenset()
    null_refused: ClassVar[str] = "Null is not a value this field takes; leave it out instead."

    @field_validator("*", mode="before")
    @classmethod
    def _refuse_a_null_the_design_gives_no_meaning(cls, sent: Any, field: ValidationInfo) -> Any:
        if sent is None and field.field_name in cls.not_nullable:
            raise PydanticCustomError("null_not_allowed", cls.null_refused)
        return sent


class PartialChangeBody(NullRefusingBody):
    """A request body that changes only the fields it carries.

    **Left out means "leave it as it is"; null is a value, and only where the design gives it
    one** -- a band's bound or a threshold, where null clears. `not_nullable` names every other
    field (BE-23). It used to be coerced into something nobody sent: `scale_anchors: null`
    cleared the anchors, `required_value: null` became `false`, and a null weight, flag or switch
    was taken as though the field had been left out.
    """

    null_refused: ClassVar[str] = (
        "Null is not a value this field takes; leave it out to keep what is stored."
    )
