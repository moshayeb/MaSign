---
description: Stop and prove the current work still matches MaSign's goal and process — six questions, ≤80 chars of checkable evidence each
---

Run the `sanity-check` skill (`.claude/skills/sanity-check/SKILL.md`) against
the project as it stands right now, and follow it exactly.

Do not answer from memory. Gather the evidence first by running the commands
the skill lists — branch and last commits, working tree, the frontend test
count, the backend test count when the backend changed, and `/api/contracts`
when a demo or freeze is near — then read the ticket the branch names.

Then output one line per question: number, verdict (✅/⚠️/❌), and at most 80
characters of evidence that a reader could go and verify. Anything that cannot
be evidenced is ⚠️, never ✅. Close with a single next action only if something
is ⚠️ or ❌.
