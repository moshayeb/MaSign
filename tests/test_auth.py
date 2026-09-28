"""MAS-143: internal accounts, personal workspaces, sessions and workspace
isolation. The rest of the suite runs against one auto-authenticated account
(conftest's `_authenticated` autouse fixture); these tests turn that override
off to exercise the real register/login/logout/session flow, and to prove
two different accounts cannot see each other's contracts.
"""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api import dependencies
from app.database import repository
from app.main import app

PASSWORD = "correct horse battery staple"


@pytest.fixture
def email() -> str:
    # `users`/`workspaces` rows are not truncated between tests (only
    # `contracts` cascades from truncating that table), so a shared literal
    # email would collide with whatever an earlier test already registered.
    return f"reviewer-{uuid4().hex[:8]}@example.com"


def _unauthenticated_client() -> TestClient:
    """A fresh client with the autouse auth override switched off, so real
    session cookies (not the test-suite default account) drive every request."""
    app.dependency_overrides.pop(dependencies.get_current_user, None)
    app.dependency_overrides.pop(dependencies.get_current_workspace, None)
    return TestClient(app)


# --- registration -------------------------------------------------------------


def test_register_creates_an_account_and_signs_in(db, email: str) -> None:
    client = _unauthenticated_client()

    response = client.post("/api/auth/register", json={"email": email, "password": PASSWORD})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["email"] == email and body["id"]
    assert "password" not in body and "password_hash" not in body
    assert "masign_session" in response.cookies

    # The session actually works: a follow-up request needs no login.
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["email"] == email


def test_register_hashes_the_password_not_stores_it_verbatim(db, email: str) -> None:
    client = _unauthenticated_client()
    client.post("/api/auth/register", json={"email": email, "password": PASSWORD})

    user = repository.get_user_by_email(db, email)
    assert user is not None
    assert user.password_hash != PASSWORD
    assert PASSWORD not in user.password_hash


def test_register_creates_exactly_one_personal_workspace(db, email: str) -> None:
    client = _unauthenticated_client()
    client.post("/api/auth/register", json={"email": email, "password": PASSWORD})

    user = repository.get_user_by_email(db, email)
    workspace = repository.get_workspace_for_user(db, user.id)
    assert workspace is not None and workspace.name == f"{email}'s workspace"


def test_registering_the_same_email_twice_is_refused_generically(db, email: str) -> None:
    client = _unauthenticated_client()
    first = client.post("/api/auth/register", json={"email": email, "password": PASSWORD})
    assert first.status_code == 201

    second = client.post("/api/auth/register", json={"email": email, "password": "a different password"})
    assert second.status_code == 409
    # Never a message revealing *why* -- "already registered" would confirm
    # the email exists to an unauthenticated caller.
    assert "already" not in second.json()["detail"].lower()


def test_register_normalizes_email_case_and_whitespace(db) -> None:
    client = _unauthenticated_client()
    client.post("/api/auth/register", json={"email": "  ReViEwEr@Example.com  ", "password": PASSWORD})

    assert repository.get_user_by_email(db, "reviewer@example.com") is not None


def test_register_rejects_a_short_password(db, email: str) -> None:
    client = _unauthenticated_client()
    response = client.post("/api/auth/register", json={"email": email, "password": "short"})
    assert response.status_code == 422


def test_register_rejects_an_invalid_email(db) -> None:
    client = _unauthenticated_client()
    response = client.post("/api/auth/register", json={"email": "not-an-email", "password": PASSWORD})
    assert response.status_code == 422


# --- login / logout -------------------------------------------------------------


def test_login_with_correct_credentials_signs_in(db, email: str) -> None:
    setup = _unauthenticated_client()
    setup.post("/api/auth/register", json={"email": email, "password": PASSWORD})

    client = _unauthenticated_client()  # a fresh client: no cookie yet
    response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})

    assert response.status_code == 200 and response.json()["email"] == email
    assert client.get("/api/auth/me").status_code == 200


