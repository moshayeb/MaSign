"""MAS-12: /api/query returns the stored chunks most relevant to the question.

Uses the fake bag-of-words embedder and in-memory Qdrant from conftest, so
relevance here means word overlap; the real model is checked by the opt-in
test in test_embeddings.py and the manual verification recorded on MAS-12.
"""

from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.database import repository
from app.main import app
from app.retrieval.retriever import retrieve_contract_context
from app.retrieval.vector_store import ChunkVector

client = TestClient(app)

pytestmark = pytest.mark.usefixtures("db")

# Each clause is ~600 characters, so no two fit in one 1200-character chunk and
# every clause becomes its own chunk (with the usual overlap from the previous one).
FEES = (
    "2. Fees\nLate payment accrues interest at 1.5% per month from the due date until paid. "
    "Customer pays a subscription fee of EUR 18,500 per month, invoiced monthly in advance, "
    "and professional services at EUR 1,250 per consultant day, invoiced monthly in arrears "
    "against approved timesheets. All invoices are payable within thirty days of the invoice "
    "date by bank transfer to the account designated on the invoice. Fees are exclusive of "
    "value added tax and any other applicable taxes, which shall be added to each invoice at "
    "the prevailing rate. Vendor may adjust the subscription once per calendar year on ninety "
    "days' written notice by no more than three percent."
)
TERM = (
    "3. Term\nThis agreement commences on the effective date and continues for an initial term "
    "of thirty-six months. After the initial term it renews automatically for successive "
    "periods of twelve months unless either party gives the other written notice of "
    "non-renewal at least ninety days before the end of the then-current term. Either party "
    "may terminate with immediate effect by written notice if the other party commits a "
    "material breach and fails to remedy it within thirty days of receiving written notice "
    "describing the breach, or if the other party becomes insolvent, enters into liquidation "
    "or has a receiver or administrator appointed over any of its assets."
)
LIABILITY = (
    "5. Liability\nNeither party is liable to the other for any indirect, incidental, special, "
    "consequential or punitive damages, or for any loss of profits, revenue, business or "
    "anticipated savings, however arising. The total aggregate liability of each party "
    "arising out of or in connection with this agreement, whether in contract, tort "
    "(including negligence) or otherwise, is capped at the total amount paid or payable by "
    "customer under this agreement in the twelve months immediately preceding the event "
    "giving rise to the claim. Nothing in this agreement limits liability for death or "
    "personal injury caused by negligence, fraud, or breach of confidentiality."
)


def _upload(name: str, *clauses: str) -> UUID:
    response = client.post(
        "/api/contracts/upload",
        files={"file": (name, "\n\n".join(clauses).encode(), "text/plain")},
    )
    assert response.status_code == 200, response.text
    return UUID(response.json()["contract_id"])


def _query(question: str, **body):
    return client.post("/api/query", json={"question": question, **body})


def test_most_relevant_chunk_comes_first() -> None:
    _upload("msa.txt", FEES, TERM, LIABILITY)

    response = _query("What interest applies to late payment of fees?")

    assert response.status_code == 200
    body = response.json()
    assert len(body["retrieved_context"]) == 3
    assert "2. Fees" in body["retrieved_context"][0]["text"]
    scores = [hit["score"] for hit in body["retrieved_context"]]
    assert scores == sorted(scores, reverse=True)
    assert body["answer"] == "The passage states it [1]."  # the fake model cites the top hit
    assert body["grounded"] is True


def test_hits_identify_their_chunk(db: psycopg.Connection) -> None:
    contract_id = _upload("msa.txt", FEES, TERM, LIABILITY)

    hit = _query("cap on aggregate liability").json()["retrieved_context"][0]

    assert UUID(hit["contract_id"]) == contract_id
    assert "5. Liability" in hit["text"]
    assert hit["chunk_index"] == 2
    stored = repository.list_chunks(db, contract_id)[2]
    assert UUID(hit["chunk_id"]) == stored.id and hit["text"] == stored.chunk_text


def test_contract_id_restricts_the_search() -> None:
    _upload("first.txt", FEES)
    second = _upload("second.txt", "2. Fees\nFees are paid quarterly; late payment interest is 2% per month.")

    response = _query("late payment interest on fees", contract_id=str(second))

    assert response.status_code == 200
    assert {UUID(hit["contract_id"]) for hit in response.json()["retrieved_context"]} == {second}


