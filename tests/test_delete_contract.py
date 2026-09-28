"""MAS-126: DELETE /api/contracts/{id} -- a new, irreversible, user-facing
action (previously only an internal cleanup helper for a failed upload)."""

import json
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.database import repository
from app.main import app
from app.retrieval.vector_store import VectorStore, VectorStoreError
from app.risk_analysis.review import review_contract
from tests.conftest import FakeChatModel

client = TestClient(app)


def test_delete_removes_the_contract_its_chunks_and_its_vectors(db, vector_store: VectorStore) -> None:
    upload = client.post("/api/contracts/upload", files={"file": ("c.txt", b"2. Fees. EUR 100 per month.", "text/plain")})
    contract_id = UUID(upload.json()["contract_id"])
    assert vector_store.count(contract_id=contract_id) > 0

    response = client.delete(f"/api/contracts/{contract_id}")

    assert response.status_code == 204
    assert client.get(f"/api/contracts/{contract_id}").status_code == 404
    assert vector_store.count(contract_id=contract_id) == 0


def test_delete_cascades_review_key_terms_questions_and_links(db, fake_chat_model: FakeChatModel) -> None:
    primary = client.post("/api/contracts/upload", files={"file": ("main.txt", b"2. Fees. Customer pays EUR 100 per month, as set out in the Order Form.", "text/plain")})
    primary_id = primary.json()["contract_id"]
    linked = client.post("/api/contracts/upload", files={"file": ("order-form.txt", b"1. This is the Order Form.", "text/plain")})
    linked_id = linked.json()["contract_id"]
    client.post(f"/api/contracts/{primary_id}/links", json={"linked_contract_id": linked_id, "reference_name": "Order Form"})

    fake_chat_model.key_terms_reply = json.dumps(
        [{"term": "recurring_fee", "value": "EUR 100 per month", "passage": 1, "quote": "EUR 100 per month", "typed": {"amount": 100, "currency": "EUR", "period": "month"}}]
    )
    review_contract(primary_id, fake_chat_model, batch_size=1)
    client.post("/api/query", json={"question": "What is the fee?", "contract_id": primary_id})

    with db.cursor() as cursor:
        cursor.execute("SELECT count(*) AS n FROM key_terms WHERE contract_id = %s", (primary_id,))
        assert cursor.fetchone()["n"] > 0
        cursor.execute("SELECT count(*) AS n FROM questions WHERE contract_id = %s", (primary_id,))
        assert cursor.fetchone()["n"] > 0
        cursor.execute("SELECT count(*) AS n FROM contract_links WHERE primary_contract_id = %s", (primary_id,))
        assert cursor.fetchone()["n"] > 0

    response = client.delete(f"/api/contracts/{primary_id}")
    assert response.status_code == 204

    with db.cursor() as cursor:
        cursor.execute("SELECT count(*) AS n FROM chunks WHERE contract_id = %s", (primary_id,))
        assert cursor.fetchone()["n"] == 0
        cursor.execute("SELECT count(*) AS n FROM risk_reviews WHERE contract_id = %s", (primary_id,))
        assert cursor.fetchone()["n"] == 0
        cursor.execute("SELECT count(*) AS n FROM key_terms WHERE contract_id = %s", (primary_id,))
        assert cursor.fetchone()["n"] == 0
        cursor.execute("SELECT count(*) AS n FROM questions WHERE contract_id = %s", (primary_id,))
        assert cursor.fetchone()["n"] == 0
        cursor.execute("SELECT count(*) AS n FROM contract_links WHERE primary_contract_id = %s", (primary_id,))
        assert cursor.fetchone()["n"] == 0


def test_delete_an_unknown_contract_is_404() -> None:
    response = client.delete(f"/api/contracts/{uuid4()}")
    assert response.status_code == 404
    assert response.json()["detail"] == "Contract not found."


def test_delete_still_succeeds_when_qdrant_cleanup_fails(db, monkeypatch) -> None:
    upload = client.post("/api/contracts/upload", files={"file": ("c.txt", b"2. Fees. EUR 100 per month.", "text/plain")})
    contract_id = upload.json()["contract_id"]

    def broken_delete(self, contract_id):
        raise VectorStoreError("simulated Qdrant outage")

    monkeypatch.setattr(VectorStore, "delete_contract", broken_delete)

    response = client.delete(f"/api/contracts/{contract_id}")

    assert response.status_code == 204  # Postgres is the source of truth; a Qdrant failure is logged, not fatal
    assert client.get(f"/api/contracts/{contract_id}").status_code == 404
