"""MAS-192: qualitative policy content rules on MAS-188's clause catalog."""

import json
from uuid import uuid4

from fastapi.testclient import TestClient

from app.answering.llm import ChatModelError
from app.database import repository
from app.main import app
from app.risk_analysis.clause_checker import ClauseFinding
from app.risk_analysis.policy_checker import PolicyReport, check_policy_rules
from app.risk_analysis.review import review_contract
from app.retrieval.vector_store import ChunkHit
from tests.conftest import FakeChatModel

client = TestClient(app)

LIABILITY = "9. Liability. Vendor's total liability under this Agreement shall not exceed the fees paid in the preceding twelve months."
RULE = "the liability cap must not exceed 12 months of fees"


def _clause_finding(clause_id: str = "liability_cap", quote: str = "total liability under this Agreement shall not exceed the fees paid") -> ClauseFinding:
    contract_id = uuid4()
    hit = ChunkHit(chunk_id=uuid4(), contract_id=contract_id, chunk_index=0, text=LIABILITY, score=1.0)
    return ClauseFinding(clause_id=clause_id, name="Liability cap", quote=quote, label=1, hit=hit)


def _stored(db, workspace_id, *passages: str) -> str:
    contract = repository.create_contract(
        db, workspace_id=workspace_id, filename="c.txt", file_type="txt", size_bytes=1, character_count=1, chunks=list(passages)
    )
    db.commit()
    return contract.id


# --- check_policy_rules: verification and zero-cost short-circuits -------------------


def test_a_verdict_is_kept_only_with_a_verbatim_quote_from_the_clause_findings_own_quote() -> None:
    fake = FakeChatModel()
    fake.policy_reply = json.dumps(
        [
            {"item": 1, "clause": "liability_cap", "verdict": "compliant", "quote": "shall not exceed the fees paid"},
        ]
    )
    report = check_policy_rules([_clause_finding()], {"liability_cap": RULE}, fake)

    assert report.checked is True and report.complete is True
    assert len(report.findings) == 1
    assert report.findings[0].verdict == "compliant"


def test_a_quote_not_found_in_the_source_clause_finding_is_dropped() -> None:
    fake = FakeChatModel()
    fake.policy_reply = json.dumps(
        [{"item": 1, "clause": "liability_cap", "verdict": "violated", "quote": "this text was never in the quote"}]
    )
    report = check_policy_rules([_clause_finding()], {"liability_cap": RULE}, fake)

    assert report.checked is False and report.complete is False  # all elements rejected


def test_an_unknown_verdict_is_dropped() -> None:
    fake = FakeChatModel()
    fake.policy_reply = json.dumps(
        [{"item": 1, "clause": "liability_cap", "verdict": "sort of fine", "quote": "shall not exceed the fees paid"}]
    )
    report = check_policy_rules([_clause_finding()], {"liability_cap": RULE}, fake)

    assert report.findings == []
    assert report.checked is False


def test_a_clause_finding_with_no_configured_rule_is_never_sent_and_costs_no_call() -> None:
    fake = FakeChatModel()

    report = check_policy_rules([_clause_finding(clause_id="insurance")], {"liability_cap": RULE}, fake)

    assert report == PolicyReport([], checked=True)
    assert fake.calls == []


def test_no_clause_findings_means_no_model_call() -> None:
    fake = FakeChatModel()

    report = check_policy_rules([], {"liability_cap": RULE}, fake)

    assert report == PolicyReport([], checked=True)
    assert fake.calls == []


def test_a_partial_reply_marks_the_rest_incomplete_not_absent_of_judgement() -> None:
    fake = FakeChatModel()
    findings = [_clause_finding(), _clause_finding(quote="insurance of at least EUR 1,000,000")]
    fake.policy_reply = json.dumps([{"item": 1, "clause": "liability_cap", "verdict": "compliant", "quote": "shall not exceed the fees paid"}])

    report = check_policy_rules(findings, {"liability_cap": RULE}, fake)

    assert report.checked is True
    assert report.complete is False  # only 1 of 2 relevant findings got a verdict
    assert len(report.findings) == 1


# --- the whole-contract review (MAS-192 folded into MAS-81/82/188's batch loop) -------------------