def test_without_contract_id_every_contract_is_searched() -> None:
    first = _upload("first.txt", FEES)
    second = _upload("second.txt", "2. Fees\nFees are paid quarterly; late payment interest is 2% per month.")

    response = _query("late payment interest on fees")

    assert {UUID(hit["contract_id"]) for hit in response.json()["retrieved_context"]} == {first, second}


def test_limit_caps_the_number_of_hits() -> None:
    _upload("msa.txt", FEES, TERM, LIABILITY)

    assert len(_query("months", limit=2).json()["retrieved_context"]) == 2
    assert _query("months", limit=0).status_code == 422
    assert _query("months", limit=21).status_code == 422


def test_unknown_contract_is_a_404_and_malformed_id_a_422() -> None:
    missing = _query("anything", contract_id="00000000-0000-0000-0000-000000000000")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Contract not found."

    malformed = _query("anything", contract_id="not-a-uuid")
    assert malformed.status_code == 422
    assert malformed.json()["detail"].startswith("contract_id: ")


def test_empty_index_returns_no_context_not_an_error() -> None:
    response = _query("late payment")

    assert response.status_code == 200
    assert response.json()["retrieved_context"] == []
    assert response.json()["answer"] == "Not found in contract."
    assert response.json()["grounded"] is False


def test_points_of_a_deleted_contract_are_not_returned(db: psycopg.Connection, vector_store, fake_embedder) -> None:
    # MAS-50: a failed upload's cleanup is best effort, so the store may hold
    # vectors for a contract Postgres no longer knows. They must stay invisible.
    _upload("msa.txt", TERM)
    ghost = uuid4()
    vector_store.upsert([ChunkVector(uuid4(), ghost, 0, FEES, fake_embedder.embed_documents([FEES])[0])])

    hits = retrieve_contract_context("late payment interest", db=db, embedder=fake_embedder, store=vector_store)

    assert hits and all(hit.contract_id != ghost for hit in hits)
    assert vector_store.count(contract_id=ghost) == 1  # the point is still there; it is just filtered


def test_leftover_points_cannot_crowd_out_valid_results(db: psycopg.Connection, vector_store, fake_embedder) -> None:
    # MAS-60: more leftover points than `limit`, every one of them a better
    # match than the real chunk. The real chunk must still be returned.
    _upload("msa.txt", FEES)
    question = "late payment interest"
    for _ in range(6):
        vector = fake_embedder.embed_documents([question])[0]  # identical words: a perfect score
        vector_store.upsert([ChunkVector(uuid4(), uuid4(), 0, question, vector)])

    hits = retrieve_contract_context(question, db=db, embedder=fake_embedder, store=vector_store, limit=2)

    assert len(hits) == 1 and "2. Fees" in hits[0].text
    response = _query(question, limit=2)
    assert response.status_code == 200 and "2. Fees" in response.json()["retrieved_context"][0]["text"]


def test_vector_store_outage_is_a_503() -> None:
    from app.api import dependencies
    from app.retrieval.vector_store import VectorStoreError

    class DownStore:
        def search(self, *args, **kwargs):
            raise VectorStoreError("connection refused (simulated)")

    _upload("msa.txt", FEES)  # something to search, so the outage is actually hit
    app.dependency_overrides[dependencies.get_vector_store] = lambda: DownStore()

    response = _query("anything")

    assert response.status_code == 503
    assert "Vector store unavailable" in response.json()["detail"]


def test_embedding_service_outage_is_a_503() -> None:
    # MAS-61: the quality profile's llama-server is down (or ran out of VRAM).
    from app.api import dependencies
    from app.retrieval.embeddings import EmbeddingServiceError

    class DownEmbedder:
        backend, model_name, dimension, max_tokens, prompt_format = "openai-compatible", "qwen", 3, 512, "qwen3"

        def embed_query(self, text):
            raise EmbeddingServiceError("Embedding service at http://llama-server:8081 is unreachable (simulated)")

    _upload("msa.txt", FEES)
    app.dependency_overrides[dependencies.get_embedder] = lambda: DownEmbedder()

    response = _query("anything")

    assert response.status_code == 503
    assert "Embedding service unavailable" in response.json()["detail"]
    assert "EMBEDDING_API_URL" in response.json()["detail"]
