"""What a refused rule says about itself, beyond its sentence (PL-026)."""

from collections.abc import Mapping, Sequence


class RuleRefusalError(ValueError):
    """A rule the domain will not accept, naming the fields of the rule it concerns.

    `fields` are the names a criterion's rule is written with -- `target_range_min`,
    `scale_anchors`, `matching_threshold` -- so a form can mark the ones it refused, as it marks
    a field the request boundary refused. **Required, never defaulted**: a refusal that forgot
    its fields would reach the form as a sentence pointing nowhere. `limit` is the bound that
    refused a figure, where one did; `details`, where a refusal gives them, say the rest in
    fields a client can word without parsing the sentence (PL-006).
    """

    def __init__(
        self,
        message: str,
        *,
        fields: Sequence[str],
        limit: int | None = None,
        details: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.fields = tuple(fields)
        self.limit = limit
        self.details = details
