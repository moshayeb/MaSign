import os
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


def get_database_url() -> str:
    return os.getenv(
        "DATABASE_URL",
        "postgresql://rag_user:rag_password@localhost:5433/contract_rag",
    )


@contextmanager
def get_connection(database_url: str | None = None) -> Iterator[psycopg.Connection]:
    """Open a connection that commits on success and rolls back on error.

    Rows come back as dicts so the repository can build models by column name
    rather than by position.
    """
    with psycopg.connect(database_url or get_database_url(), row_factory=dict_row) as connection:
        yield connection
