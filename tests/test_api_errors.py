"""Operational failures surface as clear API errors, not bare 500s."""

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.database import session
from app.main import app


@pytest.fixture
def client_without_database(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # Simulate Postgres being down at the connect call itself: deterministic,
    # and avoids a real socket attempt that some platforms leave hanging.
    def refuse(*_args, **_kwargs):
        raise psycopg.OperationalError("connection refused (simulated)")

    monkeypatch.setattr(session.psycopg, "connect", refuse)
    return TestClient(app)


def test_upload_reports_database_unavailable(client_without_database: TestClient) -> None:
    response = client_without_database.post(
        "/api/contracts/upload",
        files={"file": ("contract.txt", b"Clause one.", "text/plain")},
    )

    assert response.status_code == 503
    assert "Database unavailable" in response.json()["detail"]


def test_listing_reports_database_unavailable(client_without_database: TestClient) -> None:
    response = client_without_database.get("/api/contracts")

    assert response.status_code == 503
    assert "Database unavailable" in response.json()["detail"]


def test_health_does_not_need_the_database(client_without_database: TestClient) -> None:
    assert client_without_database.get("/health").status_code == 200
