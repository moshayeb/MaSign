"""Reads and writes for the contracts and chunks tables."""

from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from app.database.models import Chunk, Contract, KeyTermRow, RiskFindingRow, RiskReview, VectorIndex
from app.ingestion.document_type import DocumentKind, classify_document


def create_contract(
    connection: psycopg.Connection,
    *,
    filename: str,
    file_type: str,
    size_bytes: int,
    character_count: int,
    chunks: list[str],
    ingestion_notes: list[str] | None = None,
    document_kind: DocumentKind | None = None,
) -> Contract:
    """Store a parsed contract together with its chunks in one transaction."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO contracts (filename, file_type, size_bytes, character_count, chunk_count, ingestion_notes,
                                       document_kind, document_looks_like, document_kind_reasons)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    filename,
                    file_type,
                    size_bytes,
                    character_count,
                    len(chunks),
                    Jsonb(list(ingestion_notes or [])),
                    document_kind.kind if document_kind else None,
                    document_kind.looks_like if document_kind else None,
                    Jsonb(list(document_kind.reasons) if document_kind else []),
                ),
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


def classify_unclassified_contracts(connection: psycopg.Connection) -> int:
    """Give a document kind to every contract stored before MAS-107, from its chunks. Returns how many."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM contracts WHERE document_kind IS NULL")
        ids = [row["id"] for row in cursor.fetchall()]
    for contract_id in ids:
        text = "\n\n".join(chunk.chunk_text for chunk in list_chunks(connection, contract_id))
        kind = classify_document(text)
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE contracts SET document_kind = %s, document_looks_like = %s, document_kind_reasons = %s WHERE id = %s",
                (kind.kind, kind.looks_like, Jsonb(list(kind.reasons)), contract_id),
            )
    connection.commit()
    return len(ids)


def get_contract(connection: psycopg.Connection, contract_id: UUID) -> Contract | None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM contracts WHERE id = %s", (contract_id,))
        row = cursor.fetchone()
    return Contract(**row) if row else None


def list_contract_ids(connection: psycopg.Connection) -> list[UUID]:
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM contracts")
        return [row["id"] for row in cursor.fetchall()]


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


def replace_chunks(connection: psycopg.Connection, contract_id: UUID, texts: list[str]) -> list[Chunk]:
    """Swap chunk rows and invalidate analysis derived from the old rows."""
    with connection.transaction():
        with connection.cursor() as cursor:
            # Findings and key terms point at specific chunk rows. Remove them
            # deliberately before the chunks (their FKs would also cascade),
            # then make the surviving contract-level review honestly retryable.
            cursor.execute("DELETE FROM risk_findings WHERE contract_id = %s", (contract_id,))
            cursor.execute("DELETE FROM key_terms WHERE contract_id = %s", (contract_id,))
            cursor.execute("DELETE FROM chunks WHERE contract_id = %s", (contract_id,))
            cursor.executemany(
                "INSERT INTO chunks (contract_id, chunk_index, chunk_text) VALUES (%s, %s, %s)",
                [(contract_id, index, text) for index, text in enumerate(texts)],
            )
            cursor.execute("UPDATE contracts SET chunk_count = %s WHERE id = %s", (len(texts), contract_id))
            cursor.execute(
                """
                UPDATE risk_reviews SET
                    status = 'failed', chunks_total = %s, chunks_checked = 0,
                    chunks_withheld = 0, complete = FALSE, key_terms_complete = FALSE,
                    unreadable_chunks = '[]'::jsonb, withheld_chunks = '[]'::jsonb,
                    redacted_chunks = '[]'::jsonb,
                    error = 'Contract passages changed. Run the review again.',
                    updated_at = now()
                WHERE contract_id = %s
                """,
                (len(texts), contract_id),
            )
    return list_chunks(connection, contract_id)


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


