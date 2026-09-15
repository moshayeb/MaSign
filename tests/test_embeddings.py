"""MAS-11 / MAS-44: chunk vectors land in Qdrant and can be queried."""

import os
from uuid import UUID, uuid4

import psycopg
import pytest
from qdrant_client import QdrantClient

from app.database import repository
from app.retrieval.embeddings import DEFAULT_EMBEDDING_MODEL, SentenceTransformerEmbedder
from app.retrieval.indexing import index_contract
from app.retrieval.vector_store import ChunkVector, VectorStore


# --- vector store --------------------------------------------------------------


def _vector(store_dimension: int, hot: int) -> list[float]:
    v = [0.0] * store_dimension
    v[hot] = 1.0
    return v


def test_ensure_collection_is_idempotent(vector_store: VectorStore, fake_embedder) -> None:
    vector_store.ensure_collection(fake_embedder.dimension)
    vector_store.ensure_collection(fake_embedder.dimension)

    assert vector_store.count() == 0


def test_collection_is_rebuilt_when_dimension_changes(caplog: pytest.LogCaptureFixture) -> None:
    # MAS-44: a different EMBEDDING_MODEL means a different vector size; old
    # vectors are useless, so the collection is dropped and recreated.
    store = VectorStore(QdrantClient(":memory:"), collection="rebuild")
    store.ensure_collection(4)
    store.upsert([ChunkVector(uuid4(), uuid4(), 0, "old", _vector(4, 0))])
    assert store.count() == 1

    with caplog.at_level("WARNING"):
        store.ensure_collection(8)

    assert store.count() == 0
    assert "Rebuilding collection" in caplog.text
    store.upsert([ChunkVector(uuid4(), uuid4(), 0, "new", _vector(8, 0))])
    assert store.count() == 1


def test_search_ranks_by_similarity_and_filters_by_contract(vector_store: VectorStore, fake_embedder) -> None:
    contract_a, contract_b = uuid4(), uuid4()
    texts = {
        contract_a: ["The vendor shall indemnify the customer.", "Payment is due within 30 days."],
        contract_b: ["The vendor shall indemnify the customer for all claims."],
    }
    for contract_id, chunk_texts in texts.items():
        vectors = fake_embedder.embed_documents(chunk_texts)
        vector_store.upsert(
            [
                ChunkVector(uuid4(), contract_id, index, text, vector)
                for index, (text, vector) in enumerate(zip(chunk_texts, vectors))
            ]
        )

    query = fake_embedder.embed_query("indemnify the customer")

    everywhere = vector_store.search(query, limit=3)
    assert [hit.contract_id for hit in everywhere][:2] != [contract_a, contract_a]  # both contracts present
    assert all("indemnify" in hit.text for hit in everywhere[:2])
    assert everywhere[0].score >= everywhere[1].score >= everywhere[2].score

    only_a = vector_store.search(query, contract_id=contract_a, limit=3)
    assert {hit.contract_id for hit in only_a} == {contract_a}
    assert only_a[0].text.startswith("The vendor shall indemnify")


def test_delete_contract_removes_only_its_vectors(vector_store: VectorStore, fake_embedder) -> None:
    keep, drop = uuid4(), uuid4()
    for contract_id in (keep, drop):
        vector_store.upsert([ChunkVector(uuid4(), contract_id, 0, "clause", fake_embedder.embed_query("clause"))])

    vector_store.delete_contract(drop)

    assert vector_store.count(contract_id=drop) == 0
    assert vector_store.count(contract_id=keep) == 1


# --- indexing (needs the test database) -----------------------------------------


def test_index_contract_stores_one_vector_per_chunk_and_records_ids(
    db: psycopg.Connection, vector_store: VectorStore, fake_embedder
) -> None:
    contract = repository.create_contract(
        db, filename="a.txt", file_type="txt", size_bytes=1, character_count=1,
        chunks=["1. Term. Three years.", "2. Fees. Paid monthly.", "3. Liability. Capped."],
    )

    indexed = index_contract(db, contract, fake_embedder, vector_store)

    assert indexed == 3
    assert vector_store.count(contract_id=contract.id) == 3
    chunks = repository.list_chunks(db, contract.id)
    # MAS-11 "queryable alongside the chunks table rows": the point id is the chunk id.
    assert [c.embedding_id for c in chunks] == [str(c.id) for c in chunks]
    hit = vector_store.search(fake_embedder.embed_query("fees paid monthly"), contract_id=contract.id, limit=1)[0]
    assert hit.chunk_id == chunks[1].id
    assert hit.chunk_index == 1


def test_index_contract_with_no_chunks_is_a_noop(db: psycopg.Connection, vector_store: VectorStore, fake_embedder) -> None:
    contract = repository.create_contract(db, filename="e.txt", file_type="txt", size_bytes=1, character_count=1, chunks=[])

    assert index_contract(db, contract, fake_embedder, vector_store) == 0
    assert vector_store.count() == 0


# --- real model (opt-in) ----------------------------------------------------------


@pytest.mark.skipif(os.getenv("MASIGN_REAL_EMBEDDINGS") != "1", reason="set MASIGN_REAL_EMBEDDINGS=1 to load the real model")
def test_real_model_embeds_contract_clauses_meaningfully() -> None:
    embedder = SentenceTransformerEmbedder(DEFAULT_EMBEDDING_MODEL)

    docs = embedder.embed_documents([
        "The Vendor's aggregate liability shall not exceed the fees paid in the preceding twelve months.",
        "This Agreement renews automatically for successive one-year terms unless either party gives notice.",
    ])
    query = embedder.embed_query("Is there a cap on liability?")

    assert embedder.dimension == len(query) == len(docs[0]) == 768
    similarity = [sum(a * b for a, b in zip(query, d)) for d in docs]
    assert similarity[0] > similarity[1]  # the liability clause wins for a liability question
