# Frontend Conventions

Decided 2026-09-14, before any UI code exists, so that MAS-17/MAS-18 and all
later UI work follow the same rules.

## Stack

- **React + Vite**, in `frontend/`, built to static files and served by the
  FastAPI app (so `docker compose up --build` still starts everything).
- **sonner** for toast notifications. Chosen over react-hot-toast for
  `toast.promise()` (loading → success/error in one call) and stacking.

## Toast rules (apply to every user action, now and in the future)

1. Every async user action (upload, ask a question, load list, delete) reports
   its outcome through a toast. Use `toast.promise()` so the loading state,
   success and error are wired together and can't drift apart.
2. **Error toasts show the API's actual `detail` message** from the error
   response body — never a generic "Something went wrong". This is why every
   API error path returns `{"detail": "<human-readable reason>"}` (400, 404,
   413, 415, 422, 503). If a response has no `detail`, fall back to the HTTP
   status text. Validation errors (422) follow the same contract: `detail` is
   one readable line such as `question: String should have at least 1
   character`; the structured per-field list is available under `errors` for
   inline form hints.
3. Success toasts only where the outcome isn't already obvious on screen.
   "contract.pdf uploaded — 12 chunks" is useful; "Answer ready" next to a
   rendered answer is noise.
4. One `<Toaster />` at the app root; call `toast` from wherever the API call
   is made (a small `api.ts` wrapper that unwraps `detail` keeps this uniform).

Backend implication: keep error `detail` strings user-readable, since they
are displayed verbatim.

## Layout (MAS-17)

`frontend/src/api.ts` is the only module that calls `fetch`: it turns any
non-2xx response into an `ApiError` whose message is the API's `detail` (or the
status text), which is what every toast shows. `UploadForm` wraps the upload
in `toast.promise` and hands the new contract to `App`, which keeps the
selected contract and reloads the list; `ContractList` renders and selects.
List loads are numbered and only the latest may set the list, so a slow
earlier response can never hide a newer one (MAS-66). Automatic loads (mount,
after upload) toast only on failure; the Refresh button runs in
`toast.promise` like every user action (MAS-68).

`QuestionPanel` (MAS-18) posts to `/api/query` scoped to the selected
contract or all contracts; the loading toast is dismissed on success because
the answer renders (rule 3), failures show the `detail`. `AnswerView` turns
each `[n]` in the answer into a button that highlights the cited passage,
shows an **Unverified** badge when `grounded` is false, renders "Not found in
contract." distinctly with the considered passages still listed, offers Copy
per citation ("Citation [n] copied"), and lists the risk flags (severity
colour, category, reason, quoted clause, `[n]` link that also opens the
collapsed passage list) and the suggested actions (MAS-15/16).
Build output (`frontend/dist`) is served by FastAPI from `/` when present
(`FRONTEND_DIST` overrides the path); without it `/` redirects to `/docs`.

## Look and feel (MAS-73, MAS-79, MAS-95)

**Light theme only** since MAS-95 (owner decision 2026-09-20; the MAS-79 navy
palette is in git history). Inter on a `#f4f6fa` ground with a faint cyan
wash and grid, white cards, the logo's cyan as the single accent: `#009fe3`
for fills and borders, `#0077b3` (4.6:1 on white) wherever it is text.
Status colours are the 700-weight shades (`--ok #047857`, `--warn #b45309`)
on 12 % tints; severity tags are white on solid red/amber/green. Every
colour is a `:root` token — no hard-coded dark values remain, and
`color-scheme: light` is set. The header shows the full logo inlined (`components/Wordmark.tsx`,
generated from `logo/MaSign_logo_BB.svg`) so the ink paths follow the theme
and no font is needed: every letter is an outline — the owner exported the
wordmark from Illustrator in Anurati, and the one letter Illustrator left as
live text (the S) was outlined with fontTools. `frontend/public/brand/` holds
the font-free colour and white versions for documents.
Two-column layout: a sticky sidebar and the main column, stacking under
960 px. Since MAS-104 the sidebar is the upload card (the dashed drop zone —
the owner kept it over a "+ New contract" button, 2026-09-21), a search box once there is more than one
contract, and one line per contract: file-type tag, name, and the review
state in words (Reviewed · High risk / Not reviewed / Reviewing… / Review
failed, `reviewStatus.ts`) — size, passage count and date moved to the
contract header. With no
contract selected the main column is a landing: headline, the question
composer (scope pills and Ask inside one bordered box), example questions
as chips and three feature tiles.

