"""/health is liveness only; /ready tells the truth about the dependencies (MAS-88)."""

import pytest
from fastapi.testclient import TestClient

from app.api import dependencies
from app.main import app
from app.retrieval.vector_store import VectorStoreError

client = TestClient(app)


def test_health_check() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_reports_every_dependency_when_all_answer(db) -> None:
    response = client.get("/ready")

    assert response.status_code == 200, response.text
    assert response.json() == {"database": "ok", "vector_store": "ok", "chat_model": "fake fake-chat", "status": "ok"}


def test_ready_names_the_vector_store_when_qdrant_is_down(db) -> None:
    class DownStore:
        def ping(self) -> None:
            raise VectorStoreError("connection refused")

    app.dependency_overrides[dependencies.get_vector_store] = lambda: DownStore()
    try:
        response = client.get("/ready")
    finally:
        app.dependency_overrides.pop(dependencies.get_vector_store, None)

    assert response.status_code == 503
    body = response.json()
    assert (body["database"], body["vector_store"], body["status"]) == ("ok", "unavailable", "unavailable")


def test_ready_names_the_database_when_postgres_is_down(monkeypatch: pytest.MonkeyPatch, vector_store) -> None:
    # An unroutable address (TEST-NET-1) with a 1 s connect timeout: the
    # connection attempt fails fast, the route must not fail at all.
    monkeypatch.setenv("DATABASE_URL", "postgresql://rag_user:rag_password@192.0.2.1:5432/contract_rag?connect_timeout=1")

    response = client.get("/ready")

    assert response.status_code == 503
    body = response.json()
    assert (body["database"], body["vector_store"]) == ("unavailable", "ok")


def test_ready_says_when_no_chat_model_is_configured(db) -> None:
    from app.answering.llm import UnconfiguredChatModel

    app.dependency_overrides[dependencies.get_chat_model] = lambda: UnconfiguredChatModel("anthropic")
    try:
        response = client.get("/ready")
    finally:
        app.dependency_overrides.pop(dependencies.get_chat_model, None)

    assert response.status_code == 200  # uploads and retrieval still work without it
    assert response.json()["chat_model"] == "not configured"


def test_a_body_that_is_not_json_gets_a_sentence_not_an_index() -> None:
    # MAS-89: was "1: JSON decode error".
    response = client.post("/api/query", content=b"{not json", headers={"content-type": "application/json"})

    assert response.status_code == 422
    assert response.json()["detail"] == "Request body is not valid JSON."


def test_field_errors_keep_their_field_name() -> None:
    response = client.post("/api/query", json={"contract_id": None})

    assert response.status_code == 422
    assert response.json()["detail"] == "question: Field required"
