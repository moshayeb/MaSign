"""MAS-15 / MAS-16: the rubric, and risk flags that quote the passage they come from."""

import json
import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.actions.workflow import build_follow_up_actions
from app.api import dependencies
from app.main import app
from app.retrieval.vector_store import ChunkHit
from app.risk_analysis.analyzer import SYSTEM_PROMPT, analyze_risks
from app.risk_analysis.rubric import CATEGORY_IDS, RISK_CATEGORIES, SEVERITIES, rubric_text
from tests.conftest import FakeChatModel

CONTRACT = uuid4()

UNLIMITED = (
    "9. Liability\n9.1 Customer's liability under this Agreement shall be unlimited and Customer shall "
    "reimburse Vendor for all losses of whatever kind."
)
FEES = "2. Fees\n2.3 Late payment shall accrue interest at the rate of 1.5% per month (18% per annum)."


def _hits(*texts: str) -> list[ChunkHit]:
    return [ChunkHit(chunk_id=uuid4(), contract_id=CONTRACT, chunk_index=i, text=t, score=0.8 - i / 10) for i, t in enumerate(texts)]


def _model(reply: object) -> FakeChatModel:
    model = FakeChatModel()
    model.risk_reply = reply if isinstance(reply, str) else json.dumps(reply)
    return model


# --- rubric (MAS-15) ---------------------------------------------------------------


def test_rubric_covers_the_agreed_categories_with_three_graded_levels() -> None:
    assert CATEGORY_IDS == (
        "liability", "termination", "indemnification", "auto_renewal", "confidentiality", "payment_terms", "ip_assignment",
    )
    assert SEVERITIES == ("Low", "Medium", "High")
    for category in RISK_CATEGORIES:
        assert category.name and category.looks_for and category.high and category.medium and category.low
    text = rubric_text()
    assert "perspective of the Customer" in text
    assert all(f"- {c.id} ({c.name})" in text for c in RISK_CATEGORIES)
    assert text in SYSTEM_PROMPT  # the model is graded by the same rubric the docs describe


# --- detection (MAS-16, no API) -----------------------------------------------------


def test_findings_are_resolved_to_their_passage_and_sorted_by_severity() -> None:
    hits = _hits(FEES, UNLIMITED)
    model = _model([
        {"category": "payment_terms", "severity": "Medium", "reason": "Interest at the top of the usual range.", "passage": 1,
         "quote": "interest at the rate of 1.5% per month"},
        {"category": "liability", "severity": "High", "reason": "Customer's exposure is uncapped.", "passage": 2,
         "quote": "Customer's liability under this Agreement shall be unlimited"},
    ])

    report = analyze_risks(hits, model, filenames={CONTRACT: "msa.txt"})

    assert report.checked is True
    assert [(f.category, f.severity, f.label) for f in report.findings] == [("liability", "High", 2), ("payment_terms", "Medium", 1)]
    assert report.findings[0].hit is hits[1]
    assert report.findings[0].category_name == "Liability cap"
    system, user = model.calls[0]
    assert system == SYSTEM_PROMPT
    assert "[2] (msa.txt, passage 2)" in user and "risky for the Customer" in user


def test_a_finding_whose_quote_is_not_in_the_passage_is_dropped(caplog: pytest.LogCaptureFixture) -> None:
    hits = _hits(UNLIMITED)
    model = _model([
        {"category": "liability", "severity": "High", "reason": "Invented.", "passage": 1, "quote": "Vendor's liability shall be unlimited"},
        {"category": "liability", "severity": "High", "reason": "Real.", "passage": 1, "quote": "Customer's  liability under this Agreement shall be unlimited"},
    ])

    with caplog.at_level("WARNING"):
        report = analyze_risks(hits, model)

    assert [f.reason for f in report.findings] == ["Real."]  # whitespace differences are tolerated, paraphrase is not
    assert "Dropped risk finding" in caplog.text


@pytest.mark.parametrize(
    "item",
    [
        {"category": "tax", "severity": "High", "reason": "r", "passage": 1, "quote": "unlimited"},
        {"category": "liability", "severity": "Critical", "reason": "r", "passage": 1, "quote": "unlimited"},
        {"category": "liability", "severity": "High", "reason": "", "passage": 1, "quote": "unlimited"},
        {"category": "liability", "severity": "High", "reason": "r", "passage": 7, "quote": "unlimited"},
        {"category": "liability", "severity": "High", "reason": "r", "passage": 1, "quote": ""},
        "not an object",
    ],
)
def test_malformed_findings_are_dropped_not_crashed(item: object) -> None:
    report = analyze_risks(_hits(UNLIMITED), _model([item]))

    # The only finding was unusable: that is an unavailable analysis, not "no risk" (MAS-74).
    assert report.checked is False
    assert report.findings == []


