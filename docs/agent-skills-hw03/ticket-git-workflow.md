---
name: ticket-git-workflow
description: Defines how tickets (Jira or GitHub Issues) should be written with clear, testable goals, and how tickets, git branches, commits, and pull requests stay linked to each other throughout a task's lifecycle. Trigger this whenever creating a new ticket, starting work on an existing ticket, naming a branch, writing a commit message, or opening a PR for ticket-tracked work.
---

# Ticket ↔ Git Workflow

## Purpose

Work that isn't traceable from ticket → branch → commits → PR → done is work nobody but the original agent/session can reconstruct later. This skill keeps that chain intact so any future agent (or human) can answer "why does this code exist?" by following IDs, not by re-reading the whole chat history.

## Ticket format

Every ticket, regardless of tracker, follows this shape:

```markdown
## Goal
One or two sentences: what should be true after this ticket is done.

## Acceptance criteria
- [ ] Testable statement 1
- [ ] Testable statement 2
(Each item must be checkable by running something — a test, a manual repro
step, a command — not just "code reviewed" or "looks good".)

## Out of scope
What this ticket deliberately does not cover.

## Notes / links
Links to the spec (see spec-from-brainstorm), related tickets, design docs.
```

If a confirmed spec already exists for this work, copy its acceptance criteria in verbatim rather than rewriting them — divergence between spec and ticket is a common source of scope creep.

## Branch naming

`<type>/<ticket-id>-<short-slug>`, e.g. `feature/AA-123-pdf-chunking` or `fix/AA-141-null-metadata`.

## Commit messages

Every commit that works on a ticket references its ID at the start of the subject line:

```
AA-123: add PDF chunking for contract ingestion
```

Small, frequent, scoped commits are preferred over one giant commit at the end — this was explicit past feedback (commit frequency) and applies generally: it lets reviewers and future agents see the reasoning trail, not just the final diff.

## Linking tickets to commits/PRs

- If the tracker supports smart commits (e.g. Jira via `AA-123 #comment ...` or `AA-123 #time`), use them so the ticket auto-updates.
- Every PR description includes `Closes AA-123` (or `Relates to AA-123` if it doesn't fully close it) so the tracker and the git host stay cross-referenced automatically.
- Never let a ticket's status silently drift from what git actually shows — if the ticket says "In Progress" but the branch has been merged, update the ticket before doing anything else.

## Starting work on a ticket

1. Read the ticket's acceptance criteria before writing any code — if they're not testable, stop and clarify (or route to spec-from-brainstorm) rather than guessing.
2. Create/checkout the branch using the naming convention above.
3. Move the ticket to "In Progress" (or equivalent) immediately, not after the work is done.
