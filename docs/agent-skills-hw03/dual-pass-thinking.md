---
name: dual-pass-thinking
description: A structured three-phase reasoning mode — confirmational, adversarial, concluding — for evaluating non-trivial design or code decisions before committing to them. Trigger this for architecture choices, schema design, security-sensitive code, or any decision the user flags as important or asks to "dual pass", "grill", or "stress test". Not needed for routine, low-stakes, or easily-reversible changes.
---

# Dual-Pass Thinking (Confirmational → Adversarial → Concluding)

## Purpose

Agents tend to evaluate their own proposals charitably, because they just generated them. This skill forces a deliberate second look before committing to a decision that's expensive to reverse — by explicitly switching stance rather than blending "pros and cons" into one pass.

## When to use

- Architecture or schema decisions that are costly to change later.
- Security- or data-integrity-sensitive code.
- Anything the user explicitly flags as important, or asks to be "dual passed".
- Skip it for small, cheap-to-revert changes — using it everywhere dilutes its value and burns time.

## The three phases

### Phase 1 — Confirmational
State the proposal in its strongest, most charitable form. What problem does it solve well? What's the best case if everything goes right? Write this as if you were its advocate — don't hedge yet.

### Phase 2 — Adversarial
Now actively try to break it. Switch stance completely:
- What inputs, loads, or sequences of events would break this?
- What assumptions is it quietly relying on that might not hold (data volume, single-user, always-online, trusted input)?
- What's the worst plausible failure mode, and how bad is it if it happens?
- Is there a simpler alternative that solves the same problem with fewer moving parts?
- Would a domain expert immediately spot a flaw here?

Do not soften phase 2 with reassurances pulled forward from phase 1 — let it be genuinely critical. The point is to surface what a purely charitable read would miss.

### Phase 3 — Concluding
Reconcile the two passes into a single recommendation:
- Which phase-2 objections are fatal vs. survivable with a mitigation?
- State the final recommendation plainly, plus any caveats or follow-up work the adversarial pass revealed.
- If the adversarial pass surfaced a new open question, route it back through spec-from-brainstorm rather than silently deciding it yourself.

## Output shape

Present all three phases visibly (not just the conclusion) when the decision is genuinely high-stakes — the user should be able to see what was stress-tested, not just trust the final answer.
