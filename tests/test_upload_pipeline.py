"""MAS-9: uploading a contract produces real text chunks and stores them."""

from pathlib import Path
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.database import repository
from app.main import app


client = TestClient(app)

# Successful uploads are persisted, so every test here needs the test database.
pytestmark = pytest.mark.usefixtures("db")

SAMPLE_CONTRACT = (
    Path(__file__).resolve().parent.parent
    / "data"
    / "sample_contracts"
    / "acme_vendor_agreement.txt"
)


def _upload(filename: str, content: bytes, content_type: str):
    return client.post(
        "/api/contracts/upload",
        files={"file": (filename, content, content_type)},
    )


def test_uploading_a_contract_produces_chunks() -> None:
    response = _upload(
        "acme.txt",
        SAMPLE_CONTRACT.read_bytes(),
        "text/plain",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "processed"
    assert body["chunk_count"] >= 1
    assert body["character_count"] > 0


def test_character_count_reflects_parsed_text_not_raw_bytes() -> None:
    # The file has CRLF line endings; parsing normalises them, so the parsed
    # text is shorter than the uploaded byte count.
    raw = SAMPLE_CONTRACT.read_bytes()

    body = _upload("acme.txt", raw, "text/plain").json()

    assert body["size_bytes"] == len(raw)
    assert body["character_count"] < body["size_bytes"]


def test_long_contract_is_split_into_several_chunks() -> None:
    clauses = [
        f"{number}. Clause\n" + ("The vendor shall indemnify the customer. " * 20)
        for number in range(1, 16)
    ]
    content = "\n\n".join(clauses).encode("utf-8")

    body = _upload("long.txt", content, "text/plain").json()

    assert body["chunk_count"] > 1


def test_pdf_upload_is_parsed_into_chunks(make_pdf) -> None:
    pdf = make_pdf(["1. Services", "Vendor will provide document processing."])

    response = _upload("contract.pdf", pdf, "application/pdf")

    assert response.status_code == 200
    assert response.json()["chunk_count"] >= 1


def test_docx_upload_is_parsed_into_chunks(make_docx) -> None:
    docx = make_docx(["2. Fees", "ACME will pay according to the order form."])

    response = _upload(
        "contract.docx",
        docx,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

    assert response.status_code == 200
    assert response.json()["chunk_count"] >= 1


def test_upload_stores_contract_and_chunks_in_database(db: psycopg.Connection) -> None:
    body = _upload("acme.txt", SAMPLE_CONTRACT.read_bytes(), "text/plain").json()
    contract_id = UUID(body["contract_id"])

    stored = repository.get_contract(db, contract_id)
    assert stored is not None
    assert stored.filename == "acme.txt"
    assert stored.character_count == body["character_count"]

    chunks = repository.list_chunks(db, contract_id)
    assert len(chunks) == body["chunk_count"]
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    assert "".join(c.chunk_text for c in chunks)  # real text, not empty rows


def test_chunk_rows_match_the_chunker_output(db: psycopg.Connection) -> None:
    clauses = [
        f"{number}. Clause\n" + ("The vendor shall indemnify the customer. " * 20)
        for number in range(1, 16)
    ]
    body = _upload("long.txt", "\n\n".join(clauses).encode(), "text/plain").json()

    chunks = repository.list_chunks(db, UUID(body["contract_id"]))
    assert len(chunks) == body["chunk_count"] > 1
    assert chunks[0].chunk_text.startswith("1. Clause")


def test_failed_parse_stores_nothing(db: psycopg.Connection, make_scanned_pdf) -> None:
    response = _upload("scan.pdf", make_scanned_pdf(), "application/pdf")

    assert response.status_code == 422
    assert repository.list_contracts(db) == []


def test_contracts_can_be_listed_newest_first() -> None:
    first = _upload("first.txt", b"Clause one.", "text/plain").json()
    second = _upload("second.txt", b"Clause two.", "text/plain").json()

    response = client.get("/api/contracts")

    assert response.status_code == 200
    listed = [c["contract_id"] for c in response.json()]
    assert listed.index(second["contract_id"]) < listed.index(first["contract_id"])


def test_contract_detail_and_404() -> None:
    uploaded = _upload("acme.txt", SAMPLE_CONTRACT.read_bytes(), "text/plain").json()

    found = client.get(f"/api/contracts/{uploaded['contract_id']}")
    assert found.status_code == 200
    assert found.json()["filename"] == "acme.txt"
    assert found.json()["chunk_count"] == uploaded["chunk_count"]

    missing = client.get("/api/contracts/00000000-0000-0000-0000-000000000000")
    assert missing.status_code == 404

    malformed = client.get("/api/contracts/not-a-uuid")
    assert malformed.status_code == 422


def test_scanned_pdf_gets_a_clear_unsupported_document_message(make_scanned_pdf) -> None:
    response = _upload("scan.pdf", make_scanned_pdf(), "application/pdf")

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "No readable text" in detail
    assert "OCR" in detail


def test_unreadable_pdf_is_reported_rather_than_crashing() -> None:
    # Passes upload validation on the %PDF- signature, but pypdf cannot read it.
    response = _upload("broken.pdf", b"%PDF-1.4\nnot actually a pdf body", "application/pdf")

    assert response.status_code == 422
    assert "could not be read" in response.json()["detail"]
