"""The evaluation harness's moving parts, kept free of Ragas and of the network (MAS-91).

Everything here is plain Python over plain data so the unit tests can drive
it with a fake API client and a fake judge. The pieces that touch the
outside world — `MaSignClient` (HTTP) and `evaluation.judge` (Ragas + the
judge model) — are thin and imported only where needed.

A question names its contract by file name and its reference passage by a
distinctive quote, never by chunk index: chunking depends on the embedding
profile, so the quote is resolved against the live passages at run time.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any, Callable, Protocol

NOT_FOUND_ANSWER = "Not found in contract."


@dataclass(frozen=True)
class Question:
    id: str
    contract: str  # file name as uploaded (e.g. northwind_master_services_agreement.txt)
    question: str
    reference_answer: str
    # A verbatim fragment of the passage the answer comes from; empty when
    # the contract does not answer the question (expect_not_found).
    reference_quote: str = ""
    expect_not_found: bool = False
    # Optional key-term id this question checks (MAS-82 coverage).
    term: str | None = None
    tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class RetrievalResult:
    question: Question
    # chunk indexes of the retrieved passages, best first
    retrieved: tuple[int, ...]
    # the reference passage's chunk index, or None when unresolved / not expected
    reference: int | None
    retrieved_texts: tuple[str, ...] = ()
    reference_text: str | None = None


@dataclass(frozen=True)
class AnswerResult:
    question: Question
    answer: str
    answer_status: str
    grounded: bool
    cited: tuple[int, ...]
    retrieved_texts: tuple[str, ...]
    calls: int  # provider calls the API spent producing it (answer + risk)


@dataclass(frozen=True)
class JudgedResult:
    answer: AnswerResult
    faithfulness: float | None
    correctness: float | None
    judge_calls: int
    # "not found" questions are graded by the rule, not the judge
    not_found_correct: bool | None = None


# --- questions ------------------------------------------------------------------------------


def load_questions(path: Path) -> list[Question]:
    questions: list[Question] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        raw = json.loads(line)
        try:
            questions.append(
                Question(
                    id=str(raw["id"]),
                    contract=raw["contract"],
                    question=raw["question"],
                    reference_answer=raw.get("reference_answer", ""),
                    reference_quote=raw.get("reference_quote", ""),
                    expect_not_found=bool(raw.get("expect_not_found", False)),
                    term=raw.get("term"),
                    tags=tuple(raw.get("tags", ())),
                )
            )
        except KeyError as error:
            raise ValueError(f"{path}:{line_number}: missing field {error}") from error
    ids = [q.id for q in questions]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{path}: duplicate question ids")
    for q in questions:
        if not q.expect_not_found and not q.reference_quote:
            raise ValueError(f"{path}: question {q.id} needs a reference_quote or expect_not_found")
    return questions


# --- resolving references against the live passages ---------------------------------------------


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("“", '"').replace("”", '"').replace("’", "'")).strip().lower()


def resolve_reference(passages: list[dict[str, Any]], quote: str) -> int | None:
    """The chunk_index of the passage containing `quote` (whitespace/quote-style tolerant), or None."""
    needle = _normalise(quote)
    if not needle:
        return None
    for passage in passages:
        if needle in _normalise(passage["text"]):
            return int(passage["chunk_index"])
    return None


# --- retrieval metrics (no model call) --------------------------------------------------------------


@dataclass
class RetrievalMetrics:
    questions: int
    resolved: int
    hit_at_1: float
    hit_at_k: float
    mrr: float
    k: int
    unresolved: list[str] = field(default_factory=list)
    misses: list[str] = field(default_factory=list)


def retrieval_metrics(results: list[RetrievalResult], *, k: int) -> RetrievalMetrics:
    """hit@1, hit@k and MRR over the questions whose reference passage resolved.

    Questions that expect "not found" have no reference passage and are not
    counted here — retrieval has nothing to hit.
    """
    scored = [r for r in results if not r.question.expect_not_found]
    resolved = [r for r in scored if r.reference is not None]
    unresolved = [r.question.id for r in scored if r.reference is None]
    if not resolved:
        return RetrievalMetrics(len(scored), 0, 0.0, 0.0, 0.0, k, unresolved, [])
    ranks: list[int | None] = []
    for r in resolved:
        ranks.append(r.retrieved.index(r.reference) + 1 if r.reference in r.retrieved else None)
    hit1 = mean(1.0 if rank == 1 else 0.0 for rank in ranks)
    hitk = mean(1.0 if rank is not None and rank <= k else 0.0 for rank in ranks)
    mrr = mean(1.0 / rank if rank is not None else 0.0 for rank in ranks)
    misses = [r.question.id for r, rank in zip(resolved, ranks) if rank != 1]
    return RetrievalMetrics(len(scored), len(resolved), hit1, hitk, mrr, k, unresolved, misses)


# --- the API client (the only HTTP in the harness) ------------------------------------------------


class ApiClient(Protocol):
    def contracts(self) -> list[dict[str, Any]]: ...
    def passages(self, contract_id: str) -> list[dict[str, Any]]: ...
    def search(self, contract_id: str, question: str, limit: int) -> list[dict[str, Any]]: ...
    def query(self, contract_id: str, question: str, limit: int) -> dict[str, Any]: ...


class MaSignClient:
    """httpx client for the running stack. `query` costs provider calls; the rest is free."""

    def __init__(self, base_url: str, timeout: float = 120.0) -> None:
        import httpx

        self._http = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout)

    def contracts(self) -> list[dict[str, Any]]:
        return self._get("/api/contracts")

    def passages(self, contract_id: str) -> list[dict[str, Any]]:
        return self._get(f"/api/contracts/{contract_id}/passages")

    def search(self, contract_id: str, question: str, limit: int) -> list[dict[str, Any]]:
        return self._get(f"/api/contracts/{contract_id}/search", params={"q": question, "limit": limit})

    def query(self, contract_id: str, question: str, limit: int) -> dict[str, Any]:
        response = self._http.post("/api/query", json={"question": question, "contract_id": contract_id, "limit": limit})
        response.raise_for_status()
        return response.json()

    def _get(self, path: str, **kwargs: Any) -> Any:
        response = self._http.get(path, **kwargs)
        response.raise_for_status()
        return response.json()


def contract_ids_by_filename(client: ApiClient, filenames: set[str]) -> dict[str, str]:
    """Map each needed file name to the newest stored contract with that name; missing names are absent."""
    found: dict[str, str] = {}
    for contract in sorted(client.contracts(), key=lambda c: c.get("created_at", ""), reverse=True):
        name = contract["filename"]
        if name in filenames and name not in found:
            found[name] = contract["contract_id"]
    return found


# --- running the two phases ----------------------------------------------------------------------


def run_retrieval(client: ApiClient, questions: list[Question], ids: dict[str, str], *, k: int) -> list[RetrievalResult]:
    passages_cache: dict[str, list[dict[str, Any]]] = {}
    results: list[RetrievalResult] = []
    for q in questions:
        contract_id = ids[q.contract]
        if contract_id not in passages_cache:
            passages_cache[contract_id] = client.passages(contract_id)
        passages = passages_cache[contract_id]
        by_index = {int(p["chunk_index"]): p["text"] for p in passages}
        reference = None if q.expect_not_found else resolve_reference(passages, q.reference_quote)
        hits = client.search(contract_id, q.question, k)
        retrieved = tuple(int(h["chunk_index"]) for h in hits)
        results.append(
            RetrievalResult(
                question=q,
                retrieved=retrieved,
                reference=reference,
                retrieved_texts=tuple(by_index.get(i, "") for i in retrieved),
                reference_text=by_index.get(reference) if reference is not None else None,
            )
        )
    return results


def run_answers(client: ApiClient, questions: list[Question], ids: dict[str, str], *, k: int) -> list[AnswerResult]:
    """Ask the real system each question. Each call spends the API's own provider calls (answer + risk)."""
    results: list[AnswerResult] = []
    for q in questions:
        body = client.query(ids[q.contract], q.question, k)
        results.append(
            AnswerResult(
                question=q,
                answer=body["answer"],
                answer_status=body.get("answer_status", "answered"),
                grounded=bool(body.get("grounded")),
                cited=tuple(int(c["chunk_index"]) for c in body.get("citations", [])),
                retrieved_texts=tuple(c["text"] for c in body.get("retrieved_context", [])),
                calls=2 if body.get("answer_status") != "withheld" else 0,
            )
        )
    return results


