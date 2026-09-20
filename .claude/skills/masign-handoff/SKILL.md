---
name: masign-handoff
description: Writes and reads MaSign session handoffs in docs/handoffs/ so a new session (or a compacted one) resumes from a short tree summary instead of the transcript. Trigger this at the start of every session in this repo (read the latest handoff first), when the user says wrap up, hand over, summarize, "we continue tomorrow", or types /compact, when the conversation is getting long, and at the end of a sprint or before a review/demo.
---

# MaSign session handoff

Evolved from the Homework-03 `session-handoff` skill.

## At session start

1. `ls docs/handoffs/` → read the newest file. Then `git status --short`,
   `git branch --show-current`, `git log --oneline -5 origin/main`, and one JQL
   for open work (`project = MAS AND status = "In Progress"`). Only then act.
2. If the handoff says PRs were waiting, check whether they merged
   (`git log origin/main`) and close their tickets (`masign-ticket-flow`).
3. Recalled memories (`~/.claude/projects/.../memory/`) hold standing rules
   (API spend, sprint field); the handoff holds *this week's* state.

## At session end (or on /compact, or before a demo)

Write `docs/handoffs/<YYYY-MM-DD>-<short-topic>.md`:

```markdown
# Handoff: MaSign — <date> (<topic>)
## Goal            1–2 sentences
## Decisions made  one line each, with the ticket that records it
## Changes made    commits/branches/PRs by reference; tickets and their status
## Open questions  what needs the owner's decision
## Next steps      concrete: ticket, first command, cost if any
```

Rules: reference tickets and commits, do not restate them; bullets, not
prose; note anything untracked that the next session must not touch
(reviewer probe files, owner's uncommitted files); note API calls spent
today. Commit it on the current story branch (it is documentation).

## What "next steps" must include for this project

- PRs waiting for the owner to merge, in the order they must merge.
- Whether the running stack is behind main (`docker compose up -d --build`).
- The next story with its cost (`api-spend-guard`) and any decision blocking
  it (e.g. light vs dark theme before the UX reorganisation).
