"""Reads and writes for the contracts and chunks tables."""

from collections.abc import Sequence
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from app.database.models import AuditEvent, CoveragePassage, Chunk, Contract, ContractLink, KeyTermRow, Question, RiskFindingRow, RiskReview, RiskSummary, User, VectorIndex, Workspace
from app.ingestion.document_type import DocumentKind, classify_document

# The single legacy workspace every contract that existed before MAS-143
# backfills into (migration 014) -- fixed and deterministic, never inferred.
LEGACY_WORKSPACE_ID = UUID("00000000-0000-0000-0000-000000000001")


def create_contract(
    connection: psycopg.Connection,
    *,
    workspace_id: UUID,
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
                INSERT INTO contracts (workspace_id, filename, file_type, size_bytes, character_count, chunk_count, ingestion_notes,
                                       document_kind, document_looks_like, document_kind_reasons)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    workspace_id,
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


def get_contract(connection: psycopg.Connection, contract_id: UUID, workspace_id: UUID) -> Contract | None:
    """A contract in another workspace is indistinguishable from a missing
    one (MAS-143): the caller gets None either way, never a 403 that would
    confirm the id exists. Every HTTP route must use this, not
    `get_contract_by_id` below."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM contracts WHERE id = %s AND workspace_id = %s", (contract_id, workspace_id))
        row = cursor.fetchone()
    return Contract(**row) if row else None


def get_contract_by_id(connection: psycopg.Connection, contract_id: UUID) -> Contract | None:
    """Unscoped lookup for trusted internal callers only (MAS-143) -- the
    background review job, which already has a contract_id it validated when
    the review was requested and has no request/workspace context of its own
    to scope with. Never call this from an HTTP route."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM contracts WHERE id = %s", (contract_id,))
        row = cursor.fetchone()
    return Contract(**row) if row else None


def list_contract_ids(connection: psycopg.Connection, workspace_id: UUID) -> list[UUID]:
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM contracts WHERE workspace_id = %s", (workspace_id,))
        return [row["id"] for row in cursor.fetchall()]


def list_contracts(connection: psycopg.Connection, workspace_id: UUID) -> list[Contract]:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM contracts WHERE workspace_id = %s ORDER BY created_at DESC, id", (workspace_id,))
        return [Contract(**row) for row in cursor.fetchall()]


def list_all_contracts(connection: psycopg.Connection) -> list[Contract]:
    """Unscoped, for trusted internal callers only (MAS-143) -- the startup
    vector-index rebuild, which by design covers every workspace at once.
    Never call this from an HTTP route."""
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


def add_indexed_profile(connection: psycopg.Connection, contract_id: UUID, profile: str) -> None:
    """Record that `profile` has been successfully indexed for this contract (MAS-62).

    Idempotent (array_append is skipped if already present); called after
    indexing actually succeeds, never speculatively before it.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE contracts
            SET indexed_profiles = array_append(indexed_profiles, %s)
            WHERE id = %s AND NOT (%s = ANY(indexed_profiles))
            """,
            (profile, contract_id, profile),
        )


def delete_contract(connection: psycopg.Connection, contract_id: UUID) -> bool:
    """Remove a contract and, via the FK cascade, its chunks and contract_links rows."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM contracts WHERE id = %s", (contract_id,))
            return cursor.rowcount > 0


def create_link(
    connection: psycopg.Connection, *, primary_contract_id: UUID, linked_contract_id: UUID, reference_name: str
) -> ContractLink:
    """Record that `linked_contract_id` resolves `reference_name` on `primary_contract_id` (MAS-137).

    Always called from an explicit, user-confirmed action (app/api/routes.py)
    -- never inferred from filename or content.
    """
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO contract_links (primary_contract_id, linked_contract_id, reference_name)
                VALUES (%s, %s, %s)
                RETURNING *
                """,
                (primary_contract_id, linked_contract_id, reference_name),
            )
            row = cursor.fetchone()
            _invalidate_bundle_review(cursor, primary_contract_id)
    return ContractLink(**row)


