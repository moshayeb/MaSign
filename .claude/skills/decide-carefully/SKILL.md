---
name: decide-carefully
description: Turns a vague idea into a confirmed spec before code, and stress-tests costly decisions with a confirm → attack → conclude pass, using MaSign's own examples. Trigger this when the user proposes a feature or change in loose terms ("can we…", "what if…", "I want it to…", "make it better"), asks "grill me", "what do you think", or "is this a good idea"; before any story that adds a table, a prompt, a model call, a guardrail rule, a provider or embedding change, or changes what a result claims; and when a reviewer's recommendation would change priorities.
---

# Decide carefully

Merges the Homework-03 `spec-from-brainstorm` and `dual-pass-thinking`
skills, tuned to how MaSign decisions have actually gone.

## Part A — from idea to a spec the owner has confirmed

1. **Restate** the idea in one paragraph, plain words. (The whole-contract
   review, MAS-81, came from restating "it doesn't analyse anything" as
   "silence must mean reviewed, not skipped".)
2. **Ask the few questions that change the work**, batched, not a wall:
   scope in/out · inputs/outputs · cost in model calls · what the user sees
   when the model fails or the text is silent (`honest-outcomes`) · what is
   testable with the fake model · what is *not* being solved.
3. **Write the spec** into the Jira ticket itself (Goal / In scope / Out of
   scope / Acceptance criteria as checkable items / Cost / Open questions) —
   the ticket is the spec; no separate document.
4. **Get a yes** ("go") before code. A "sounds good" to a *plan* is not a
   confirmed *spec*. If the owner says go without answering the questions,
   state the assumptions you are taking and proceed.

## Part B — dual pass for decisions that are costly to reverse

Use for: new tables/migrations, prompt changes, provider or embedding
changes, guardrail rules, what a status flag means, anything touching money
or trust. Skip for CSS, copy, and reversible refactors.

- **Confirm**: the proposal at its strongest — what it fixes, best case.
- **Attack**: what breaks it — malformed model replies, short contracts that
  become one chunk, a reviewer file in the tree, connector timeouts, a user
  who reads "Nothing found" as safe, an attacker who writes the contract,
  cost per contract at 30 pages, Windows paths and CRLF, the fake model not
  exercising the real path.
- **Conclude**: recommendation, the mitigations for surviving objections, and
  the follow-up tickets the attack pass produced. Show all three parts to the
  owner when the decision is genuinely big; otherwise a two-line conclusion.

## MaSign precedents to reuse

- Embedding model: benchmark on *this* machine and *this* contract, not only
  MLEB; two deployment profiles rather than one "best" (MAS-58/61).
- Chat model: Sonnet over Haiku for legal reading; provider swap is config
  because the prompt is ours (MAS-13).
- Risk review: batches of 8 passages, stored per contract, status row with
  three outcomes (MAS-81, MAS-74).
- Guardrail: withhold the passage, keep numbering, refuse an injected question
  before any call; pattern-based (named as a limitation, MAS-90) and, since
  MAS-99, sentence-level — only injected sentences are cut, a passage that is
  nothing but injection is still withheld whole.
- Priorities after the 2026-09-17 product review: financial key terms with
  sources, click-to-source, explicit coverage; risk score and redlines
  postponed; missing-clause checklist separate (MAS-82/83/84).
