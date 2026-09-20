"""The evaluation harness's scoring glue, driven by fakes — no Ragas, no network, no model (MAS-91)."""

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app.database import repository
from app.main import app
from evaluation.harness import (
    AnswerResult,
    Question,
    contract_ids_by_filename,
    judge_answers,
    judge_summary,
    load_questions,
    render_markdown,
    resolve_reference,
    retrieval_metrics,
    run_answers,
    run_retrieval,
)

client = TestClient(app)
ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = ROOT / "docs" / "evaluation" / "questions.jsonl"
CONTRACTS = ROOT / "data" / "sample_contracts"

NW = "northwind_master_services_agreement.txt"
HB = "harbor_software_subscription.txt"


class FakeApi:
    """Two contracts with three passages each; search ranks by a fixed table; query is canned."""

    def __init__(self) -> None:
        self.passage_texts = {
            "nw": ["1. Parties.", "2. Fees. EUR 18,500 per month; payable within thirty (30) days.", "3. Term of thirty-six (36) months."],
            "hb": ["1. Subscription.", "2. Fees. Annual fee of EUR 96,000.", "3. Term of twenty-four (24) months."],
        }
        self.rank = {"fee": [1, 2, 0], "term": [2, 1, 0], "days": [2, 1, 0]}
        self.queries: list[str] = []

    def contracts(self) -> list[dict[str, Any]]:
        return [
            {"contract_id": "old-nw", "filename": NW, "created_at": "2026-09-01T00:00:00Z"},
            {"contract_id": "nw", "filename": NW, "created_at": "2026-09-20T00:00:00Z"},
            {"contract_id": "hb", "filename": HB, "created_at": "2026-09-20T00:00:00Z"},
        ]

    def passages(self, contract_id: str) -> list[dict[str, Any]]:
        return [{"chunk_id": f"{contract_id}-{i}", "chunk_index": i, "text": t} for i, t in enumerate(self.passage_texts[contract_id])]

    def search(self, contract_id: str, question: str, limit: int) -> list[dict[str, Any]]:
        key = next((k for k in self.rank if k in question.lower()), "fee")
        return [{"chunk_index": i, "text": self.passage_texts[contract_id][i], "score": 0.9 - n / 10} for n, i in enumerate(self.rank[key][:limit])]

    def query(self, contract_id: str, question: str, limit: int) -> dict[str, Any]:
        self.queries.append(question)
        if "manager" in question:
            return {"answer": "Not found in contract.", "answer_status": "not_found", "grounded": False, "citations": [], "retrieved_context": []}
        return {
            "answer": "The fee is EUR 18,500 per month [1].",
            "answer_status": "answered",
            "grounded": True,
            "citations": [{"chunk_index": 1, "text": self.passage_texts[contract_id][1]}],
            "retrieved_context": [{"chunk_index": 1, "text": self.passage_texts[contract_id][1]}],
        }


def _q(id: str, question: str, quote: str = "", *, contract: str = NW, not_found: bool = False, answer: str = "x") -> Question:
    return Question(id=id, contract=contract, question=question, reference_answer=answer, reference_quote=quote, expect_not_found=not_found)


# --- the question file itself -----------------------------------------------------------------


def test_the_committed_question_set_is_well_formed_and_every_quote_is_in_its_contract() -> None:
    questions = load_questions(QUESTIONS)
    assert len(questions) >= 28
    assert {q.contract for q in questions} == {NW, HB}
    for q in questions:
        if q.expect_not_found:
            continue
        text = (CONTRACTS / q.contract).read_text(encoding="utf-8")
        assert resolve_reference([{"chunk_index": 0, "text": text}], q.reference_quote) == 0, f"{q.id}: quote not in {q.contract}"
    # one question per MAS-82 key term, across the two contracts
    terms = {q.term for q in questions if q.term}
    assert terms == {"effective_date", "recurring_fee", "one_off_fee", "payment_deadline", "late_payment", "termination_cost", "initial_term", "renewal", "notice_period", "price_changes"}
    assert sum(1 for q in questions if q.expect_not_found) >= 3


# --- resolving and scoring ------------------------------------------------------------------------


def test_reference_quotes_resolve_tolerantly_and_unknown_quotes_do_not() -> None:
    passages = FakeApi().passages("nw")
    assert resolve_reference(passages, "EUR 18,500  per month") == 1
    assert resolve_reference(passages, "thirty (30) days") == 1
    assert resolve_reference(passages, "not in any passage") is None
    assert resolve_reference(passages, "") is None


