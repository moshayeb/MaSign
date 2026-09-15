"""MAS-48: the temporary test database is dropped even if migrating it fails."""

import pytest

from tests import conftest


def test_failed_migration_still_drops_the_database(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    monkeypatch.setattr(conftest, "get_database_url", lambda: "postgresql://u:p@localhost:5433/base")
    monkeypatch.setattr(conftest, "_create_database", lambda url, name: events.append(f"create {name}"))
    monkeypatch.setattr(conftest, "_drop_database", lambda url, name: events.append(f"drop {name}"))

    def failing_migration(url):
        events.append("migrate")
        raise RuntimeError("simulated migration failure")

    monkeypatch.setattr(conftest, "run_migrations", failing_migration)

    # Drive the generator fixture by hand, as pytest would.
    generator = conftest.database.__wrapped__()
    with pytest.raises(RuntimeError, match="simulated migration failure"):
        next(generator)

    assert [e.split()[0] for e in events] == ["create", "migrate", "drop"]
    assert events[0].split()[1] == events[2].split()[1]  # same database name created and dropped