### Contract workspace tabs (MAS-95)

Selecting a contract replaces the landing with the contract header
(MAS-104: file name, type tag, size · passages · upload date, the
Reviewed / Not reviewed pill read from the contract list, the **Ask MaSign
about this contract** button that opens the Ask tab with the cursor in the
composer, and the Download links) and a tab bar (`components/Tabs.tsx`,
WAI-ARIA `tablist`/`tab`/`tabpanel`; arrow keys, Home and End move, only
the active tab is in the tab order):

- **Overview** — the summary strip, the coverage notice, the Key terms card
  and the Risk review (default).
- **Ask MaSign** — the composer, five suggested questions, and the answer
  with citations and per-question flags. Asking a question switches here.
  The suggestions (`src/suggestions.ts`, MAS-108) are a fixed Customer-side
  set ranked by the stored review — a term the review could not find first
  (the chip's title says the answer should say "not found"), then terms that
  deviate from the standard and categories with a High finding; without a
  finished review the base order shows. A click fills the composer and
  focuses it; Ask sends it — a chip never spends a call by itself. The chips
  go once an answer is shown and return when another contract is selected.
- **Contract text** — the passage reader, always expanded. "Show in
  contract" and passage links switch here with the passage highlighted.

Inactive panels stay mounted but `hidden`, so the answer, the draft and the
reader position survive a switch. The selection and tab live in the URL
hash as `#<contract_id>/<tab>`: a refresh or a pasted link restores both
(applied when the first contract list arrives; an unknown id is ignored).
Selecting a different contract resets to Overview and clears the answer
(MAS-86). The header has no "API docs" link any more; `/docs` still works.
The contract list uses amber **Partly reviewed** when the backend reports a
done but incomplete review; only complete clean reviews receive green.
Card titles are `white-space: nowrap` with `flex-wrap`, so a long status
pill drops under the title whole at phone width instead of breaking the
title.
Cards are `.card` (never bare `section`, so the toast container stays
invisible); section titles are small uppercase labels. The answer card
carries a status pill — green "Citations attached · n passages", amber "Unverified",
grey "Not in the text" — and citation cards with a numbered bubble.
Verified with headless-Edge screenshots at 1280 px and inside a 400 px
iframe (headless Edge clamps its own viewport to 492 px, so narrow widths
must be checked through an iframe).

## Overview (MAS-104)

`RiskReviewPanel` is the Overview: it loads and polls the stored review and
renders, top to bottom, `SummaryStrip`, `CoverageNotice`, `BriefCard`,
`KeyTermsCard` and the Risk review card. The strip is four tiles — Key terms `n of 10`,
Deviations `n`, Risks `2 High · 1 Medium` (or `None` only when the review
is complete), Coverage `n of m` passages read (+ withheld) — with "…" while
the review runs and "—" / "Not reviewed" before one exists, so the strip
never shows a zero that could read as "nothing wrong". Findings come first
in the Risk review, worst first, and the categories without a finding are
one muted line: "No issues found in the 5 other categories: …" when the
review is complete, "5 other categories: unable to determine — the review
did not cover every passage" when it is not, "… still being graded…" while
it runs. There are no green "Nothing found" cards.

### Getting around the workspace (MAS-124)

Selecting a contract moves focus to the contract heading (`tabIndex={-1}`,
no ring for mouse users, a ring under `:focus-visible`), so the keyboard
follows the selection; when `matchMedia('(max-width: 960px)')` matches — the
one-column layout, where the sidebar sits above the workspace — the heading
is also scrolled into view. On a wide screen the page deliberately does not
move: the workspace is already visible and a page that jumps under the mouse
is worse than one that stays still.

The heading spells the filename out over as many lines as it needs
(`overflow-wrap: anywhere`); truncation belongs in the sidebar row, where the
name is a label rather than the subject of the page.

The four summary tiles are buttons once there is a review to jump into: Key
terms and Deviations scroll to the key-terms card, Risks to the risk review,
Coverage to the coverage notice (opening its details) or to the review when
there is no notice. Each target card takes focus as well as the scroll. A
tile with nothing behind it yet stays plain text — a dead button is worse
than no button.

### What costs money (MAS-122)

`src/cost.ts` holds the estimates — `2 * ceil(chunks / 8)` for a review (one
call per batch of 8 for the risks, one for the key terms), 2 for a question —
so no number is written twice. Every paid control names its cost before it is
pressed: the review button reads "Review risks"/"Review again" with
"≈ 4 model calls" beside it and in its accessible name, and the composer
says "Each question uses about 2 model calls". **Review again** takes two
clicks: the first opens an amber confirm ("Run the review again? It grades all
12 passages from scratch and costs ≈ 4 model calls." / Yes, run it /
Cancel), because a second review re-spends what the first one cost; a first
review does not, since nothing has been paid for yet.

When the review cannot be **read** (any failure that is not 404), the panel
offers **Try again**, which re-reads and costs nothing — never the paid
button. A transient 503 must not be recoverable only by spending money. 404
still means "never reviewed" and offers the first, paid review.

### Document kind (MAS-107)

`kindBadge()` / `rubricMayNotApply()` in `reviewStatus.ts`. The contract
header gets a pill — grey *Commercial contract*, amber *Document type
uncertain* or *Likely not a contract — invoice* — whose tooltip is the
markers behind it; the sidebar row a small *Not a contract?* / *Type
uncertain* tag; a row not yet classified shows nothing. For the two
non-contract kinds the Overview opens with an amber note ("This file does
not look like a commercial contract — it reads like an invoice (Invoice
markers: …). The key terms and risk review below are graded with the
contract rubric and may not be meaningful here; you can still ask questions
about the text.") and the clean states stop reassuring: the Risks tile says
"rubric may not apply" in amber, the Before-you-sign pill reads *Rubric may
not apply* with "No contract risks or deviations were flagged — but this
file does not read as a commercial contract, so the rubric says little
about it", and the categories line ends "The rubric is written for
contracts, so this says little about this file." Nothing is hidden or
blocked.

### Before you sign (MAS-105/106/111)

`BriefCard` is derived by rule in `src/brief.ts` from the stored review — no
model call, so nothing can be invented. **In brief** is five facts (Term,
Cost, Renewal, Leaving, Risks), each with its passage link: "36 months from
1 March 2026, ending 28 Feb 2029", "Renews automatically … — notice by
30 Nov 2028 (90 days)", "2 High · 1 Medium: Liability cap, …"; an absent term
reads "not stated in the reviewed text" only after a complete key-terms
pass, "not checked" otherwise, and "nothing flagged in 7 categories" only for
a complete review. **Needs attention** is one checklist (so nothing is
listed twice): High/Medium findings ("Confirm Liability cap — reason"),
deviations ("Check late-payment interest — value — your standard"),
important terms not stated (effective date, recurring fee, initial term,
notice period, termination cost; with the "may be in Order Form" hint), the
notice deadline ("Diary …"), and an incomplete review ("2 passages were not
graded", with a link that opens the coverage details). Each item has a
session-local tick box; the pill counts what is left. A clean, complete
review reads "Nothing needs attention: …" — no score, no alarm. Low findings
stay in the Risk review. A running review shows "The summary appears when the
review finishes"; a failed one the failure, verbatim. Dates use the same
`30 Nov 2028` form as the deadline formulas, whatever the browser locale.

## Key terms (MAS-82)

`KeyTermsCard` renders above the Risk review from the same `RiskReview`
response (`key_terms`, `key_terms_complete`), so it shares the panel's load
and polling. Since MAS-104 only stated terms get a tile: name in small
caps, the value prominent, `passage n` link and the standard pill inline,
the verbatim quote under it, and for `conflicting` an amber tag plus "Also
stated in passage m" lines. The terms that are `not_stated` share one line
("Not stated in the reviewed text: One-off fees, Price changes") — only sent
when the pass completed — and `unchecked` terms another ("Not checked: …")
with an amber notice that some passages could not be checked — never
present absence as a fact the contract states. Pill: `n of 10 stated`
(green, `· k deviate(s)` amber), `n of 10 stated · partly checked` (amber)
or `Extracting…`.

### Download and print (MAS-97)

The contract header has plain `<a download>` links to
`/api/contracts/{id}/export.md` and `.csv` (the browser shows the download;
no toast) and a Print button (`window.print()`). `@media print` in
`index.css` hides the sidebar, tabs, composer, download links and action
buttons, forces the Overview panels visible in black on white, keeps
passage numbers as plain text, and breaks the page between cards.

### Deadlines (MAS-100)

A `Deadlines` strip under the key-term tiles (once the review is done): three tiles — Initial term ends · Give notice by · First renewal runs
to — with the date, the formula (`how`) and, on hover, the terms it was
computed from; a notice deadline within 90 days gets an amber "in n days"
pill, a past one "passed"; a tile that cannot be computed shows the reason.
Dates are compared at local midnight so "in 30 days" is exact.

### Standard verdicts (MAS-96)

A stated term with a standard shows a pill next to its passage link — green
"Meets standard", amber "Deviates" with the detail and the standard under
the quote, grey "Can't compare" when the value is text-only — from
`term.standard`; terms without a standard show nothing. The card pill adds
"· n deviate(s)" and turns amber when n > 0; the count is also the
Deviations tile of the summary strip.

## Coverage (MAS-84)

`CoverageNotice` (MAS-104) renders `review.coverage` once for the whole
Overview as one line. Since MAS-123 a document the contract refers to but
that nobody uploaded **leads** that line and turns the notice amber —
"Review may be incomplete — Service Level Schedule was referenced but not
uploaded" — because it is a hole in the review, not a footnote; the same
document also becomes a "Before you sign" item ("Get Service Level Schedule
before signing — referred to in passages 4, 8 but not uploaded"), once per
document however many passages name it. The notice stays quiet grey when the
only note is an unreadable page. In full, the line reads — "AI instructions detected · 1 passage withheld · 1
passage read in part · 2 passages not graded · part of the file not
readable · depends on Order Form (not uploaded) — View details" (amber
with a shield when the guardrail was involved, grey otherwise) — and the
`<details>` open to `CoverageNote`, the per-passage list: "Not reviewed:
<ingestion note>", "Not graded — … passages 5, 6", "Withheld from the
model — passage 12 …", "Depends on a document not uploaded: Order Form
(referred to in passage 2)". Every passage number is a link into the reader
(`onShowSource`, accessible name `Show passage n in contract`). The review
shows "Reviewed <date> by <model> · n of m passages graded"; the
"Not stated" line of the key terms adds "— may be in <document> (not
uploaded)"; the contract list shows a *Partly readable* badge whose title
is the ingestion notes.

## Contract text reader (MAS-83)

`PassageReader` (a collapsible `.card.reader` below the review) loads
`GET /api/contracts/{id}/passages` once per contract and renders every
passage. App holds a `SourceRef {chunk_index, quote?}`; `RiskReviewPanel`
and `KeyTermsCard` receive `onShowSource` and call it from the finding's
"Show in contract" button and the key term's passage link (accessible
names `Show <category> finding in contract`, `Show <term> in contract`). A
new target opens the reader, scrolls the passage into view, focuses it
(`tabIndex=-1`, `aria-current`) and wraps the quote in `<mark>` via
`findQuote` in `src/quote.tsx` (exact match, then whitespace/quote-style
tolerant). Selecting another contract clears the target. The answer view's
`[n]` markers keep their own in-card highlighting.

## Risk review (MAS-81)

Selecting a contract mounts `RiskReviewPanel` (keyed by contract id) which
reads `GET /api/contracts/{id}/risks` and, while the status is pending or
running, re-reads it every 2 s (`pollMs`, shortened in tests). It shows a
status pill (Reviewing… n/m passages · Reviewed · Partly reviewed · Review
failed · Not reviewed), each category's result or an explicit
unable-to-determine state, the findings with reason and quoted clause, and a
Review risks / Review again button that posts to `.../review` inside
`toast.promise` (rule 1). A failed review shows the API's `error` verbatim.
A temporary polling failure keeps the last progress visible, says
**Connection interrupted — retrying**, and retries with exponential backoff
capped at 30 seconds; only a 404 becomes Not reviewed.
When a review settles after being seen running, the panel calls `onSettled`
so the contract list refreshes its coloured dot (worst severity, pulsing
while running, green when reviewed clean).

## Query results

`blocked_passages` (MAS-90) names passages the prompt-injection guardrail
withheld from the model; the answer view shows an amber notice and tags those
passages "Withheld from the model" in the passage lists. `answer_status`
(MAS-93) is `answered`, `not_found` or `withheld`; the last means every
retrieved passage was withheld and the model was never asked — the view shows
an amber **Withheld** pill, "Could not answer" with the reason, opens the
passage list so the user reads it, and says "Risk check not run" instead of
"No risk flagged". With some passages withheld, "Not found" and "No risk
flagged" are qualified with "in the n of m passages the model could read"
(MAS-94). Withheld ≠ deleted, and withheld ≠ checked. `redacted_passages`
(MAS-99) are passages read minus their injected sentences: an amber
"Passage n contained instructions addressed to the AI: only those
sentences were withheld, the rest was read" notice, a *Sentences withheld*
tag on the passage, and in the Contract text reader the cut sentences are
wavy-underlined in red (`<mark class="withheld">`, from `withheld_spans`
on `/passages`) — together with the quote mark when both apply.


`POST /api/query` returns (MAS-12/13):

- `answer` — one to four sentences written only from the passages, with `[n]`
  markers, or exactly `Not found in contract.`, or the fixed withheld text.
- `answer_status` — `answered` | `not_found` | `withheld` (see above).
- `grounded` — false for "not found" and for an answer that cites nothing;
  show an "unverified" badge in that case rather than hiding the text.
- `citations` — `{label, chunk_id, contract_id, chunk_index, text, score}` for
  each `[n]` actually used, so the markers can link to the quoted passage.
- `answer_model` — which model wrote it (handy for the demo comparison).
- `risks` — rubric findings `{category, category_name, severity, reason,
  quote, label, chunk_id, contract_id, chunk_index}`, High first; `label` is
  the passage's `[n]` so the flag can link to it. `risks_checked` is false
  when the analysis could not run or none of its findings could be verified
  — say so, never show an empty "no risks". `risks_complete` is false when
  some findings were dropped, or when a passage was withheld and so never
  graded: show the verified ones with an "incomplete analysis" warning.
- `recommended_actions` — next steps derived from the findings.
- `retrieved_context` — every passage considered, best first, same shape
  minus `label`; `chunk_index` gives its position in the contract and `score`
  (cosine, 0–1) can drive a relevance hint.

`contract_id` is optional in the request — default the UI to the selected
contract, and offer "all contracts" explicitly. A 503 here carries the reason
(no API key, provider down, rate limit) in `detail` — show it verbatim.
