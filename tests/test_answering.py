"""MAS-13 / MAS-14: answers come from the passages, cite them, or say "not found"."""

import os
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.answering import llm
from app.answering.grounding import (
    NOT_FOUND_ANSWER,
    NOT_FOUND_TOKEN,
    SYSTEM_PROMPT,
    answer_question,
    build_user_prompt,
)
from app.answering.llm import ChatModelError, LiteLLMChatModel, UnconfiguredChatModel
from app.guardrails.prompt_injection import GuardedChatModel
from app.api import dependencies
from app.main import app
from app.retrieval.vector_store import ChunkHit
from tests.conftest import FakeChatModel

CONTRACT = uuid4()


def _hits(*texts: str) -> list[ChunkHit]:
    return [ChunkHit(chunk_id=uuid4(), contract_id=CONTRACT, chunk_index=i + 2, text=t, score=0.9 - i / 10) for i, t in enumerate(texts)]


# --- prompt and parsing (no API, no database) ---------------------------------------


def test_prompt_numbers_the_passages_and_names_their_source() -> None:
    hits = _hits("2. Fees. EUR 18,500 per month.", "3. Term. Thirty-six (36) months.")

    prompt = build_user_prompt("What is the monthly fee?", hits, {CONTRACT: "northwind.txt"})

    assert prompt == (
        "Contract passages:\n\n"
        "[1] (northwind.txt, passage 3)\n2. Fees. EUR 18,500 per month.\n\n"
        "[2] (northwind.txt, passage 4)\n3. Term. Thirty-six (36) months.\n\n"
        "Question: What is the monthly fee?"
    )
    assert "only the passages" in SYSTEM_PROMPT
    assert NOT_FOUND_TOKEN in SYSTEM_PROMPT


def test_answer_cites_the_passages_it_used_in_order_of_use() -> None:
    hits = _hits("fees", "term", "liability")
    model = FakeChatModel()
    model.reply = "The fee is EUR 18,500 per month [1]. Late payment bears interest at 1.5% per month, capped at 3% [3][1]."

    answer = answer_question("fees?", hits, model)

    assert answer.grounded is True
    assert [c.label for c in answer.citations] == [1, 3]
    assert answer.citations[1].hit is hits[2]
    assert answer.model == "fake-chat"
    system, user = model.calls[0]
    assert system == SYSTEM_PROMPT
    assert user.endswith("Question: fees?")


@pytest.mark.parametrize("reply", ["[1, 2] are relevant.", "See [1] and [2].", "[2][1]", "[1] twice [1]."])
def test_citation_formats(reply: str) -> None:
    model = FakeChatModel()
    model.reply = reply

    answer = answer_question("q", _hits("a", "b"), model)

    assert answer.grounded is True
    assert all(1 <= c.label <= 2 for c in answer.citations)
    assert len({c.label for c in answer.citations}) == len(answer.citations)  # no duplicates


@pytest.mark.parametrize("reply", ["The fee is X [1], the term Y [99].", "Cited [1], also [7] and [0].", "Only [3]."])
def test_a_reference_to_a_nonexistent_passage_makes_the_answer_unverified(reply: str, caplog: pytest.LogCaptureFixture) -> None:
    # MAS-69: [99] points at nothing, so the answer as a whole cannot be trusted.
    model = FakeChatModel()
    model.reply = reply

    with caplog.at_level("WARNING"):
        answer = answer_question("q", _hits("a", "b"), model)

    assert answer.grounded is False
    assert answer.text == reply  # still shown, flagged
    assert all(1 <= c.label <= 2 for c in answer.citations)  # the real ones are still resolved
    assert "invalid=" in caplog.text


def test_a_cut_off_answer_is_unverified_even_when_it_cites(caplog: pytest.LogCaptureFixture) -> None:
    # MAS-70: generation hit max_tokens mid-sentence.
    model = FakeChatModel()
    model.reply = "The fee is EUR 18,500 [1] and late payment bears interest at"
    model.truncated = True

    with caplog.at_level("WARNING"):
        answer = answer_question("q", _hits("fees"), model)

    assert answer.grounded is False
    assert [c.label for c in answer.citations] == [1]
    assert "truncated=True" in caplog.text

    model.reply = "NOT_FOUND"  # a cut-off reply is never read as a deliberate NOT_FOUND
    answer = answer_question("q", _hits("fees"), model)
    assert answer.text == "NOT_FOUND"
    assert answer.grounded is False


