# MaSign — notes for Claude Code

Project conventions that are not derivable from the code. Read before working.

## Workflow

- Jira project MAS (board 100), three one-week sprints: Sprint 1 Sep 14–18 and
  Sprint 2 Sep 21–25 build; Sprint 3 Sep 28–Oct 2 is verification only.
- One branch per story, `MAS-<n>-short-slug`; commits start with the key; merge
  via PR. Claude commits and pushes the branch and hands over the PR link; the
  user opens/merges the PR. Every review finding becomes a Jira issue
  (label `review-finding`) before it is fixed.
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
- The model is set by `EMBEDDING_MODEL`. The embedder adds the family's input
  prefixes itself (`search_document: `/`search_query: ` for ModernBERT-embed,
  MAS-51) and gives the chunker a token budget so no chunk is truncated
  (MAS-49). The index fingerprint (model, dims, token limit, prompt format) is
  stored in `vector_index`; any change rebuilds the collection from the stored
  chunks at startup (MAS-52). Upgrade path: `Qwen/Qwen3-Embedding-0.6B`
  (1024 dims) or `Qwen3-Embedding-4B` (0.842, beats OpenAI large) if GPU
  inference becomes available — a config change, re-indexed automatically.
- Known gap: no benchmark covers financial/economic contract terms
  (fees, penalties, payment clauses) specifically — MAS-32's
  evaluation set MUST include financial-term questions to actually
  measure this, not assume general MTEB strength carries over.

### GPU benchmark and profiles (MAS-58, 2026-09-16)

The teacher's advice was "strongest model possible" (Qwen3-Embedding-4B
Q4_K_M); the earlier timings were all CPU-only. Re-measured on the dev
machine's Quadro P1000 (4 GB, ~1.2 GB used by other apps), same 12 Northwind
chunks, 18 questions (10 on fees/penalties/payment terms):

| Model | Device | ≈ 30 pages | query | VRAM | top-1 |
|---|---|---|---|---|---|
| ModernBERT | CPU | 31 s | 97 ms | – | 16/18 |
| ModernBERT | GPU | 5 s | 48 ms | 0.7 GB | 16/18 |
| Qwen3-0.6B | GPU fp32 | 27 s | 180 ms | 1.6 GB | 16/18 |
| Qwen3-4B Q4_K_M | GPU llama.cpp | 100 s | 178 ms | 2.7 GB (all that is free) | 16/18 |

Quality was a tie on this contract (different near-misses, all rank 2–3);
MLEB (0.842 vs 0.741) remains the reason to believe 4B wins on harder cases.

**Decision — two deployment profiles, the deployer chooses (MAS-61):**
`portable` (default) = ModernBERT, CPU or GPU, runs on any laptop;
`quality` = Qwen3-Embedding-4B Q4_K_M via `llama-server` on a GPU with
≥3 GB free VRAM, through an OpenAI-compatible embedder backend. ModernBERT
stays the default because it runs everywhere and no measurable gap has been
shown yet; MAS-32's evaluation decides which profile the project recommends.
"Compare mode" (both indexes, the end user chooses per question) is a parked
suggestion: MAS-62. Never quote CPU timings for Qwen models again — the
"10 minutes per 30 pages" figure was a CPU artefact.

Implemented in MAS-61: `EMBEDDING_BACKEND=sentence-transformers|openai-compatible`,
`EMBEDDING_DEVICE=auto|cpu|cuda`, `EMBEDDING_API_URL`; the quality profile is
`docker compose -f docker-compose.yml -f docker-compose.quality.yml up` (a
compose *profile* cannot reconfigure the `api` service, hence an override
file). The backend is part of the index fingerprint (migration 003): the same
model name through the two backends gives different vectors. Measured in
compose on the P1000: 12-chunk Northwind upload 25 s (llama-server runs
batches on parallel slots, so the benchmark's one-request-per-chunk 100 s was
pessimistic), queries 160–240 ms end to end, 8/8 Northwind questions top-1.

## LLM decision (MAS-13, 2026-09-16)

