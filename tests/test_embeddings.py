"""MAS-11 / MAS-44: chunk vectors land in Qdrant and can be queried."""

import os
from uuid import UUID, uuid4

import psycopg
import pytest
from qdrant_client import QdrantClient

from app.database import repository
from app.retrieval.embeddings import (
    DEFAULT_EMBEDDING_MODEL,
    EmbeddingInputTooLong,
    SentenceTransformerEmbedder,
    prompt_format_for,
)
from app.retrieval.indexing import ensure_index_current, fingerprint, index_contract
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


# --- index fingerprint (MAS-52) ---------------------------------------------------


def _store_two_contracts(db: psycopg.Connection) -> list[UUID]:
    ids = []
    for name, chunks in (("a.txt", ["1. Term. Three years.", "2. Fees. Monthly."]), ("b.txt", ["Liability capped."])):
        ids.append(repository.create_contract(db, filename=name, file_type="txt", size_bytes=1, character_count=1, chunks=chunks).id)
    return ids


def test_first_start_indexes_stored_chunks_and_records_the_fingerprint(
    db: psycopg.Connection, vector_store: VectorStore, fake_embedder
) -> None:
    _store_two_contracts(db)

    assert ensure_index_current(db, fake_embedder, vector_store) == 3
    assert vector_store.count() == 3
    assert repository.get_vector_index(db, vector_store.collection) == fingerprint(fake_embedder, vector_store.collection)

    # Same embedder again: nothing to do.
    assert ensure_index_current(db, fake_embedder, vector_store) is None
    assert vector_store.count() == 3


def test_same_dimension_model_change_rebuilds_the_index(
    db: psycopg.Connection, vector_store: VectorStore, fake_embedder, caplog: pytest.LogCaptureFixture
) -> None:
    _store_two_contracts(db)
    ensure_index_current(db, fake_embedder, vector_store)
    # An orphan point that a rebuild must not keep.
    vector_store.upsert([ChunkVector(uuid4(), uuid4(), 0, "stale", fake_embedder.embed_query("stale"))])
    assert vector_store.count() == 4

    fake_embedder.prompt_format = "nomic"  # e.g. MAS-51: same model, same 64 dims, different input format
    with caplog.at_level("WARNING"):
        reindexed = ensure_index_current(db, fake_embedder, vector_store)

    assert reindexed == 3
    assert "Rebuilding vector index" in caplog.text
    assert vector_store.count() == 3  # only the chunks in Postgres survive
    assert repository.get_vector_index(db, vector_store.collection).prompt_format == "nomic"


def test_rebuild_splits_stored_chunks_that_exceed_the_token_limit(
    db: psycopg.Connection, vector_store: VectorStore, fake_embedder, caplog: pytest.LogCaptureFixture
) -> None:
    # MAS-55: a chunk stored before the token budget existed (or under a larger
    # EMBEDDING_MAX_TOKENS) must not make the rebuild — and so startup — fail.
    fake_embedder.max_tokens = 40
    oversized = "1. Fees\n" + " ".join(f"term{i}" for i in range(100))  # 101 words
    contract = repository.create_contract(
        db, filename="old.txt", file_type="txt", size_bytes=1, character_count=1, chunks=["0. Intro short.", oversized]
    )

    with caplog.at_level("WARNING"):
        indexed = ensure_index_current(db, fake_embedder, vector_store)

    chunks = repository.list_chunks(db, contract.id)
    assert len(chunks) > 2 and indexed == len(chunks)
    assert all(fake_embedder.count_tokens(c.chunk_text) <= 40 for c in chunks)
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    assert " ".join(c.chunk_text for c in chunks).split() == ("0. Intro short. " + oversized).split()
    assert repository.get_contract(db, contract.id).chunk_count == len(chunks)
    assert all(c.embedding_id == str(c.id) for c in chunks)
    assert vector_store.count(contract_id=contract.id) == len(chunks)
    assert "exceed" in caplog.text and "old.txt" in caplog.text


