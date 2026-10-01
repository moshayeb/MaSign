"""Named standard profiles (MAS-185): a workspace can define more than one
named set of the MAS-120 numeric standards and assign one per contract. A
contract with none assigned uses the workspace's single default profile --
today's MAS-120/181 behaviour, unchanged. No model call anywhere here."""

import json
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.api import dependencies
from app.database import repository
from app.main import app
from app.risk_analysis.review import review_contract
from tests.conftest import FakeChatModel

client = TestClient(app)

FEES = "2. Fees. Customer shall pay EUR 18,500 per month, invoiced monthly in advance. Invoices are due thirty (30) days after the invoice date."


def _item(term: str, value: str, passage: int, quote: str, typed: dict | None = None) -> dict:
    return {"term": term, "value": value, "passage": passage, "quote": quote, "typed": typed}


def _stored(db, workspace_id, *passages: str) -> str:
    contract = repository.create_contract(
        db, workspace_id=workspace_id, filename="c.txt", file_type="txt", size_bytes=1, character_count=1, chunks=list(passages)
    )
    db.commit()
    return contract.id


def test_workspace_always_has_exactly_one_default_profile(db) -> None:
    body = client.get("/api/standard-profiles").json()
    assert len(body) == 1
    assert body[0]["name"] == "Default"
    assert body[0]["is_default"] is True


def test_create_profile_then_list_shows_both(db) -> None:
    created = client.post("/api/standard-profiles", json={"name": "Vendor contracts"})
    assert created.status_code == 201
    assert created.json()["name"] == "Vendor contracts"
    assert created.json()["is_default"] is False

    body = client.get("/api/standard-profiles").json()
    names = {p["name"] for p in body}
    assert names == {"Default", "Vendor contracts"}


def test_duplicate_profile_name_in_a_workspace_is_a_conflict(db) -> None:
    assert client.post("/api/standard-profiles", json={"name": "Vendor contracts"}).status_code == 201
    dupe = client.post("/api/standard-profiles", json={"name": "Vendor contracts"})
    assert dupe.status_code == 409


def test_blank_profile_name_is_rejected(db) -> None:
    assert client.post("/api/standard-profiles", json={"name": "   "}).status_code == 422


