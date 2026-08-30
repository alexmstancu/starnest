"""The composition root's view of the environment.

Small, but not ceremonial: the API key must never reach a log, a database row or an error
message (arch.md 7.5), and the easiest way for it to reach all three is a settings object
that renders itself in a traceback.
"""

import pytest
from pydantic import ValidationError

from starnest.main import Environment

A_KEY = "sk-ant-not-a-real-key"
A_URL = "postgresql://user:pw@127.0.0.1:5432/db"


def test_refuses_to_construct_without_a_database_url() -> None:
    """No default. An application that invents a database to connect to is worse than one
    that refuses to start."""
    with pytest.raises(ValidationError):
        Environment(_env_file=None)


def test_the_api_key_is_optional() -> None:
    """The MVP is country-level and uses the LLM for one attribute (reqs.md 6.10), so an
    absent key is a valid configuration rather than a broken one."""
    assert Environment(_env_file=None, database_url=A_URL).anthropic_api_key is None


@pytest.mark.parametrize("render", [repr, str, "{}".format])
def test_rendering_never_discloses_the_api_key_or_the_password(render) -> None:
    environment = Environment(_env_file=None, database_url=A_URL, anthropic_api_key=A_KEY)

    rendered = render(environment)

    assert A_KEY not in rendered
    assert "pw" not in rendered
    assert "redacted" in rendered


def test_binds_to_localhost_by_default() -> None:
    """There is no authentication, ever (reqs.md 10). The default binding IS the security
    model, so a change to it should break a test rather than pass unnoticed."""
    assert Environment(_env_file=None, database_url=A_URL).host == "127.0.0.1"
