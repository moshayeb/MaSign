"""MAS-41: a slow database write must not stall the event loop.

The write is faked to take 400 ms. A 50 ms timer running on the same loop
must finish long before the upload does; if the write ran inline, the timer
could not fire until the write returned.
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
    def slow_create(db, *, filename, file_type, size_bytes, character_count, chunks):
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

    monkeypatch.setattr(routes.repository, "create_contract", slow_create)
    app.dependency_overrides[get_db] = lambda: None  # no real connection needed
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.mark.anyio
async def test_slow_database_write_does_not_block_other_work(slow_database) -> None:
    timer_elapsed: float | None = None

    async def timer() -> None:
        nonlocal timer_elapsed
        started = perf_counter()
        await anyio.sleep(0.05)
        timer_elapsed = perf_counter() - started

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        async with anyio.create_task_group() as tasks:
            tasks.start_soon(timer)
            response = await client.post(
                "/api/contracts/upload",
                files={"file": ("contract.txt", b"Clause one.", "text/plain")},
            )

    assert response.status_code == 200
    assert timer_elapsed is not None
    # Inline, the timer would measure ~0.4 s; off the loop it measures ~0.05 s.
    assert timer_elapsed < 0.25, f"event loop was blocked for {timer_elapsed:.3f}s"
