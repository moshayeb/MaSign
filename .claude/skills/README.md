# MaSign agent skills

Project-specific skills for Claude Code, derived from the five generic
Homework-03 skills (kept for provenance in `docs/agent-skills-hw03/`) and from
what Sprint 1 of MaSign actually taught. Each `SKILL.md` `description` is the
trigger: it names the concrete situations in this project that should make
the skill fire, so it is picked up by situation, not only by name.

| Skill | Fires when… | Replaces / adds |
|---|---|---|
| `masign-ticket-flow` | starting work, reviewer findings pasted, any Jira create/close, branching, committing, PR handover, connector timeouts | evolves `ticket-git-workflow` + the owner-files rule + connector quirks |
| `masign-done` | about to say "done", push, or write an evidence comment | evolves `definition-of-done` with the exact commands and the docs map |
| `api-spend-guard` | anything that could reach Anthropic/OpenAI | new — the owner's standing rule, with a cost table |
| `honest-outcomes` | designing/reviewing anything model-facing or any result state | new — the product principle behind MAS-74/76/80/87/90 |
| `ui-preview` | any frontend change or visual check | new — canned-API harness, headless Edge, toast rules |
| `masign-handoff` | session start, wrap up, /compact, before a demo | evolves `session-handoff` with the start-of-session routine |
| `decide-carefully` | vague feature ideas; costly or trust-affecting decisions | merges `spec-from-brainstorm` + `dual-pass-thinking` with MaSign precedents |
| `sanity-check` | `/sanity-check`; before "done", a demo or the freeze; a long or drifting session | new (Homework 4) — six questions, ≤80 chars of checkable evidence each, unknown is `⚠️` not `✅` |

How they chain: `masign-handoff` (read) → `decide-carefully` (spec into the
ticket) → `masign-ticket-flow` (branch, findings as tickets) → build with
`honest-outcomes` and `ui-preview`, spending nothing without `api-spend-guard`
→ `masign-done` (verify, document, evidence) → `masign-handoff` (write).

## Safety hooks (Homework 6)

Skills are conventions the agent follows; `.claude/hooks/` is enforcement —
three `PreToolUse` scripts that stop specific tool calls before they run,
not just describe why they shouldn't. Registered locally in
`.claude/settings.json` (never committed, so each machine points at its own
Python/script paths), but the scripts, their tests and this doc are.

| Hook | Stops | Decision |
|---|---|---|
| `protect_sensitive_files.py` | destructive ops (`rm`, overwrite, `git checkout --`, `git clean -f`) on CLAUDE.md, .gitignore, .dockerignore, .env(.example), an existing migration file | **confirm** — a typed code, see below |
| `block_destructive_sql.py` | an unbounded `DELETE`, or either of the two whole-table SQL statements this hook exists to stop, wherever they're headed for a real database client (psql/python/mysql/sqlite3) or a non-doc file | **deny** |
| `block_history_rewrite.py` | `git push` to main, any force-push to any branch | ask |
| `block_history_rewrite.py` | `reset --hard`, `commit --amend`, `rebase`, `filter-branch`, `reflog expire`, `gc --prune` | **confirm** — a typed code, see below |

All three fail closed: a crash, bad stdin, or a call they cannot classify
becomes **ask**, never a silent allow (`.claude/hooks/_common.py`). Every
ask/deny is logged to `.claude/hooks/blocked.log`. `tests/test_safety_hooks.py`
runs the real scripts as subprocesses with the protocol Claude Code uses,
not just their pattern-matching functions — including regressions for two
false positives caught live while building them (a commit message or a
doc file merely *naming* the banned SQL keywords is not itself SQL).
Documented, not hidden: neither SQL nor file-protection hook can see what
happens *inside* an interpreter it merely launches — only the tool call's
own text.

**`ask` is not a guarantee outside an attended session.** Found live: a real
push to `main` and a real `reset --hard` both went through with no prompt,
in the autonomous session that built these hooks, while `deny` stopped a
real destructive-SQL attempt every single time. `ask` routes through the
normal interactive permission prompt, which an unattended ("Auto Mode")
session can pass unanswered; `deny` (exit 2) never enters that system.
Push-to-main/force-push in `block_history_rewrite.py` is still `ask`-only
by design — a push is already headed for a PR review, so a second human
is downstream of it either way.

**`confirm`: a typed code for the commands a push/PR review never sees.**
Local history-destroying commands (`reset --hard`, `commit --amend`,
`rebase`, `filter-branch`, `reflog expire`, `gc --prune`) and everything
`protect_sensitive_files.py` covers never reach a remote or a reviewer, so
they got a fourth decision instead of a blanket `deny`: `_common.confirm()`
bypasses Claude Code's permission prompt entirely and requires a human to
type a code the owner chose (`MASIGN_CONFIRM_CODE` or a local, git-ignored
`.claude/hooks/.confirm_code`) within a time limit (`MASIGN_CONFIRM_TIMEOUT`,
default 20s). No code configured, no console attached or spawnable, a wrong
code, or nobody answering in time — every one of those denies, same as
Hook 2. Proven live, twice: a real `git reset --hard HEAD` with no code
configured was stopped (`blocked.log`, `2026-09-24T11:33:37Z`), and — after
`protect_sensitive_files.py` was escalated the same way — a real
`rm CLAUDE.md` that had previously gone straight through under `ask` was
stopped too (`2026-09-24T13:00:11Z`).

**Found the same day: this process's own console is not the owner's
screen.** `confirm()` first tried `CONIN$`/`CONOUT$` (Windows) / `/dev/tty`
(POSIX) — the *inherited* console. On POSIX that is the controlling
terminal itself and is fine. On Windows, in this project's actual harness
(Claude Code inside a VSCode extension host), it opened without error but
attached to a console the owner could not see, so every real confirmation
silently ran out its timeout — safe (still denied), but nobody ever had a
real chance to answer. Fixed by not trusting the inherited console at all
on Windows: `_prompt_windows_new_console` spawns a brand new, independent
console window (`CREATE_NEW_CONSOLE`) to show the prompt, confirmed live
to actually appear on screen. Fixing it also exposed that `run_hook`'s
fail-closed exception guard covered `classify()` but not the `confirm()`
call itself — a crash in the new, more complex console-spawning code
(a missing `import re`, caught this way) would have exited 1, which
Claude Code treats as non-blocking. Now a crash while acting on a
`confirm` decision escalates to `deny`, not `ask`.
