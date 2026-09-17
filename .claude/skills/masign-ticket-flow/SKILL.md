---
name: masign-ticket-flow
description: How work moves through Jira (MAS), git branches, commits and PRs in MaSign, including the Jira-connector quirks and the owner's files that must never be staged. Trigger this whenever starting any piece of work, when the user says "go" or "what next", when the user pastes findings from Codex or another reviewer, when creating, editing, assigning or closing a Jira issue, when naming a branch, committing, pushing, or handing over a PR, and when the Jira connector times out.
---

# MaSign ticket flow

Evolved from the Homework-03 `ticket-git-workflow` skill (docs/agent-skills-hw03/)
with what this project actually taught. CLAUDE.md is the source of truth; this
skill is the procedure.

## Before any code

1. **Find or create the ticket.** JQL first (`project = MAS AND summary ~ "…"`);
   the connector duplicates on retry, so never create blind. A new ticket has:
   Goal · Acceptance criteria (checkable by running something) · Out of scope ·
   Notes. Put it in the current sprint (`customfield_10020`: Sprint 1 = 106; look
   the id up for later sprints) and assign it to the owner
   (`70121:68fe6fd6-b528-4a26-a9d4-f391eefb1673`).
2. **A reviewer finding is a ticket before it is a fix.** When the user pastes
   Codex/reviewer output, create one Bug per finding with label `review-finding`,
   the location, the chosen fix and a test plan — then fix. Findings the reviewer
   got wrong get a ticket too, closed with the reason.
3. **Transition to In Progress** (id 21) when starting; Done (31) only after the
   owner merges. "Verification-only" tickets (MAS-30/31 repeats) stay In
   Progress with an evidence comment.

## Branches, commits, PRs

- Branch per story: `MAS-<n>-short-slug`, from `main` (or from the branch it
  depends on — say so in the ticket comment). No `feature/` prefix.
- Commits start with the key(s): `MAS-86 MAS-87: …`. Small, scoped commits.
- Claude commits and pushes; **the owner opens and merges the PR**. Hand over
  the compare link, a PR title and a body that ends with `Closes MAS-<n>`.
- Merge order matters when branches stack; state it.

## Files that are the owner's — never stage them

`CLAUDE.md` (their "Project guide and logo" section), `.gitignore`,
`.dockerignore`, `AGENTS.md`, `docs/project-guide/`, `logo/`, `output/`,
`scripts/`, `tmp/`, and any reviewer probe file (`review-probe-*.test.tsx`,
`tmp/review-*`). Also `.env` (real keys — never print it; edit single lines
with `sed`), `.claude/settings.json`.

- Switching branches: `git stash push -- CLAUDE.md .gitignore .dockerignore`
  … `git stash pop`.
- Committing *your* paragraph of a file the owner has uncommitted edits in:
  build the blob from `git show HEAD:<file>` + your change, then
  `git update-index --cacheinfo 100644,<blob>,<file>`.
- `git add` specific paths only. Never `git add -A`.

## Jira connector behaviour (learned the hard way)

- A "timed out" / "transport dropped" reply usually means the write
  **succeeded server-side**. Before retrying any create or transition, read it
  back (JQL / getJiraIssue). Duplicates created this way get renamed
  `DUPLICATE of MAS-n`, label `duplicate`, and closed.
- Comments are the evidence record: branch, commit, what changed, how it was
  verified (test counts, live checks, screenshots), what is still open.
- Batch several connector calls in one turn; verify with one JQL at the end.

## Handing back to the user

End with: PR link(s) + title/body, ticket states, what needs their action
(merge, `docker compose up -d --build`, a decision), and the next candidate
story. If anything cost API calls, say how many (see `api-spend-guard`).