def test_rename_and_set_default(db) -> None:
    created = client.post("/api/standard-profiles", json={"name": "Vendor contracts"}).json()
    renamed = client.put(f"/api/standard-profiles/{created['id']}", json={"name": "Vendor agreements"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Vendor agreements"

    made_default = client.put(f"/api/standard-profiles/{created['id']}", json={"is_default": True})
    assert made_default.status_code == 200
    assert made_default.json()["is_default"] is True

    by_id = {p["id"]: p for p in client.get("/api/standard-profiles").json()}
    assert by_id[created["id"]]["is_default"] is True
    assert all(not p["is_default"] for pid, p in by_id.items() if pid != created["id"])


def test_default_profile_cannot_be_deleted(db) -> None:
    default_id = client.get("/api/standard-profiles").json()[0]["id"]
    deleted = client.delete(f"/api/standard-profiles/{default_id}")
    assert deleted.status_code == 400
    assert "default" in deleted.json()["detail"].lower()


def test_deleting_a_profile_falls_its_contracts_back_to_the_default(db, workspace_id) -> None:
    contract_id = _stored(db, workspace_id, FEES)
    profile = client.post("/api/standard-profiles", json={"name": "Strict"}).json()
    client.put(f"/api/standard-profiles/{profile['id']}/standards/payment_deadline", json={"params": {"net_days_min": 90}})
    assign = client.put(f"/api/contracts/{contract_id}/standard-profile", json={"profile_id": profile["id"]})
    assert assign.status_code == 200
    assert assign.json()["standard_profile_id"] == profile["id"]

    deleted = client.delete(f"/api/standard-profiles/{profile['id']}")
    assert deleted.status_code == 204

    summary = client.get(f"/api/contracts/{contract_id}").json()
    assert summary["standard_profile_id"] is None  # ON DELETE SET NULL -- never a dangling reference


def test_unknown_profile_id_is_404(db) -> None:
    fake_id = str(uuid4())
    assert client.get(f"/api/standard-profiles/{fake_id}/standards").status_code == 404
    assert client.put(f"/api/standard-profiles/{fake_id}", json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/standard-profiles/{fake_id}").status_code == 404
    assert client.put(f"/api/standard-profiles/{fake_id}/standards/payment_deadline", json={"params": {}}).status_code == 404


def test_standard_profiles_require_a_session(db) -> None:
    app.dependency_overrides.pop(dependencies.get_current_user, None)
    app.dependency_overrides.pop(dependencies.get_current_workspace, None)
    anonymous = TestClient(app)

    assert anonymous.get("/api/standard-profiles").status_code == 401
    assert anonymous.post("/api/standard-profiles", json={"name": "x"}).status_code == 401


def test_cannot_assign_a_contract_to_another_workspaces_profile(db, fake_chat_model: FakeChatModel) -> None:
    app.dependency_overrides.pop(dependencies.get_current_user, None)
    app.dependency_overrides.pop(dependencies.get_current_workspace, None)

    def account() -> tuple[TestClient, UUID]:
        signed_in = TestClient(app)
        response = signed_in.post(
            "/api/auth/register", json={"email": f"profile-{uuid4().hex}@example.com", "password": "correct horse battery staple"}
        )
        assert response.status_code == 201, response.text
        user = repository.get_user_by_email(db, response.json()["email"])
        workspace = repository.get_workspace_for_user(db, user.id)
        return signed_in, workspace.id

    first, first_workspace = account()
    second, second_workspace = account()
    second_contract = _stored(db, second_workspace, FEES)
    first_profile = first.post("/api/standard-profiles", json={"name": "Mine"}).json()

    response = second.put(f"/api/contracts/{second_contract}/standard-profile", json={"profile_id": first_profile["id"]})
    assert response.status_code == 422


def test_assigning_a_profile_changes_the_deviation_count_with_no_model_call(db, fake_chat_model: FakeChatModel, workspace_id) -> None:
    """The exact MAS-120 guarantee, extended to a non-default profile:
    switching which profile a contract uses changes its verdicts immediately,
    no re-review, no model call."""
    contract_id = _stored(db, workspace_id, FEES)

    def extract(user: str) -> str:
        return json.dumps([_item("payment_deadline", "30 days", 1, "due thirty (30) days after the invoice date", {"net_days": 30})])

    fake_chat_model.key_terms_reply = extract
    review_contract(contract_id, fake_chat_model, batch_size=1)

    before = client.get(f"/api/contracts/{contract_id}/key-terms").json()
    assert before["deviations"] == 0

    strict = client.post("/api/standard-profiles", json={"name": "Strict"}).json()
    client.put(f"/api/standard-profiles/{strict['id']}/standards/payment_deadline", json={"params": {"net_days_min": 60}})
    client.put(f"/api/contracts/{contract_id}/standard-profile", json={"profile_id": strict["id"]})
    fake_chat_model.calls.clear()

    after = client.get(f"/api/contracts/{contract_id}/key-terms").json()
    assert after["deviations"] == 1
    assert fake_chat_model.calls == []

    list_summary = next(c for c in client.get("/api/contracts").json() if c["contract_id"] == str(contract_id))
    assert list_summary["deviations"] == 1

    # Clearing the assignment (profile_id: null) returns to the workspace default.
    cleared = client.put(f"/api/contracts/{contract_id}/standard-profile", json={"profile_id": None})
    assert cleared.status_code == 200
    assert cleared.json()["standard_profile_id"] is None
    assert cleared.json()["deviations"] == 0


def test_contracts_on_different_profiles_are_batched_correctly_in_the_list(db, fake_chat_model: FakeChatModel, workspace_id) -> None:
    """repository.get_standards_by_profiles must return each contract's own
    profile's standards, not leak one contract's rule onto another's row."""
    strict_contract = _stored(db, workspace_id, FEES)
    default_contract = _stored(db, workspace_id, FEES)

    def extract(user: str) -> str:
        return json.dumps([_item("payment_deadline", "30 days", 1, "due thirty (30) days after the invoice date", {"net_days": 30})])

    fake_chat_model.key_terms_reply = extract
    review_contract(strict_contract, fake_chat_model, batch_size=1)
    review_contract(default_contract, fake_chat_model, batch_size=1)

    strict = client.post("/api/standard-profiles", json={"name": "Strict"}).json()
    client.put(f"/api/standard-profiles/{strict['id']}/standards/payment_deadline", json={"params": {"net_days_min": 60}})
    client.put(f"/api/contracts/{strict_contract}/standard-profile", json={"profile_id": strict["id"]})

    by_id = {c["contract_id"]: c for c in client.get("/api/contracts").json()}
    assert by_id[str(strict_contract)]["deviations"] == 1
    assert by_id[str(default_contract)]["deviations"] == 0
