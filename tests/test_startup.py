"""MAS-40: application startup runs migrations, and a failure there is fatal.

The other API tests deliberately construct TestClient without entering it, so
they never exercise the lifespan. These do, with run_migrations mocked so no
real database is touched.
"""

from contextlib import nullcontext

import pytest
from fastapi.testclient import TestClient

from app import main


class _StubEmbedder:
    backend = "stub"
    model_name = "stub"
    dimension = 4
    warmed_up = False

    def warm_up(self) -> None:
        self.warmed_up = True


class _StubStore:
    index_checked_with: tuple | None = None


@pytest.fixture
def production_like_env(monkeypatch: pytest.MonkeyPatch) -> tuple[_StubEmbedder, _StubStore]:
    # Startup also warms the embedding model and checks the vector index
    # against it (MAS-52); stub all of that so no model is downloaded and
    # neither Postgres nor Qdrant is needed.
    monkeypatch.setenv("APP_ENV", "development")
    embedder, store = _StubEmbedder(), _StubStore()
    monkeypatch.setattr(main, "get_embedder", lambda: embedder)
    monkeypatch.setattr(main, "get_vector_store", lambda: store)
    monkeypatch.setattr(main, "get_connection", lambda: nullcontext("fake connection"))

    def fake_ensure_index_current(db, embedder, store):
        store.index_checked_with = (db, embedder)

    monkeypatch.setattr(main, "ensure_index_current", fake_ensure_index_current)
    # The MAS-107 backfill needs a real connection; the fake one has none.
    monkeypatch.setattr(main.repository, "classify_unclassified_contracts", lambda db: 0)
    return embedder, store


def test_startup_runs_migrations_before_serving(
    production_like_env: tuple[_StubEmbedder, _StubStore], monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(main, "run_migrations", lambda: calls.append("migrated") or [])
    embedder, store = production_like_env

    with TestClient(main.app) as client:
        assert calls == ["migrated"]  # already applied when the first request can be made
        assert client.get("/health").status_code == 200

    assert calls == ["migrated"]
    # MAS-11 / MAS-52: the model is loaded and the index checked against it before serving.
    assert embedder.warmed_up is True
    assert store.index_checked_with == ("fake connection", embedder)


def test_startup_fails_when_migrations_fail(
    production_like_env: tuple[_StubEmbedder, _StubStore], monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken_migrations():
        raise RuntimeError("simulated unavailable database")

    monkeypatch.setattr(main, "run_migrations", broken_migrations)

    with pytest.raises(RuntimeError, match="simulated unavailable database"):
        with TestClient(main.app):
            pass


def test_startup_fails_when_the_embedding_service_is_down(
    production_like_env: tuple[_StubEmbedder, _StubStore], monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    # MAS-61: EMBEDDING_BACKEND=openai-compatible with nothing listening at
    # EMBEDDING_API_URL. Serving would only produce 503s, so refuse to start.
    import httpx

    from app.retrieval.embeddings import EmbeddingServiceError, OpenAICompatibleEmbedder

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused (simulated)", request=request)

    monkeypatch.setattr(main, "run_migrations", lambda: [])
    embedder = OpenAICompatibleEmbedder("qwen", "http://llama-server:8081", transport=httpx.MockTransport(refuse))
    monkeypatch.setattr(main, "get_embedder", lambda: embedder)

    with caplog.at_level("ERROR", logger="app.main"):
        with pytest.raises(EmbeddingServiceError, match="http://llama-server:8081 is unreachable"):
            with TestClient(main.app):
                pass

    assert "Cannot start: Embedding service at http://llama-server:8081 is unreachable" in caplog.text


def test_test_environment_skips_migrations(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    calls: list[str] = []
    monkeypatch.setattr(main, "run_migrations", lambda: calls.append("migrated") or [])

    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200

    assert calls == []
