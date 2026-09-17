---
name: session-handoff
description: Produces a structured, tree-organized summary of the current work session and manages where that summary lives, so context can be handed over or compacted between agent sessions without another agent re-reading the whole transcript. Trigger this when the user asks to wrap up, hand over, compact, or summarize a session, when context is getting long, or when starting a new session that continues previous work.
---

# Session Handoff

## Purpose

A chat transcript is expensive for another agent (or your future self, post-compaction) to re-read in full. This skill produces a short, structured artifact that lets a new session get oriented in seconds — and keeps a consistent place to look for it, so "what happened last session" is never a guessing game.

## When to use

- The user asks to wrap up, hand over, or summarize a session.
- Context is getting long and needs compacting before continuing.
- You're starting a new session on a project that has prior handoff docs — read the latest one first, before re-deriving context from scratch.

## Summary structure (the "tree")

Save as markdown, one file per session, with this shape:

```markdown
# Handoff: <project> — <date>

## Goal
What this session was trying to accomplish (1-2 sentences).

## Decisions made
- Decision — why (one line each). Only decisions, not the discussion that led to them.

## Changes made
- Files touched: <paths>
- Commits: <commit refs, with ticket IDs — don't restate their content, just point at them>
- Tickets touched: <IDs and new status>

## Open questions
- Anything left unresolved that the next session needs to pick up.

## Next steps
- Concrete, actionable — not "continue working on X".
```

## Rules

1. **Reference, don't duplicate.** If a decision is already fully captured in a ticket or commit message, link/cite it instead of re-explaining it — the handoff doc is a map, not a second copy of the territory.
2. **One file per session**, named `docs/handoffs/<YYYY-MM-DD>-<short-topic>.md` (adjust the path to match project convention, but keep it consistent within a project so it's always findable).
3. **Keep the tree shallow.** Bullet points, not prose paragraphs — a future agent scans this, it doesn't read it closely.
4. **A new session starts by reading the latest handoff doc** (and only as much of the raw transcript as the handoff doc says is relevant) — this is what makes compaction actually save context instead of just being extra work.
5. If multiple agents are working in parallel on the same project, each session's handoff doc should note which other tickets/branches were active at the time, so a resuming agent knows what might have changed underneath it.
