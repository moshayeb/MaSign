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
| `protect_sensitive_files.py` | destructive ops (`rm`, overwrite, `git checkout --`, `git clean -f`) on CLAUDE.md, .gitignore, .dockerignore, .env(.example), an existing migration file | ask |
| `block_destructive_sql.py` | an unbounded `DELETE`, or either of the two whole-table SQL statements this hook exists to stop, wherever they're headed for a real database client (psql/python/mysql/sqlite3) or a non-doc file | **deny** |
| `block_history_rewrite.py` | `git push` to main, any force-push, `reset --hard`, `commit --amend`, `rebase`, `filter-branch`, `reflog expire`, `gc --prune` | ask |

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