def test_review_contract_reports_compliant_violated_and_not_applicable(db, workspace_id, fake_chat_model: FakeChatModel) -> None:
    profile = repository.get_or_create_default_profile(db, workspace_id)
    repository.set_profile_policy_rule(db, profile.id, "liability_cap", RULE)
    db.commit()

    contract_id = _stored(db, workspace_id, LIABILITY)
    fake_chat_model.clause_reply = json.dumps(
        [{"clause": "liability_cap", "passage": 1, "quote": "total liability under this Agreement shall not exceed the fees paid"}]
    )
    fake_chat_model.policy_reply = json.dumps(
        [{"item": 1, "clause": "liability_cap", "verdict": "compliant", "quote": "shall not exceed the fees paid"}]
    )

    review = review_contract(contract_id, fake_chat_model)
    assert review.policy_complete is True

    body = client.get(f"/api/contracts/{contract_id}/risks").json()
    policy = {p["id"]: p for p in body["policy"]}
    assert policy["liability_cap"]["status"] == "compliant"
    assert policy["liability_cap"]["rule_text"] == RULE
    assert policy["liability_cap"]["source"]["quote"] == "shall not exceed the fees paid"
    # No rule configured for these -- absent from the list entirely.
    assert "insurance" not in policy
    assert "data_protection" not in policy


def test_an_absent_clause_with_a_configured_rule_is_not_applicable(db, workspace_id, fake_chat_model: FakeChatModel) -> None:
    profile = repository.get_or_create_default_profile(db, workspace_id)
    repository.set_profile_policy_rule(db, profile.id, "insurance", "must name a minimum coverage amount")
    db.commit()

    contract_id = _stored(db, workspace_id, LIABILITY)  # no insurance clause stated at all
    fake_chat_model.clause_reply = "[]"

    review_contract(contract_id, fake_chat_model)

    body = client.get(f"/api/contracts/{contract_id}/risks").json()
    policy = {p["id"]: p for p in body["policy"]}
    assert policy["insurance"]["status"] == "not_applicable"
    assert policy["insurance"]["source"] is None


def test_a_policy_check_failure_never_discards_risk_findings_key_terms_or_clauses(
    db, workspace_id, fake_chat_model: FakeChatModel
) -> None:
    """Same MAS-129/MAS-188 independent-failure-domain guarantee."""
    profile = repository.get_or_create_default_profile(db, workspace_id)
    repository.set_profile_policy_rule(db, profile.id, "liability_cap", RULE)
    db.commit()

    contract_id = _stored(db, workspace_id, LIABILITY)
    fake_chat_model.risk_reply = json.dumps(
        [{"category": "liability", "severity": "High", "reason": "uncapped", "passage": 1, "quote": "shall not exceed the fees paid"}]
    )
    fake_chat_model.clause_reply = json.dumps(
        [{"clause": "liability_cap", "passage": 1, "quote": "total liability under this Agreement shall not exceed the fees paid"}]
    )
    fake_chat_model.policy_error = ChatModelError("Anthropic API refused the request (HTTP 429): rate limited")

    review = review_contract(contract_id, fake_chat_model)

    assert review.status == "done"
    assert review.complete is True
    assert review.clauses_complete is True  # the clause pass itself never failed
    assert review.policy_complete is False
    assert len(repository.list_risk_findings(db, contract_id)) == 1
    assert len(repository.list_clause_findings(db, contract_id)) == 1  # kept despite the policy-check failure

    body = client.get(f"/api/contracts/{contract_id}/risks").json()
    assert body["policy_complete"] is False
    assert body["clauses_complete"] is True
    policy = {p["id"]: p for p in body["policy"]}
    assert policy["liability_cap"]["status"] == "cannot_tell"  # never a fabricated verdict


# --- configuring a profile's policy rules (MAS-185-style, per profile) -------------------


def test_every_clause_starts_with_no_rule_configured(db, workspace_id) -> None:
    profile = repository.get_or_create_default_profile(db, workspace_id)
    db.commit()

    response = client.get(f"/api/standard-profiles/{profile.id}/policy-rules")

    assert response.status_code == 200
    assert all(r["rule_text"] is None for r in response.json())