def test_interrupted_rebuild_is_redone_on_the_next_start(
    db: psycopg.Connection, vector_store: VectorStore, fake_embedder, monkeypatch: pytest.MonkeyPatch
) -> None:
    # MAS-56: a lost collection with a matching fingerprint; the rebuild dies
    # after the first contract. The next start must not believe the index is complete.
    from app.retrieval import indexing

    _store_two_contracts(db)
    ensure_index_current(db, fake_embedder, vector_store)
    vector_store._client.delete_collection(vector_store.collection)

    real_index_contract, calls = indexing.index_contract, []

    def dies_on_second_contract(*args, **kwargs):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("simulated crash mid-rebuild")
        return real_index_contract(*args, **kwargs)

    monkeypatch.setattr(indexing, "index_contract", dies_on_second_contract)
    with pytest.raises(RuntimeError, match="mid-rebuild"):
        ensure_index_current(db, fake_embedder, vector_store)
    assert repository.get_vector_index(db, vector_store.collection) is None  # marked incomplete
    monkeypatch.setattr(indexing, "index_contract", real_index_contract)

    assert ensure_index_current(db, fake_embedder, vector_store) == 3
    assert vector_store.count() == 3
    assert ensure_index_current(db, fake_embedder, vector_store) is None  # and now it is complete


def test_crash_right_after_the_collection_is_recreated_is_redone_on_the_next_start(
    db: psycopg.Connection, vector_store: VectorStore, fake_embedder, monkeypatch: pytest.MonkeyPatch
) -> None:
    # MAS-59: the fingerprint must be gone *before* Qdrant is touched, or a
    # crash right after the (empty) collection is created passes as complete.
    _store_two_contracts(db)
    ensure_index_current(db, fake_embedder, vector_store)
    vector_store._client.delete_collection(vector_store.collection)  # lost volume, fingerprint still matches

    real_reset = vector_store.reset_collection

    def reset_then_die(dimension: int) -> None:
        real_reset(dimension)
        raise ConnectionError("simulated crash right after the collection was created")

    monkeypatch.setattr(vector_store, "reset_collection", reset_then_die)
    with pytest.raises(ConnectionError):
        ensure_index_current(db, fake_embedder, vector_store)
    assert vector_store.matches(fake_embedder.dimension)  # the empty collection exists ...
    assert repository.get_vector_index(db, vector_store.collection) is None  # ... but nothing vouches for it
    monkeypatch.setattr(vector_store, "reset_collection", real_reset)

    assert ensure_index_current(db, fake_embedder, vector_store) == 3
    assert vector_store.count() == 3


def test_qdrant_is_not_touched_while_the_fingerprint_is_valid(
    db: psycopg.Connection, vector_store: VectorStore, fake_embedder, monkeypatch: pytest.MonkeyPatch
) -> None:
    _store_two_contracts(db)
    ensure_index_current(db, fake_embedder, vector_store)

    def must_not_be_called(dimension: int) -> None:
        raise AssertionError("reset_collection called although the index is current")

    monkeypatch.setattr(vector_store, "reset_collection", must_not_be_called)
    assert ensure_index_current(db, fake_embedder, vector_store) is None


def test_wiped_collection_is_rebuilt_even_when_the_fingerprint_matches(
    db: psycopg.Connection, vector_store: VectorStore, fake_embedder
) -> None:
    _store_two_contracts(db)
    ensure_index_current(db, fake_embedder, vector_store)
    vector_store._client.delete_collection(vector_store.collection)  # a lost Qdrant volume

    assert ensure_index_current(db, fake_embedder, vector_store) == 3
    assert vector_store.count() == 3


# --- prefixes and token guard (MAS-51 / MAS-49, no model loaded) --------------------


class _FakeModel:
    """Stands in for a SentenceTransformer: records what encode() is given."""

    max_seq_length = 512
    prompts: dict[str, str] = {}

    def __init__(self) -> None:
        self.encoded: list[tuple[list[str], str | None]] = []

    @staticmethod
    def tokenizer(text: str, add_special_tokens: bool = True) -> dict[str, list[int]]:
        return {"input_ids": [0] * (len(text.split()) + (2 if add_special_tokens else 0))}

    def get_sentence_embedding_dimension(self) -> int:
        return 4

    def encode(self, texts, prompt_name=None, **_):
        import numpy as np

        self.encoded.append((list(texts), prompt_name))
        return np.zeros((len(texts), 4))


