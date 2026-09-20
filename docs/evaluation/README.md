# Evaluation (MAS-91 → MAS-32)

How MaSign's numbers are produced, so the Sprint 3 verification (MAS-32) is a
repeatable run, not a hand-made table.

## What is measured

| Phase | Metric | Needs a model? | What it tells you |
|---|---|---|---|
| Retrieval | **hit@1**, **hit@k**, **MRR** over the reference passage | No | Does the passage that answers the question come first / in the top k? This is what decides ModernBERT vs Qwen3 (MAS-58/61). |
| Answers | **Faithfulness** (Ragas): share of the answer's statements supported by the retrieved passages | Yes — judge | Is the answer grounded, sentence by sentence — the claim behind "answers with proof". |
| Answers | **Factual correctness** (Ragas, F1): the answer's statements against the reference answer | Yes — judge | Is it *right*, not only grounded. |
| Answers | **Not-found questions right** | No — rule | For questions the contract does not answer: did the system say "Not found in contract"? |

Ragas' `AnswerCorrectness` is not used: half of it is embedding similarity,
which needs an embeddings client and adds calls without adding evidence.
`FactualCorrectness` (statement-level F1) is the same idea without it. The
risk review is not judged here; it stays a manual rubric check in MAS-32.

## The question file

`questions.jsonl`, one object per line:

```json
{"id": "nw-04", "contract": "northwind_master_services_agreement.txt",
 "question": "What interest applies to late payments?",
 "reference_answer": "1.5% per month (18% per annum) …",
 "reference_quote": "accrue interest at the rate of 1.5% per month",
 "term": "late_payment", "tags": ["financial"]}
```

- `contract` is the file name as uploaded (`data/sample_contracts/`).
- `reference_quote` is a verbatim fragment of the passage that answers the
  question. It is resolved to a passage number **at run time** against the
  stored text, because chunk boundaries depend on the embedding profile.
- `expect_not_found: true` marks a question the contract does not answer; it
  has no quote and is scored by the rule above.
- `term` names the MAS-82 key term the question exercises (one per term).
- Two fictional contracts: Northwind (18 questions, 10 on money) and Harbor
  (12). Real CUAD contracts are added in MAS-32, not here.

`tests/test_evaluation.py` checks that every quote is in its contract and
every key term has a question, so the file cannot rot silently.

## Running it

The stack must be up and the contracts uploaded (an upload runs the review:
about one Sonnet call per 8 passages, plus one for key terms).

```bash
# Retrieval only — 0 provider calls. Works with the project's own Python.
python -m evaluation.evaluate --retrieval-only --profile quality \
    --out docs/evaluation/results-<date>-quality.md

# Restrict to one contract while another is not uploaded yet
python -m evaluation.evaluate --retrieval-only --contracts northwind_master_services_agreement.txt

# Judged run — PAID. Prints the estimate and refuses without --yes.
py -3.13 -m venv .venv-eval && .venv-eval/Scripts/pip install -r requirements-eval.txt
.venv-eval/Scripts/python -m evaluation.evaluate --judge --limit 3          # estimate only
.venv-eval/Scripts/python -m evaluation.evaluate --judge --limit 3 --yes    # spends it
```

Options: `--api` (default `http://localhost:8000`), `--k` (passages per
question, default 5), `--judge-provider` / `--judge-model` (default
`anthropic` / `claude-haiku-4-5-20251001`, through LiteLLM; the key comes
from `MASIGN_JUDGE_API_KEY` or LiteLLM's usual environment variables),
`--profile` and `--chat-model` are labels for the table.

Cost of a judged run: each question costs the API 2 Sonnet calls (answer +
risk flags), and the judge about 3 Haiku calls per answered question
(statement extraction, verdicts, correctness). "Not found" questions and
answers the system declined cost no judge call. The run prints the exact
count it spent; Ragas' telemetry is switched off.

## Reading the numbers

- `Resolved` < `Questions` means a reference quote was not found in the
  stored passages — fix the question file, do not trust the row.
- hit@1 is the number to compare between embedding profiles; hit@5 says
  whether the answerer even *sees* the right passage.
- Faithfulness near 1.0 with low correctness means the answer stuck to the
  text but the text (or the retrieval) was wrong; the reverse means the
  model added things.
- The results table lists every question with its retrieved passage numbers
  (1-based, as the UI shows them), so a miss can be read against the contract.

## Results so far

| Date | Profile | Contract | Questions | hit@1 | hit@5 | MRR | Calls |
|---|---|---|---|---|---|---|---|
| 2026-09-20 | quality (Qwen3-Embedding-4B) | Northwind | 16 | 0.94 | 1.00 | 0.96 | 0 |
| 2026-09-20 | portable (ModernBERT) | Northwind | 16 | 0.88 | 1.00 | 0.94 | 0 |

Both profiles put the right passage in the top 5 every time; Qwen3 misses
top-1 once (nw-03, invoice due date ranked 3rd), ModernBERT twice (nw-03 and
nw-06, the fee-increase clause ranked 2nd). Files:
`results-2026-09-20-quality-northwind.md`, `results-2026-09-20-portable-northwind.md`.
No judged run yet — it needs the owner's OK (api-spend-guard).
