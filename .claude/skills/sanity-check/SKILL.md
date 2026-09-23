---
name: sanity-check
description: Stop and prove that the current work still serves MaSign's promise and follows its own rules — grounded answers, asking before paid calls, honest outcomes, ticket flow, real progress, and the signed-off spec. Six questions, each answered in at most 80 characters of checkable evidence (a file, a MAS key, a count, a command's output), never an adjective. Trigger this when the user types /sanity-check, before claiming a ticket is done, before a demo or code freeze, when a session has run long or changed direction, when the same file has been edited several times without a test or behaviour change, and whenever the agent is about to say "everything looks good".
---

# Sanity check

A self-check that cannot fail is theatre. This one is built so that it can:
every answer must come from a command run **now**, and anything that cannot
be evidenced is `⚠️` — never `✅`.

## The rule for evidence

- **At most 80 characters.** Count them.
- It must be something a reader could go and verify: a path, `MAS-<n>`,
  a commit sha, a number from a command, an HTTP result.
- Adjectives are not evidence. "Looks fine", "all good", "should work",
  "no issues found" — these make the verdict `⚠️` by definition.
- Unknown is an answer. "Cannot tell: no run since 21 Sep" beats a guess.

## Gather first, judge second

Run these before writing a single verdict; quote their output, do not recall it.

```bash
git branch --show-current && git log --oneline -3
git status --short | grep -v '^??'
cd frontend && npx vitest run --exclude "**/review-probe-*" 2>&1 | tail -3
MASIGN_REQUIRE_DB=1 python -m pytest -q tests 2>&1 | tail -1   # when backend changed
curl -s -m 5 http://localhost:8000/api/contracts | head -c 200  # when a demo is near
```

Read the ticket the branch names (`getJiraIssue`) rather than trusting memory
of it.

## The six questions

| # | Question | `✅` needs | `⚠️`/`❌` when |
|---|---|---|---|
| 1 | **Big-picture goal** — does this work still serve grounded, cited contract analysis? | The change names the user-visible promise it serves | It only serves tidiness, or serves a goal nobody asked for |
| 2 | **api-spend-guard** — was the owner asked before any paid call? | Count of paid calls this session + where the OK is recorded | A call was made without a recorded yes, or the count is unknown |
| 3 | **honest-outcomes** — does any current state hide "unable to verify" behind "looks fine"? | The state that would be shown, named: file or test | A clean-looking state exists for an unchecked/failed path |
| 4 | **masign-ticket-flow** — is there a ticket, and do branch and commits follow `MAS-<n>-slug`? | The key, the branch name, the last commit's prefix | Work with no ticket, or a commit not starting with the key |
| 5 | **Stuck check** — real progress, or circling? | A commit, a test-count change, or a behaviour change since the last check | Same file edited 3+ times with no test or behaviour change and no commit |
| 6 | **Spec match** — does the implementation match the last signed-off spec? | The spec's location (ticket comment, owner message) and what differs | Scope grew or shrank with no new sign-off recorded |

Question 3 deserves the most care: it is MaSign's whole claim, and it is the
one a passing test suite does not cover. Ask it about what a user would see
**right now**, including the running stack, not only about the diff.

## Output

One line per question: number, verdict, evidence. Nothing else — no preamble,
no summary of the summary.

```
1 ✅  MAS-110 timeline: dates only from quoted terms, never invented
2 ✅  0 paid calls; 3 asks recorded in MAS-110 comment
...
```

Then, only if anything is `⚠️` or `❌`:

> **Next:** one sentence, one action — the single thing that most reduces the
> risk, named concretely enough to start immediately.

Not a list. If two things look equally urgent, pick the one that would be
worse to discover later, and say the other exists in the same sentence.

## What this command is not

It does not fix anything, does not start work, and does not spend money. It
reports. The user decides what to do with `⚠️`.
