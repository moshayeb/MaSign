# Handoff: MaSign — 2026-09-17 (Sprint 1 close)

## Goal
Finish Sprint 1 (Sep 14–18): fix what the owner and reviewers found, ship the
whole-contract risk review, deliver Homework 4 (LiteLLM prompt-injection
guardrail), and leave the project ready for a full walkthrough on Sep 18.

## Decisions made
- Whole-contract risk review runs after every upload (MAS-81) — the per-question
  flags alone read as "it doesn't analyse anything".
- Every model call goes through LiteLLM with a prompt-injection guardrail (MAS-90);
  a withheld passage is named to the user, never silently dropped.
- Product direction for Sprint 2 (reviewer + owner, see MAS-82/83/84): financial
  key terms with sources, click-to-source, explicit coverage. Risk score and
  suggested redlines postponed; missing-clause checklist is its own later story.
- Theme stays dark unless the owner says otherwise (reviewer prefers light).
- The five Homework-03 agent skills are adopted project-wide (MAS-72); see CLAUDE.md
  "Agent skills" for the two places they yield to project convention.

## Changes made
- Commits (branch → PR): MAS-79 ui-round-2 (merged #26), MAS-80 (merged #27),
  MAS-81 (merged #28), MAS-86/87 `MAS-86-ui-review-fixes`, MAS-33
  `MAS-33-secrets-check` (merged), MAS-88/89 `MAS-88-readiness-and-json-errors`,
  MAS-90 `MAS-90-litellm-injection-guardrail`, MAS-72 `MAS-72-agent-skills`.
- Tickets: MAS-22 Done (retrieval check 6/6); MAS-30, MAS-31 In Progress with
  first-run evidence, repeat in Sprint 3; MAS-74–81 Done; MAS-85 duplicate closed;
  MAS-86–90 In Progress until their PRs merge; MAS-82/83/84 backlog
  (`sprint-2-candidate`); all issues assigned to the owner.
- Docs: README (guardrail, security, endpoints), docs/architecture.md,
  docs/frontend.md, docs/risk-rubric.md, CLAUDE.md;
  `output/pdf/MaSign-prompt-injection-guardrail.pdf` (class handout, untracked).

## Open questions
- Light vs dark theme for the Sprint 2 UI reorganisation (owner's call).
- Whether to keep the guardrail deck builder as a permanent script under `scripts/`.
- `frontend/review-probe-8a32.test.tsx` (reviewer's untracked probe) fails by
  design after MAS-86/87 and should be deleted.

## Next steps
- Owner: merge MAS-86, MAS-88, MAS-90, MAS-72 PRs; `docker compose up -d --build`.
- Sep 18 walkthrough: follow the demo runbook (≈12–15 model calls); dedupe the
  contract list first (three `acme_vendor_agreement.txt`, two Northwind).
- Sprint 2 (Sep 21): start MAS-82 (key-terms card); then MAS-83, MAS-84; UX
  reorganisation ticket once the theme is decided.
- Sprint 3: repeat MAS-30 and MAS-31 on the tagged build; MAS-32 evaluation set
  (~50 paid calls — ask first).
