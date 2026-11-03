# Release readiness

## Status checked on 2026-11-02

No local tags were present after fetching origin. GitHub's releases endpoint
returned an empty list. No v1.0.0 tag or release was created in this task.

The final verification issues **MAS-19** (complete user journey) and **MAS-30**
(fresh Docker build) still read **In Progress**. Public presentation changes
do not resolve those acceptance criteria. The recorded 2026-09-30 demo is
historical evidence, not verification of every feature on current main.

## Gate before v1.0.0

- [ ] Merge the reviewed presentation branches into main.
- [ ] Select and record the exact release commit.
- [ ] Record passing backend, frontend, production build and lint checks on it.
- [ ] Complete MAS-30's fresh-clone Docker verification in an isolated stack.
  Follow the shared-container cautions in the project instructions; do not
  recreate the live stack from a story worktree.
- [ ] Complete MAS-19's browser/API journey and record remaining limitations.
  Any paid model verification requires a separate cost estimate and owner OK.
- [ ] Repeat the bounded secret scan on the chosen release commit.
- [ ] Check the setup instructions and screenshot date against that version.
- [ ] Confirm known limitations and evaluation sample sizes in release notes.
- [ ] Create an annotated v1.0.0 tag at the verified commit and publish release
  notes describing that version, with links to evidence.

## Draft release notes — not a published release

MaSign is an AI-assisted contract review application built with FastAPI,
PostgreSQL, Qdrant and React/Vite.

The release candidate supports contract upload, source-linked questions,
key-term extraction, risk review and explicit passage coverage. It also
includes explicitly linked contract bundles, configurable review standards,
stored results and review exports. Verify the final feature list against the
selected commit before publishing.

Answers that fail citation or detected-value checks are flagged as unverified.
Findings and key terms require source quotes. Neither these checks nor the
presence of a citation establishes legal correctness.

Known limits include no OCR for image-only PDFs, no signing or redlining,
pattern-based injection filtering, a small answer-evaluation sample and
authentication gaps described in the README. Upload reviews and questions can
send contract text to the configured paid provider.

Evidence to insert before publication: exact commit, CI run, MAS-19 and MAS-30
verification records, final scan result and release-specific known issues.