def list_links(connection: psycopg.Connection, primary_contract_id: UUID) -> list[ContractLink]:
    """Every link where `primary_contract_id` is the contract with the gap (MAS-137)."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM contract_links WHERE primary_contract_id = %s ORDER BY created_at",
            (primary_contract_id,),
        )
        return [ContractLink(**row) for row in cursor.fetchall()]


def bundle_contract_ids(connection: psycopg.Connection, primary_contract_id: UUID) -> list[UUID]:
    """The primary contract plus every contract linked to it (MAS-137), primary first."""
    return [primary_contract_id] + [link.linked_contract_id for link in list_links(connection, primary_contract_id)]


def delete_link(connection: psycopg.Connection, link_id: UUID) -> ContractLink | None:
    """Remove a link and invalidate the primary's existing review (MAS-137).

    A review that ran over the linked document's passages must never keep
    silently claiming that coverage once the link is gone -- the same
    honesty rule `replace_chunks` already enforces when a contract's own
    chunks change.
    """
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM contract_links WHERE id = %s RETURNING *", (link_id,))
            row = cursor.fetchone()
            if row is None:
                return None
            link = ContractLink(**row)
            _invalidate_bundle_review(cursor, link.primary_contract_id)
    return link


def _invalidate_bundle_review(cursor: psycopg.Cursor, primary_contract_id: UUID) -> None:
    """Remove results derived from a bundle whose membership just changed."""
    cursor.execute("DELETE FROM risk_findings WHERE contract_id = %s", (primary_contract_id,))
    cursor.execute("DELETE FROM key_terms WHERE contract_id = %s", (primary_contract_id,))
    cursor.execute(
        """
        UPDATE risk_reviews SET
            status = 'failed',
            chunks_total = (
                SELECT COUNT(*) FROM chunks
                WHERE contract_id = %s
                   OR contract_id IN (
                       SELECT linked_contract_id FROM contract_links WHERE primary_contract_id = %s
                   )
            ),
            chunks_checked = 0, chunks_withheld = 0,
            complete = FALSE, key_terms_complete = FALSE,
            unreadable_chunks = '[]'::jsonb, withheld_chunks = '[]'::jsonb,
            redacted_chunks = '[]'::jsonb,
            error = 'Linked documents changed. Run the review again.', updated_at = now()
        WHERE contract_id = %s
        """,
        (primary_contract_id, primary_contract_id, primary_contract_id),
    )


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


def _coverage_passages(values: list[object], primary_contract_id: UUID) -> list[CoveragePassage]:
    """Read both MAS-139 locations and older integer-only coverage rows."""
    result: list[CoveragePassage] = []
    for value in values:
        if isinstance(value, int):
            result.append(CoveragePassage(contract_id=primary_contract_id, chunk_index=value))
        elif isinstance(value, dict) and isinstance(value.get("chunk_index"), int):
            try:
                result.append(CoveragePassage(contract_id=UUID(str(value["contract_id"])), chunk_index=value["chunk_index"]))
            except (KeyError, TypeError, ValueError):
                continue
    return result


def _risk_review(row: dict) -> RiskReview:
    """Normalise JSONB coverage locations when a review row leaves Postgres."""
    row = dict(row)
    primary = row["contract_id"]
    for name in ("unreadable_chunks", "withheld_chunks", "redacted_chunks"):
        row[name] = _coverage_passages(row.get(name) or [], primary)
    return RiskReview(**row)


def _coverage_json(passages: list[CoveragePassage]) -> list[dict[str, object]]:
    return [{"contract_id": str(p.contract_id), "chunk_index": p.chunk_index} for p in passages]


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
            return _risk_review(cursor.fetchone())


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
    return _risk_review(row) if row else None


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
    unreadable_chunks: list[CoveragePassage] | None = None,
    withheld_chunks: list[CoveragePassage] | None = None,
    redacted_chunks: list[CoveragePassage] | None = None,
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
                    Jsonb(_coverage_json(unreadable_chunks)) if unreadable_chunks is not None else None,
                    Jsonb(_coverage_json(withheld_chunks)) if withheld_chunks is not None else None,
                    Jsonb(_coverage_json(redacted_chunks)) if redacted_chunks is not None else None,
                    error, contract_id,
                ),
            )
            row = cursor.fetchone()
    if row is None:
        raise LookupError(f"No risk review for contract {contract_id}")
    return _risk_review(row)


def get_risk_review(connection: psycopg.Connection, contract_id: UUID) -> RiskReview | None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM risk_reviews WHERE contract_id = %s", (contract_id,))
        row = cursor.fetchone()
    return _risk_review(row) if row else None


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
    """Swap the contract's stored findings for `(chunk_id, category, severity, reason, quote)` rows.

    `chunk_id` may belong to a linked document's own chunks when this is a
    bundle review (MAS-138) -- the finding is still recorded under this
    contract_id, the review that found it; a solo review of the linked
    document later stores its own row for the same chunk independently
    (contract_id, chunk_id, category) is the uniqueness, not chunk_id alone.
    """
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM risk_findings WHERE contract_id = %s", (contract_id,))
            cursor.executemany(
                """
                INSERT INTO risk_findings (contract_id, chunk_id, category, severity, reason, quote)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (contract_id, chunk_id, category) DO NOTHING
                """,
                [(contract_id, *finding) for finding in findings],
            )


def list_risk_findings(connection: psycopg.Connection, contract_id: UUID) -> list[RiskFindingRow]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT f.*, c.contract_id AS source_contract_id FROM risk_findings f JOIN chunks c ON c.id = f.chunk_id
            WHERE f.contract_id = %s
            ORDER BY (c.contract_id <> f.contract_id), c.contract_id, c.chunk_index, f.category
            """,
            (contract_id,),
        )
        return [RiskFindingRow(**row) for row in cursor.fetchall()]


