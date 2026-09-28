---
name: masign-done
description: The checklist that must pass before Claude says a MaSign ticket is done, pushes a branch, or writes an evidence comment in Jira — the exact test, build, lint and rebuild commands, which docs each kind of change must update, and how completion is reported against the ticket's acceptance criteria. Trigger this whenever Claude is about to claim completion, report "tests pass", push, hand over a PR, or move to the next task, and whenever the user asks "is it done?" or "check the result".
---

# MaSign definition of done

Evolved from the Homework-03 `definition-of-done` skill. "I think it works"
is not done; this list is.

## 1. Run what CI runs — all of it, not just the new tests

```bash
cd /c/Github-Ai/MaSign
MASIGN_REQUIRE_DB=1 python -m pytest -q tests      # compose Postgres on :5433 must be up
cd frontend && npm test && npm run build && npm run lint
```

- Use the system Python (`/c/Python314/python.exe`), not `.venv-docs`
  (that venv is the PDF tooling and has no pytest).
- `pytest` is scoped to `tests/` (`pytest.ini testpaths`); reviewer scratch
  folders under `tmp/` are locked and must not be collected.
- Lint has two pre-existing warnings (`api.test.ts` optional chaining,
  `App.tsx` setState in effect); anything new is yours.
- The opt-in live tests (`MASIGN_REAL_LLM=1`) cost money — `api-spend-guard`.

## 2. New behaviour has a test; changed behaviour has a changed test

Backend tests use `FakeChatModel` (routes by system prompt; `reply`,
`risk_reply`, `truncated`, `risk_error`) wrapped in the real
`GuardedChatModel`, so API tests exercise the guardrail without a key.
Frontend tests route `fetch` by URL (`mockApi` pattern in `Answer.test.tsx`).
The chunker packs short paragraphs into one 1200-char chunk: use
`repository.create_contract(chunks=[…])` for exact passages, or pad clauses.

## 3. Self-review the diff

`git diff --cached` as the reviewer would: leftover prints, debug flags, the
owner's files staged by mistake (see `masign-ticket-flow`), preview harness
files (`frontend/preview.html`, `src/preview.tsx`) still present, docs that
now lie.

## 4. Update the docs the change touches

| Change in… | Update |
|---|---|
| API shape / endpoints | `README.md` endpoint table, `docs/architecture.md` |
| UI behaviour or look | `docs/frontend.md` (rules + look & feel) |
| Rubric, risk outcomes | `app/risk_analysis/rubric.py` → regenerate `docs/risk-rubric.md`; CLAUDE.md "Risk rubric" |
| Model/provider/guardrail | CLAUDE.md "LLM decision", `docs/architecture.md`, README guardrail section |
| Embeddings/profiles | CLAUDE.md embedding sections, README profiles table |
| Any decision not derivable from code | CLAUDE.md (only Claude's paragraphs; blob-stage it) |

## 5. Rebuild and look

**Never run `docker compose up`/`--build` against this repo's
`docker-compose.yml` from a per-ticket worktree.** `container_name` in that
file is hardcoded (`masign-api`, etc.) — it is not scoped by directory or
`COMPOSE_PROJECT_NAME` — so the command recreates the one shared, live
container everyone uses on port 8000, no matter which worktree you run it
from. Done twice for real, both times silently dropping the GPU "quality"
embedding profile (Qwen3-Embedding-4B via `llama-server`, MAS-58/61) back to
default ModernBERT and re-indexing every stored contract on the wrong model,
because the plain command omits `-f docker-compose.quality.yml`.

- For UI changes: use `ui-preview` (canned-API, zero build, zero spend) —
  never the live container.
- For API changes: run the test suite (step 1) and, if you need a live HTTP
  round-trip, hit the *existing* running container's endpoint with curl —
  do not rebuild it.
- The live container is only rebuilt **after** a PR is merged to `main`, from
  the dedicated `main-live` worktree, by whoever owns that step, with both
  compose files and the shared project name so the profile survives:
  `COMPOSE_PROJECT_NAME=masign docker compose -f docker-compose.yml -f docker-compose.quality.yml up -d --no-deps --build api`.
  Check `docker logs masign-api` for the embedder line (`backend='openai-compatible'`,
  not `'sentence-transformers'`) before calling it healthy — **but that alone
  is not enough.** Done for real (MAS-168): a rebuild right after a fast
  `git pull` reported success, built the correct new frontend assets, and
  logged a perfectly healthy embedder/chat-model startup — while the
  `COPY app ./app` layer silently served Docker's build cache with backend
  code from *before* MAS-143 had ever merged (no auth, no workspace scoping).
  Every route touching `Contract`/`workspace_id` 500'd for every real user
  until this was caught. The embedder log line only proves the embedding
  config changed; it says nothing about the rest of `app/`. Always also
  confirm the running container's own code, not the worktree's, actually
  changed: `MSYS_NO_PATHCONV=1 docker exec masign-api grep -n '<a line you
  know just changed>' /app/app/api/routes.py` (or whichever file), and
  compare it to the same grep against the worktree's on-disk file. If they
  don't match, `docker compose build --no-cache --pull api` before
  `up -d --no-deps --force-recreate api` — don't trust a second cached
  `--build` to fix a caching bug.

## 6. Evidence comment on the ticket, then hand over

Comment: branch + commit, what changed (short), verification with numbers
(e.g. "267 passed / 4 skipped, frontend 30", "6/6 top-1 at 113–196 ms",
"HTTP 400, 0 requests to api.anthropic.com"), API calls spent, what remains.
Then report to the user **against the ticket's acceptance criteria one by
one** ("criterion 3 verified by test X; criterion 4 needs your eyes: …").
Anything not verifiable automatically is said out loud, never skipped.
