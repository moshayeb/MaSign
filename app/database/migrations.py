"""Apply the SQL files in app/database/migrations in order, exactly once each.

Deliberately small: the schema is two tables and a school-project timeline, so
a directory of numbered .sql files plus a bookkeeping table does the job
without pulling in Alembic. Add a migration by dropping `NNN_name.sql` next to
the existing ones; it runs on the next startup.
"""

import logging
from pathlib import Path

import psycopg

from app.database.session import get_database_url

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def discover_migrations(directory: Path = MIGRATIONS_DIR) -> list[Path]:
    """Return migration files in application order (lexical by filename)."""
    return sorted(path for path in directory.glob("*.sql") if path.is_file())


def run_migrations(database_url: str | None = None, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply every migration not yet recorded. Returns the versions applied."""
    url = database_url or get_database_url()
    applied: list[str] = []

    with psycopg.connect(url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version    TEXT        PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cursor.execute("SELECT version FROM schema_migrations")
            already_applied = {row[0] for row in cursor.fetchall()}
        connection.commit()

        for path in discover_migrations(directory):
            version = path.stem
            if version in already_applied:
                continue

            # Each file is one transaction: either the whole migration lands
            # together with its bookkeeping row, or nothing does.
            with connection.transaction():
                with connection.cursor() as cursor:
                    cursor.execute(path.read_text(encoding="utf-8"))
                    cursor.execute(
                        "INSERT INTO schema_migrations (version) VALUES (%s)",
                        (version,),
                    )
            logger.info("Applied migration %s", version)
            applied.append(version)

    return applied