def test_setting_and_clearing_a_policy_rule(db, workspace_id) -> None:
    profile = repository.get_or_create_default_profile(db, workspace_id)
    db.commit()

    set_response = client.put(f"/api/standard-profiles/{profile.id}/policy-rules/liability_cap", json={"rule_text": RULE})
    assert set_response.status_code == 200
    assert set_response.json() == {"id": "liability_cap", "name": "Liability cap", "rule_text": RULE}

    listing = {r["id"]: r["rule_text"] for r in client.get(f"/api/standard-profiles/{profile.id}/policy-rules").json()}
    assert listing["liability_cap"] == RULE

    delete_response = client.delete(f"/api/standard-profiles/{profile.id}/policy-rules/liability_cap")
    assert delete_response.status_code == 200
    assert delete_response.json()["rule_text"] is None

    listing = {r["id"]: r["rule_text"] for r in client.get(f"/api/standard-profiles/{profile.id}/policy-rules").json()}
    assert listing["liability_cap"] is None


def test_whitespace_only_rule_text_clears_the_rule(db, workspace_id) -> None:
    profile = repository.get_or_create_default_profile(db, workspace_id)
    repository.set_profile_policy_rule(db, profile.id, "liability_cap", RULE)
    db.commit()

    response = client.put(f"/api/standard-profiles/{profile.id}/policy-rules/liability_cap", json={"rule_text": "   "})

    assert response.json()["rule_text"] is None


def test_update_profile_policy_rule_404s_for_an_unknown_clause_or_profile(db, workspace_id) -> None:
    profile = repository.get_or_create_default_profile(db, workspace_id)
    db.commit()

    assert client.put(f"/api/standard-profiles/{profile.id}/policy-rules/not_a_clause", json={"rule_text": RULE}).status_code == 404
    assert client.put(f"/api/standard-profiles/{uuid4()}/policy-rules/liability_cap", json={"rule_text": RULE}).status_code == 404


# --- MAS-193-style staleness, applied here before it could recur (MAS-192) ---------------------


def test_a_rule_added_after_the_review_ran_reads_cannot_tell_not_compliant(db, workspace_id, fake_chat_model: FakeChatModel) -> None:
    profile = repository.get_or_create_default_profile(db, workspace_id)
    db.commit()  # no rule configured yet

    contract_id = _stored(db, workspace_id, LIABILITY)
    fake_chat_model.clause_reply = json.dumps(
        [{"clause": "liability_cap", "passage": 1, "quote": "total liability under this Agreement shall not exceed the fees paid"}]
    )
    review = review_contract(contract_id, fake_chat_model)
    assert review.policy_complete is True  # vacuously -- nothing was configured to check
    assert review.checked_policy_clause_ids == []

    # Configure a rule after the review already ran, with no re-review.
    client.put(f"/api/standard-profiles/{profile.id}/policy-rules/liability_cap", json={"rule_text": RULE})

    body = client.get(f"/api/contracts/{contract_id}/risks").json()
    assert body["policy_complete"] is False  # honestly incomplete for the config as it now stands
    policy = {p["id"]: p for p in body["policy"]}
    assert policy["liability_cap"]["status"] == "cannot_tell"  # never "compliant": never asked


def test_a_stored_verdict_goes_stale_when_the_rule_text_changes(db, workspace_id, fake_chat_model: FakeChatModel) -> None:
    profile = repository.get_or_create_default_profile(db, workspace_id)
    repository.set_profile_policy_rule(db, profile.id, "liability_cap", RULE)
    db.commit()

    contract_id = _stored(db, workspace_id, LIABILITY)
    fake_chat_model.clause_reply = json.dumps(
        [{"clause": "liability_cap", "passage": 1, "quote": "total liability under this Agreement shall not exceed the fees paid"}]
    )
    fake_chat_model.policy_reply = json.dumps(
        [{"item": 1, "clause": "liability_cap", "verdict": "compliant", "quote": "shall not exceed the fees paid"}]
    )
    review_contract(contract_id, fake_chat_model)

    body = client.get(f"/api/contracts/{contract_id}/risks").json()
    assert {p["id"]: p["status"] for p in body["policy"]}["liability_cap"] == "compliant"

    # The rule's wording changes, with no re-review.
    client.put(f"/api/standard-profiles/{profile.id}/policy-rules/liability_cap", json={"rule_text": "the cap must not exceed 6 months of fees"})

    body = client.get(f"/api/contracts/{contract_id}/risks").json()
    policy = {p["id"]: p for p in body["policy"]}
    assert policy["liability_cap"]["status"] == "cannot_tell"  # the stored verdict judged the OLD wording
    assert policy["liability_cap"]["rule_text"] == "the cap must not exceed 6 months of fees"
