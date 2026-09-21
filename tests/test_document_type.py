"""Is the file a commercial contract at all? (MAS-107) — by rule, no model call, never a gate."""

from pathlib import Path

from fastapi.testclient import TestClient

from app.database import repository
from app.ingestion.document_type import classify_document
from app.main import app
from tests.conftest import FakeChatModel

client = TestClient(app)

SAMPLES = Path(__file__).resolve().parent.parent / "data" / "sample_contracts"

INVOICE = """INVOICE
Invoice Number: INV-2026-0142
Invoice Date: 12 September 2026
Bill To: Northwind Traders, 12 Harbour Road
Description                      Qty   Unit price   Line total
Consulting services, August       10     150.00       1,500.00
Subtotal                                               1,500.00
VAT 25%                                                  375.00
Amount due                                             1,875.00
Please pay by 12 October 2026 quoting payment reference INV-2026-0142.
Remit to: Bank account 1234-5678.
"""

QUOTATION = """QUOTATION
Quotation No. Q-2026-88 — prepared for Harbor Logistics AB
Valid until 31 October 2026
Item                     Qty   Unit price   Line total
Licence, 25 seats         25     40.00      1,000.00
Onboarding workshop        1    900.00        900.00
Prices exclude VAT. Delivery within 10 working days of order.
We are pleased to quote the above; please sign and return to accept.
"""

REQUIREMENTS = """Software Requirements Specification — Warehouse Scanner App
1. Introduction
This SRS describes the functional requirements and non-functional requirements of the scanner app.
2. Functional requirements
FR-1 The system shall read EAN-13 barcodes within 300 ms.
FR-2 The application must work offline and sync when a connection returns.
User story: as a picker I want to see the next bin so that I do not walk back.
Acceptance criteria: the next bin is shown within one second of a scan.
3. Use cases
Use case 1: pick an order. Use case 2: count stock.
"""

EMAIL = """From: Anna Berg
To: Mo
Subject: Friday call
Dear Mo,
here is the agenda for Friday: pricing, the minutes from last week, and the open action items.
Let me know if you want to add anything before we meet.
Best regards,
Anna
"""


def test_the_sample_contracts_read_as_contracts() -> None:
    for name in ("northwind_master_services_agreement.txt", "harbor_software_subscription.txt", "acme_vendor_agreement.txt"):
        kind = classify_document((SAMPLES / name).read_text(encoding="utf-8"))
        assert kind.kind == "contract", (name, kind)
        assert kind.looks_like is None
        assert kind.reasons[0].startswith("Contract markers: 'agreement / contract'")


def test_common_non_contracts_are_flagged_with_the_type_and_the_markers() -> None:
    invoice = classify_document(INVOICE)
    assert (invoice.kind, invoice.looks_like) == ("not_contract", "invoice")
    assert invoice.reasons == ["Invoice markers: 'Invoice number', 'Amount due', 'Bill to', 'Subtotal', 'VAT / tax line', 'Remittance' and 1 more"]

    quotation = classify_document(QUOTATION)
    assert (quotation.kind, quotation.looks_like) == ("not_contract", "quotation")
    assert "'Quotation number'" in quotation.reasons[-1] and "'Valid until'" in quotation.reasons[-1]

    requirements = classify_document(REQUIREMENTS)
    assert (requirements.kind, requirements.looks_like) == ("not_contract", "requirements document")

    email = classify_document(EMAIL)
    assert (email.kind, email.looks_like) == ("not_contract", "correspondence or notes")


def test_a_short_or_featureless_text_is_uncertain_not_a_verdict() -> None:
    short = classify_document("Meeting tomorrow at ten. Bring the printouts.")
    assert short.kind == "uncertain" and short.looks_like is None
    assert short.reasons == ["Only 7 words — too short to classify"]

    prose = classify_document(" ".join(["The weather was fine and the road was long."] * 20))
    assert prose.kind == "uncertain"
    assert prose.reasons == ["No contract or other document markers found"]

    # A contract pasted into an email: markers on both sides, no verdict.
    mixed = classify_document(EMAIL + "\n" + (SAMPLES / "acme_vendor_agreement.txt").read_text(encoding="utf-8"))
    assert mixed.kind == "uncertain"
    assert mixed.looks_like == "correspondence or notes"


def test_upload_stores_the_kind_and_the_list_review_and_export_carry_it(db, fake_chat_model: FakeChatModel) -> None:
    upload = client.post("/api/contracts/upload", files={"file": ("august.txt", INVOICE.encode(), "text/plain")})
    assert upload.status_code == 200, upload.text  # never blocked on the classification
    body = upload.json()
    assert body["document_kind"] == "not_contract"
    assert body["document_looks_like"] == "invoice"
    assert body["document_kind_reasons"][0].startswith("Invoice markers: 'Invoice number'")

    listed = next(c for c in client.get("/api/contracts").json() if c["contract_id"] == body["contract_id"])
    assert (listed["document_kind"], listed["document_looks_like"]) == ("not_contract", "invoice")

    review = client.get(f"/api/contracts/{body['contract_id']}/risks").json()
    assert review["coverage"]["document_kind"] == "not_contract"
    assert review["coverage"]["document_looks_like"] == "invoice"

    markdown = client.get(f"/api/contracts/{body['contract_id']}/export.md").text
    assert "- Document type: likely not a commercial contract — looks like invoice; the key terms and risk verdicts below use the contract rubric and may not be meaningful" in markdown

    contract = client.post("/api/contracts/upload", files={"file": ("acme.txt", (SAMPLES / "acme_vendor_agreement.txt").read_bytes(), "text/plain")}).json()
    assert contract["document_kind"] == "contract" and contract["document_looks_like"] is None


def test_rows_from_before_the_kind_existed_are_classified_at_startup(db) -> None:
    contract = repository.create_contract(
        db, filename="old.txt", file_type="txt", size_bytes=10, character_count=10, chunks=[INVOICE], ingestion_notes=[]
    )
    assert contract.document_kind is None  # what an old row looks like
    db.commit()

    assert repository.classify_unclassified_contracts(db) == 1
    assert repository.classify_unclassified_contracts(db) == 0  # once

    stored = repository.get_contract(db, contract.id)
    assert stored is not None and (stored.document_kind, stored.document_looks_like) == ("not_contract", "invoice")
    assert stored.document_kind_reasons[0].startswith("Invoice markers")
    # Jsonb round-trips the list as given.
    with db.cursor() as cursor:
        cursor.execute("SELECT document_kind_reasons FROM contracts WHERE id = %s", (contract.id,))
        assert cursor.fetchone()["document_kind_reasons"] == stored.document_kind_reasons
