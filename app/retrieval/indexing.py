"""Embed a stored contract's chunks and put them in the vector store."""

import logging

import psycopg

from app.database import repository
from app.database.models import Contract, VectorIndex
from app.ingestion.pipeline import TokenBudget, chunk_contract_text
from app.retrieval.embeddings import Embedder
from app.retrieval.vector_store import ChunkVector, VectorStore

logger = logging.getLogger(__name__)


def index_contract(
    db: psycopg.Connection,
    contract: Contract,
    embedder: Embedder,
    store: VectorStore,
) -> int:
    """Embed every chunk of `contract`, upsert to Qdrant, record the point ids.

    Returns the number of chunks indexed. Raises VectorStoreError if Qdrant
    is unavailable; the caller decides what to do with the contract row.
    """
    chunks = repository.list_chunks(db, contract.id)
    if not chunks:
        return 0

    vectors = embedder.embed_documents([chunk.chunk_text for chunk in chunks])
    store.upsert(
        [
            ChunkVector(
                chunk_id=chunk.id,
                contract_id=contract.id,
                chunk_index=chunk.chunk_index,
                text=chunk.chunk_text,
                vector=vector,
            )
            for chunk, vector in zip(chunks, vectors, strict=True)
        ]
    )
    # The point id is the chunk id, so the "embedding id" is simply that.
    repository.set_embedding_ids(db, {chunk.id: str(chunk.id) for chunk in chunks})
    return len(chunks)


def fingerprint(embedder: Embedder, collection: str) -> VectorIndex:
    return VectorIndex(
        collection=collection,
        backend=embedder.backend,
        model_name=embedder.model_name,
        dimension=embedder.dimension,
        max_tokens=embedder.max_tokens,
        prompt_format=embedder.prompt_format,
    )


def ensure_index_current(db: psycopg.Connection, embedder: Embedder, store: VectorStore) -> int | None:
    """Make the vector index match the configured embedder (MAS-52).

    The collection is rebuilt and every stored chunk re-embedded when the
    recorded fingerprint differs from the embedder (a model, prefix or token
    limit change — even at the same dimension), or when the collection is
    missing or the wrong size (first run, or a wiped Qdrant volume). Qdrant is
    only modified once the old fingerprint is gone. Returns the number of
    chunks re-indexed, or None when nothing needed doing.
    """
    wanted = fingerprint(embedder, store.collection)
    recorded = repository.get_vector_index(db, store.collection)

    if recorded == wanted and store.matches(wanted.dimension):
        return None

    logger.warning(
        "Rebuilding vector index %s: %s, embedder is now %s",
        store.collection,
        f"built with {recorded}" if recorded == wanted else f"built with {recorded or 'unrecorded settings'}",
        wanted if recorded != wanted else "the same, but the collection is missing or has the wrong size",
    )
    # Forget the old fingerprint and commit BEFORE touching Qdrant: from here
    # until the new fingerprint is written the index is incomplete, and a
    # missing row makes the next start rebuild. Deleting it after creating the
    # collection left a window where a crash produced an empty index with a
    # valid-looking fingerprint (MAS-56, MAS-59).
    repository.clear_vector_index(db, store.collection)
    db.commit()
    store.reset_collection(wanted.dimension)

    contracts = repository.list_contracts(db)
    logger.info("Re-indexing %d contract(s) with %s", len(contracts), embedder.model_name)
    indexed = 0
    for contract in contracts:
        _refit_oversized_chunks(db, contract, embedder)
        indexed += index_contract(db, contract, embedder, store)
    repository.set_vector_index(db, wanted)
    db.commit()
    logger.info("Vector index %s ready: %d chunk(s) indexed", store.collection, indexed)
    return indexed


def _refit_oversized_chunks(db: psycopg.Connection, contract: Contract, embedder: Embedder) -> None:
    """Re-split stored chunks that no longer fit the embedder's token limit (MAS-55).

    Chunks stored before the token budget existed, or under a larger
    EMBEDDING_MAX_TOKENS, would trip the embedder's guard and abort startup.
    Splitting them (without overlap — the neighbours already carry it) keeps
    every clause searchable; the chunk rows are replaced so Postgres matches
    what is embedded.
    """
    chunks = repository.list_chunks(db, contract.id)
    budget = TokenBudget(count=embedder.count_tokens, max_tokens=embedder.max_tokens)
    if all(budget.count(chunk.chunk_text) <= budget.max_tokens for chunk in chunks):
        return

    texts: list[str] = []
    for chunk in chunks:
        if budget.count(chunk.chunk_text) <= budget.max_tokens:
            texts.append(chunk.chunk_text)
        else:
            texts.extend(chunk_contract_text(chunk.chunk_text, overlap_chars=0, token_budget=budget))
    logger.warning(
        "Contract %s (%s): stored chunks exceed the %d-token limit; re-split %d -> %d chunks",
        contract.id, contract.filename, budget.max_tokens, len(chunks), len(texts),
    )
    repository.replace_chunks(db, contract.id, texts)
