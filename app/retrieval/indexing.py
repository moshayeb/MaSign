"""Embed a stored contract's chunks and put them in the vector store."""

import psycopg

from app.database import repository
from app.database.models import Contract
from app.retrieval.embeddings import Embedder
from app.retrieval.vector_store import ChunkVector, VectorStore


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
