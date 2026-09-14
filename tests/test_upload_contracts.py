from fastapi.testclient import TestClient

from app.ingestion.uploads import MAX_UPLOAD_BYTES
from app.main import app


client = TestClient(app)


def test_upload_accepts_text_contract() -> None:
    response = client.post(
        "/api/contracts/upload",
        files={
            "file": (
                "contract.txt",
                b"Services\n\nEither party may terminate on 30 days notice.",
                "text/plain",
            ),
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "filename": "contract.txt",
        "file_type": "txt",
        "content_type": "text/plain",
        "size_bytes": 55,
        "max_size_bytes": MAX_UPLOAD_BYTES,
        "status": "processed",
        "character_count": 55,
        "chunk_count": 1,
    }


def test_upload_accepts_pdf_contract_by_content_signature(make_pdf) -> None:
    # A real PDF, not just the %PDF- signature: the endpoint parses the file
    # now, so a stub that only looks like a PDF no longer gets through.
    response = client.post(
        "/api/contracts/upload",
        files={
            "file": (
                "contract.pdf",
                make_pdf(["3. Limitation of Liability", "Vendor liability is capped."]),
                "application/pdf",
            ),
        },
    )

    assert response.status_code == 200
    assert response.json()["file_type"] == "pdf"


def test_upload_accepts_docx_contract_by_package_contents(make_docx) -> None:
    # A real DOCX package, for the same reason as the PDF test above.
    response = client.post(
        "/api/contracts/upload",
        files={
            "file": (
                "contract.docx",
                make_docx(["4. Termination", "Either party may terminate for breach."]),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
        },
    )

    assert response.status_code == 200
    assert response.json()["file_type"] == "docx"


def test_upload_rejects_missing_file() -> None:
    response = client.post("/api/contracts/upload")

    assert response.status_code == 422


def test_upload_rejects_empty_file() -> None:
    response = client.post(
        "/api/contracts/upload",
        files={"file": ("empty.txt", b"", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Uploaded file is empty."


def test_upload_rejects_oversized_file() -> None:
    response = client.post(
        "/api/contracts/upload",
        files={
            "file": (
                "contract.txt",
                b"a" * (MAX_UPLOAD_BYTES + 1),
                "text/plain",
            ),
        },
    )

    assert response.status_code == 413


def test_upload_rejects_unsupported_file_content() -> None:
    response = client.post(
        "/api/contracts/upload",
        files={
            "file": (
                "contract.txt",
                b"\x00\x01\x02\x03\x04",
                "text/plain",
            ),
        },
    )

    assert response.status_code == 415
    assert response.json()["detail"] == (
        "Unsupported file content. Upload a TXT, PDF, or DOCX contract."
    )


def test_upload_rejects_supported_extension_with_mismatched_content() -> None:
    response = client.post(
        "/api/contracts/upload",
        files={
            "file": (
                "contract.pdf",
                b"This is plain text pretending to be a PDF.",
                "application/octet-stream",
            ),
        },
    )

    assert response.status_code == 415
    assert response.json()["detail"] == (
        "Filename extension does not match uploaded file content."
    )


def test_upload_rejects_unsupported_extension_even_with_valid_content() -> None:
    response = client.post(
        "/api/contracts/upload",
        files={
            "file": (
                "contract.exe",
                b"Valid contract text.",
                "application/octet-stream",
            ),
        },
    )

    assert response.status_code == 415
    assert response.json()["detail"] == (
        "Unsupported filename extension. Upload a TXT, PDF, or DOCX contract."
    )


def test_upload_rejects_mismatched_supported_mime_type() -> None:
    response = client.post(
        "/api/contracts/upload",
        files={
            "file": (
                "contract.txt",
                b"Valid contract text.",
                "application/pdf",
            ),
        },
    )

    assert response.status_code == 415
    assert response.json()["detail"] == (
        "Client MIME type does not match uploaded file content."
    )


def test_upload_rejects_unsupported_mime_type_even_with_valid_content() -> None:
    response = client.post(
        "/api/contracts/upload",
        files={
            "file": (
                "contract.txt",
                b"Valid contract text.",
                "image/png",
            ),
        },
    )

    assert response.status_code == 415
    assert response.json()["detail"] == (
        "Unsupported client MIME type. Upload a TXT, PDF, or DOCX contract."
    )