@pytest.fixture
def modernbert_like(monkeypatch: pytest.MonkeyPatch) -> tuple[SentenceTransformerEmbedder, _FakeModel]:
    monkeypatch.delenv("EMBEDDING_PROMPT_FORMAT", raising=False)
    embedder = SentenceTransformerEmbedder(DEFAULT_EMBEDDING_MODEL)
    model = _FakeModel()
    monkeypatch.setattr(embedder, "_load", lambda: model)
    return embedder, model


def test_modernbert_inputs_carry_the_search_prefixes(modernbert_like) -> None:
    embedder, model = modernbert_like

    embedder.embed_documents(["Fees are due monthly.", "Term: three years."])
    embedder.embed_query("When are fees due?")

    assert embedder.prompt_format == "nomic"
    assert model.encoded == [
        (["search_document: Fees are due monthly.", "search_document: Term: three years."], None),
        (["search_query: When are fees due?"], None),
    ]


def test_prefix_scheme_follows_the_model_family(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EMBEDDING_PROMPT_FORMAT", raising=False)

    assert prompt_format_for("freelawproject/modernbert-embed-base_finetune_512") == "nomic"
    assert prompt_format_for("nomic-ai/nomic-embed-text-v1.5") == "nomic"
    assert prompt_format_for("Qwen/Qwen3-Embedding-0.6B") == "none"  # different instruction format

    monkeypatch.setenv("EMBEDDING_PROMPT_FORMAT", "none")
    assert prompt_format_for("freelawproject/modernbert-embed-base_finetune_512") == "none"

    monkeypatch.setenv("EMBEDDING_PROMPT_FORMAT", "bogus")
    with pytest.raises(ValueError, match="EMBEDDING_PROMPT_FORMAT"):
        prompt_format_for("anything")


def test_without_a_prefix_scheme_the_models_own_prompt_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EMBEDDING_PROMPT_FORMAT", raising=False)
    embedder = SentenceTransformerEmbedder("Qwen/Qwen3-Embedding-0.6B")
    model = _FakeModel()
    model.prompts = {"query": "Instruct: retrieve passages\nQuery: "}
    monkeypatch.setattr(embedder, "_load", lambda: model)

    embedder.embed_documents(["clause"])
    embedder.embed_query("question")

    assert model.encoded == [(["clause"], None), (["question"], "query")]


def test_token_count_includes_prefix_and_special_tokens(modernbert_like) -> None:
    embedder, _ = modernbert_like

    # "search_document:" + 3 words + 2 special tokens, as the fake tokenizer counts.
    assert embedder.count_tokens("one two three") == 1 + 3 + 2
    assert embedder.max_tokens == 512


def test_overlong_chunk_is_refused_rather_than_truncated(modernbert_like) -> None:
    embedder, model = modernbert_like
    model.max_seq_length = 8

    with pytest.raises(EmbeddingInputTooLong, match="exceeds the 8-token limit"):
        embedder.embed_documents(["one two three four five six seven"])
    assert model.encoded == []  # nothing reached the model


# --- real model (opt-in) ----------------------------------------------------------


@pytest.mark.skipif(os.getenv("MASIGN_REAL_EMBEDDINGS") != "1", reason="set MASIGN_REAL_EMBEDDINGS=1 to load the real model")
def test_real_tokenizer_budget_keeps_dense_financial_text_within_the_limit() -> None:
    # MAS-49: the text that produced 529 tokens for a 1192-character chunk.
    from app.ingestion.pipeline import TokenBudget, chunk_contract_text

    embedder = SentenceTransformerEmbedder(DEFAULT_EMBEDDING_MODEL)
    financial = " ".join(
        f"Fee {i}: USD 12,345.67 due on 2026-0{i % 9 + 1}-15; late payment penalty 1.5% per month (18% p.a.), "
        f"cap EUR 9,999.99; ref. §4.2(b)(iii)/Sched. A-{i}."
        for i in range(60)
    ) + " Final clause: termination fee EUR 50,000."

    by_chars_only = chunk_contract_text(financial)
    assert any(embedder.count_tokens(chunk) > embedder.max_tokens for chunk in by_chars_only)  # the bug

    chunks = chunk_contract_text(financial, token_budget=TokenBudget(embedder.count_tokens, embedder.max_tokens))

    assert all(embedder.count_tokens(chunk) <= embedder.max_tokens for chunk in chunks)
    assert "termination fee EUR 50,000" in chunks[-1]
    embedder.embed_documents(chunks)  # the guard must not fire


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
