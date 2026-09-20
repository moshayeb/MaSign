---
name: api-spend-guard
description: Protects the owner's paid Anthropic/OpenAI budget ($5 a month) in MaSign. Trigger this before any action that can reach the model provider — calling /api/query on the running stack, uploading a contract to the running stack (the background review calls the model), running tests with MASIGN_REAL_LLM=1, probe or demo scripts, live screenshots of answers, "run", "test it live", "try it" — and whenever the user mentions cost, dollars, budget or the API key.
---

# API spend guard

Standing rule from the owner (2026-09-17, after $0.30 of a $5 monthly limit
had gone): **ask before any paid model call, say roughly how many calls, and
default to the fake model.** No exceptions for "just one quick check".

## What costs money in this codebase

| Action | Model calls |
|---|---|
| `POST /api/query` (a question in the UI or via curl) | 2 — answer + per-question risk analysis |
| Uploading a contract to a running stack with a key configured | ≈ 1 per 8 passages — the whole-contract review runs in the background (Northwind 12 passages → 2; a 30-page contract → 6–8) |
| `POST /api/contracts/{id}/review` ("Review risks / Review again") | same as upload |
| `MASIGN_REAL_LLM=1` pytest runs | see the test: the Northwind set is 7+ questions × 2 |
| The MAS-32 evaluation set | ~50 questions × 2 = ~100 calls — needs explicit OK |
| Anything that goes through `get_chat_model()` when `ANTHROPIC_API_KEY` is set | yes |

What is free: the whole test suite (fake model), the canned-API UI preview
(`ui-preview`), retrieval (`retrieve_contract_context` — embeddings are local),
`/ready`, `/api/contracts`, injected questions (refused before any call),
uploads when no key is configured (review fails with a readable reason).

## Procedure

1. Before the action, state: what you want to run, why the fake model is not
   enough, and the estimated number of calls. Wait for a yes.
2. Prefer: fake model tests → canned preview → retrieval-only script → one
   live contract, in that order. The MAS-31 edge-case run accidentally spent a
   call because a "gibberish" upload was valid text and triggered the review —
   uploads are not free once a key is set. Delete probe contracts afterwards.
3. After a live run, report the count and check the log:
   `docker compose logs api --since 10m | grep -c api.anthropic.com`.
4. Never print `.env`; the key is `sk-ant-…`, 109 chars; edit single lines with
   `sed`. Never paste a key into a ticket, a doc, or a commit.
5. If the user is the one clicking (uploads, questions in the demo), tell them
   the price of each step up front; that is their choice to make, not a
   surprise to discover.
