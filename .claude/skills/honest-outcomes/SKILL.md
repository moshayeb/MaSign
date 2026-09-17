---
name: honest-outcomes
description: MaSign's product principle for anything the model produces — answers, citations, risk findings, reviews, key terms, guardrail decisions — and the UI that shows them: never silently forward, never silently drop, and never let "we could not check" look like "nothing is wrong". Trigger this when designing, implementing or reviewing any feature that calls the model, parses its reply, validates findings, sets a status flag, or renders a result state; when writing a prompt; when a reviewer says a result could mislead; and when planning MAS-82 (key terms), MAS-83 (source view) or MAS-84 (coverage).
---

# Honest outcomes

The single idea behind MaSign's design: a contract reviewer must be able to
trust silence. Every mistake caught this sprint broke that in the same way —
an unusable result was shown as a clean one.

## The rules

1. **Verify against the text, or drop it.** A finding or key term must quote
   its passage verbatim (whitespace/quote-style normalised) or it does not
   exist. An answer must cite `[n]` that resolve to real passages, or it is
   `grounded: false` — shown, but flagged. Invented quotes are worse than no
   flag.
2. **Three outcomes, never two.** A model reply is: readable and complete
   (`checked: true, complete: true`); readable but partly unusable
   (`checked: true, complete: false` — show the verified part *and* say the
   rest was dropped); unusable (`checked: false` — "analysis unavailable").
   Never map "all findings rejected" to "no findings" (MAS-74). Never discard
   a cut-off reply's complete findings (MAS-80).
3. **Unavailable ≠ empty, in the UI too.** A category with no finding reads
   "Nothing found" only when the whole review completed; otherwise "Unable to
   determine" (MAS-87). A failed call keeps the good answer and says the risk
   part failed (MAS-76). Status pills and cards must agree with the warning
   above them.
4. **Withheld ≠ deleted.** When the guardrail withholds a passage, its number
   and source stay, the user is told which passage and why, and it is still
   listed for them to read (MAS-90). Silence about a refusal is a lie.
5. **Say what was and wasn't read.** Passages checked / total, review date and
   model, unreadable pages, references to documents not uploaded — coverage
   is part of the result (MAS-84). "Not stated in the reviewed text" is a
   value, not a blank (MAS-82).
6. **No fake precision.** No 0–100 risk score without a validated basis;
   "2 High, 3 Medium, review incomplete" is the honest form. Thresholds live
   in the rubric and are labelled "a first read, not legal advice".
7. **Errors carry the reason.** `detail` is a sentence the user can act on
   ("set ANTHROPIC_API_KEY", "Request body is not valid JSON."), toasts show it
   verbatim, and `/ready` names the failing dependency instead of saying ok.

## Checklist when adding a model-facing feature

- What does the response look like when the model reply is garbage? cut off?
  partly wrong? refused? empty because the text is silent? Each is a distinct,
  visible state with a test.
- Can a user tell "checked and clean" from "not checked" at a glance?
- Is every value one click from the text it came from (MAS-83)?
- Does the log line carry enough (contract_id, chunk_index, pattern/reason)
  to reconstruct the decision later?