def get_vector_index(connection: psycopg.Connection, collection: str) -> VectorIndex | None:
    """What the collection was last built with, or None if never recorded (MAS-52)."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT collection, backend, model_name, dimension, max_tokens, prompt_format "
            "FROM vector_index WHERE collection = %s",
            (collection,),
        )
        row = cursor.fetchone()
    return VectorIndex(**row) if row else None


def clear_vector_index(connection: psycopg.Connection, collection: str) -> None:
    """Forget what the collection was built with, so the next start rebuilds it (MAS-56)."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM vector_index WHERE collection = %s", (collection,))


def set_vector_index(connection: psycopg.Connection, index: VectorIndex) -> None:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO vector_index (collection, backend, model_name, dimension, max_tokens, prompt_format)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (collection) DO UPDATE SET
                    backend = EXCLUDED.backend,
                    model_name = EXCLUDED.model_name,
                    dimension = EXCLUDED.dimension,
                    max_tokens = EXCLUDED.max_tokens,
                    prompt_format = EXCLUDED.prompt_format,
                    created_at = now()
                """,
                (
                    index.collection, index.backend, index.model_name,
                    index.dimension, index.max_tokens, index.prompt_format,
                ),
            )


# --- risk reviews (MAS-81) ------------------------------------------------------


def start_risk_review(connection: psycopg.Connection, contract_id: UUID, *, status: str = "pending") -> RiskReview:
    """Create or reset the contract's review row; the runner fills it in."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO risk_reviews (contract_id, status)
                VALUES (%s, %s)
                ON CONFLICT (contract_id) DO UPDATE SET
                    status = EXCLUDED.status, error = NULL, chunks_checked = 0,
                    chunks_withheld = 0, complete = FALSE, key_terms_complete = FALSE,
                    unreadable_chunks = '[]'::jsonb, withheld_chunks = '[]'::jsonb, redacted_chunks = '[]'::jsonb, updated_at = now()
                RETURNING *
                """,
                (contract_id, status),
            )
            return RiskReview(**cursor.fetchone())


def claim_risk_review(connection: psycopg.Connection, contract_id: UUID) -> RiskReview | None:
    """Atomically claim the right to start a review, or return None if active."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO risk_reviews (contract_id, status)
                VALUES (%s, 'pending')
                ON CONFLICT (contract_id) DO UPDATE SET
                    status = 'pending', error = NULL, chunks_checked = 0,
                    chunks_withheld = 0, complete = FALSE, key_terms_complete = FALSE,
                    unreadable_chunks = '[]'::jsonb, withheld_chunks = '[]'::jsonb,
                    redacted_chunks = '[]'::jsonb, updated_at = now()
                WHERE risk_reviews.status NOT IN ('pending', 'running')
                RETURNING *
                """,
                (contract_id,),
            )
            row = cursor.fetchone()
    return RiskReview(**row) if row else None


def update_risk_review(
    connection: psycopg.Connection,
    contract_id: UUID,
    *,
    status: str,
    model: str | None = None,
    chunks_total: int | None = None,
    chunks_checked: int | None = None,
    chunks_withheld: int | None = None,
    complete: bool | None = None,
    key_terms_complete: bool | None = None,
    unreadable_chunks: list[int] | None = None,
    withheld_chunks: list[int] | None = None,
    redacted_chunks: list[int] | None = None,
    error: str | None = None,
) -> RiskReview:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE risk_reviews SET
                    status = %s,
                    model = COALESCE(%s, model),
                    chunks_total = COALESCE(%s, chunks_total),
                    chunks_checked = COALESCE(%s, chunks_checked),
                    chunks_withheld = COALESCE(%s, chunks_withheld),
                    complete = COALESCE(%s, complete),
                    key_terms_complete = COALESCE(%s, key_terms_complete),
                    unreadable_chunks = COALESCE(%s, unreadable_chunks),
                    withheld_chunks = COALESCE(%s, withheld_chunks),
                    redacted_chunks = COALESCE(%s, redacted_chunks),
                    error = %s,
                    updated_at = now()
                WHERE contract_id = %s
                RETURNING *
                """,
                (
                    status, model, chunks_total, chunks_checked, chunks_withheld, complete, key_terms_complete,
                    Jsonb(unreadable_chunks) if unreadable_chunks is not None else None,
                    Jsonb(withheld_chunks) if withheld_chunks is not None else None,
                    Jsonb(redacted_chunks) if redacted_chunks is not None else None,
                    error, contract_id,
                ),
            )
            row = cursor.fetchone()
    if row is None:
        raise LookupError(f"No risk review for contract {contract_id}")
    return RiskReview(**row)


