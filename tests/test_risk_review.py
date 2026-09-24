"""MAS-81: every uploaded contract gets a whole-contract risk review."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import pytest
from fastapi.testclient import TestClient

from app.answering.llm import ChatModelError
from app.database import repository
from app.database.session import get_connection
from app.main import app
from app.risk_analysis.review import review_contract
from tests.conftest import FakeChatModel

client = TestClient(app)

NORTHWIND = Path(__file__).resolve().parent.parent / "data" / "sample_contracts" / "northwind_master_services_agreement.txt"

FEES = "2. Fees. Customer shall pay EUR 18,500 per month. Late payment shall accrue interest at 1.5% per month."
UNLIMITED = "9. Liability. Customer's liability under this Agreement shall be unlimited."
RENEWAL = "12. Term. This Agreement renews automatically for successive twelve-month periods unless either party gives ninety days notice."


def _upload(text: str, name: str = "c.txt") -> str:
    response = client.post("/api/contracts/upload", files={"file": (name, text.encode(), "text/plain")})
    assert response.status_code == 200, response.text
    return response.json()["contract_id"]


def _stored(db, *passages: str) -> str:
    """A contract with exactly these chunks (the chunker would pack short ones together)."""
    contract = repository.create_contract(
        db, filename="c.txt", file_type="txt", size_bytes=1, character_count=1, chunks=list(passages)
    )
    db.commit()
    return contract.id


# Long enough that the chunker (1200 chars) makes one chunk per clause.
PAD = " The parties acknowledge the foregoing and agree that this clause is read together with the rest of the Agreement." * 9


def _finding(category: str, severity: str, passage: int, quote: str) -> dict:
    return {"category": category, "severity": severity, "reason": f"{category} risk", "passage": passage, "quote": quote}


def _passage_with(user_prompt: str, needle: str) -> int | None:
    """The [n] of the passage in a risk prompt whose text contains `needle`."""
    for block in user_prompt.split("[")[1:]:
        label, _, body = block.partition("]")
        if label.isdigit() and needle in body:
            return int(label)
    return None


# --- the runner (no HTTP) -----------------------------------------------------------


def test_review_grades_every_passage_in_batches_and_stores_the_verified_findings(db, fake_chat_model: FakeChatModel) -> None:
    contract_id = _stored(db, FEES, UNLIMITED, RENEWAL)
    chunks = repository.list_chunks(db, contract_id)

    # Batches of one passage: each call sees exactly one numbered passage.
    def grade(user: str) -> str:
        if "unlimited" in user:
            return json.dumps([_finding("liability", "High", 1, "shall be unlimited")])
        if "renews automatically" in user:
            return json.dumps([_finding("auto_renewal", "Medium", 1, "renews automatically"), _finding("liability", "High", 1, "not in the text")])
        return "[]"

    fake_chat_model.risk_reply = grade
    fake_chat_model.calls.clear()

    review = review_contract(contract_id, fake_chat_model, batch_size=1)

    assert (review.status, review.chunks_total, review.chunks_checked, review.model) == ("done", 3, 3, "fake-chat")
    assert review.complete is False  # the invented liability finding was dropped
    assert len(fake_chat_model.calls) == 6  # per batch: one risk call, one key-terms call (MAS-82)
    rows = repository.list_risk_findings(db, contract_id)
    assert [(r.category, r.severity, r.quote) for r in rows] == [
        ("liability", "High", "shall be unlimited"),
        ("auto_renewal", "Medium", "renews automatically"),
    ]
    assert {r.chunk_id for r in rows} == {chunks[1].id, chunks[2].id}


def test_review_uses_the_batch_size_as_passages_per_call(db, fake_chat_model: FakeChatModel) -> None:
    contract_id = _stored(db, *(f"{i}. Clause number {i} says something ordinary." for i in range(1, 21)))
    fake_chat_model.calls.clear()

    review = review_contract(contract_id, fake_chat_model, batch_size=8)

    assert review.status == "done" and review.complete is True
    assert len(fake_chat_model.calls) == 6  # (8 + 8 + 4) x (risks + key terms)
    assert "[8]" in fake_chat_model.calls[0][1] and "[9]" not in fake_chat_model.calls[0][1]


def test_a_model_failure_marks_the_review_failed_with_the_reason(db, fake_chat_model: FakeChatModel) -> None:
    contract_id = _stored(db, FEES, UNLIMITED)
    fake_chat_model.risk_error = ChatModelError("Anthropic API refused the request (HTTP 429): rate limited")

    review = review_contract(contract_id, fake_chat_model, batch_size=1)

    assert review.status == "failed"
    assert review.error == "Anthropic API refused the request (HTTP 429): rate limited"
    assert review.complete is False


def test_a_key_terms_only_failure_keeps_the_verified_risk_findings(db, fake_chat_model: FakeChatModel) -> None:
    # MAS-129: risk grading succeeded for both passages; only the key-terms
    # call fails. The review must still reach "done" with both risk findings
    # kept — not "failed" with everything discarded, which is what a shared
    # try/except around both calls used to do.
    contract_id = _stored(db, FEES, UNLIMITED)
    fake_chat_model.risk_reply = lambda user: json.dumps([_finding("liability", "High", 1, "shall be unlimited")]) if "unlimited" in user else "[]"
    fake_chat_model.key_terms_error = ChatModelError("Anthropic API refused the request (HTTP 429): rate limited")

    review = review_contract(contract_id, fake_chat_model, batch_size=1)

    assert review.status == "done"
    assert review.complete is True  # risk grading itself never failed
    assert review.key_terms_complete is False
    rows = repository.list_risk_findings(db, contract_id)
    assert [(r.category, r.quote) for r in rows] == [("liability", "shall be unlimited")]
    assert repository.list_key_terms(db, contract_id) == []  # nothing usable to store


def test_an_unreadable_batch_makes_the_review_incomplete_not_empty(db, fake_chat_model: FakeChatModel) -> None:
    contract_id = _stored(db, FEES, UNLIMITED)
    fake_chat_model.risk_reply = lambda user: "no json here" if "unlimited" in user else "[]"

    review = review_contract(contract_id, fake_chat_model, batch_size=1)

    assert (review.status, review.complete, review.chunks_checked, review.chunks_total) == ("done", False, 1, 2)


def test_review_progress_is_visible_from_another_connection(db, fake_chat_model: FakeChatModel) -> None:
    contract_id = _stored(db, FEES, UNLIMITED)
    observed: list[tuple[str, int, int]] = []

    def observe_progress(_: str) -> str:
        with get_connection() as observer:
            review = repository.get_risk_review(observer, contract_id)
            assert review is not None
            observed.append((review.status, review.chunks_checked, review.chunks_total))
        return "[]"

    fake_chat_model.risk_reply = observe_progress
    review_contract(contract_id, fake_chat_model, batch_size=1)

    # The second risk batch sees the first one's committed progress rather
    # than the old pending row.
    assert observed[0] == ("running", 0, 2)
    assert observed[1] == ("running", 1, 2)


def test_startup_recovery_makes_interrupted_reviews_retryable(db) -> None:
    pending_id = _stored(db, FEES)
    running_id = _stored(db, UNLIMITED)
    repository.start_risk_review(db, pending_id)
    repository.start_risk_review(db, running_id, status="running")
    db.commit()

    assert repository.fail_interrupted_risk_reviews(db) == 2
    db.commit()

    for contract_id in (pending_id, running_id):
        recovered = repository.get_risk_review(db, contract_id)
        assert recovered is not None
        assert recovered.status == "failed" and recovered.complete is False
        assert recovered.error == "Review interrupted by a server restart. Run it again."


def test_rerunning_a_review_replaces_the_old_findings(db, fake_chat_model: FakeChatModel) -> None:
    contract_id = _upload(UNLIMITED)
    fake_chat_model.risk_reply = json.dumps([_finding("liability", "High", 1, "shall be unlimited")])
    review_contract(contract_id, fake_chat_model)
    assert len(repository.list_risk_findings(db, contract_id)) == 1

    fake_chat_model.risk_reply = "[]"
    review = review_contract(contract_id, fake_chat_model)

    assert review.status == "done" and repository.list_risk_findings(db, contract_id) == []


def test_deleting_a_contract_removes_its_review(db, fake_chat_model: FakeChatModel) -> None:
    contract_id = _upload(UNLIMITED)
    fake_chat_model.risk_reply = json.dumps([_finding("liability", "High", 1, "shall be unlimited")])
    review_contract(contract_id, fake_chat_model)

    assert repository.delete_contract(db, contract_id) is True
    assert repository.get_risk_review(db, contract_id) is None
    assert repository.list_risk_findings(db, contract_id) == []


# --- through the API --------------------------------------------------------------------


def test_upload_starts_a_review_and_the_result_is_readable(db, fake_chat_model: FakeChatModel) -> None:
    def grade(user: str) -> str:
        label = _passage_with(user, "shall be unlimited")
        return json.dumps([_finding("liability", "High", label, "shall be unlimited")]) if label else "[]"

    fake_chat_model.risk_reply = grade

    upload = client.post(
        "/api/contracts/upload", files={"file": ("risky.txt", f"{FEES}{PAD}\n\n{UNLIMITED}{PAD}".encode(), "text/plain")}
    )

    assert upload.status_code == 200, upload.text
    assert upload.json()["risk_status"] == "pending"  # the review runs after the response
    contract_id = upload.json()["contract_id"]

    # The TestClient runs background tasks before returning, so the review is done.
    body = client.get(f"/api/contracts/{contract_id}/risks").json()
    assert body["status"] == "done" and body["complete"] is True
    assert body["chunks_total"] == body["chunks_checked"] >= 2 and body["model"] == "fake-chat"
    assert [(f["category_name"], f["severity"]) for f in body["findings"]] == [("Liability cap", "High")]
    assert body["findings"][0]["chunk_index"] >= 1  # the liability clause comes after the fees
    by_id = {c["id"]: c for c in body["categories"]}
    assert len(by_id) == 7
    assert by_id["liability"] == {"id": "liability", "name": "Liability cap", "worst_severity": "High", "findings": 1}
    assert by_id["termination"]["worst_severity"] is None and by_id["termination"]["findings"] == 0

    listed = {c["contract_id"]: c for c in client.get("/api/contracts").json()}[contract_id]
    assert (listed["risk_status"], listed["risk_worst_severity"]) == ("done", "High")
    assert (listed["risk_complete"], listed["risk_chunks_checked"], listed["risk_chunks_total"]) == (
        True,
        body["chunks_checked"],
        body["chunks_total"],
    )


def test_contract_list_reports_an_incomplete_review(db, fake_chat_model: FakeChatModel) -> None:
    contract_id = _stored(db, FEES, UNLIMITED)
    repository.start_risk_review(db, contract_id, status="running")
    repository.update_risk_review(db, contract_id, status="done", chunks_total=2, chunks_checked=1, complete=False)
    db.commit()

    listed = {c["contract_id"]: c for c in client.get("/api/contracts").json()}[str(contract_id)]

    assert listed["risk_status"] == "done"
    assert listed["risk_complete"] is False
    assert (listed["risk_chunks_checked"], listed["risk_chunks_total"]) == (1, 2)


def test_review_can_be_rerun_for_a_contract_and_is_refused_while_running(db, fake_chat_model: FakeChatModel) -> None:
    contract_id = _upload(UNLIMITED)
    fake_chat_model.risk_reply = json.dumps([_finding("liability", "Medium", 1, "shall be unlimited")])

    started = client.post(f"/api/contracts/{contract_id}/review")

    assert started.status_code == 202, started.text
    assert started.json()["status"] == "pending"
    done = client.get(f"/api/contracts/{contract_id}/risks").json()
    assert done["status"] == "done" and [f["severity"] for f in done["findings"]] == ["Medium"]

    repository.update_risk_review(db, contract_id, status="running")
    db.commit()
    refused = client.post(f"/api/contracts/{contract_id}/review")
    assert refused.status_code == 409
    assert "already running" in refused.json()["detail"]


def test_concurrent_review_starts_schedule_only_one_job(db, fake_chat_model: FakeChatModel) -> None:
    contract_id = _stored(db, UNLIMITED)
    entered = Event()
    release = Event()
    risk_calls = 0

    def hold_first_job(_: str) -> str:
        nonlocal risk_calls
        risk_calls += 1
        entered.set()
        assert release.wait(timeout=5), "test did not release the review job"
        return "[]"

    fake_chat_model.risk_reply = hold_first_job
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(client.post, f"/api/contracts/{contract_id}/review")
        assert entered.wait(timeout=5), "first review did not start"
        second = pool.submit(client.post, f"/api/contracts/{contract_id}/review")
        refused = second.result(timeout=5)
        release.set()
        accepted = first.result(timeout=5)

    assert accepted.status_code == 202
    assert refused.status_code == 409
    assert risk_calls == 1


def test_a_contract_uploaded_before_reviews_existed_reports_no_review(db) -> None:
    contract_id = _upload(FEES)
    with db.cursor() as cursor:
        cursor.execute("DELETE FROM risk_reviews WHERE contract_id = %s", (contract_id,))
    db.commit()

    response = client.get(f"/api/contracts/{contract_id}/risks")

    assert response.status_code == 404
    assert "not been reviewed" in response.json()["detail"]
    assert client.get("/api/contracts").json()[0]["risk_status"] is None


def test_a_failed_review_reports_the_model_error(db, fake_chat_model: FakeChatModel) -> None:
    fake_chat_model.risk_error = ChatModelError("Chat model is not configured: set ANTHROPIC_API_KEY")

    contract_id = _upload(UNLIMITED)

    body = client.get(f"/api/contracts/{contract_id}/risks").json()
    assert body["status"] == "failed"
    assert "set ANTHROPIC_API_KEY" in body["error"]
    assert body["findings"] == []


def test_unknown_contract_is_404_for_both_endpoints(db) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/contracts/{missing}/risks").status_code == 404
    assert client.post(f"/api/contracts/{missing}/review").status_code == 404


@pytest.mark.skipif(not NORTHWIND.exists(), reason="sample contract missing")
def test_northwind_is_reviewed_in_two_batches(db, fake_chat_model: FakeChatModel) -> None:
    fake_chat_model.calls.clear()
    contract_id = _upload(NORTHWIND.read_text(encoding="utf-8"), "northwind.txt")

    body = client.get(f"/api/contracts/{contract_id}/risks").json()

    assert body["status"] == "done" and body["chunks_total"] == body["chunks_checked"]
    assert len(fake_chat_model.calls) == 2 * -(-body["chunks_total"] // 8)  # ceil(chunks / 8) batches x 2 calls
