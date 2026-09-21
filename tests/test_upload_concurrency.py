"""MAS-41 / MAS-54: slow database work in an upload must not stall the event loop.

The blocking call (a write, or the cleanup after a failed upload) is faked to
take 400 ms. A 50 ms timer running on the same loop must finish long before
the upload does; if the call ran inline, the timer could not fire until it
returned.
"""

import time
from datetime import datetime, timezone
from time import perf_counter
from uuid import uuid4

import anyio
import httpx
import pytest

from app.api import routes
from app.api.dependencies import get_db
from app.database.models import Contract
from app.main import app


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def slow_database(monkeypatch: pytest.MonkeyPatch):
    def slow_create(db, *, filename, file_type, size_bytes, character_count, chunks, ingestion_notes=None, document_kind=None):
        time.sleep(0.4)  # blocking, like a real synchronous insert
        return Contract(
            id=uuid4(),
            filename=filename,
            file_type=file_type,
            size_bytes=size_bytes,
            character_count=character_count,
            chunk_count=len(chunks),
            status="processed",
            created_at=datetime.now(timezone.utc),
        )

    class FakeConnection:
        def commit(self) -> None:
            pass

    monkeypatch.setattr(routes.repository, "create_contract", slow_create)
    monkeypatch.setattr(routes, "index_contract", lambda *args, **kwargs: 0)
    # The whole-contract review (MAS-81) is not what is measured here.
    monkeypatch.setattr(routes.repository, "start_risk_review", lambda *args, **kwargs: None)
    monkeypatch.setattr(routes, "run_review_in_background", lambda *args, **kwargs: None)
    app.dependency_overrides[get_db] = lambda: FakeConnection()  # no real connection needed
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def slow_cleanup(monkeypatch: pytest.MonkeyPatch):
    """Indexing fails, and removing the contract afterwards is slow (MAS-54)."""
    from app.retrieval.vector_store import VectorStoreError

    class FakeConnection:
        def rollback(self) -> None:
            pass

    def fast_create(db, *, filename, file_type, size_bytes, character_count, chunks, ingestion_notes=None, document_kind=None):
        return Contract(
            id=uuid4(),
            filename=filename,
            file_type=file_type,
            size_bytes=size_bytes,
            character_count=character_count,
            chunk_count=len(chunks),
            status="processed",
            created_at=datetime.now(timezone.utc),
        )

    def failing_index(*args, **kwargs):
        raise VectorStoreError("connection refused (simulated)")

    def slow_delete(db, contract_id) -> bool:
        time.sleep(0.4)  # blocking, like a real synchronous delete
        return True

    monkeypatch.setattr(routes.repository, "create_contract", fast_create)
    monkeypatch.setattr(routes, "index_contract", failing_index)
    monkeypatch.setattr(routes.repository, "delete_contract", slow_delete)
    app.dependency_overrides[get_db] = lambda: FakeConnection()
    yield
    app.dependency_overrides.pop(get_db, None)


async def _upload_while_timing(timer_seconds: float = 0.05) -> tuple[httpx.Response, float]:
    """POST an upload while a timer runs on the same loop; return both results."""
    timer_elapsed: float | None = None

    async def timer() -> None:
        nonlocal timer_elapsed
        started = perf_counter()
        await anyio.sleep(timer_seconds)
        timer_elapsed = perf_counter() - started

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        async with anyio.create_task_group() as tasks:
            tasks.start_soon(timer)
            response = await client.post(
                "/api/contracts/upload",
                files={"file": ("contract.txt", b"Clause one.", "text/plain")},
            )

    assert timer_elapsed is not None
    return response, timer_elapsed


@pytest.mark.anyio
async def test_slow_database_write_does_not_block_other_work(slow_database) -> None:
    response, timer_elapsed = await _upload_while_timing()

    assert response.status_code == 200
    # Inline, the timer would measure ~0.4 s; off the loop it measures ~0.05 s.
    assert timer_elapsed < 0.25, f"event loop was blocked for {timer_elapsed:.3f}s"


@pytest.mark.anyio
async def test_slow_failed_upload_cleanup_does_not_block_other_work(slow_cleanup) -> None:
    response, timer_elapsed = await _upload_while_timing()

    assert response.status_code == 503
    assert "Vector store unavailable" in response.json()["detail"]
    assert timer_elapsed < 0.25, f"event loop was blocked for {timer_elapsed:.3f}s"
