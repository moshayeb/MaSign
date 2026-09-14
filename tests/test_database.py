"""Schema, migration runner, and repository behaviour.

Unit tests need nothing. Tests taking `db` run against the throwaway test
database from conftest (skipped locally without Postgres, required in CI).
"""

from pathlib import Path

import psycopg

from app.database import repository
from app.database.migrations import MIGRATIONS_DIR, discover_migrations, run_migrations


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


def test_migrations_are_idempotent(database: str) -> None:
    # Everything was applied by the fixture; a second run must be a no-op.
    assert run_migrations(database) == []


def test_schema_has_expected_columns(db: psycopg.Connection) -> None:
    rows = db.execute(
        """
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_name IN ('contracts', 'chunks')
        """
    ).fetchall()
    columns = {(row["table_name"], row["column_name"]) for row in rows}

    for name in ("id", "filename", "file_type", "size_bytes", "character_count", "chunk_count", "status", "created_at"):
        assert ("contracts", name) in columns
    for name in ("id", "contract_id", "chunk_index", "chunk_text", "embedding_id", "created_at"):
        assert ("chunks", name) in columns


def _store(db: psycopg.Connection, chunks: list[str]):
    return repository.create_contract(
        db,
        filename="acme.txt",
        file_type="txt",
        size_bytes=123,
        character_count=100,
        chunks=chunks,
    )


def test_create_contract_stores_chunks_in_order(db: psycopg.Connection) -> None:
    contract = _store(db, ["first clause", "second clause", "third clause"])

    assert contract.chunk_count == 3
    assert contract.status == "processed"
    assert repository.get_contract(db, contract.id) == contract

    chunks = repository.list_chunks(db, contract.id)
    assert [c.chunk_index for c in chunks] == [0, 1, 2]
    assert [c.chunk_text for c in chunks] == ["first clause", "second clause", "third clause"]
    assert all(c.embedding_id is None for c in chunks)
    assert contract.id in {c.id for c in repository.list_contracts(db)}


def test_set_embedding_ids_updates_only_given_chunks(db: psycopg.Connection) -> None:
    contract = _store(db, ["a", "b"])
    first, _ = repository.list_chunks(db, contract.id)

    repository.set_embedding_ids(db, {first.id: "vec-1"})

    first, second = repository.list_chunks(db, contract.id)
    assert first.embedding_id == "vec-1"
    assert second.embedding_id is None


def test_deleting_contract_cascades_to_chunks(db: psycopg.Connection) -> None:
    contract = _store(db, ["a", "b"])

    assert repository.delete_contract(db, contract.id) is True
    assert repository.get_contract(db, contract.id) is None
    assert repository.list_chunks(db, contract.id) == []
    assert repository.delete_contract(db, contract.id) is False
