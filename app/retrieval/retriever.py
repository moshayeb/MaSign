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
    contract_ids: list[UUID] | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[ChunkHit]:
    """Embed the question and return the best-matching chunks, best first.

    With `contract_ids` the search is restricted to exactly that set (MAS-138:
    a contract's bundle — itself plus any documents explicitly linked to it,
    MAS-137). With `contract_id` alone it is restricted to that one contract.
    With neither, every contract currently stored in Postgres is searched.
    The restriction is applied inside the search, not afterwards: a failed
    upload's cleanup is best effort (MAS-50), so the vector store may hold
    points for contracts that were removed, and those must not take any of
    the `limit` slots (MAS-60).
    """
    if contract_ids is not None:
        if not contract_ids:
            return []
        return store.search(embedder.embed_query(question), contract_ids=contract_ids, limit=limit)
    if contract_id is None:
        all_ids = repository.list_contract_ids(db)
        if not all_ids:
            return []
        return store.search(embedder.embed_query(question), contract_ids=all_ids, limit=limit)
    return store.search(embedder.embed_query(question), contract_id=contract_id, limit=limit)
