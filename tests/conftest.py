"""Shared builders for real PDF and DOCX documents used across the test suite.

Upload validation only checks that bytes look like a supported type, but the
ingestion pipeline actually parses them, so tests that exercise the full path
need genuine documents rather than byte stubs.
"""

import os
from io import BytesIO

import pytest

# Keep app startup from running migrations under test; the database tests
# manage the schema themselves against DATABASE_URL.
os.environ.setdefault("APP_ENV", "test")
from docx import Document
from pypdf import PdfWriter


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