@pytest.mark.parametrize("category", [[], {}, None, 7, True, ["liability"], {"id": "liability"}])
def test_a_category_of_the_wrong_type_is_dropped_not_a_crash(category: object) -> None:
    # MAS-75: a list or object where a string belongs used to raise inside the lookup -> HTTP 500.
    item = {"category": category, "severity": "High", "reason": "r", "passage": 1, "quote": "unlimited"}

    report = analyze_risks(_hits(UNLIMITED), _model([item]))

    assert report.findings == []


def test_a_missing_category_is_dropped_not_a_crash() -> None:
    item = {"severity": "High", "reason": "r", "passage": 1, "quote": "unlimited"}

    assert analyze_risks(_hits(UNLIMITED), _model([item])).findings == []


@pytest.mark.parametrize("field, value", [("severity", ["High"]), ("reason", {"text": "r"}), ("passage", "1"), ("passage", True), ("quote", ["unlimited"])])
def test_other_fields_of_the_wrong_type_are_dropped_not_a_crash(field: str, value: object) -> None:
    item = {"category": "liability", "severity": "High", "reason": "r", "passage": 1, "quote": "unlimited", field: value}

    assert analyze_risks(_hits(UNLIMITED), _model([item])).findings == []


# The three outcomes of validation (MAS-74).

VALID = {"category": "liability", "severity": "High", "reason": "Uncapped.", "passage": 1, "quote": "shall be unlimited"}
INVALID = {"category": "liability", "severity": "High", "reason": "Invented.", "passage": 1, "quote": "Vendor's liability is unlimited"}


def test_an_empty_reply_is_a_completed_analysis_with_no_findings() -> None:
    report = analyze_risks(_hits(UNLIMITED), _model([]))

    assert (report.checked, report.complete, report.findings) == (True, True, [])


