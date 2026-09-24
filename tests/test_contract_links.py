"""MAS-137: linking an uploaded contract as the resolution of a named external
reference on another contract -- explicit and user-confirmed only, never
inferred from filename or content."""

from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import repository
from app.main import app
from tests.conftest import FakeChatModel

client = TestClient(app)


def _stored(db, *passages: str, name: str = "c.txt") -> str:
    contract = repository.create_contract(db, filename=name, file_type="txt", size_bytes=1, character_count=1, chunks=list(passages))
    db.commit()
    return contract.id


ORDER_FORM_CONTRACT = "2. Fees. The Fees are as set out in the Order Form and Schedule 2."


# --- the API ------------------------------------------------------------------------------


def test_link_is_created_and_listed(db) -> None:
    primary_id = _stored(db, ORDER_FORM_CONTRACT, name="main.txt")
    linked_id = _stored(db, "1. This is the Order Form.", name="order-form.txt")

    response = client.post(f"/api/contracts/{primary_id}/links", json={"linked_contract_id": str(linked_id), "reference_name": "Order Form"})

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["primary_contract_id"], body["linked_contract_id"], body["reference_name"]) == (str(primary_id), str(linked_id), "Order Form")
    assert body["id"] and body["created_at"]

    listed = client.get(f"/api/contracts/{primary_id}/links").json()
    assert len(listed) == 1 and listed[0]["id"] == body["id"]


def test_link_rejects_a_reference_name_that_is_not_actually_unresolved(db) -> None:
    primary_id = _stored(db, ORDER_FORM_CONTRACT, name="main.txt")
    linked_id = _stored(db, "1. Some other document.", name="other.txt")

    not_a_reference = client.post(f"/api/contracts/{primary_id}/links", json={"linked_contract_id": str(linked_id), "reference_name": "Statement of Work"})
    assert not_a_reference.status_code == 400
    assert "not an unresolved reference" in not_a_reference.json()["detail"]

    # Linking the real reference once resolves it -- linking it again is refused too.
    first = client.post(f"/api/contracts/{primary_id}/links", json={"linked_contract_id": str(linked_id), "reference_name": "Order Form"})
    assert first.status_code == 201, first.text
    again = client.post(f"/api/contracts/{primary_id}/links", json={"linked_contract_id": str(linked_id), "reference_name": "Order Form"})
    assert again.status_code == 400
    assert "not an unresolved reference" in again.json()["detail"]


def test_link_rejects_a_contract_linking_itself(db) -> None:
    primary_id = _stored(db, ORDER_FORM_CONTRACT, name="main.txt")

    response = client.post(f"/api/contracts/{primary_id}/links", json={"linked_contract_id": str(primary_id), "reference_name": "Order Form"})

    assert response.status_code == 400
    assert "cannot be linked to itself" in response.json()["detail"]


def test_link_rejects_unknown_contracts(db) -> None:
    primary_id = _stored(db, ORDER_FORM_CONTRACT, name="main.txt")

    unknown_primary = client.post(f"/api/contracts/{uuid4()}/links", json={"linked_contract_id": str(primary_id), "reference_name": "Order Form"})
    assert unknown_primary.status_code == 404

    unknown_linked = client.post(f"/api/contracts/{primary_id}/links", json={"linked_contract_id": str(uuid4()), "reference_name": "Order Form"})
    assert unknown_linked.status_code == 404
    assert "document to link was not found" in unknown_linked.json()["detail"]


def test_unlink_removes_the_link(db) -> None:
    primary_id = _stored(db, ORDER_FORM_CONTRACT, name="main.txt")
    linked_id = _stored(db, "1. This is the Order Form.", name="order-form.txt")
    link_id = client.post(f"/api/contracts/{primary_id}/links", json={"linked_contract_id": str(linked_id), "reference_name": "Order Form"}).json()["id"]

    deleted = client.delete(f"/api/contracts/{primary_id}/links/{link_id}")
    assert deleted.status_code == 204
    assert client.get(f"/api/contracts/{primary_id}/links").json() == []

    again = client.delete(f"/api/contracts/{primary_id}/links/{link_id}")
    assert again.status_code == 404


