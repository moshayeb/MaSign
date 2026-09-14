from collections.abc import Iterator

import psycopg

from app.database.session import get_connection


def get_db() -> Iterator[psycopg.Connection]:
    """One connection per request, committed when the handler returns."""
    with get_connection() as connection:
        yield connection