Judge = Callable[[AnswerResult], tuple[float | None, float | None, int]]
"""(faithfulness, correctness, judge calls spent) for one answered question."""


def judge_answers(results: list[AnswerResult], judge: Judge) -> list[JudgedResult]:
    """Score answers; "not found" questions are graded by the rule, never by the judge."""
    judged: list[JudgedResult] = []
    for r in results:
        if r.question.expect_not_found:
            judged.append(JudgedResult(r, None, None, 0, not_found_correct=_says_not_found(r.answer)))
            continue
        if _says_not_found(r.answer) or r.answer_status == "withheld":
            # The system declined: a wrong outcome for a stated fact, scored 0 without spending a judge call.
            judged.append(JudgedResult(r, 0.0, 0.0, 0))
            continue
        faithfulness, correctness, calls = judge(r)
        judged.append(JudgedResult(r, faithfulness, correctness, calls))
    return judged


def _says_not_found(answer: str) -> bool:
    return answer.strip().lower().startswith(NOT_FOUND_ANSWER.lower().rstrip("."))


@dataclass
class JudgeSummary:
    judged: int
    faithfulness: float | None
    correctness: float | None
    not_found_questions: int
    not_found_correct: int
    judge_calls: int
    answer_calls: int


def judge_summary(results: list[JudgedResult]) -> JudgeSummary:
    scored = [r for r in results if r.faithfulness is not None]
    not_found = [r for r in results if r.not_found_correct is not None]
    return JudgeSummary(
        judged=len(scored),
        faithfulness=mean(r.faithfulness for r in scored) if scored else None,  # type: ignore[misc]
        correctness=mean(r.correctness for r in scored if r.correctness is not None) if scored else None,
        not_found_questions=len(not_found),
        not_found_correct=sum(1 for r in not_found if r.not_found_correct),
        judge_calls=sum(r.judge_calls for r in results),
        answer_calls=sum(r.answer.calls for r in results),
    )


