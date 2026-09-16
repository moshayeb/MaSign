"""MAS-17: the built React app is served from the root when it exists."""

import importlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main


def _reload_main(monkeypatch: pytest.MonkeyPatch, dist: Path | None):
    # The mount is decided at import time from FRONTEND_DIST; reload to re-decide.
    monkeypatch.setenv("FRONTEND_DIST", str(dist) if dist else "/nonexistent")
    return importlib.reload(main)


def test_built_ui_is_served_from_the_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "index.html").write_text("<!doctype html><title>MaSign</title><div id=root></div>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('ui')")
    module = _reload_main(monkeypatch, tmp_path)

    client = TestClient(module.app)

    assert "<title>MaSign</title>" in client.get("/").text
    assert client.get("/assets/app.js").text == "console.log('ui')"
    assert client.get("/health").json() == {"status": "ok"}  # API routes still win
    assert client.get("/api/contracts/not-a-uuid").status_code == 422


def test_without_a_built_ui_the_root_redirects_to_the_docs(monkeypatch: pytest.MonkeyPatch) -> None:
    module = _reload_main(monkeypatch, None)

    response = TestClient(module.app).get("/", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/docs"


@pytest.fixture(autouse=True)
def _restore_main(monkeypatch: pytest.MonkeyPatch):
    # Other test modules hold `app.main.app`; put the module back the way it was.
    yield
    monkeypatch.delenv("FRONTEND_DIST", raising=False)
    importlib.reload(main)