def replace_key_terms(
    connection: psycopg.Connection,
    contract_id: UUID,
    terms: list[tuple[UUID, str, str, str, dict | None]],
) -> None:
    """Swap the contract's stored key terms for `(chunk_id, term, value, quote, typed)` rows.

    `chunk_id` may belong to a linked document's own chunks when this is a
    bundle review (MAS-138); see `replace_risk_findings` for why the
    uniqueness is `(contract_id, chunk_id, term)`, not `chunk_id` alone.
    """
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM key_terms WHERE contract_id = %s", (contract_id,))
            cursor.executemany(
                """
                INSERT INTO key_terms (contract_id, chunk_id, term, value, quote, typed)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (contract_id, chunk_id, term) DO NOTHING
                """,
                [(contract_id, chunk_id, term, value, quote, Jsonb(typed) if typed is not None else None)
                 for chunk_id, term, value, quote, typed in terms],
            )


def list_key_terms(connection: psycopg.Connection, contract_id: UUID) -> list[KeyTermRow]:
    """Stored key terms, earliest statement first per term.

    "Earliest" means the primary document's own passages first (in passage
    order), then a linked document's (MAS-138) -- two documents can both have
    a chunk_index 0, so document identity, not just chunk_index, decides.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT k.*, c.contract_id AS source_contract_id FROM key_terms k JOIN chunks c ON c.id = k.chunk_id
            WHERE k.contract_id = %s
            ORDER BY (c.contract_id <> k.contract_id), c.contract_id, c.chunk_index, k.term
            """,
            (contract_id,),
        )
        return [KeyTermRow(**row) for row in cursor.fetchall()]


