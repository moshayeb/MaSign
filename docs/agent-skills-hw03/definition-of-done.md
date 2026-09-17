---
name: definition-of-done
description: Defines exactly what an agent must do before declaring a ticket or task complete — run and pass tests, check coverage on changed code, self-review the diff, open a pull request with a clear description, and update the ticket status. Trigger this whenever the agent believes it has finished implementing a ticket or task and is about to report completion, hand off, or move on to the next task.
---

# Definition of Done

## Purpose

"I think this is done" from an agent is not the same as "this is done". This skill is the checklist an agent runs through before making that claim, so completion reports are actually trustworthy instead of optimistic.

## Checklist — run every item before claiming completion

1. **Re-read the acceptance criteria** (from the ticket, see ticket-git-workflow). Go through each checkbox item literally and verify it, don't eyeball it.
2. **Run the test suite.** All existing tests must pass — not just the ones you wrote. A green run you didn't actually execute doesn't count.
3. **Add or update tests for the change.** New behavior needs new tests; changed behavior needs updated tests. If a ticket criterion has no test covering it, that criterion is not actually verified yet.
4. **Check test coverage on the changed files specifically** (not just project-wide average) — a high overall number can hide an untested new module.
5. **Self-review the diff** before anyone else does: read the full `git diff` as if you were the reviewer. Look for leftover debug code, TODOs that should be tickets instead, inconsistent naming, and anything that doesn't match the acceptance criteria.
6. **Run integration checks if applicable** — if this ticket touches an interface other components depend on (API contract, DB schema, shared module), confirm the dependent side still works, don't assume.
7. **Open the pull request** with:
   - A description of *what* changed and *why* (link the ticket, don't restate its whole body).
   - `Closes <TICKET-ID>` so it auto-links.
   - Any manual test steps a human reviewer should follow, if automated tests don't cover everything.
8. **Update the ticket** — status, and a short comment on what was actually done (useful later even if the PR description also says it).
9. Only after 1–8: report completion to the user, in terms of the acceptance criteria ("criteria 1–3 verified via tests, criterion 4 verified manually because X").

## When something can't be fully verified

If a criterion genuinely can't be tested automatically (e.g. requires manual UX judgment), say so explicitly rather than silently skipping it — "criterion 4 needs manual review, here's how to check it" is honest; silence is not.

## Anti-patterns to avoid

- Declaring done because the code "should work" without having run the tests.
- Treating "the happy path works" as equivalent to the acceptance criteria being met.
- Opening a PR with no description, relying on the diff to speak for itself.
- Leaving the ticket status stale after the PR is merged.
