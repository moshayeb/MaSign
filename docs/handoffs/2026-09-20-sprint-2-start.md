# Handoff: MaSign — 2026-09-20 (Sprint 2 start: key terms, click-to-source, coverage)

## Goal
Deliver the three product-review stories (MAS-82/83/84) as one stacked chain
so Sprint 2 opens with the financial key-terms card, click-to-source and
explicit coverage ready to merge; close the MAS-93/94 review findings.

## Decisions made
- Qwen3-Embedding-4B (`quality` profile) is running on the dev stack since
  2026-09-18; 6/6 Northwind top-1, ~210 ms/query, 3.9/4 GB VRAM. ModernBERT
  stays the default until MAS-91/MAS-32 numbers say otherwise (MAS-58/61).
- MAS-91 (Ragas harness): judge = Haiku 4.5; second contract fictional; CUAD
  belongs to MAS-32.
- MAS-32: **1 CUAD contract × 8 questions** (owner scaled down from 4);
  Sonnet answers; estimated ≈ 55 calls ≈ $0.45 (worst ≈ $0.75); the run and
  the contract selection both need the owner's OK at the time.
- MAS-92 invoice verification: parked, `post-course`, documentation only;
  MAS-82 stores typed values as its only prep.
- Withheld is its own outcome (MAS-93/94): no model call when everything is
  withheld; withheld ≠ checked everywhere (query, review, key terms).
- Key terms (MAS-82): nine terms as data; verbatim quote or dropped; typed
  fields kept only when their numbers are in the quote; `not_stated` only when
  the pass completed, else `unchecked`.
- Coverage (MAS-84): "tables dropped" is not reported — nothing measurable.
- Evaluation (MAS-91): harness lives in `evaluation/` (not `scripts/`, which is
  the owner's untracked tooling); retrieval scored directly (hit@1/k, MRR), not
  Ragas' string-similarity variants; judge = Ragas 0.4 Faithfulness +
  FactualCorrectness (not AnswerCorrectness: needs embeddings) via
  instructor.from_litellm, calls counted; ragas 0.4.3 needs
  `langchain-community<0.4`.

## Changes made
- Merged by owner: MAS-93/94 (#33) → Done.
- Pushed, PRs to open in this order (each branch stacks on the previous):
  1. `MAS-82-key-terms` `0b744d9` — migration 006, `app/key_terms/`, KeyTermsCard.
  2. `MAS-83-click-to-source` `37fb30e` — `/passages`, PassageReader, `src/quote.tsx`.
  3. `MAS-84-coverage` `ec9899b` — migration 007, `ingestion/references.py`, CoverageNote.
  4. `MAS-91-evaluation-harness` `500d643` — `evaluation/`, `/search` endpoint,
     `docs/evaluation/` (30 questions, README, two result tables),
     `data/sample_contracts/harbor_software_subscription.txt`, `requirements-eval.txt`.
- Jira: MAS-82/83/84/91 in Sprint 2 (id 110), In Progress, evidence comments
  posted; MAS-32 has the harness pointer; MAS-92 backlog `post-course`.
- Measured (0 calls): Northwind retrieval hit@1 0.94 / MRR 0.96 on Qwen3,
  0.88 / 0.94 on ModernBERT; hit@5 1.00 on both.
- The dev stack was rebuilt from the MAS-91 branch (migrations 006–007
  applied) and is on the quality profile; `.venv-eval` (Python 3.13) exists.
- Incident: a `git reset --hard` on 2026-09-20 02:30 wiped the owner's
  uncommitted CLAUDE.md/.gitignore/.dockerignore; restored from the stash
  commit `ece80d8` (verified: "Project guide and logo" section back).
- Still unmerged from Sprint 1: `MAS-88-readiness-and-json-errors` (/ready).
- Suites: backend 297 passed / 4 skipped; frontend 43 passed; 0 API calls
  spent this session.

## Open questions
- Remove the "API docs" header link now or in the header rework (owner).
- Light vs dark theme before the UX reorganisation ticket (owner).
- Should the review job also write `chunks_withheld` for contracts reviewed
  before migration 005/007 ("Review again" handles it; nothing automatic).

## Next steps
- Owner: open/merge PRs 88 → 82 → 83 → 84 → 91, then
  `docker compose -f docker-compose.yml -f docker-compose.quality.yml up -d --build`
  (or plain `up -d --build --remove-orphans` for ModernBERT); migrations
  005–007 run on start. Existing contracts get key terms/coverage after
  "Review again" (≈ 4 calls for Northwind).
- Then transition MAS-82/83/84 to Done; MAS-91 needs the owner's OK for the
  3-question judged smoke test (≈ 6 Sonnet + 9 Haiku calls ≈ $0.10) and the
  Harbor upload (≈ 3 calls) before it can close.
- Next: the UX reorganisation ticket (blocked on the theme decision),
  MAS-35 buffer, then Sprint 3 (MAS-32 with the harness, MAS-30/31 repeats).
- Do not touch: owner's uncommitted `CLAUDE.md`, `.gitignore`,
  `.dockerignore`; untracked `docs/project-guide/`, `logo/`, `output/`,
  `scripts/`, `tmp/`, `frontend/review-probe-8a32.test.tsx`, `AGENTS.md`.