def test_unlink_invalidates_the_primarys_existing_review(db, fake_chat_model: FakeChatModel) -> None:
    primary_id = _stored(db, ORDER_FORM_CONTRACT, name="main.txt")
    linked_id = _stored(db, "1. This is the Order Form.", name="order-form.txt")
    repository.start_risk_review(db, primary_id, status="done")
    repository.update_risk_review(db, primary_id, status="done", chunks_total=1, chunks_checked=1, complete=True, key_terms_complete=True)
    db.commit()
    link_id = client.post(f"/api/contracts/{primary_id}/links", json={"linked_contract_id": str(linked_id), "reference_name": "Order Form"}).json()["id"]

    client.delete(f"/api/contracts/{primary_id}/links/{link_id}")

    review = repository.get_risk_review(db, primary_id)
    assert review.status == "failed" and review.complete is False and review.key_terms_complete is False
    assert "Run the review again" in review.error


def test_unlink_with_no_existing_review_does_not_error(db) -> None:
    primary_id = _stored(db, ORDER_FORM_CONTRACT, name="main.txt")
    linked_id = _stored(db, "1. This is the Order Form.", name="order-form.txt")
    link_id = client.post(f"/api/contracts/{primary_id}/links", json={"linked_contract_id": str(linked_id), "reference_name": "Order Form"}).json()["id"]

    response = client.delete(f"/api/contracts/{primary_id}/links/{link_id}")

    assert response.status_code == 204
    assert repository.get_risk_review(db, primary_id) is None


# --- cascading deletes ----------------------------------------------------------------------


def test_deleting_the_primary_contract_cascades_the_link(db) -> None:
    primary_id = _stored(db, ORDER_FORM_CONTRACT, name="main.txt")
    linked_id = _stored(db, "1. This is the Order Form.", name="order-form.txt")
    repository.create_link(db, primary_contract_id=primary_id, linked_contract_id=linked_id, reference_name="Order Form")
    db.commit()

    repository.delete_contract(db, primary_id)
    db.commit()

    # The linked contract itself is untouched.
    assert repository.get_contract(db, linked_id) is not None
    with db.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) AS n FROM contract_links WHERE linked_contract_id = %s", (linked_id,))
        assert cursor.fetchone()["n"] == 0


def test_deleting_the_linked_contract_cascades_the_link(db) -> None:
    primary_id = _stored(db, ORDER_FORM_CONTRACT, name="main.txt")
    linked_id = _stored(db, "1. This is the Order Form.", name="order-form.txt")
    repository.create_link(db, primary_contract_id=primary_id, linked_contract_id=linked_id, reference_name="Order Form")
    db.commit()

    repository.delete_contract(db, linked_id)
    db.commit()

    # The primary contract itself is untouched.
    assert repository.get_contract(db, primary_id) is not None
    assert repository.list_links(db, primary_id) == []


# --- repository -----------------------------------------------------------------------------


def test_bundle_contract_ids_returns_the_primary_first_then_every_linked_contract(db) -> None:
    primary_id = _stored(db, ORDER_FORM_CONTRACT, name="main.txt")
    first_linked = _stored(db, "1. This is the Order Form.", name="order-form.txt")
    second_linked = _stored(db, "1. This is Schedule 2.", name="schedule-2.txt")
    repository.create_link(db, primary_contract_id=primary_id, linked_contract_id=first_linked, reference_name="Order Form")
    repository.create_link(db, primary_contract_id=primary_id, linked_contract_id=second_linked, reference_name="Schedule 2")
    db.commit()

    assert repository.bundle_contract_ids(db, primary_id) == [primary_id, first_linked, second_linked]
    # A contract with no links is a bundle of one.
    assert repository.bundle_contract_ids(db, first_linked) == [first_linked]
