"""Shared fixtures: a throwaway test database, and real PDF/DOCX builders.

Upload validation only checks that bytes look like a supported type, but the
ingestion pipeline actually parses them, so tests that exercise the full path
need genuine documents rather than byte stubs.
"""

import os
from collections.abc import Iterator
from io import BytesIO

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

# Keep app startup from running migrations under test; the `database` fixture
# below manages the schema itself.
os.environ.setdefault("APP_ENV", "test")
from docx import Document
from pypdf import PdfWriter

from app.database.migrations import run_migrations
from app.database.session import get_connection, get_database_url


# --- database ---------------------------------------------------------------


def _test_database_url(base_url: str) -> str:
    params = conninfo_to_dict(base_url)
    params["dbname"] = f"{params.get('dbname', 'postgres')}_test"
    return make_conninfo(**params)


def _ensure_database(base_url: str, name: str) -> None:
    # CREATE DATABASE cannot run inside a transaction, hence autocommit.
    with psycopg.connect(base_url, autocommit=True, connect_timeout=3) as connection:
        exists = connection.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (name,)
        ).fetchone()
        if not exists:
            connection.execute(f'CREATE DATABASE "{name}"')


@pytest.fixture(scope="session")
def database() -> Iterator[str]:
    """A migrated `<dbname>_test` database, and DATABASE_URL pointed at it.

    Skips when Postgres isn't reachable, unless MASIGN_REQUIRE_DB=1 (CI) makes
    that a failure instead. Tests never touch the dev database.
    """
    base_url = get_database_url()
    test_url = _test_database_url(base_url)
    try:
        _ensure_database(base_url, conninfo_to_dict(test_url)["dbname"])
    except psycopg.OperationalError as error:
        if os.getenv("MASIGN_REQUIRE_DB") == "1":
            raise
        pytest.skip(f"Postgres not reachable at {base_url}: {error}")

    run_migrations(test_url)
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = test_url
    yield test_url
    if previous is None:
        del os.environ["DATABASE_URL"]
    else:
        os.environ["DATABASE_URL"] = previous


@pytest.fixture
def db(database: str) -> Iterator[psycopg.Connection]:
    """A connection to the test database, emptied after each test."""
    with get_connection(database) as connection:
        yield connection
        connection.execute("TRUNCATE contracts CASCADE")


# --- documents --------------------------------------------------------------


def build_pdf(lines: list[str]) -> bytes:
    """Build a minimal one-page PDF containing the given lines of text."""
    content = "BT /F1 12 Tf 14 TL 72 720 Td\n"
    for line in lines:
        escaped = line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        content += f"({escaped}) Tj T*\n"
    content += "ET"
    stream = content.encode("latin-1")

    page = (
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]"
        b"/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>"
    )
    objects = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        page,
        b"<</Length " + str(len(stream)).encode() + b">>stream\n" + stream + b"\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_position = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<</Size {len(objects) + 1}/Root 1 0 R>>\n"
        f"startxref\n{xref_position}\n%%EOF\n"
    ).encode()

    return bytes(out)


def build_scanned_pdf() -> bytes:
    """A structurally valid PDF with no text layer, like a scan."""
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def build_docx(
    paragraphs: list[str],
    table_rows: list[list[str]] | None = None,
) -> bytes:
    document = Document()
    for paragraph in paragraphs:
        document.add_paragraph(paragraph)

    if table_rows:
        table = document.add_table(rows=len(table_rows), cols=len(table_rows[0]))
        for row_index, row in enumerate(table_rows):
            for cell_index, value in enumerate(row):
                table.rows[row_index].cells[cell_index].text = value

    buffer = BytesIO()
    document.save(buffer)
    return buffer.getvalue()


@pytest.fixture
def make_pdf():
    return build_pdf


@pytest.fixture
def make_scanned_pdf():
    return build_scanned_pdf


@pytest.fixture
def make_docx():
    return build_docx
