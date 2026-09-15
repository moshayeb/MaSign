"""Embed a stored contract's chunks and put them in the vector store."""

import logging

import psycopg

from app.database import repository
from app.database.models import Contract, VectorIndex
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
        model_name=embedder.model_name,
        dimension=embedder.dimension,
        max_tokens=embedder.max_tokens,
        prompt_format=embedder.prompt_format,
    )


def ensure_index_current(db: psycopg.Connection, embedder: Embedder, store: VectorStore) -> int | None:
    """Make the vector index match the configured embedder (MAS-52).

    The collection is rebuilt and every stored chunk re-embedded when the
    recorded fingerprint differs from the embedder (a model, prefix or token
    limit change — even at the same dimension), or when the collection had to
    be created (first run, or a wiped Qdrant volume). Returns the number of
    chunks re-indexed, or None when nothing needed doing.
    """
    wanted = fingerprint(embedder, store.collection)
    recorded = repository.get_vector_index(db, store.collection)

    created = store.ensure_collection(wanted.dimension)
    if recorded == wanted and not created:
        return None

    if not created:
        logger.warning(
            "Rebuilding vector index %s: built with %s, embedder is now %s",
            store.collection, recorded or "unrecorded settings", wanted,
        )
        store.reset_collection(wanted.dimension)

    contracts = repository.list_contracts(db)
    logger.info("Re-indexing %d contract(s) with %s", len(contracts), embedder.model_name)
    indexed = sum(index_contract(db, contract, embedder, store) for contract in contracts)
    repository.set_vector_index(db, wanted)
    logger.info("Vector index %s ready: %d chunk(s) indexed", store.collection, indexed)
    return indexed
