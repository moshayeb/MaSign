"""Reads and writes for the contracts and chunks tables."""

from uuid import UUID

import psycopg

from app.database.models import Chunk, Contract


def create_contract(
    connection: psycopg.Connection,
    *,
    filename: str,
    file_type: str,
    size_bytes: int,
    character_count: int,
    chunks: list[str],
) -> Contract:
    """Store a parsed contract together with its chunks in one transaction."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO contracts (filename, file_type, size_bytes, character_count, chunk_count)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING *
                """,
                (filename, file_type, size_bytes, character_count, len(chunks)),
            )
            contract = Contract(**cursor.fetchone())

            if chunks:
                cursor.executemany(
                    """
                    INSERT INTO chunks (contract_id, chunk_index, chunk_text)
                    VALUES (%s, %s, %s)
                    """,
                    [(contract.id, index, text) for index, text in enumerate(chunks)],
                )

    return contract


def get_contract(connection: psycopg.Connection, contract_id: UUID) -> Contract | None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM contracts WHERE id = %s", (contract_id,))
        row = cursor.fetchone()
    return Contract(**row) if row else None


def list_contracts(connection: psycopg.Connection) -> list[Contract]:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM contracts ORDER BY created_at DESC, id")
        return [Contract(**row) for row in cursor.fetchall()]


def list_chunks(connection: psycopg.Connection, contract_id: UUID) -> list[Chunk]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM chunks WHERE contract_id = %s ORDER BY chunk_index",
            (contract_id,),
        )
        return [Chunk(**row) for row in cursor.fetchall()]


def set_embedding_ids(
    connection: psycopg.Connection,
    embedding_ids: dict[UUID, str],
) -> None:
    """Record which vector each chunk was stored under (MAS-11)."""
    if not embedding_ids:
        return
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.executemany(
                "UPDATE chunks SET embedding_id = %s WHERE id = %s",
                [(embedding_id, chunk_id) for chunk_id, embedding_id in embedding_ids.items()],
            )


def delete_contract(connection: psycopg.Connection, contract_id: UUID) -> bool:
    """Remove a contract and, via the FK cascade, its chunks."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM contracts WHERE id = %s", (contract_id,))
            return cursor.rowcount > 0
