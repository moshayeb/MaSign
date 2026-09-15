"""MAS-47: validation errors carry a readable `detail` string like every other error.

The UI shows `detail` verbatim in a toast (docs/frontend.md); FastAPI's default
list-of-objects would render as "[object Object]".
"""

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_blank_question_has_readable_detail() -> None:
    response = client.post("/api/query", json={"question": "   "})

    assert response.status_code == 422
    body = response.json()
    assert isinstance(body["detail"], str)
    assert body["detail"].startswith("question: ")
    assert isinstance(body["errors"], list) and body["errors"][0]["loc"] == ["body", "question"]


def test_malformed_contract_id_has_readable_detail() -> None:
    response = client.get("/api/contracts/not-a-uuid")

    assert response.status_code == 422
    assert response.json()["detail"].startswith("contract_id: ")


def test_missing_upload_file_has_readable_detail() -> None:
    response = client.post("/api/contracts/upload")

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert isinstance(detail, str)
    assert "file" in detail and "required" in detail.lower()


def test_several_problems_are_joined_into_one_line() -> None:
    response = client.post("/api/query", json={"question": "", "contract_id": 12345})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "question: " in detail and "contract_id: " in detail and "; " in detail
