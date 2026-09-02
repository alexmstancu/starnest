"""Getting a connection out of the pool, decoding rows the way this module expects.

The pool itself is opened by the composition root and passed in (`arch.md` 6.8): nothing here
reads the environment, names a database or decides how many connections there should be. What
this file owns is the two decoding decisions every store depends on, applied in one place so
that no store can forget one.

**A connection block is a transaction.** `pool.connection()` commits when the block exits
normally and rolls back when it raises, so "each item is its own transaction" (`arch.md` 7.1)
is written as one `async with` per item rather than as explicit BEGIN and COMMIT.
"""

import functools
import json
import weakref
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal

from psycopg import AsyncConnection
from psycopg.rows import namedtuple_row
from psycopg.types.json import set_json_loads
from psycopg_pool import AsyncConnectionPool

_parse_json_keeping_decimals = functools.partial(json.loads, parse_float=Decimal)
"""Read every JSON number as a `Decimal`, never as a float.

The typed payload of a value arrives as a jsonb object (`storage/queries/values.sql`), and
`amount`, `amount_eur` and `fx_rate` are inside it. `json.loads` would hand them back as
binary floats, and money that has been through a float is money that no longer adds up --
which is the failure this application is least entitled to, since the figure and the rate that
produced it are stored precisely so a reader can reproduce the conversion (`reqs.md` 5.5).
"""

_connections_already_configured: weakref.WeakSet[AsyncConnection] = weakref.WeakSet()
"""Which pooled connections have had the decimal-preserving JSON loader registered.

Registering builds four loader classes, and a pool hands the same handful of connections back
over and over, so doing it once per connection rather than once per acquisition is the
difference between four classes and four per query. Weak, so a connection the pool discards is
not kept alive by this set.
"""


@asynccontextmanager
async def acquire(pool: AsyncConnectionPool) -> AsyncIterator[AsyncConnection]:
    """One connection, configured, for the duration of one transaction."""
    async with pool.connection() as connection:
        connection.row_factory = namedtuple_row
        if connection not in _connections_already_configured:
            set_json_loads(_parse_json_keeping_decimals, connection)
            _connections_already_configured.add(connection)
        yield connection
