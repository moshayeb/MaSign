"""Run the MaSign evaluation set against the running stack (MAS-91).

    python -m evaluation.evaluate --retrieval-only            # 0 provider calls
    python -m evaluation.evaluate --judge --limit 3 --yes     # asks the real system, then judges

The retrieval phase reads passages and search results only. The judged
phase POSTs every question to /api/query (2 provider calls each, paid by the
API's own key) and then scores each answer with the judge model (about 2–4
calls per question). It refuses to start without --yes, after printing the
estimate, because the owner's budget rule is "ask before any paid call".
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from evaluation.harness import (
    MaSignClient,
    contract_ids_by_filename,
    judge_answers,
    judge_summary,
    load_questions,
    render_markdown,
    retrieval_metrics,
    run_answers,
    run_retrieval,
)

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_QUESTIONS = ROOT / "docs" / "evaluation" / "questions.jsonl"
JUDGE_CALLS_PER_QUESTION = 3  # Faithfulness (statements + verdicts) + FactualCorrectness, typical


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api", default=os.environ.get("MASIGN_API", "http://localhost:8000"))
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    parser.add_argument("--profile", default=os.environ.get("MASIGN_PROFILE", "portable"), help="label for the results table")
    parser.add_argument("--k", type=int, default=5, help="passages retrieved per question")
    parser.add_argument("--limit", type=int, default=None, help="only the first N questions (smoke tests)")
    parser.add_argument("--contracts", default=None, help="comma-separated file names to restrict to (e.g. while one is not uploaded)")
    parser.add_argument("--retrieval-only", action="store_true", help="retrieval metrics only; no provider call")
    parser.add_argument("--judge", action="store_true", help="ask the real system and judge the answers (paid)")
    parser.add_argument("--judge-provider", default=os.environ.get("MASIGN_JUDGE_PROVIDER", "anthropic"))
    parser.add_argument("--judge-model", default=os.environ.get("MASIGN_JUDGE_MODEL", "claude-haiku-4-5-20251001"))
    parser.add_argument("--chat-model", default=os.environ.get("CHAT_MODEL", "claude-sonnet-5"), help="label only")
    parser.add_argument("--out", type=Path, default=None, help="write the Markdown table here (default: print)")
    parser.add_argument("--yes", action="store_true", help="confirm the paid judged run")
    args = parser.parse_args(argv)

    if args.judge and args.retrieval_only:
        parser.error("choose --retrieval-only or --judge")
    if not args.judge and not args.retrieval_only:
        args.retrieval_only = True

    questions = load_questions(args.questions)
    if args.contracts:
        wanted = {name.strip() for name in args.contracts.split(",")}
        questions = [q for q in questions if q.contract in wanted]
    if args.limit:
        questions = questions[: args.limit]
    client = MaSignClient(args.api)
    needed = {q.contract for q in questions}
    ids = contract_ids_by_filename(client, needed)
    missing = sorted(needed - set(ids))
    if missing:
        print(f"Not uploaded to {args.api}: {', '.join(missing)}", file=sys.stderr)
        print("Upload them through the UI first (each upload runs the review: about one call per 8 passages).", file=sys.stderr)
        return 2

    retrieval_rows = run_retrieval(client, questions, ids, k=args.k)
    retrieval = retrieval_metrics(retrieval_rows, k=args.k)
    print(f"Retrieval: {retrieval.resolved}/{retrieval.questions} resolved, hit@1 {retrieval.hit_at_1:.2f}, hit@{args.k} {retrieval.hit_at_k:.2f}, MRR {retrieval.mrr:.2f} (0 provider calls)")
    if retrieval.unresolved:
        print(f"  reference quote not found for: {', '.join(retrieval.unresolved)}")

    judged = None
    judge_model = None
    if args.judge:
        answer_calls = 2 * len(questions)
        judge_calls = JUDGE_CALLS_PER_QUESTION * sum(1 for q in questions if not q.expect_not_found)
        print(
            f"Judged run: {len(questions)} questions -> about {answer_calls} {args.chat_model} calls (the API's key) "
            f"+ about {judge_calls} {args.judge_model} calls (the judge)."
        )
        if not args.yes:
            print("Re-run with --yes to spend them.", file=sys.stderr)
            return 3
        from evaluation.judge import build_judge

        judge, counter = build_judge(provider=args.judge_provider, model=args.judge_model, api_key=os.environ.get("MASIGN_JUDGE_API_KEY"))
        answers = run_answers(client, questions, ids, k=args.k)
        judged = judge_answers(answers, judge)
        judge_model = f"{args.judge_provider}/{args.judge_model}"
        summary = judge_summary(judged)
        print(
            f"Answers: faithfulness {_fmt(summary.faithfulness)}, factual correctness {_fmt(summary.correctness)}, "
            f"not-found right {summary.not_found_correct}/{summary.not_found_questions}; "
            f"spent {summary.answer_calls} answer calls + {counter.calls} judge calls"
        )

    table = render_markdown(
        title="MaSign evaluation",
        profile=args.profile,
        chat_model=args.chat_model if args.judge else None,
        judge_model=judge_model,
        retrieval=retrieval,
        retrieval_rows=retrieval_rows,
        judged=judged,
        when=datetime.now(timezone.utc),
    )
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(table, encoding="utf-8")
        print(f"Wrote {args.out}")
    else:
        print(table)
    return 0


def _fmt(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


if __name__ == "__main__":
    sys.exit(main())
