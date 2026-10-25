"""What a citation must be: a page somebody can follow (PL-086, PL-152).

One definition for every page a person or the model writes down -- a typed figure's citations
and a gate answer's pages alike -- so the record never cites a page that is not one.
"""

import re
from typing import Annotated

from pydantic import StringConstraints

WEB_ADDRESS = r"^[Hh][Tt][Tt][Pp][Ss]?://[^\s/?#]+[^\s]*$"
"""A full web address: http or https, a host, no whitespace.

A pattern rather than Pydantic's `HttpUrl`, which rewrites what it accepts -- "https://a.eu"
comes back as "https://a.eu/" -- and a citation is stored exactly as written. Declared on the
bodies so the generated contract carries it, and equal to the design's by test.
"""

WebAddress = Annotated[str, StringConstraints(pattern=WEB_ADDRESS)]

_A_WEB_ADDRESS = re.compile(WEB_ADDRESS)


def is_web_address(page: str) -> bool:
    """Whether `page` is a full web address, by the same rule the bodies refuse with."""
    # `fullmatch`, because Python's `$` also matches before a final newline and Pydantic's does not.
    return _A_WEB_ADDRESS.fullmatch(page) is not None
