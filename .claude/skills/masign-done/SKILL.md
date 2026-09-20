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

`docker compose up -d --build` (≈1 min; first start after a fresh volume also
downloads ModernBERT). Check `/ready`, then the log for the startup lines.
For UI changes take screenshots (`ui-preview`); for API changes hit the
endpoint with curl and paste the real response into the Jira comment.

## 6. Evidence comment on the ticket, then hand over

Comment: branch + commit, what changed (short), verification with numbers
(e.g. "267 passed / 4 skipped, frontend 30", "6/6 top-1 at 113–196 ms",
"HTTP 400, 0 requests to api.anthropic.com"), API calls spent, what remains.
Then report to the user **against the ticket's acceptance criteria one by
one** ("criterion 3 verified by test X; criterion 4 needs your eyes: …").
Anything not verifiable automatically is said out loud, never skipped.