def test_login_with_wrong_password_is_refused_generically(db, email: str) -> None:
    setup = _unauthenticated_client()
    setup.post("/api/auth/register", json={"email": email, "password": PASSWORD})

    client = _unauthenticated_client()
    response = client.post("/api/auth/login", json={"email": email, "password": "wrong password entirely"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."


def test_login_with_unknown_email_gives_the_same_message_as_a_wrong_password(db) -> None:
    client = _unauthenticated_client()
    response = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": PASSWORD})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."


def test_login_hashes_even_for_an_unknown_email_so_it_cannot_be_timed_out(db, email: str, monkeypatch) -> None:
    """The identical error message (above) is not enough on its own: `user is
    None or not verify_password(...)` would short-circuit past the ~150-200ms
    Argon2id verify for an unregistered email, returning in ~30ms instead --
    a timing oracle an attacker uses to enumerate real accounts even though
    every response body reads the same (found live, MAS-33)."""
    calls: list[str | None] = []
    from app.api import auth_routes

    real_verify = auth_routes.verify_password

    def counting_verify(password: str, password_hash: str) -> bool:
        calls.append(password_hash)
        return real_verify(password, password_hash)

    monkeypatch.setattr(auth_routes, "verify_password", counting_verify)

    setup = _unauthenticated_client()
    setup.post("/api/auth/register", json={"email": email, "password": PASSWORD})

    client = _unauthenticated_client()
    client.post("/api/auth/login", json={"email": "nobody-else@example.com", "password": PASSWORD})
    client.post("/api/auth/login", json={"email": email, "password": "wrong password entirely"})

    assert len(calls) == 2  # a real Argon2id verify ran for the unknown email too, not skipped
    assert calls[0] == auth_routes.DUMMY_PASSWORD_HASH  # unknown email: verified against the dummy hash
    assert calls[1] != auth_routes.DUMMY_PASSWORD_HASH  # known email: verified against its real hash


def test_me_without_a_session_is_401(db) -> None:
    client = _unauthenticated_client()
    assert client.get("/api/auth/me").status_code == 401


def test_logout_revokes_the_session_not_just_the_cookie(db, email: str) -> None:
    client = _unauthenticated_client()
    client.post("/api/auth/register", json={"email": email, "password": PASSWORD})
    session_cookie = client.cookies["masign_session"]
    assert client.get("/api/auth/me").status_code == 200

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 204

    # The session row itself is gone, not just forgotten by this client: a
    # replayed copy of the old cookie must not still work (real revocation).
    replay = _unauthenticated_client()
    replay.cookies.set("masign_session", session_cookie)
    assert replay.get("/api/auth/me").status_code == 401


# --- workspace isolation (MAS-143 acceptance criteria) ---------------------------


def test_a_user_cannot_list_get_query_or_export_another_users_contract(db) -> None:
    owner = _unauthenticated_client()
    owner.post("/api/auth/register", json={"email": "owner@example.com", "password": PASSWORD})
    uploaded = owner.post(
        "/api/contracts/upload", files={"file": ("owner-only.txt", b"1. Fees. EUR 100 per month.", "text/plain")}
    )
    assert uploaded.status_code == 200, uploaded.text
    contract_id = uploaded.json()["contract_id"]

    stranger = _unauthenticated_client()
    stranger.post("/api/auth/register", json={"email": "stranger@example.com", "password": PASSWORD})

    # Every one of these looks exactly like the contract does not exist --
    # never a 403 that would confirm a valid id belonging to someone else.
    assert stranger.get(f"/api/contracts/{contract_id}").status_code == 404
    assert stranger.get(f"/api/contracts/{contract_id}/passages").status_code == 404
    assert stranger.get(f"/api/contracts/{contract_id}/risks").status_code == 404
    assert stranger.post("/api/query", json={"question": "what is the fee?", "contract_id": contract_id}).status_code == 404
    assert stranger.post(f"/api/contracts/{contract_id}/review").status_code == 404
    assert stranger.get(f"/api/contracts/{contract_id}/export.md").status_code == 404

    # And the owner's own list never contains the stranger's view of nothing.
    owner_list = {c["contract_id"] for c in owner.get("/api/contracts").json()}
    stranger_list = {c["contract_id"] for c in stranger.get("/api/contracts").json()}
    assert contract_id in owner_list
    assert contract_id not in stranger_list


def test_an_all_contracts_query_only_searches_the_callers_own_workspace(db) -> None:
    owner = _unauthenticated_client()
    owner.post("/api/auth/register", json={"email": "owner2@example.com", "password": PASSWORD})
    owner.post("/api/contracts/upload", files={"file": ("secret.txt", b"1. Penalty. EUR 999,999 on breach.", "text/plain")})

    stranger = _unauthenticated_client()
    stranger.post("/api/auth/register", json={"email": "stranger2@example.com", "password": PASSWORD})

    # No-scope query ("all contracts") in the stranger's own, empty workspace
    # must not retrieve anything from the owner's workspace.
    response = stranger.post("/api/query", json={"question": "what is the penalty?"})
    assert response.status_code == 200
    assert response.json()["retrieved_context"] == []


def test_linking_cannot_reach_across_workspaces(db) -> None:
    owner = _unauthenticated_client()
    owner.post("/api/auth/register", json={"email": "owner3@example.com", "password": PASSWORD})
    primary = owner.post(
        "/api/contracts/upload",
        files={"file": ("main.txt", b"2. Fees. The Fees are as set out in the Order Form.", "text/plain")},
    ).json()["contract_id"]

    stranger = _unauthenticated_client()
    stranger.post("/api/auth/register", json={"email": "stranger3@example.com", "password": PASSWORD})
    other = stranger.post(
        "/api/contracts/upload", files={"file": ("order-form.txt", b"1. This is the Order Form.", "text/plain")}
    ).json()["contract_id"]

    # The owner cannot link in a document that belongs to another workspace --
    # it 404s exactly like a nonexistent id, never a cross-tenant link.
    response = owner.post(
        f"/api/contracts/{primary}/links", json={"linked_contract_id": other, "reference_name": "Order Form"}
    )
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


# --- audit trail (MAS-143 acceptance criteria) -----------------------------------


def test_upload_records_an_audit_event_with_the_requesting_user(db) -> None:
    client = _unauthenticated_client()
    client.post("/api/auth/register", json={"email": "auditee@example.com", "password": PASSWORD})
    user = repository.get_user_by_email(db, "auditee@example.com")
    workspace = repository.get_workspace_for_user(db, user.id)

    uploaded = client.post("/api/contracts/upload", files={"file": ("c.txt", b"1. Fees.", "text/plain")})
    contract_id = uploaded.json()["contract_id"]

    events = repository.list_audit_events(db, workspace.id)
    upload_events = [e for e in events if e.event_type == "contract.uploaded"]
    assert len(upload_events) == 1
    assert str(upload_events[0].target_id) == contract_id
    assert upload_events[0].user_id == user.id  # a person did this, not the system