Default `CHAT_PROVIDER=anthropic`, `CHAT_MODEL=claude-sonnet-5`; OpenAI
(`gpt-4.1-mini`) is the switch. Sonnet over Haiku because MAS-15/16 (risk
detection) and MAS-14/32 (grounding discipline) need legal reading
comprehension more than raw Q&A does, and per-query cost is cents either way.
Switching providers is config only: the prompt is ours (`app/answering/
grounding.py`) and nothing model-specific is stored — but rerun the MAS-32 set
after a switch. Since MAS-90 every call goes through `litellm.completion()`
and the model is wrapped in the prompt-injection guardrail
(`app/guardrails/prompt_injection.py`, a LiteLLM `CustomGuardrail`): contract
passages carrying instructions to the AI are withheld before the call, never
silently forwarded. Since MAS-99 only the injected sentences are cut and the rest of
the passage is read (`redact_passage`); a passage that is nothing but injection
is withheld whole. Tests wrap the fake model in the same guardrail. Every answer must carry `[n]` citations; uncited answers are
returned with `grounded: false`, never silently accepted.

The UI follows the same budget rule as the agent (MAS-122): a control that
reaches the paid model states its cost first (`frontend/src/cost.ts`), a
re-review asks before re-spending, and a failed *read* of a review is
recovered with a free retry — never by offering the paid job as the only
way out.

## Risk rubric (MAS-15/16)

Seven categories, Customer perspective, High/Medium/Low thresholds live in
`app/risk_analysis/rubric.py` and are the single source for the prompt and
`docs/risk-rubric.md` (regenerate the doc when the rubric changes). A finding
must quote its passage verbatim or it is dropped; an unreadable model reply is
`risks_checked: false`, never an empty "no risks". Two scopes since MAS-81
(owner feedback 2026-09-17: "it doesn't analyse anything"): every upload gets a
whole-contract review (all passages, batches of 8, stored per contract, shown
in the Risk review panel), and each question still flags its own retrieved
passages. The review costs about one model call per 8 passages.
Since MAS-82 the same job also extracts nine financial key terms
(`app/key_terms/terms.py` is the single source, like the rubric): verbatim
quote or dropped, typed fields kept only when their numbers are in the quote,
`not_stated` only when the pass completed — otherwise `unchecked`. One more
call per batch of 8 (Northwind: 4 calls per upload in total).
Since MAS-107 every upload also gets a **document kind** by rule, no model
call (`app/ingestion/document_type.py`: contract | uncertain | not_contract,
with the markers that decided it): a clean review of an invoice must read
"rubric may not apply", never "nothing found". It is a hint, never a gate —
nothing is blocked on it.

## Agent skills (MAS-72)

`.claude/skills/` holds eight MaSign-specific skills that load in every
session here; `.claude/skills/README.md` is the index and
`docs/agent-skills-hw03/` keeps the five generic Homework-03 originals they
grew from. Their `description` fields are the triggers, written as this
project's concrete situations: `masign-ticket-flow` (Jira/git procedure,
owner's files never staged, connector timeouts -> read before retry),
`masign-done` (the exact commands and docs map before "done"),
`api-spend-guard` (ask before any paid call, with the cost table),
`honest-outcomes` (unavailable != empty; verify quotes or drop),
`ui-preview` (canned-API screenshots, zero spend), `masign-handoff`
(`docs/handoffs/`, read the latest at session start), `decide-carefully`
(spec into the ticket before code; confirm -> attack -> conclude for costly
decisions) and `sanity-check` (`/sanity-check`, MAS-127, Homework 4: six
process/goal questions, each answered in <=80 characters of checkable
evidence -- a file, a MAS key, a count -- never an adjective; unknown counts
as a warning, not a pass). When a skill and this file disagree, this file
wins; fix the skill. `.claude/commands/` mirrors the slash-command-shaped
ones (currently `sanity-check`) so they also appear in the `/` menu.

## Safety hooks (MAS-127a, Homework 6)

`.claude/hooks/` holds three `PreToolUse` scripts, registered locally in
`.claude/settings.json` (never committed -- each teammate wires their own
absolute interpreter/script paths) but the scripts themselves are tracked,
tested and documented like any other code. Every hook reads one JSON tool
call on stdin and fails closed: a crash, malformed stdin, or missing
`tool_name` all become **ask**, never a silent allow (`_common.py`
`run_hook`). `ask` prints a `permissionDecision` JSON and exits 0 (forces
the normal approval prompt); `deny` writes to stderr and exits 2 (no way
through at all).

- `protect_sensitive_files.py` -- asks before `rm`/`mv`/a truncating `>`/
  `git checkout --`/`git restore`/`git clean -f` touches `CLAUDE.md`,
  `.gitignore`, `.dockerignore`, `.env`, `.env.example`, or an *existing*
  `app/database/migrations/*.sql` file (a brand new migration is exempt),
  and before a Write/Edit/NotebookEdit targets any of them directly. Built
  after a real incident: a `git reset --hard` once wiped uncommitted
  CLAUDE.md/.gitignore/.dockerignore edits, recovered only from a dangling
  stash. Disclosed gap: a one-line interpreter script that opens and
  overwrites a protected file directly is not pattern-matched -- including
  this project's own habit of editing CLAUDE.md that way.
