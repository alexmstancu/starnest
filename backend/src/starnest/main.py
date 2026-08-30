"""The composition root.

The one place in the system that knows concrete types, and the one place that reads the
environment (arch.md 6.8, 7.5). Nothing else names a database driver, an HTTP client or an
API key.

Two kinds of configuration are kept apart, deliberately:

    technical  -- how to reach things: connection string, API key, port, log level.
                  Environment variables, read here, never in git.

    domain     -- attributes, weights, thresholds, sources.
                  Rows in the database, shipped as migrations (arch.md 1.2).

Confusing the two is how "nothing hardcoded" quietly stops being true.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(BaseSettings):
    """Technical configuration, read from the environment exactly once.

    Values come from real environment variables, or from a `.env` file in development.
    `.env` is never committed; `.env.example` documents the shape with placeholder values.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # No env_prefix. The product name must not appear in an environment-variable
        # prefix (CLAUDE.md); these names describe what they configure, not what ships.
    )

    database_url: str = Field(
        description="PostgreSQL connection string. Never contains a default -- an "
        "application that invents a database to connect to is worse than one that refuses."
    )
    anthropic_api_key: str | None = Field(
        default=None,
        description="Only needed for the LLM acquisition path (reqs.md 6.10). Absent is "
        "valid: the MVP is country-level and uses it for one attribute.",
    )
    port: int = 8000
    host: str = Field(
        default="127.0.0.1",
        description="There is no authentication, ever (reqs.md 10). Binding to localhost "
        "IS the security model, so it is stated rather than assumed. In a container this "
        "becomes 0.0.0.0, and the published port is what stays bound to localhost.",
    )
    log_level: str = "INFO"

    app_display_name: str = Field(
        default="Starnest",
        description="The only place the product name is a value in this system, and it is a "
        "value rather than an identifier. Used for the page title, headings and About text. "
        "Renaming the product is a change to this one string.",
    )

    def __repr__(self) -> str:
        """Never render the API key. This object reaches logs and tracebacks."""
        return f"Environment(database_url=<redacted>, port={self.port}, host={self.host!r})"

    __str__ = __repr__


def run() -> None:
    """Build every concrete type, wire it, and serve.

    Implemented in P3 (devplan.md). The startup sequence it must follow is arch.md 9.2:
    read the environment, refuse to start if the schema version is behind, validate every
    adapter declaration against the catalog, sweep abandoned runs, then serve.
    """
    raise NotImplementedError("The composition root is built in P3 (devplan.md).")
