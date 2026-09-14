"""MAS-40: application startup runs migrations, and a failure there is fatal.

The other API tests deliberately construct TestClient without entering it, so
they never exercise the lifespan. These do, with run_migrations mocked so no
real database is touched.
"""

import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture
def production_like_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")


def test_startup_runs_migrations_before_serving(
    production_like_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(main, "run_migrations", lambda: calls.append("migrated") or [])

    with TestClient(main.app) as client:
        assert calls == ["migrated"]  # already applied when the first request can be made
        assert client.get("/health").status_code == 200

    assert calls == ["migrated"]


def test_startup_fails_when_migrations_fail(
    production_like_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken_migrations():
        raise RuntimeError("simulated unavailable database")

    monkeypatch.setattr(main, "run_migrations", broken_migrations)

    with pytest.raises(RuntimeError, match="simulated unavailable database"):
        with TestClient(main.app):
            pass


def test_test_environment_skips_migrations(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    calls: list[str] = []
    monkeypatch.setattr(main, "run_migrations", lambda: calls.append("migrated") or [])

    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200

    assert calls == []
