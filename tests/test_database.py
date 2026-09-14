"""Schema, migration runner, and repository behaviour.

Unit tests need nothing. Integration tests need a reachable Postgres at
DATABASE_URL; they skip when it's absent, unless MASIGN_REQUIRE_DB=1 (set in
CI) turns that skip into a failure.
"""

import os
from pathlib import Path

import psycopg
import pytest

from app.database import repository
from app.database.migrations import MIGRATIONS_DIR, discover_migrations, run_migrations
from app.database.session import get_connection, get_database_url


# --- unit ------------------------------------------------------------------


def test_initial_migration_is_first() -> None:
    versions = [path.stem for path in discover_migrations()]
    assert versions[0] == "001_initial"


def test_migrations_apply_in_filename_order(tmp_path: Path) -> None:
    (tmp_path / "010_later.sql").write_text("select 1;")
    (tmp_path / "002_second.sql").write_text("select 1;")
    (tmp_path / "001_first.sql").write_text("select 1;")
    (tmp_path / "notes.txt").write_text("ignored")

    assert [p.name for p in discover_migrations(tmp_path)] == [
        "001_first.sql",
        "002_second.sql",
        "010_later.sql",
    ]


def test_initial_migration_creates_expected_tables() -> None:
    sql = (MIGRATIONS_DIR / "001_initial.sql").read_text()
    for table in ("contracts", "chunks"):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in sql
    assert "REFERENCES contracts (id) ON DELETE CASCADE" in sql


# --- integration -----------------------------------------------------------


@pytest.fixture(scope="module")
def database_url() -> str:
    url = get_database_url()
    try:
        with psycopg.connect(url, connect_timeout=3):
            pass
    except psycopg.OperationalError as error:
        if os.getenv("MASIGN_REQUIRE_DB") == "1":
            raise
        pytest.skip(f"Postgres not reachable at {url}: {error}")
    run_migrations(url)
    return url


@pytest.fixture
def connection(database_url: str):
    with get_connection(database_url) as conn:
        yield conn


def test_migrations_are_idempotent(database_url: str) -> None:
    # Everything was applied by the fixture; a second run must be a no-op.
    assert run_migrations(database_url) == []


def test_schema_has_expected_columns(connection: psycopg.Connection) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_name IN ('contracts', 'chunks')
            """
        )
        columns = {(row["table_name"], row["column_name"]) for row in cursor.fetchall()}

    for name in ("id", "filename", "file_type", "size_bytes", "character_count", "chunk_count", "status", "created_at"):
        assert ("contracts", name) in columns
    for name in ("id", "contract_id", "chunk_index", "chunk_text", "embedding_id", "created_at"):
        assert ("chunks", name) in columns


def test_create_contract_stores_chunks_in_order(connection: psycopg.Connection) -> None:
    contract = repository.create_contract(
        connection,
        filename="acme.txt",
        file_type="txt",
        size_bytes=123,
        character_count=100,
        chunks=["first clause", "second clause", "third clause"],
    )
    try:
        assert contract.chunk_count == 3
        assert contract.status == "processed"

        fetched = repository.get_contract(connection, contract.id)
        assert fetched == contract

        chunks = repository.list_chunks(connection, contract.id)
        assert [c.chunk_index for c in chunks] == [0, 1, 2]
        assert [c.chunk_text for c in chunks] == ["first clause", "second clause", "third clause"]
        assert all(c.embedding_id is None for c in chunks)
        assert contract.id in {c.id for c in repository.list_contracts(connection)}
    finally:
        repository.delete_contract(connection, contract.id)


def test_set_embedding_ids_updates_only_given_chunks(connection: psycopg.Connection) -> None:
    contract = repository.create_contract(
        connection,
        filename="acme.txt",
        file_type="txt",
        size_bytes=1,
        character_count=1,
        chunks=["a", "b"],
    )
    try:
        first, second = repository.list_chunks(connection, contract.id)
        repository.set_embedding_ids(connection, {first.id: "vec-1"})

        first, second = repository.list_chunks(connection, contract.id)
        assert first.embedding_id == "vec-1"
        assert second.embedding_id is None
    finally:
        repository.delete_contract(connection, contract.id)


def test_deleting_contract_cascades_to_chunks(connection: psycopg.Connection) -> None:
    contract = repository.create_contract(
        connection,
        filename="acme.txt",
        file_type="txt",
        size_bytes=1,
        character_count=1,
        chunks=["a", "b"],
    )

    assert repository.delete_contract(connection, contract.id) is True
    assert repository.get_contract(connection, contract.id) is None
    assert repository.list_chunks(connection, contract.id) == []
    assert repository.delete_contract(connection, contract.id) is False
