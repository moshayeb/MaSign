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
    every contract currently stored in Postgres is searched. The restriction is
    applied inside the search, not afterwards: a failed upload's cleanup is
    best effort (MAS-50), so the vector store may hold points for contracts
    that were removed, and those must not take any of the `limit` slots (MAS-60).
    """
    if contract_id is None:
        contract_ids = repository.list_contract_ids(db)
        if not contract_ids:
            return []
        return store.search(embedder.embed_query(question), contract_ids=contract_ids, limit=limit)
    return store.search(embedder.embed_query(question), contract_id=contract_id, limit=limit)