@pytest.mark.parametrize("reply", ["NOT_FOUND", "NOT_FOUND.", "not_found", "NOT_FOUND\nThe passages cover fees only."])
def test_not_found_token_becomes_the_fixed_answer(reply: str) -> None:
    # MAS-14: an irrelevant question gets "not found in contract", never a guess.
    model = FakeChatModel()
    model.reply = reply

    answer = answer_question("Who is the CEO of Northwind?", _hits("fees"), model)

    assert answer.text == NOT_FOUND_ANSWER == "Not found in contract."
    assert answer.grounded is False
    assert answer.citations == []


def test_empty_retrieval_never_asks_the_model() -> None:
    model = FakeChatModel()

    answer = answer_question("anything", [], model)

    assert answer.text == NOT_FOUND_ANSWER
    assert answer.grounded is False
    assert answer.model is None
    assert model.calls == []


def test_uncited_answer_is_returned_but_marked_ungrounded(caplog: pytest.LogCaptureFixture) -> None:
    model = FakeChatModel()
    model.reply = "The fee is EUR 18,500 per month."

    with caplog.at_level("WARNING"):
        answer = answer_question("fee?", _hits("fees"), model)

    assert answer.text == "The fee is EUR 18,500 per month."
    assert answer.grounded is False
    assert answer.citations == []
    assert "Unverified answer" in caplog.text and "cited=[]" in caplog.text


# --- provider selection (the adapters themselves are tested in test_guardrails.py, MAS-90) ---