def list_risk_summaries(connection: psycopg.Connection) -> dict[UUID, RiskSummary]:
    """Review status, severity and coverage for each contract list row."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT r.contract_id, r.status, r.complete, r.chunks_checked, r.chunks_total, r.key_terms_complete,
                   (SELECT severity FROM risk_findings f WHERE f.contract_id = r.contract_id
                    ORDER BY CASE severity WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 ELSE 1 END DESC LIMIT 1) AS worst,
                   (SELECT COUNT(*) FROM risk_findings f WHERE f.contract_id = r.contract_id AND f.severity = 'High') AS high_findings
            FROM risk_reviews r
            """
        )
        return {
            row["contract_id"]: RiskSummary(
                status=row["status"],
                worst_severity=row["worst"],
                complete=row["complete"],
                chunks_checked=row["chunks_checked"],
                chunks_total=row["chunks_total"],
                key_terms_complete=row["key_terms_complete"],
                high_findings=row["high_findings"],
            )
            for row in cursor.fetchall()
        }


def list_key_terms_for(connection: psycopg.Connection, term_ids: Sequence[str]) -> dict[UUID, dict[str, KeyTermRow]]:
    """Earliest stored value per contract for the given terms (MAS-101): one query, not N+1.

    Used for the contract-list summary strip, which only needs a handful of
    terms per contract — not the full `list_key_terms` read a single contract
    page uses.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT DISTINCT ON (k.contract_id, k.term) k.*, c.contract_id AS source_contract_id
            FROM key_terms k JOIN chunks c ON c.id = k.chunk_id
            WHERE k.term = ANY(%s)
            ORDER BY k.contract_id, k.term, c.chunk_index
            """,
            (list(term_ids),),
        )
        result: dict[UUID, dict[str, KeyTermRow]] = {}
        for row in cursor.fetchall():
            term_row = KeyTermRow(**row)
            result.setdefault(term_row.contract_id, {})[term_row.term] = term_row
        return result


def create_question(
    connection: psycopg.Connection,
    *,
    workspace_id: UUID,
    contract_id: UUID | None,
    question: str,
    answer: str,
    answer_status: str,
    grounded: bool,
    model: str | None,
    response: dict,
) -> Question:
    """Store a successful answer (MAS-102) -- never called for a refused one."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO questions (workspace_id, contract_id, question, answer, answer_status, grounded, model, response)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (workspace_id, contract_id, question, answer, answer_status, grounded, model, Jsonb(response)),
        )
        row = cursor.fetchone()
    return Question(**row)


def list_questions(connection: psycopg.Connection, contract_id: UUID, workspace_id: UUID) -> list[Question]:
    """Questions stored for `contract_id`, plus any all-contracts question that cited it (MAS-102).

    `workspace_id` scopes both halves of the OR (MAS-143): a no-scope
    question asked in another workspace must never surface here even if it
    happened to cite the same contract_id (which cannot exist cross-workspace
    today, but the filter is explicit rather than relying on that)."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT * FROM questions
            WHERE workspace_id = %s
              AND (
                contract_id = %s
                OR (
                    contract_id IS NULL
                    AND EXISTS (
                        SELECT 1 FROM jsonb_array_elements(response -> 'citations') AS citation
                        WHERE (citation ->> 'contract_id')::uuid = %s
                    )
                )
              )
            ORDER BY created_at DESC
            """,
            (workspace_id, contract_id, contract_id),
        )
        return [Question(**row) for row in cursor.fetchall()]


def delete_question(connection: psycopg.Connection, question_id: UUID, workspace_id: UUID) -> bool:
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM questions WHERE id = %s AND workspace_id = %s", (question_id, workspace_id))
        return cursor.rowcount > 0


# --- users, workspaces, sessions, audit (MAS-143) ----------------------------


def create_user(connection: psycopg.Connection, *, email: str, password_hash: str) -> User:
    with connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO users (email, password_hash) VALUES (%s, %s) RETURNING *",
            (email, password_hash),
        )
        return User(**cursor.fetchone())


def get_user_by_email(connection: psycopg.Connection, email: str) -> User | None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM users WHERE email = %s", (email,))
        row = cursor.fetchone()
    return User(**row) if row else None


def get_user_by_id(connection: psycopg.Connection, user_id: UUID) -> User | None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        row = cursor.fetchone()
    return User(**row) if row else None


def create_personal_workspace(connection: psycopg.Connection, *, user_id: UUID, name: str) -> Workspace:
    """A new workspace with `user_id` as its sole `owner` member (MAS-143):
    every account gets exactly one, created at registration."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO workspaces (name) VALUES (%s) RETURNING *", (name,))
            workspace = Workspace(**cursor.fetchone())
            cursor.execute(
                "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (%s, %s, 'owner')",
                (workspace.id, user_id),
            )
    return workspace


