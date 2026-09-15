"""Find the stored chunks most relevant to a question (MAS-12)."""

from uuid import UUID

import psycopg

from app.database import repository
from app.retrieval.embeddings import Embedder
from app.retrieval.vector_store import ChunkHit, VectorStore

DEFAULT_LIMIT = 5


def retrieve_contract_context(
    question: str,
    *,
    db: psycopg.Connection,
    embedder: Embedder,
    store: VectorStore,
    contract_id: UUID | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[ChunkHit]:
    """Embed the question and return the best-matching chunks, best first.

    With `contract_id` the search is restricted to that contract; without it,
    every uploaded contract is searched. Hits whose contract no longer exists
    in Postgres are dropped: a failed upload's cleanup is best effort (MAS-50),
    so the vector store may hold points for a contract that was removed.
    """
    hits = store.search(embedder.embed_query(question), contract_id=contract_id, limit=limit)
    if not hits:
        return []
    known = repository.existing_contract_ids(db, {hit.contract_id for hit in hits})
    return [hit for hit in hits if hit.contract_id in known]
