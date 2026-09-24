"""MAS-138: a bundle review reads every linked document's (MAS-137) chunks as
one review unit, stored under the primary contract -- while every finding,
key term and citation still names the real document it came from. A linked
document opened on its own keeps its own, fully independent review."""

import json
from uuid import UUID

from fastapi.testclient import TestClient

from app.database import repository
from app.main import app
from app.risk_analysis.review import review_contract
from tests.conftest import FakeChatModel

client = TestClient(app)

# Short enough that each upload is exactly one chunk (well under the ~1200
# character chunk size), so passage numbers are predictable: within one
# bundle batch, the primary's own chunk is passage 1 and the linked
# document's is passage 2 (repository.bundle_contract_ids puts the primary first).
PRIMARY_TEXT = "2. Fees. The Fees are as set out in the Order Form. Customer's liability under this Agreement shall be unlimited."
LINKED_TEXT = "1. Order Form. Customer shall pay EUR 18,500 per month."


def _upload(name: str, text: str) -> UUID:
    response = client.post("/api/contracts/upload", files={"file": (name, text.encode(), "text/plain")})
    assert response.status_code == 200, response.text
    return UUID(response.json()["contract_id"])


def _link(primary_id: UUID, linked_id: UUID, reference_name: str = "Order Form") -> str:
    response = client.post(f"/api/contracts/{primary_id}/links", json={"linked_contract_id": str(linked_id), "reference_name": reference_name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _findings(contract_id: UUID) -> list[dict]:
    return client.get(f"/api/contracts/{contract_id}/risks").json()["findings"]


def _terms(contract_id: UUID) -> dict[str, dict]:
    return {t["id"]: t for t in client.get(f"/api/contracts/{contract_id}/key-terms").json()["terms"]}


def test_bundle_review_reads_every_linked_documents_chunks(db, fake_chat_model: FakeChatModel) -> None:
    primary_id = _upload("main.txt", PRIMARY_TEXT)
    linked_id = _upload("order-form.txt", LINKED_TEXT)
    _link(primary_id, linked_id)

    # A finding on the primary's own text, a key term on the linked document's.
    fake_chat_model.risk_reply = json.dumps(
        [{"category": "liability", "severity": "High", "reason": "unlimited liability", "passage": 1, "quote": "shall be unlimited"}]
    )
    fake_chat_model.key_terms_reply = json.dumps(
        [{"term": "recurring_fee", "value": "EUR 18,500 per month", "passage": 2, "quote": "pay EUR 18,500 per month", "typed": None}]
    )
    review = review_contract(primary_id, fake_chat_model)

    assert review.chunks_total == 2  # both documents' chunks, one review unit
    assert review.contract_id == primary_id  # stored under the primary, not a new bundle entity

    findings = _findings(primary_id)
    assert len(findings) == 1 and findings[0]["contract_id"] == str(primary_id)  # sourced from the primary's own passage

    fee = _terms(primary_id)["recurring_fee"]
    assert fee["status"] == "found" and fee["source"]["contract_id"] == str(linked_id)  # sourced from the linked document


def test_a_linked_documents_own_solo_review_stays_independent(db, fake_chat_model: FakeChatModel) -> None:
    primary_id = _upload("main.txt", PRIMARY_TEXT)
    linked_id = _upload("order-form.txt", LINKED_TEXT)
    _link(primary_id, linked_id)

    fake_chat_model.risk_reply = json.dumps(
        [{"category": "liability", "severity": "High", "reason": "unlimited liability", "passage": 1, "quote": "shall be unlimited"}]
    )
    review_contract(primary_id, fake_chat_model)  # bundle review: one finding, on the primary's own passage

    fake_chat_model.risk_reply = "[]"
    linked_review = review_contract(linked_id, fake_chat_model)  # the linked document reviewed entirely on its own

    assert linked_review.chunks_total == 1  # only its own chunk -- not the bundle
    assert _findings(linked_id) == []
    assert len(_findings(primary_id)) == 1  # the primary's bundle review is untouched


def test_a_finding_on_a_linked_chunk_and_that_documents_own_solo_finding_do_not_collide(db, fake_chat_model: FakeChatModel) -> None:
    """Regression guard for the storage bug migration 011 fixes: before it, a
    finding stored under the primary (for a linked chunk) and the same
    chunk's own later solo finding shared one UNIQUE(chunk_id, category) row,
    so the second write was silently dropped by ON CONFLICT DO NOTHING."""
    primary_id = _upload("main.txt", PRIMARY_TEXT)
    linked_id = _upload("order-form.txt", LINKED_TEXT)
    _link(primary_id, linked_id)

    # The bundle review finds something on the LINKED document's own chunk (passage 2).
    fake_chat_model.risk_reply = json.dumps(
        [{"category": "payment_terms", "severity": "Medium", "reason": "x", "passage": 2, "quote": "EUR 18,500 per month"}]
    )
    review_contract(primary_id, fake_chat_model)
    bundle_findings = _findings(primary_id)
    assert len(bundle_findings) == 1 and bundle_findings[0]["contract_id"] == str(linked_id)

    # The exact same chunk and category, found again by the document's own solo review.
    fake_chat_model.risk_reply = json.dumps(
        [{"category": "payment_terms", "severity": "Medium", "reason": "x", "passage": 1, "quote": "EUR 18,500 per month"}]
    )
    review_contract(linked_id, fake_chat_model)

    assert len(_findings(linked_id)) == 1  # the solo review's own row was not silently dropped
    assert len(_findings(primary_id)) == 1  # nor did it clobber the bundle review's row


def test_rereview_after_unlink_drops_the_linked_documents_content(db, fake_chat_model: FakeChatModel) -> None:
    primary_id = _upload("main.txt", PRIMARY_TEXT)
    linked_id = _upload("order-form.txt", LINKED_TEXT)
    link_id = _link(primary_id, linked_id)

    fake_chat_model.key_terms_reply = json.dumps(
        [{"term": "recurring_fee", "value": "EUR 18,500 per month", "passage": 2, "quote": "pay EUR 18,500 per month", "typed": None}]
    )
    review_contract(primary_id, fake_chat_model)
    assert client.get(f"/api/contracts/{primary_id}/risks").json()["chunks_total"] == 2
    assert _terms(primary_id)["recurring_fee"]["status"] == "found"

    client.delete(f"/api/contracts/{primary_id}/links/{link_id}")
    assert client.get(f"/api/contracts/{primary_id}/risks").json()["status"] == "failed"

    fake_chat_model.key_terms_reply = "[]"
    rereviewed = review_contract(primary_id, fake_chat_model)

    assert rereviewed.chunks_total == 1  # only the primary's own chunk now
    assert _terms(primary_id)["recurring_fee"]["status"] == "not_stated"  # the fee lived only in the unlinked document


# --- retrieval across the bundle (MAS-138 extends /api/query) ------------------------------


def test_query_scoped_to_a_bundle_retrieves_the_linked_documents_passages_too(db) -> None:
    primary_id = _upload("main.txt", PRIMARY_TEXT)
    linked_id = _upload("order-form.txt", LINKED_TEXT)
    _link(primary_id, linked_id)

    response = client.post("/api/query", json={"question": "EUR 18,500 per month", "contract_id": str(primary_id)})

    assert response.status_code == 200
    contract_ids = {hit["contract_id"] for hit in response.json()["retrieved_context"]}
    assert contract_ids == {str(primary_id), str(linked_id)}


def test_query_scoped_to_a_contract_with_no_links_only_searches_that_contract(db) -> None:
    solo_id = _upload("solo.txt", PRIMARY_TEXT)
    _upload("other.txt", "Completely unrelated text about widgets and gadgets.")

    response = client.post("/api/query", json={"question": "unlimited liability", "contract_id": str(solo_id)})

    assert {hit["contract_id"] for hit in response.json()["retrieved_context"]} == {str(solo_id)}


# --- repository ------------------------------------------------------------------------------


def test_bundle_contract_ids_feeds_the_review_chunk_count(db, fake_chat_model: FakeChatModel) -> None:
    primary_id = _upload("main.txt", PRIMARY_TEXT)
    linked_id = _upload("order-form.txt", LINKED_TEXT)
    _link(primary_id, linked_id)

    assert repository.bundle_contract_ids(db, primary_id) == [primary_id, linked_id]

    review = review_contract(primary_id, fake_chat_model)
    assert review.chunks_total == sum(len(repository.list_chunks(db, cid)) for cid in [primary_id, linked_id])