def get_workspace_for_user(connection: psycopg.Connection, user_id: UUID) -> Workspace | None:
    """The user's workspace. Picks one deterministically if a user ever
    belongs to more than one in the future (`ORDER BY created_at`), since
    Tier 3's personal-workspace model gives every user exactly one today."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT w.* FROM workspaces w
            JOIN workspace_members m ON m.workspace_id = w.id
            WHERE m.user_id = %s
            ORDER BY w.created_at
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
    return Workspace(**row) if row else None


def create_session(connection: psycopg.Connection, *, session_id: str, user_id: UUID, expires_at) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO sessions (id, user_id, expires_at) VALUES (%s, %s, %s)",
            (session_id, user_id, expires_at),
        )


def get_session_user(connection: psycopg.Connection, session_id: str) -> User | None:
    """The session's user, or None if the session does not exist or has expired.

    An expired session is never deleted here: a GET-triggered write inside a
    read path is a surprise, and login/register naturally accumulate garbage
    slowly enough that a school-project schema does not need a reaper job."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT u.* FROM users u
            JOIN sessions s ON s.user_id = u.id
            WHERE s.id = %s AND s.expires_at > now()
            """,
            (session_id,),
        )
        row = cursor.fetchone()
    return User(**row) if row else None


def delete_session(connection: psycopg.Connection, session_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM sessions WHERE id = %s", (session_id,))


def create_audit_event(
    connection: psycopg.Connection,
    *,
    workspace_id: UUID,
    user_id: UUID | None,
    event_type: str,
    target_type: str,
    target_id: UUID | None,
    metadata: dict | None = None,
) -> AuditEvent:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO audit_events (workspace_id, user_id, event_type, target_type, target_id, metadata)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (workspace_id, user_id, event_type, target_type, target_id, Jsonb(metadata or {})),
        )
        return AuditEvent(**cursor.fetchone())


def list_audit_events(connection: psycopg.Connection, workspace_id: UUID, limit: int = 200) -> list[AuditEvent]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM audit_events WHERE workspace_id = %s ORDER BY created_at DESC LIMIT %s",
            (workspace_id, limit),
        )
        return [AuditEvent(**row) for row in cursor.fetchall()]


def get_standards(connection: psycopg.Connection) -> dict[str, dict]:
    """Stored overrides only (MAS-120) -- a term with no row here uses MaSign's
    built-in default (`app.key_terms.standards.DEFAULT_PARAMS`), never a row
    holding default values."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT term_id, params FROM standards")
        return {row["term_id"]: row["params"] for row in cursor.fetchall()}


def set_standard(connection: psycopg.Connection, term_id: str, params: dict) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO standards (term_id, params, updated_at)
            VALUES (%s, %s, now())
            ON CONFLICT (term_id) DO UPDATE SET params = EXCLUDED.params, updated_at = now()
            """,
            (term_id, Jsonb(params)),
        )


def delete_standard(connection: psycopg.Connection, term_id: str) -> bool:
    """Reset one term to MaSign's default by removing its override row."""
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM standards WHERE term_id = %s", (term_id,))
        return cursor.rowcount > 0
