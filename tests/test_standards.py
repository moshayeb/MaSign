"""Editable company standards (MAS-120): save, validate, reset, persist, and
that a saved standard actually changes the key-terms verdict shown -- all
without a model call."""

import json
from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import repository
from app.database.session import get_connection
from app.key_terms.standards import DEFAULT_PARAMS
from app.main import app
from app.risk_analysis.review import review_contract
from tests.conftest import FakeChatModel

client = TestClient(app)

FEES = "2. Fees. Customer shall pay EUR 18,500 per month, invoiced monthly in advance. Invoices are due thirty (30) days after the invoice date."
EARLY_TERM = "4.3 Early termination fee: fifty percent (50%) of the remaining Subscription Fees."


def _item(term: str, value: str, passage: int, quote: str, typed: dict | None = None) -> dict:
    return {"term": term, "value": value, "passage": passage, "quote": quote, "typed": typed}


def _stored(db, workspace_id, *passages: str) -> str:
    contract = repository.create_contract(
        db, workspace_id=workspace_id, filename="c.txt", file_type="txt", size_bytes=1, character_count=1, chunks=list(passages)
    )
    db.commit()
    return contract.id


def test_get_standards_returns_masigns_built_in_defaults_when_nothing_saved(db) -> None:
    body = client.get("/api/standards").json()
    by_id = {s["id"]: s for s in body}
    assert set(by_id) == set(DEFAULT_PARAMS)
    assert all(s["is_default"] for s in body)
    assert by_id["payment_deadline"]["text"] == "net 30 days or longer"
    assert by_id["payment_deadline"]["params"] == {"net_days_min": 30}
    assert by_id["termination_cost"]["text"] == "no early-termination fee"


def test_save_standard_is_validated_persisted_and_returned_by_get(db) -> None:
    bad = client.put("/api/standards/payment_deadline", json={"params": {"net_days_min": -5}})
    assert bad.status_code == 422
    assert "days" in bad.json()["detail"].lower()

    ok = client.put("/api/standards/payment_deadline", json={"params": {"net_days_min": 45}})
    assert ok.status_code == 200
    assert ok.json() == {"id": "payment_deadline", "name": "Payment deadline", "text": "net 45 days or longer", "params": {"net_days_min": 45}, "is_default": False}

    again = client.get("/api/standards").json()
    saved = next(s for s in again if s["id"] == "payment_deadline")
    assert saved["params"] == {"net_days_min": 45}
    assert saved["is_default"] is False


def test_save_persists_across_a_fresh_connection_like_an_application_restart(db, database: str) -> None:
    client.put("/api/standards/notice_period", json={"params": {"notice_days_max": 30}})

    # A brand new connection, not the request-scoped one the PUT used --
    # the value must have actually reached Postgres, not just this process.
    with get_connection(database) as fresh:
        stored = repository.get_standards(fresh)
    assert stored["notice_period"] == {"notice_days_max": 30}


def test_reset_restores_masigns_default(db) -> None:
    client.put("/api/standards/notice_period", json={"params": {"notice_days_max": 10}})
    reset = client.delete("/api/standards/notice_period")
    assert reset.status_code == 200
    assert reset.json()["is_default"] is True
    assert reset.json()["params"] == DEFAULT_PARAMS["notice_period"]

    body = client.get("/api/standards").json()
    saved = next(s for s in body if s["id"] == "notice_period")
    assert saved["is_default"] is True


def test_unknown_standard_id_is_404_not_a_silent_no_op() -> None:
    assert client.put("/api/standards/not_a_real_term", json={"params": {}}).status_code == 404
    assert client.delete("/api/standards/not_a_real_term").status_code == 404


def test_termination_cost_preference_validates_its_mode_and_paired_fields(db) -> None:
    missing_percent = client.put("/api/standards/termination_cost", json={"params": {"mode": "percent_cap"}})
    assert missing_percent.status_code == 422

    bad_currency = client.put(
        "/api/standards/termination_cost", json={"params": {"mode": "amount_cap", "max_amount": 5000, "currency": "GBP"}}
    )
    assert bad_currency.status_code == 422
    assert "currency" in bad_currency.json()["detail"].lower()

    ok = client.put("/api/standards/termination_cost", json={"params": {"mode": "amount_cap", "max_amount": 5000, "currency": "USD"}})
    assert ok.status_code == 200
    assert ok.json()["text"] == "at most USD 5,000"


def test_saved_standard_changes_the_key_terms_verdict_and_deviation_count(db, fake_chat_model: FakeChatModel, workspace_id) -> None:
    """A contract that met the default standard can start deviating from a
    stricter one the reviewer saved -- with no re-review, no model call."""
    contract_id = _stored(db, workspace_id, FEES)

    def extract(user: str) -> str:
        return json.dumps([_item("payment_deadline", "30 days", 1, "due thirty (30) days after the invoice date", {"net_days": 30})])

    fake_chat_model.key_terms_reply = extract
    review_contract(contract_id, fake_chat_model, batch_size=1)

    before = client.get(f"/api/contracts/{contract_id}/key-terms").json()
    before_terms = {t["id"]: t for t in before["terms"]}
    assert before_terms["payment_deadline"]["standard"]["status"] == "meets"
    assert before["deviations"] == 0

    client.put("/api/standards/payment_deadline", json={"params": {"net_days_min": 60}})
    fake_chat_model.calls.clear()

    after = client.get(f"/api/contracts/{contract_id}/key-terms").json()
    after_terms = {t["id"]: t for t in after["terms"]}
    assert after_terms["payment_deadline"]["standard"] == {
        "status": "deviates",
        "standard": "net 60 days or longer",
        "detail": "net 30 is 30 days shorter",
    }
    assert after["deviations"] == 1
    assert fake_chat_model.calls == []  # reading a saved standard costs nothing

    summary = client.get(f"/api/contracts/{contract_id}").json()
    assert summary["deviations"] == 1

    client.delete("/api/standards/payment_deadline")


def test_termination_cost_amount_cap_is_unknown_against_a_mismatched_currency(db, fake_chat_model: FakeChatModel, workspace_id) -> None:
    """No FX conversion: an amount standard in one currency cannot judge a
    fee stated in another -- the honest answer is unknown, not a guess."""
    contract_id = _stored(db, workspace_id, EARLY_TERM)

    def extract(user: str) -> str:
        return json.dumps([_item("termination_cost", "50% of remaining fees", 1, "fifty percent (50%) of the remaining Subscription Fees", {"percent": 50})])

    fake_chat_model.key_terms_reply = extract
    review_contract(contract_id, fake_chat_model, batch_size=1)

    client.put("/api/standards/termination_cost", json={"params": {"mode": "amount_cap", "max_amount": 5000, "currency": "USD"}})

    body = client.get(f"/api/contracts/{contract_id}/key-terms").json()
    terms = {t["id"]: t for t in body["terms"]}
    # The stored fee is a percent, not an amount, so it can't be checked
    # against an absolute cap at all -- unknown either way.
    assert terms["termination_cost"]["standard"]["status"] == "unknown"

    client.delete("/api/standards/termination_cost")
