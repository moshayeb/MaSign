---
name: spec-from-brainstorm
description: Turns a loose, informal idea or brainstorm from the user into an explicit, agreed-upon specification before any code is written. Trigger this whenever the user proposes a new feature, project, or significant change in vague or exploratory terms ("what if we...", "I'm thinking about...", "can we build something that...", "grill me on this"), or before starting implementation of anything that doesn't already have a written spec. Do NOT start writing code until the resulting spec has been explicitly confirmed by the user.
---

# Spec From Brainstorm ("grill-me")

## Purpose

Human/agent misalignment is most expensive right after an idea is born and cheapest to fix before a single line of code exists. This skill turns "I have an idea" into a specification both sides have explicitly agreed to, by interrogating the idea rather than immediately trying to please the user with a plan.

## When to use

- The user proposes a feature/project informally, without a written spec.
- The user explicitly says "grill me", "grill-me this", or "turn this into a spec".
- You (the agent) notice you are about to start implementing something non-trivial based on a one-line request.

## Process

1. **Restate the idea in your own words** — one paragraph, plain language. This surfaces misunderstandings immediately.
2. **Interrogate, don't assume.** Ask about, in this rough order, skipping what's already clear:
   - **Scope**: what's explicitly in and explicitly out of this piece of work?
   - **Inputs/outputs**: what data goes in, what comes out, in what shape?
   - **Constraints**: performance, existing architecture, deadlines, tech already chosen (e.g. stack, DB)?
   - **Edge cases**: what happens on empty input, failure, concurrent use, bad user input?
   - **Success criteria**: how will we know this is done and working? What's testable?
   - **Non-goals**: what looks related but is explicitly NOT being solved here?
3. **Batch questions**, don't interrogate one at a time unless the user's answers keep changing scope — respect their time.
4. **Push back on vague answers.** "Make it fast" is not a constraint; ask for a number or a comparable. "Handle errors gracefully" is not testable; ask what "gracefully" means concretely.
5. **Write the spec** as a short markdown document:
   ```markdown
   # Spec: <name>
   ## Goal
   ## In scope
   ## Out of scope
   ## Inputs / Outputs
   ## Constraints
   ## Acceptance criteria (testable, checkbox list)
   ## Open questions (if any remain)
   ```
6. **Get explicit sign-off.** Present the spec and ask the user to confirm or correct it. Do not begin implementation until they've said yes — an unconfirmed spec is still a brainstorm.
7. If this project uses ticket-git-workflow, the confirmed spec's acceptance criteria become the ticket's acceptance criteria directly — don't re-derive them from scratch.

## Anti-patterns to avoid

- Skipping straight to "here's a plan" without restating the idea back first.
- Asking a wall of 15 questions at once when 4 would unblock the spec.
- Writing the spec and proceeding without waiting for confirmation.
- Treating "sounds good" to a *plan* as confirmation of a *spec* — they're different; if no written spec exists yet, get one confirmed first.
