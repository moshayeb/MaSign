"""AA-47: uploading a contract produces real text chunks, end to end."""

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)

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
