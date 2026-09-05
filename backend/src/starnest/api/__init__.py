"""The REST surface. **This is the presenter** (`arch.md` 6.1).

Use cases return domain objects; this module turns them into the shapes `openapi.yaml`
describes, and turns domain faults into status codes. No rule about scoring, weighting or
matching lives here -- if a calculation appears in this package, it is in the wrong package.

**Four endpoints of the contract's forty** (`docs/mine2e.md` M3): settings, one criteria set,
the weight change, and the ranking. Each matches `openapi.yaml` exactly, because a divergence
here would be a bug in the slice rather than a shortcut through it.
"""

from starnest.api.app import API_PREFIX, build_app
from starnest.api.errors import ErrorBody, refusal_for

__all__ = ["API_PREFIX", "ErrorBody", "build_app", "refusal_for"]
