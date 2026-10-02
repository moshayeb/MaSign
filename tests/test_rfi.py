"""MAS-189: a drafted clarifying question (RFI) for a flagged risk finding.

The first MaSign feature where the model generates new text instead of
extracting it -- scoped deliberately narrow (RFI only, never a replacement
clause) after a decide-carefully confirm/attack/conclude pass, see the
ticket's comments.
"""

import json
from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import repository
from app.main import app
from app.risk_analysis.review import review_contract
from app.risk_analysis.rfi import SYSTEM_PROMPT, generate_rfi
from tests.conftest import FakeChatModel

client = TestClient(app)

UNLIMITED = "9. Liability. Customer's liability under this Agreement shall be unlimited."


def _stored(db, workspace_id, *passages: str) -> str:
    contract = repository.create_contract(
        db, workspace_id=workspace_id, filename="c.txt", file_type="txt", size_bytes=1, character_count=1, chunks=list(passages)
    )
    db.commit()
    return contract.id


def _finding(category: str, severity: str, passage: int, quote: str) -> dict:
    return {"category": category, "severity": severity, "reason": f"{category} risk", "passage": passage, "quote": quote}


# --- generation (no HTTP) ---------------------------------------------------------------------


def test_prompt_never_asks_for_replacement_wording() -> None:
    assert "question" in SYSTEM_PROMPT
    assert "redline" not in SYSTEM_PROMPT.lower()
    assert "replacement" in SYSTEM_PROMPT.lower()  # the rule telling it NOT to draft one


def test_generate_rfi_returns_the_drafted_question() -> None:
    fake = FakeChatModel()
    fake.rfi_reply = json.dumps({"question": "Does the liability cap apply per incident or in aggregate?"})

    result = generate_rfi("liability", "unlimited liability", "shall be unlimited", fake)

    assert result.checked is True
    assert result.question == "Does the liability cap apply per incident or in aggregate?"
    assert fake.calls[0][0] == SYSTEM_PROMPT


def test_generate_rfi_strips_code_fences() -> None:
    fake = FakeChatModel()
    fake.rfi_reply = '```json\n{"question": "Can you confirm the cap amount?"}\n```'

    result = generate_rfi("liability", "unlimited liability", "shall be unlimited", fake)

    assert result.checked is True
    assert result.question == "Can you confirm the cap amount?"


def test_generate_rfi_reports_a_malformed_reply_as_unreadable() -> None:
    fake = FakeChatModel()
    fake.rfi_reply = "not json at all"

    result = generate_rfi("liability", "unlimited liability", "shall be unlimited", fake)

    assert result.checked is False and result.question is None


def test_generate_rfi_reports_a_missing_question_field_as_unreadable() -> None:
    fake = FakeChatModel()
    fake.rfi_reply = json.dumps({"answer": "something else entirely"})

    result = generate_rfi("liability", "unlimited liability", "shall be unlimited", fake)

    assert result.checked is False and result.question is None


def test_generate_rfi_truncates_an_overlong_question() -> None:
    fake = FakeChatModel()
    fake.rfi_reply = json.dumps({"question": "x" * 1000})

    result = generate_rfi("liability", "unlimited liability", "shall be unlimited", fake)

    assert result.checked is True
    assert result.question is not None and len(result.question) == 400


# --- the API (MAS-122 cost-first: one call per explicit request) -----------------------------


def test_request_rfi_drafts_and_stores_a_question(db, workspace_id, fake_chat_model: FakeChatModel) -> None:
    contract_id = _stored(db, workspace_id, UNLIMITED)
    fake_chat_model.risk_reply = json.dumps([_finding("liability", "High", 1, "shall be unlimited")])
    review_contract(contract_id, fake_chat_model)
    chunk_id = str(repository.list_chunks(db, contract_id)[0].id)
    fake_chat_model.rfi_reply = json.dumps({"question": "Does the liability cap apply per incident or in aggregate?"})

    response = client.post(f"/api/contracts/{contract_id}/rfi-suggestions", json={"chunk_id": chunk_id, "category": "liability"})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["question"] == "Does the liability cap apply per incident or in aggregate?"
    assert body["category"] == "liability"
    assert body["quote"] == "shall be unlimited"  # the snapshot of the finding at generation time
    assert body["model"] == "fake-chat"

    listed = client.get(f"/api/contracts/{contract_id}/rfi-suggestions").json()
    assert len(listed) == 1 and listed[0]["id"] == body["id"]


def test_request_rfi_404s_for_a_finding_that_is_not_currently_flagged(db, workspace_id, fake_chat_model: FakeChatModel) -> None:
    contract_id = _stored(db, workspace_id, UNLIMITED)
    review_contract(contract_id, fake_chat_model)  # no risk_reply set: finds nothing
    chunk_id = str(repository.list_chunks(db, contract_id)[0].id)

    response = client.post(f"/api/contracts/{contract_id}/rfi-suggestions", json={"chunk_id": chunk_id, "category": "liability"})

    assert response.status_code == 404


def test_a_malformed_reply_is_a_request_failure_and_nothing_is_stored(db, workspace_id, fake_chat_model: FakeChatModel) -> None:
    contract_id = _stored(db, workspace_id, UNLIMITED)
    fake_chat_model.risk_reply = json.dumps([_finding("liability", "High", 1, "shall be unlimited")])
    review_contract(contract_id, fake_chat_model)
    chunk_id = str(repository.list_chunks(db, contract_id)[0].id)
    fake_chat_model.rfi_reply = "not usable at all"

    response = client.post(f"/api/contracts/{contract_id}/rfi-suggestions", json={"chunk_id": chunk_id, "category": "liability"})

    assert response.status_code == 503
    assert client.get(f"/api/contracts/{contract_id}/rfi-suggestions").json() == []


def test_a_stored_rfi_survives_a_re_review_that_no_longer_flags_the_same_finding(
    db, workspace_id, fake_chat_model: FakeChatModel
) -> None:
    """The exact bug the design correction prevents: risk_findings.id churns
    (fresh uuid) on every re-review, so a stored suggestion must never
    depend on that row still existing."""
    contract_id = _stored(db, workspace_id, UNLIMITED)
    fake_chat_model.risk_reply = json.dumps([_finding("liability", "High", 1, "shall be unlimited")])
    review_contract(contract_id, fake_chat_model)
    chunk_id = str(repository.list_chunks(db, contract_id)[0].id)
    fake_chat_model.rfi_reply = json.dumps({"question": "Does the liability cap apply per incident or in aggregate?"})
    created = client.post(f"/api/contracts/{contract_id}/rfi-suggestions", json={"chunk_id": chunk_id, "category": "liability"})
    assert created.status_code == 201

    fake_chat_model.risk_reply = "[]"  # re-review finds nothing this time
    review_contract(contract_id, fake_chat_model)
    assert repository.get_risk_finding(db, contract_id, chunk_id, "liability") is None  # the finding genuinely no longer exists

    listed = client.get(f"/api/contracts/{contract_id}/rfi-suggestions").json()
    assert len(listed) == 1  # the stored suggestion is untouched
    assert listed[0]["question"] == "Does the liability cap apply per incident or in aggregate?"


def test_request_rfi_404s_for_an_unknown_contract(db) -> None:
    response = client.post(f"/api/contracts/{uuid4()}/rfi-suggestions", json={"chunk_id": str(uuid4()), "category": "liability"})
    assert response.status_code == 404