- `block_destructive_sql.py` -- **denies** (hard, exit 2) an unbounded
  DELETE, or the two whole-table statements this file avoids spelling
  out verbatim in its own prose (see the hook's docstring for why), when
  either appears in a Bash command segment whose own program is a database
  client (psql, python, mysql, sqlite3, or `docker exec ... psql`) or in
  content a Write/Edit is about to put into a non-documentation file.
  Documented gap, not a hidden one: SQL built and executed *inside* a
  program the agent merely runs is invisible to a PreToolUse hook.
- `block_history_rewrite.py` -- asks before `git push` straight to `main`
  (explicit, via refspec, or a bare `push` while `main` is checked out) or
  any `--force`/`-f` push to any branch -- a push is already headed for a
  PR review, so a second human is downstream of it either way. For the
  commands a push/PR review never sees -- `reset --hard`, `commit --amend`,
  `rebase`, `filter-branch`, `reflog expire`, `gc --prune` -- it requires a
  **typed confirmation code** instead (Homework 6 "overkurs"): see below.

Every ask/deny is appended to `.claude/hooks/blocked.log` (git-ignored,
local audit trail). `tests/test_safety_hooks.py` runs each script as a real
subprocess with the same stdin protocol Claude Code uses -- not just the
pattern-matching functions in isolation -- and asserts the block actually
happens; several of its own tests build their SQL fixtures by string
concatenation rather than as literal text, because once these hooks are
registered they also govern editing their own test file. Hooks are read at
session start: a hook added or changed mid-session needs a restart before
it reliably takes effect everywhere, though this project's own build of
them took hold immediately in the session that wrote them.

**ask is not a guarantee in an unattended session -- only deny is.** Found
live, not reasoned about in advance: a real `git push origin HEAD:main`
and a real `git reset --hard HEAD` both ran through with no prompt shown,
in the same autonomous ("Auto Mode") session where block_destructive_sql.py's
`deny` stopped a real destructive-SQL attempt outright, every time, no
prompt involved. Both hooks independently confirmed the same input
correctly classifies as `ask` when run standalone -- the gap is not in the
classification, it is that `ask` routes through the normal interactive
permission system, which an unattended session can pass through unanswered,
while `deny` (exit 2) never enters that system at all.

**Resolved for the local history-destroying commands with a fourth
decision, `confirm` (owner sign-off, 2026-09-24).** `protect_sensitive_files.py`
and push/force-push in `block_history_rewrite.py` stay `ask`-only --
deliberately, since a push already heads toward a PR review, a second
human is downstream regardless. But `reset --hard`, `commit --amend`,
`rebase`, `filter-branch`, `reflog expire` and `gc --prune` can destroy
work with no remote and no reviewer ever involved, so those now go through
`_common.confirm()`: it bypasses Claude Code's permission prompt entirely
-- the exact plumbing `ask` was shown to leak through -- and instead opens
the real OS console directly (`CONIN$`/`CONOUT$` on Windows, `/dev/tty` on
POSIX; not this process's own stdin, already spent on the tool-call JSON,
nor its stdout, which nobody may be watching) and requires a human to type
a code the owner set themselves (`MASIGN_CONFIRM_CODE`, or a local,
git-ignored `.claude/hooks/.confirm_code`) within `MASIGN_CONFIRM_TIMEOUT`
seconds (default 20). No code configured anywhere, no console attached
(exactly the unattended case above), a wrong code, or nobody answering in
time: every one of those is a `deny`, same as Hook 2 -- only a correct,
human-typed code lets the call through. Proven live, not just unit-tested:
a real `git reset --hard HEAD` with no code configured was genuinely
stopped in this same autonomous session (`.claude/hooks/blocked.log`,
`2026-09-24T11:33:37Z`), where the equivalent `ask`-based attempt earlier
in this same session was not. See `_common.confirm()`'s docstring and
`tests/test_safety_hooks.py`'s `TestConfirmationCode` for the mechanism
and its test seam.

## Frontend Decision

React + Vite, served by FastAPI; **sonner** toasts for every user action, error
toasts show the API's `detail` verbatim. See `docs/frontend.md`.
