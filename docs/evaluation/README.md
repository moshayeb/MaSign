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
| 2026-09-28 | quality (see note below) | Northwind + Harbor | 29 | 0.86 | 1.00 | 0.91 | 0 |
| 2026-09-28 | quality (see note below) | Northwind + Harbor + BNL/VIP (CUAD) | 35 | 0.80 | 1.00 | 0.88 | 0 |

Both profiles put the right passage in the top 5 every time; Qwen3 misses
top-1 once (nw-03, invoice due date ranked 3rd), ModernBERT twice (nw-03 and
nw-06, the fee-increase clause ranked 2nd). Files:
`results-2026-09-20-quality-northwind.md`, `results-2026-09-20-portable-northwind.md`.

Adding the CUAD contract still puts every reference passage in the top 5
(`hit@5 1.00`, 35/35), and BNL's 3 misses (bnl-01, bnl-04, bnl-05) are the
same pattern as the fictional ones: the right clause ranked 2nd or 3rd, in a
real 16-page document with denser, less example-shaped prose than the
fictional set — not a retrieval failure, a harder read.
`results-2026-09-28-live-all-three.md`.

**Only one profile could be exercised on 2026-09-28 (MAS-32), and it is
mislabelled `portable` by the API** — a real deployment gap, not a harness
limitation. `docker-compose.quality.yml` (as written) overwrites the
unprefixed `EMBEDDING_*` variables, so the container's one and only active
embedder *is* Qwen3-Embedding-4B, filed under the `portable` profile name
because that is still `DEFAULT_PROFILE`. Compare mode's second profile is
gated on the separate `QUALITY_EMBEDDING_API_URL` (`app/retrieval/
embeddings.py`'s `is_profile_configured("quality")`), which nothing sets on
this deployment — so `indexed_profiles` never gains `"quality"` and the
"Compare models" button (MAS-62) cannot appear for any contract uploaded to
it, no matter which one. This is the answer to the open "Compare models not
visible" question from MAS-167: filed as its own ticket, MAS-169, since
fixing it needs a second embedding endpoint running alongside the first, not
a code change. Hit@1 dropping from 0.94 (Northwind alone, 2026-09-20 quality
run) to 0.86 (both contracts) is Harbor's two extra misses (hb-11, hb-13),
not a regression in Northwind's own numbers.

### Judged run: CUAD contract (2026-09-28, owner-approved)

The first judged run this harness has ever completed — `--judge` had never
actually been exercised end to end before MAS-32 (the README's own note
above said so). Getting there fixed a real bug in `evaluation/judge.py`,
not just a MAS-32 wrinkle: `instructor.from_litellm()` and, independently,
its own `patch_v2` dispatch underneath it, decide sync vs. async by
`inspect.iscoroutinefunction()` on the completion callable passed in — which
is always `False` for a callable class instance (`CallCounter`), even one
whose `__call__` is `async def`, because `inspect` does not unwrap
`__call__` for that check. Left as it was, this built a client that
ragas's own `_check_client_async()` also read as synchronous, and ragas's
sync `score()` entry point always calls its async `ascore()` internally
regardless — so every judged call was guaranteed to fail with "Cannot use
agenerate() with a synchronous client", the first time, every time. Fixed
by passing the bound method (`counter.__call__`, which inspects correctly)
and declaring `async_client=True` explicitly rather than trusting inference
a second time. See `evaluation/judge.py`'s comments for the full chain.
Filed as MAS-170 since it's a real defect independent of MAS-32's own scope.

Scoped to the CUAD contract only (8 questions), per the ticket's own budget
— not the fictional contracts too, which would have been a materially
larger spend the ticket never priced in:

| Judged | Faithfulness | Factual correctness | Not-found right | Answer calls | Judge calls |
|---|---|---|---|---|---|
| 6 | 0.88 | 0.59 | 2/2 | 16 | 36 |

`results-2026-09-28-judged-cuad.md`. Both "not found" questions (warranty
duration, prepayment discount) were correctly declined.

**The 0.59 correctness figure understates the system, on manual review.**
bnl-02 (payment deadline) scored correctness 0.00 despite the stored answer
being exactly right and cited: "within ten (10) days after the date of the
postmark for an invoice... late charges of 1-1/2% per month... become
payable" — word-for-word the reference. The likely cause is Ragas'
`FactualCorrectness(mode="f1")` penalizing the answer's second sentence (the
late-fee detail, true and grounded, but outside what `reference_answer`
covers) as an unmatched statement, rather than a real factual miss. Treated
as a known limitation of the judge metric on questions with a narrow
reference and a broader-but-still-correct answer, not a product defect —
not chased further to avoid more judge spend confirming a hypothesis rather
than fixing something broken.

bnl-05 (early-termination fee) scored `grounded: false` despite the stored
answer being complete and correctly citing the passage that contains the
exact reference quote — worth a second look if the judged run is ever
extended, but not investigated further here for the same reason.

Extending the judged run to the fictional contracts (37 more questions, a
materially larger spend) is left for a follow-up, not done here.
