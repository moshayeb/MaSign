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

- Model: Qwen3-Embedding-0.6B (Apache 2.0, 1024 dims, 32k context)
- Chosen via MLEB contract-only benchmark (0.766 vs OpenAI
  text-embedding-3-small's 0.742), runs on CPU
- Upgrade path: swap to Qwen3-Embedding-4B (same family/code,
  re-index only) if 0.6B quality isn't sufficient
- Known gap: no benchmark covers financial/economic contract terms
  (fees, penalties, payment clauses) specifically — MAS-32's
  evaluation set MUST include financial-term questions to actually
  measure this, not assume Qwen3's general MTEB strength carries
  over

## Frontend Decision

React + Vite, served by FastAPI; **sonner** toasts for every user action, error
toasts show the API's `detail` verbatim. See `docs/frontend.md`.
