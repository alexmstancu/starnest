"""Publishers whose figures exist as a table on a page and nowhere else.

Each file in `tables/` is one publisher's table for one attribute, transcribed by hand with the
page every figure came from (`table.py` has the format and the reasons). The composition root
builds one adapter per file, so adding a transcription is adding a file -- and the startup check
still refuses a table that names an attribute the catalog does not have.
"""

from pathlib import Path

from starnest.data_sources.published_tables.adapter import PublishedTableAdapter
from starnest.data_sources.published_tables.table import (
    PublishedTable,
    Row,
    TranscriptionError,
    read_table,
)

TABLES = Path(__file__).parent / "tables"
"""Where the transcriptions live. Inside the package, so they ship with it into the container."""


def every_published_table(directory: Path = TABLES) -> tuple[PublishedTable, ...]:
    """Every transcription, in a stable order, or `TranscriptionError` for the first bad one.

    Read at boot rather than per run, so a slip in a file stops the application from starting
    with the file and line named -- the same stance the startup sequence takes on the schema.
    """
    return tuple(read_table(path) for path in sorted(directory.glob("*.csv")))


__all__ = [
    "TABLES",
    "PublishedTable",
    "PublishedTableAdapter",
    "Row",
    "TranscriptionError",
    "every_published_table",
    "read_table",
]