# --- the results table ----------------------------------------------------------------------------


def render_markdown(
    *,
    title: str,
    profile: str,
    chat_model: str | None,
    judge_model: str | None,
    retrieval: RetrievalMetrics | None,
    retrieval_rows: list[RetrievalResult],
    judged: list[JudgedResult] | None,
    when: datetime | None = None,
) -> str:
    when = when or datetime.now(timezone.utc)
    lines = [f"# {title}", "", f"- Date: {when.strftime('%Y-%m-%d %H:%M UTC')}", f"- Embedding profile: {profile}"]
    lines.append(f"- Chat model: {chat_model or 'n/a (retrieval only)'}")
    lines.append(f"- Judge model: {judge_model or 'n/a'}")
    if retrieval:
        lines += [
            "",
            "## Retrieval (no model call)",
            "",
            f"| Questions | Resolved | hit@1 | hit@{retrieval.k} | MRR |",
            "|---|---|---|---|---|",
            f"| {retrieval.questions} | {retrieval.resolved} | {retrieval.hit_at_1:.2f} | {retrieval.hit_at_k:.2f} | {retrieval.mrr:.2f} |",
        ]
        if retrieval.unresolved:
            lines.append(f"\nReference quote not found in the stored passages (check the question file): {', '.join(retrieval.unresolved)}")
        if retrieval.misses:
            lines.append(f"\nNot top-1: {', '.join(retrieval.misses)}")
        lines += ["", "| id | question | reference | retrieved (best first) |", "|---|---|---|---|"]
        for r in retrieval_rows:
            if r.question.expect_not_found:
                continue
            ref = "?" if r.reference is None else str(r.reference + 1)
            got = ", ".join(str(i + 1) for i in r.retrieved)
            lines.append(f"| {r.question.id} | {r.question.question} | {ref} | {got} |")
    if judged is not None:
        summary = judge_summary(judged)
        lines += [
            "",
            "## Answers (judged)",
            "",
            "| Judged | Faithfulness | Factual correctness | Not-found questions right | Answer calls | Judge calls |",
            "|---|---|---|---|---|---|",
            f"| {summary.judged} | {_fmt(summary.faithfulness)} | {_fmt(summary.correctness)} | "
            f"{summary.not_found_correct}/{summary.not_found_questions} | {summary.answer_calls} | {summary.judge_calls} |",
            "",
            "| id | faithfulness | correctness | outcome |",
            "|---|---|---|---|",
        ]
        for r in judged:
            if r.not_found_correct is not None:
                outcome = "said not found ✔" if r.not_found_correct else "answered a question the text does not answer ✘"
                lines.append(f"| {r.answer.question.id} | – | – | {outcome} |")
            else:
                outcome = r.answer.answer_status if r.answer.answer_status != "answered" else ("grounded" if r.answer.grounded else "unverified")
                lines.append(f"| {r.answer.question.id} | {_fmt(r.faithfulness)} | {_fmt(r.correctness)} | {outcome} |")
    return "\n".join(lines) + "\n"


def _fmt(value: float | None) -> str:
    return "–" if value is None else f"{value:.2f}"
