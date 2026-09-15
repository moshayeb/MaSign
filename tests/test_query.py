"""MAS-39: the query endpoint rejects blank questions before doing any work."""

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.api.dependencies import get_db
from app.main import app


client = TestClient(app)


@pytest.fixture
def retriever_calls(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []

    def fake_retrieve(question: str, **_) -> list:
        calls.append(question)
        return []

    monkeypatch.setattr(routes, "retrieve_contract_context", fake_retrieve)
    app.dependency_overrides[get_db] = lambda: None  # retrieval is faked; no database needed
    yield calls
    app.dependency_overrides.pop(get_db, None)


@pytest.mark.parametrize("question", ["", "   ", "\t\t", "\n\t \n"])
def test_blank_questions_are_rejected_before_retrieval(
    question: str, retriever_calls: list[str]
) -> None:
    response = client.post("/api/query", json={"question": question})

    assert response.status_code == 422
    assert retriever_calls == []


def test_surrounding_whitespace_is_trimmed_before_retrieval(retriever_calls: list[str]) -> None:
    response = client.post("/api/query", json={"question": "  What is the term?\n"})

    assert response.status_code == 200
    assert retriever_calls == ["What is the term?"]


def test_missing_question_is_rejected(retriever_calls: list[str]) -> None:
    response = client.post("/api/query", json={})

    assert response.status_code == 422
    assert retriever_calls == []