def test_retrieval_metrics_count_hits_and_ranks_and_skip_not_found_questions() -> None:
    api = FakeApi()
    questions = [
        _q("a", "What is the fee?", "EUR 18,500"),  # ranked 1st
        _q("b", "How long is the term?", "EUR 18,500"),  # fee passage ranked 2nd for a term question
        _q("c", "Who is the manager?", not_found=True),
        _q("d", "What is the fee?", "quote that is nowhere"),  # unresolved
    ]
    ids = contract_ids_by_filename(api, {NW, HB})
    assert ids == {NW: "nw", HB: "hb"}  # the newest Northwind, not the old one

    rows = run_retrieval(api, questions, ids, k=3)
    metrics = retrieval_metrics(rows, k=3)

    assert (metrics.questions, metrics.resolved) == (3, 2)
    assert metrics.hit_at_1 == 0.5 and metrics.hit_at_k == 1.0 and metrics.mrr == 0.75
    assert metrics.unresolved == ["d"] and metrics.misses == ["b"]
    assert rows[0].reference_text.startswith("2. Fees") and rows[2].reference is None


def test_judging_never_spends_a_call_on_not_found_or_declined_answers() -> None:
    calls: list[str] = []

    def fake_judge(result: AnswerResult):
        calls.append(result.question.id)
        return 1.0, 0.5, 3

    answered = AnswerResult(_q("a", "fee?", "EUR", answer="EUR 18,500"), "EUR 18,500 [1].", "answered", True, (1,), ("2. Fees.",), 2)
    declined = AnswerResult(_q("b", "term?", "36"), "Not found in contract.", "not_found", False, (), ("x",), 2)
    withheld = AnswerResult(_q("c", "fee?", "EUR"), "Could not answer: withheld.", "withheld", False, (), ("x",), 0)
    not_found_right = AnswerResult(_q("d", "manager?", not_found=True), "Not found in contract.", "not_found", False, (), (), 2)
    not_found_wrong = AnswerResult(_q("e", "manager?", not_found=True), "The manager is Bob [1].", "answered", True, (1,), ("x",), 2)

    judged = judge_answers([answered, declined, withheld, not_found_right, not_found_wrong], fake_judge)
    summary = judge_summary(judged)

    assert calls == ["a"]
    assert [(r.faithfulness, r.correctness, r.judge_calls) for r in judged[:3]] == [(1.0, 0.5, 3), (0.0, 0.0, 0), (0.0, 0.0, 0)]
    assert [r.not_found_correct for r in judged[3:]] == [True, False]
    assert (summary.judged, summary.not_found_questions, summary.not_found_correct) == (3, 2, 1)
    assert summary.faithfulness == 1.0 / 3 and summary.judge_calls == 3 and summary.answer_calls == 8


def test_run_answers_records_what_the_api_spent() -> None:
    api = FakeApi()
    questions = [_q("a", "What is the fee?", "EUR 18,500"), _q("b", "Who is the manager?", not_found=True)]
    results = run_answers(api, questions, {NW: "nw"}, k=5)
    assert api.queries == ["What is the fee?", "Who is the manager?"]
    assert (results[0].answer_status, results[0].cited, results[0].calls) == ("answered", (1,), 2)
    assert results[1].answer_status == "not_found"


def test_the_markdown_table_names_profile_models_and_every_question() -> None:
    api = FakeApi()
    questions = [_q("a", "What is the fee?", "EUR 18,500"), _q("c", "Who is the manager?", not_found=True)]
    rows = run_retrieval(api, questions, {NW: "nw"}, k=3)
    judged = judge_answers(run_answers(api, questions, {NW: "nw"}, k=3), lambda r: (0.9, 0.8, 2))

    table = render_markdown(
        title="MaSign evaluation",
        profile="quality",
        chat_model="claude-sonnet-5",
        judge_model="anthropic/claude-haiku-4-5-20251001",
        retrieval=retrieval_metrics(rows, k=3),
        retrieval_rows=rows,
        judged=judged,
    )

    assert "- Embedding profile: quality" in table and "claude-haiku-4-5-20251001" in table
    assert "| 1 | 1 | 1.00 | 1.00 | 1.00 |" in table  # retrieval line
    assert "| a | What is the fee? | 2 | 2, 3, 1 |" in table  # 1-based passage numbers
    assert "| a | 0.90 | 0.80 | grounded |" in table
    assert "| c | – | – | said not found ✔ |" in table
    assert "| 1 | 0.90 | 0.80 | 1/1 | 4 | 2 |" in table  # judged summary: calls spent


# --- the retrieval-only endpoint the harness relies on -------------------------------------------


def test_search_endpoint_returns_passages_without_any_model_call(db, fake_chat_model, fake_embedder, vector_store) -> None:
    contract = repository.create_contract(
        db, filename="c.txt", file_type="txt", size_bytes=1, character_count=1,
        chunks=["1. Parties. Northwind and Acme.", "2. Fees. EUR 18,500 per month.", "3. Term. Thirty-six months."],
    )
    db.commit()
    from app.retrieval.indexing import index_contract

    index_contract(db, contract, fake_embedder, vector_store)
    db.commit()
    fake_chat_model.calls.clear()

    response = client.get(f"/api/contracts/{contract.id}/search", params={"q": "What is the monthly fee?", "limit": 2})

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body) == 2 and {"chunk_index", "text", "score"} <= set(body[0])
    assert fake_chat_model.calls == []
    assert client.get(f"/api/contracts/{contract.id}/search", params={"q": ""}).status_code == 422