def test_all_findings_rejected_means_the_analysis_is_unavailable(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("WARNING"):
        report = analyze_risks(_hits(UNLIMITED), _model([INVALID, dict(INVALID, severity="Low")]))

    assert (report.checked, report.findings) == (False, [])
    assert "all 2 finding(s) rejected" in caplog.text


def test_some_findings_rejected_keeps_the_verified_ones_and_marks_the_analysis_incomplete() -> None:
    report = analyze_risks(_hits(UNLIMITED, FEES), _model([INVALID, VALID]))

    assert report.checked is True
    assert report.complete is False
    assert [f.reason for f in report.findings] == ["Uncapped."]


def test_duplicate_category_per_passage_is_reported_once() -> None:
    finding = {"category": "liability", "severity": "High", "reason": "r", "passage": 1, "quote": "unlimited"}

    report = analyze_risks(_hits(UNLIMITED), _model([finding, dict(finding, reason="again")]))

    assert len(report.findings) == 1


@pytest.mark.parametrize("reply", ["I found nothing risky.", '{"category": "liability"}', "", "```json\nnot json\n```"])
def test_an_unreadable_reply_marks_the_analysis_unavailable(reply: str, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("WARNING"):
        report = analyze_risks(_hits(UNLIMITED), _model(reply))

    assert report.checked is False
    assert report.findings == []


def test_fenced_json_and_empty_arrays_are_fine() -> None:
    fenced = '```json\n[{"category": "liability", "severity": "High", "reason": "r", "passage": 1, "quote": "unlimited"}]\n```'

    assert analyze_risks(_hits(UNLIMITED), _model(fenced)).findings[0].quote == "unlimited"
    assert analyze_risks(_hits(UNLIMITED), _model("[]")) .findings == []
    assert analyze_risks([], _model("never called")).checked is True


def test_a_cut_off_reply_keeps_the_complete_findings_and_is_marked_incomplete(caplog: pytest.LogCaptureFixture) -> None:
    # MAS-80: two findings arrived whole, the third was cut mid-quote.
    model = _model(
        '[{"category": "liability", "severity": "High", "reason": "r", "passage": 2, "quote": "unlimited"},'
        ' {"category": "payment_terms", "severity": "Medium", "reason": "r", "passage": 1, "quote": "1.5% per month"},'
        ' {"category": "termination", "severity": "Low", "reason": "r", "passage": 1, "quote": "the Cust'
    )
    model.truncated = True

    with caplog.at_level("WARNING"):
        report = analyze_risks(_hits(FEES, UNLIMITED), model)

    assert report.checked is True
    assert report.complete is False
    assert [(f.category, f.label) for f in report.findings] == [("liability", 2), ("payment_terms", 1)]
    assert "2 complete finding(s) salvaged" in caplog.text


@pytest.mark.parametrize("reply", ['[{"category": "liability", "severity": "High", "reason": "r", "passage": 1, "quote": "unlim', "[", "", "```json[{"])
def test_a_cut_off_reply_with_no_complete_finding_is_unavailable(reply: str) -> None:
    model = _model(reply)
    model.truncated = True

    report = analyze_risks(_hits(UNLIMITED), model)

    assert (report.checked, report.findings) == (False, [])


def test_salvaged_findings_are_validated_like_any_other() -> None:
    # A complete but invented finding before the cut is still dropped; nothing left -> unavailable.
    model = _model('[{"category": "liability", "severity": "High", "reason": "r", "passage": 1, "quote": "not in the text"}, {"cat')
    model.truncated = True

    assert analyze_risks(_hits(UNLIMITED), model).checked is False


def test_the_risk_budget_fits_a_dozen_findings() -> None:
    from app.risk_analysis.analyzer import MAX_QUOTE_CHARS, MAX_RISK_TOKENS

    # ~120 tokens per finding with a full-length quote; 1024 held about six (MAS-80).
    assert MAX_RISK_TOKENS >= 4096 and MAX_QUOTE_CHARS <= 300


def test_follow_up_actions_follow_the_highest_severity() -> None:
    hits = _hits(FEES, UNLIMITED)
    report = analyze_risks(hits, _model([
        {"category": "liability", "severity": "High", "reason": "r", "passage": 2, "quote": "unlimited"},
        {"category": "payment_terms", "severity": "Medium", "reason": "r", "passage": 1, "quote": "1.5% per month"},
    ]))

    actions = build_follow_up_actions(report.findings)

    assert actions[0] == "Escalate to legal review before signing: Liability cap."
    assert actions[1] == "Raise in negotiation: Payment terms."
    assert build_follow_up_actions([])[0].startswith("No risk flagged")
    assert build_follow_up_actions([], checked=False)[0].startswith("Risk analysis was unavailable")


# --- through the API (needs the test database) ---------------------------------------


client = TestClient(app)


def test_query_carries_risk_flags_that_quote_the_retrieved_passage(db, fake_chat_model: FakeChatModel) -> None:
    upload = client.post("/api/contracts/upload", files={"file": ("risky.txt", (UNLIMITED + "\n\n" + FEES).encode(), "text/plain")})
    contract_id = upload.json()["contract_id"]
    fake_chat_model.risk_reply = lambda user: json.dumps([
        {"category": "liability", "severity": "High", "reason": "Customer's exposure is uncapped.",
         "passage": 1 if "[1]" in user.split("Customer's liability")[0] else 2,
         "quote": "Customer's liability under this Agreement shall be unlimited"},
    ])

    body = client.post("/api/query", json={"question": "Is my liability capped?", "contract_id": contract_id}).json()

    assert body["risks_checked"] is True
    assert len(body["risks"]) == 1
    flag = body["risks"][0]
    assert (flag["category"], flag["category_name"], flag["severity"]) == ("liability", "Liability cap", "High")
    assert flag["quote"] == "Customer's liability under this Agreement shall be unlimited"
    passage = body["retrieved_context"][flag["label"] - 1]
    assert flag["chunk_id"] == passage["chunk_id"] and flag["quote"] in passage["text"]
    assert body["recommended_actions"][0] == "Escalate to legal review before signing: Liability cap."
    # The answer itself is unaffected by the second model call.
    assert body["grounded"] is True


def test_query_keeps_the_answer_when_only_the_risk_call_fails(db, fake_chat_model: FakeChatModel) -> None:
    # MAS-76: the model refused the second call (rate limit); the answer must still arrive.
    from app.answering.llm import ChatModelError

    upload = client.post("/api/contracts/upload", files={"file": ("risky.txt", UNLIMITED.encode(), "text/plain")})
    fake_chat_model.risk_error = ChatModelError("Anthropic API refused the request (HTTP 429): rate limited")

    response = client.post("/api/query", json={"question": "liability?", "contract_id": upload.json()["contract_id"]})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answer"] == "The passage states it [1]." and body["grounded"] is True
    assert body["risks"] == [] and body["risks_checked"] is False
    assert body["recommended_actions"][0].startswith("Risk analysis was unavailable")


def test_query_fails_when_the_answer_call_fails_even_if_risks_succeed(db, fake_chat_model: FakeChatModel) -> None:
    from app.answering.llm import ChatModelError

    upload = client.post("/api/contracts/upload", files={"file": ("risky.txt", UNLIMITED.encode(), "text/plain")})

    def refuse(_: str) -> str:
        raise ChatModelError("Anthropic API is unreachable: connection refused")

    fake_chat_model.reply = refuse

    response = client.post("/api/query", json={"question": "liability?", "contract_id": upload.json()["contract_id"]})

    assert response.status_code == 503
    assert "Anthropic API is unreachable" in response.json()["detail"]


def test_query_reports_an_incomplete_analysis_with_its_verified_flags(db, fake_chat_model: FakeChatModel) -> None:
    upload = client.post("/api/contracts/upload", files={"file": ("risky.txt", UNLIMITED.encode(), "text/plain")})
    fake_chat_model.risk_reply = json.dumps([INVALID, VALID])

    body = client.post("/api/query", json={"question": "liability?", "contract_id": upload.json()["contract_id"]}).json()

    assert body["risks_checked"] is True and body["risks_complete"] is False
    assert [f["reason"] for f in body["risks"]] == ["Uncapped."]


def test_query_says_when_risk_analysis_was_unavailable(db, fake_chat_model: FakeChatModel) -> None:
    upload = client.post("/api/contracts/upload", files={"file": ("risky.txt", UNLIMITED.encode(), "text/plain")})
    fake_chat_model.risk_reply = "Sorry, I cannot produce JSON today."

    body = client.post("/api/query", json={"question": "liability?", "contract_id": upload.json()["contract_id"]}).json()

    assert body["risks"] == [] and body["risks_checked"] is False
    assert body["recommended_actions"][0].startswith("Risk analysis was unavailable")
    assert body["answer"]  # the answer still arrived


def test_query_with_no_findings_is_complete(db, fake_chat_model: FakeChatModel) -> None:
    upload = client.post("/api/contracts/upload", files={"file": ("risky.txt", UNLIMITED.encode(), "text/plain")})

    body = client.post("/api/query", json={"question": "liability?", "contract_id": upload.json()["contract_id"]}).json()

    assert (body["risks_checked"], body["risks_complete"], body["risks"]) == (True, True, [])


# --- real model (opt-in) -------------------------------------------------------------


@pytest.mark.skipif(os.getenv("MASIGN_REAL_LLM") != "1", reason="set MASIGN_REAL_LLM=1 (and the provider's API key) to call the real model")
def test_real_model_flags_unlimited_liability_as_high_with_the_clause(db) -> None:
    # MAS-16 done-when: a known risky clause triggers a High flag with the quoted clause.
    from app.answering.llm import get_chat_model

    get_chat_model.cache_clear()
    app.dependency_overrides[dependencies.get_chat_model] = get_chat_model
    risky = (
        "1. Services\nVendor provides the platform.\n\n"
        "9. Liability\n9.1 Customer's liability under this Agreement shall be unlimited and Customer shall reimburse "
        "Vendor for all losses of whatever kind, whether direct or indirect.\n9.2 Vendor's aggregate liability shall "
        "not exceed EUR 1,000.\n\n"
        "3. Term\n3.2 This Agreement renews automatically for successive periods of twenty-four (24) months unless "
        "Customer gives notice of non-renewal at least one hundred and eighty (180) days before the end of the term."
    )
    upload = client.post("/api/contracts/upload", files={"file": ("risky.txt", risky.encode(), "text/plain")})
    contract_id = upload.json()["contract_id"]

    body = client.post("/api/query", json={"question": "What is my liability under this agreement?", "contract_id": contract_id}).json()

    assert body["risks_checked"] is True, body
    liability = [f for f in body["risks"] if f["category"] == "liability"]
    assert liability and liability[0]["severity"] == "High", body["risks"]
    assert "unlimited" in liability[0]["quote"].lower()
    passage = body["retrieved_context"][liability[0]["label"] - 1]
    assert liability[0]["quote"] in passage["text"]
    assert any(f["category"] == "auto_renewal" and f["severity"] == "High" for f in body["risks"]), body["risks"]
