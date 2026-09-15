# MaSign — notes for Claude Code

Project conventions that are not derivable from the code. Read before working.

## Workflow

- Jira project MAS (board 100), three one-week sprints: Sprint 1 Sep 14–18 and
  Sprint 2 Sep 21–25 build; Sprint 3 Sep 28–Oct 2 is verification only.
- One branch per story, `MAS-<n>-short-slug`; commits start with the key; merge
  via PR. The user pushes and merges; Claude commits on the branch.
- Tests: `MASIGN_REQUIRE_DB=1 python -m pytest -q` (needs the compose Postgres;
  host port **5433** because a native PostgreSQL owns 5432 on the dev machine).
- Shell is Git Bash on Windows (`export VAR=…`, not `$env:VAR`).

## Embedding Model Decision (MAS-11)

- Default model: `freelawproject/modernbert-embed-base_finetune_512`
  (Apache 2.0, 150M params, 768 dims, 8k context, fine-tuned on legal text)
- Chosen via the MLEB contract-only benchmark **and** a CPU benchmark on the
  dev machine (2026-09-15): MLEB contract score 0.741 vs Qwen3-Embedding-0.6B
  0.766 (−3%), but 296 ms/chunk vs 10.7 s/chunk (36× faster) — Qwen3-0.6B
  meant ~10 minutes per 30-page contract on CPU, ModernBERT ~18 s.
  Both beat nothing-legal generic small models; OpenAI text-embedding-3-small
  scores 0.742 on the same benchmark.
- The model is set by `EMBEDDING_MODEL`; the collection is rebuilt if the
  dimension changes. Upgrade path: `Qwen/Qwen3-Embedding-0.6B` (1024 dims) or
  `Qwen3-Embedding-4B` (0.842, beats OpenAI large) if GPU inference becomes
  available — same code path, re-index only.
- Known gap: no benchmark covers financial/economic contract terms
  (fees, penalties, payment clauses) specifically — MAS-32's
  evaluation set MUST include financial-term questions to actually
  measure this, not assume general MTEB strength carries over.

## Frontend Decision

React + Vite, served by FastAPI; **sonner** toasts for every user action, error
toasts show the API's `detail` verbatim. See `docs/frontend.md`.