def get_risk_review(connection: psycopg.Connection, contract_id: UUID) -> RiskReview | None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM risk_reviews WHERE contract_id = %s", (contract_id,))
        row = cursor.fetchone()
    return RiskReview(**row) if row else None


def fail_interrupted_risk_reviews(connection: psycopg.Connection) -> int:
    """Make reviews left active by a previous server process retryable."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE risk_reviews SET
                    status = 'failed', complete = FALSE,
                    error = 'Review interrupted by a server restart. Run it again.',
                    updated_at = now()
                WHERE status IN ('pending', 'running')
                """
            )
            return cursor.rowcount


def replace_risk_findings(
    connection: psycopg.Connection,
    contract_id: UUID,
    findings: list[tuple[UUID, str, str, str, str]],
) -> None:
    """Swap the contract's stored findings for `(chunk_id, category, severity, reason, quote)` rows."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM risk_findings WHERE contract_id = %s", (contract_id,))
            cursor.executemany(
                """
                INSERT INTO risk_findings (contract_id, chunk_id, category, severity, reason, quote)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (chunk_id, category) DO NOTHING
                """,
                [(contract_id, *finding) for finding in findings],
            )


def list_risk_findings(connection: psycopg.Connection, contract_id: UUID) -> list[RiskFindingRow]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT f.* FROM risk_findings f JOIN chunks c ON c.id = f.chunk_id
            WHERE f.contract_id = %s ORDER BY c.chunk_index, f.category
            """,
            (contract_id,),
        )
        return [RiskFindingRow(**row) for row in cursor.fetchall()]


def replace_key_terms(
    connection: psycopg.Connection,
    contract_id: UUID,
    terms: list[tuple[UUID, str, str, str, dict | None]],
) -> None:
    """Swap the contract's stored key terms for `(chunk_id, term, value, quote, typed)` rows."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM key_terms WHERE contract_id = %s", (contract_id,))
            cursor.executemany(
                """
                INSERT INTO key_terms (contract_id, chunk_id, term, value, quote, typed)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (chunk_id, term) DO NOTHING
                """,
                [(contract_id, chunk_id, term, value, quote, Jsonb(typed) if typed is not None else None)
                 for chunk_id, term, value, quote, typed in terms],
            )


def list_key_terms(connection: psycopg.Connection, contract_id: UUID) -> list[KeyTermRow]:
    """Stored key terms in passage order, so the first row per term is the earliest statement."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT k.* FROM key_terms k JOIN chunks c ON c.id = k.chunk_id
            WHERE k.contract_id = %s ORDER BY c.chunk_index, k.term
            """,
            (contract_id,),
        )
        return [KeyTermRow(**row) for row in cursor.fetchall()]


def list_risk_summaries(connection: psycopg.Connection) -> dict[UUID, tuple[str, str | None]]:
    """Per contract: review status and the worst severity found, for the contract list."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT r.contract_id, r.status,
                   (SELECT severity FROM risk_findings f WHERE f.contract_id = r.contract_id
                    ORDER BY CASE severity WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 ELSE 1 END DESC LIMIT 1) AS worst
            FROM risk_reviews r
            """
        )
        return {row["contract_id"]: (row["status"], row["worst"]) for row in cursor.fetchall()}