def test_chat_model_is_chosen_by_environment(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    for name in ("CHAT_PROVIDER", "CHAT_MODEL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    llm.get_chat_model.cache_clear()

    with caplog.at_level("WARNING"):
        model = llm.get_chat_model()
    assert isinstance(model, UnconfiguredChatModel)  # default provider is Anthropic, no key yet
    assert "ANTHROPIC_API_KEY is not set" in caplog.text
    with pytest.raises(ChatModelError, match="set ANTHROPIC_API_KEY"):
        model.complete("s", "u", max_tokens=1)

    llm.get_chat_model.cache_clear()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    model = llm.get_chat_model()
    assert isinstance(model, GuardedChatModel) and isinstance(model.inner, LiteLLMChatModel)  # MAS-90
    assert (model.provider, model.model_name) == ("anthropic", "claude-sonnet-5")

    llm.get_chat_model.cache_clear()
    monkeypatch.setenv("CHAT_PROVIDER", "openai")
    monkeypatch.setenv("CHAT_MODEL", "gpt-4.1-mini")
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    model = llm.get_chat_model()
    assert isinstance(model, GuardedChatModel) and isinstance(model.inner, LiteLLMChatModel)
    assert (model.provider, model.model_name) == ("openai", "gpt-4.1-mini")

    llm.get_chat_model.cache_clear()
    monkeypatch.setenv("CHAT_PROVIDER", "gemini")
    with pytest.raises(ValueError, match="CHAT_PROVIDER"):
        llm.get_chat_model()
    llm.get_chat_model.cache_clear()


# --- through the API (needs the test database) ----------------------------------------


client = TestClient(app)


@pytest.fixture
def northwind(db):
    from pathlib import Path

    path = Path(__file__).resolve().parent.parent / "data" / "sample_contracts" / "northwind_master_services_agreement.txt"
    response = client.post("/api/contracts/upload", files={"file": ("northwind.txt", path.read_bytes(), "text/plain")})
    assert response.status_code == 200, response.text
    return response.json()["contract_id"]


def test_query_returns_the_answer_with_resolved_citations(northwind: str, fake_chat_model: FakeChatModel) -> None:
    fake_chat_model.reply = "The monthly fee is EUR 18,500 [1]. It is invoiced monthly in advance [1][2]."

    response = client.post("/api/query", json={"question": "What is the monthly fee?", "contract_id": northwind, "limit": 3})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answer"].startswith("The monthly fee is EUR 18,500 [1].")
    assert body["grounded"] is True
    assert body["answer_model"] == "fake-chat"
    assert [c["label"] for c in body["citations"]] == [1, 2]
    assert body["citations"][0]["chunk_id"] == body["retrieved_context"][0]["chunk_id"]
    assert body["citations"][1]["chunk_id"] == body["retrieved_context"][1]["chunk_id"]
    assert body["citations"][0]["text"] == body["retrieved_context"][0]["text"]
    # The model saw the passages under the contract's filename.
    assert "(northwind.txt, passage" in fake_chat_model.calls[0][1]


def test_query_reports_not_found_for_an_unanswerable_question(northwind: str, fake_chat_model: FakeChatModel) -> None:
    fake_chat_model.reply = "NOT_FOUND"

    body = client.post("/api/query", json={"question": "Who is Northwind's CEO?", "contract_id": northwind}).json()

    assert body["answer"] == "Not found in contract."
    assert body["grounded"] is False
    assert body["citations"] == []
    assert body["retrieved_context"]  # the passages are still shown, so the user can check


def test_query_marks_a_cut_off_answer_unverified(northwind: str, fake_chat_model: FakeChatModel) -> None:
    fake_chat_model.reply = "The monthly fee is EUR 18,500 [1] and the"
    fake_chat_model.truncated = True

    body = client.post("/api/query", json={"question": "fee?", "contract_id": northwind}).json()

    assert body["answer"] == "The monthly fee is EUR 18,500 [1] and the"
    assert body["grounded"] is False
    assert [c["label"] for c in body["citations"]] == [1]


def test_query_is_a_503_with_the_reason_when_the_model_is_unavailable(northwind: str) -> None:
    app.dependency_overrides[dependencies.get_chat_model] = lambda: UnconfiguredChatModel("anthropic")

    response = client.post("/api/query", json={"question": "fees?", "contract_id": northwind})

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "Answer generation unavailable: Answer generation is not configured: set ANTHROPIC_API_KEY (CHAT_PROVIDER=anthropic)."
    )


# --- expected values for the live test (MAS-71 / MAS-77) ----------------------------------

# Each pattern is the complete value with its unit, anchored so that a larger
# number containing the digits ("11.5% per month") or another unit ("per
# year") cannot pass. `(?<![\d.,])` = not preceded by a digit or separator.
EXPECTED_VALUES = {
    "What is the monthly fee?": r"(?<![\d.,])EUR 18,500 per month",
    "What interest applies to late payment?": r"(?<![\d.,])1\.5% per month",
    "How long is the initial term?": r"(?<![\d.,])thirty-six \(36\) months",
    "What is the termination fee?": r"(?<![\d.,])fifty percent \(50%\) of the Subscription Fees",
}


@pytest.mark.parametrize(
    "answer, expected",
    [
        ("Interest accrues at 1.5% per month [1].", True),
        ("Interest accrues at 11.5% per month [1].", False),
        ("Interest accrues at 21.5% per month [1].", False),
        ("Interest accrues at 1.5% per year [1].", False),
        ("Interest accrues at 1.5% per month (18% per annum) [1].", True),
    ],
)
def test_the_interest_pattern_rejects_wrong_magnitudes_and_units(answer: str, expected: bool) -> None:
    import re

    assert bool(re.search(EXPECTED_VALUES["What interest applies to late payment?"], answer)) is expected


# --- real model (opt-in) ------------------------------------------------------------------


@pytest.mark.skipif(os.getenv("MASIGN_REAL_LLM") != "1", reason="set MASIGN_REAL_LLM=1 (and the provider's API key) to call the real model")
def test_real_model_answers_northwind_questions_with_citations(db) -> None:
    # End to end with the real embedder as well: the fake bag-of-words embedder
    # can miss the right clause, and then "not found" is the correct answer.
    from pathlib import Path

    from qdrant_client import QdrantClient

    from app.answering.llm import get_chat_model
    from app.retrieval.embeddings import DEFAULT_EMBEDDING_MODEL, SentenceTransformerEmbedder
    from app.retrieval.vector_store import VectorStore

    embedder = SentenceTransformerEmbedder(DEFAULT_EMBEDDING_MODEL)
    store = VectorStore(QdrantClient(":memory:"), collection="real")
    store.ensure_collection(embedder.dimension)
    get_chat_model.cache_clear()
    app.dependency_overrides[dependencies.get_embedder] = lambda: embedder
    app.dependency_overrides[dependencies.get_vector_store] = lambda: store
    app.dependency_overrides[dependencies.get_chat_model] = get_chat_model
    path = Path(__file__).resolve().parent.parent / "data" / "sample_contracts" / "northwind_master_services_agreement.txt"
    northwind = client.post("/api/contracts/upload", files={"file": ("northwind.txt", path.read_bytes(), "text/plain")}).json()["contract_id"]
    import re

    # MAS-71 / MAS-77: the complete value with its unit, in the answer AND in
    # a cited passage — "136 days", "11.5% per month" or "1.5% per year" must not pass.
    for question, value in EXPECTED_VALUES.items():
        body = client.post("/api/query", json={"question": question, "contract_id": northwind, "limit": 5}).json()
        assert body["grounded"] is True, body
        assert re.search(value, body["answer"]), (question, body["answer"])
        assert any(re.search(value, c["text"]) for c in body["citations"]), (question, [c["chunk_index"] for c in body["citations"]])

    body = client.post("/api/query", json={"question": "Who is the CEO of Northwind?", "contract_id": northwind}).json()
    assert body["answer"] == "Not found in contract.", body["answer"]
    assert body["grounded"] is False and body["citations"] == []
