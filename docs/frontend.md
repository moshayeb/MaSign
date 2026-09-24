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

### The shell (MAS-125)

The permanent header carries the wordmark alone (height 26); the tagline it
used to repeat on every screen lives on the landing page, where it is a
claim rather than furniture. There is no header navigation yet.

**Public footer, redesigned (MAS-132, superseding the MAS-125/MAS-126 "no
links to pages that don't exist" scope cut for this specific set — owner
decision 2026-09-24: build the small set of pages the footer needs, not
omit the links).** `Footer` is a dark section (`#101417`) on the otherwise
light theme — MAS-95 still applies everywhere else; this is one scoped
component, not a palette change. Four columns on desktop, collapsing to two
then one under `src/index.css`'s `.sitefoot-grid` breakpoints (720px,
460px): brand + tagline + GitHub, then Product / Resources / Project, each
linking to a real destination — the workspace itself, a real GitHub URL, or
one of six new static pages under `src/pages/` (About, Privacy,
Documentation, How it works, What MaSign checks, Educational disclaimer).
`src/pages/index.ts`'s `PAGES` map names the six static information pages.
`main.tsx` maps `/` to `HomePage`, `/workspace` to the interactive `App`,
and those six paths to their static components. Links are ordinary `<a>`
links, so the server must also know these paths: `app/main.py` serves the
built `index.html` with **200** for `/workspace` and each public page before
mounting static assets. A copied `404.html` is not sufficient: it can render
the React shell but still reports a false 404 to the browser and monitoring.
The backend test covers every known public route.

Shared chrome (`PageChrome.tsx`: toaster, header, footer) wraps the home
page, workspace and static pages, so they read as one product. The header
has real links for How it works, What MaSign checks and Documentation, plus
an **Open workspace** CTA; on a phone they collapse into a keyboard-accessible
menu. `StaticPage.tsx` gives the static pages a narrow readable column
(`.staticpage`, max 720px) instead of the workspace's sidebar layout.
### Public home and workspace (MAS-133)

`/` is a small public home page: its purpose is to explain MaSign and lead a
visitor to `/workspace`, without loading contract data or inviting a paid
question immediately. It has one **Open workspace** CTA, a three-step
Upload → Review → Check sources explanation, and the cited answers / honest
unknowns / risk grading trust points.

Below those steps, the **Why MaSign** proof section (MAS-134) uses a warm
off-white ground with four white cards: Cited answers, Risk review, Key terms
and Honest unknowns. Its copy names only behaviour MaSign has today; it does
not make accuracy, speed, certification, customer-logo, pricing or
cross-document-review claims. The secondary **Open workspace** CTA links to
`/workspace`. The grid is four columns on desktop and one column at phone
width.

`/workspace` is the existing working area. Before a contract is selected it
leads with **Select a contract to get started**; the all-contract question
composer is an explicitly chosen secondary action. This keeps upload or
selection as the main first task. Old `/#<contract>/<tab>` bookmarks redirect
to `/workspace` while preserving their hash. If duplicate filenames appear
in the contract library, each duplicate gets its UTC upload date in the
stable `22 Sep` form; unique names stay compact.

A **future login page** exists as a design only, `src/pages/LoginPageDesign.tsx`
— two-column, a decorative illustration panel and a form panel, mobile shows
the form first (`order` in the `@media (max-width: 760px)` block; each panel
resets to `flex: none` there, not the desktop `flex: 1 1 50%`, or stacking
leaves large empty gaps — caught in a real mobile screenshot before this
shipped). It is deliberately **not** in `PAGES` and not imported by `App.tsx`
or `main.tsx` — no route renders it. Review it via a temporary `ui-preview`
screenshot, never a live URL.

The engineering-grid background is gone and the blue tint behind the page is
softer: the app should read as a legal workspace, not a developer tool.

A selected contract has **one** primary button, *Ask MaSign about this
contract*. Download Markdown, Download CSV and Print sit in an **Actions**
menu (a `<details>`, so it opens by keyboard and closes on Escape without
any focus-trap code). *Review again* deliberately stayed in the risk review
card: it belongs beside the review it re-runs, and moving it would mean
lifting the review state into `App` — structural work that belongs to
MAS-126. The third tab is **Sources** (the hash keeps the id `text`, so
older links still open it); the card inside it is still "Contract text".

The upload card keeps its rectangle (owner decision, twice) with less
padding and a smaller icon, so it sits quietly above the contract list.

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

### Timeline (MAS-100 dates, MAS-110 shape)

`components/Timeline.tsx` over `src/timeline.ts`, inside the Key terms card
(it replaced the flat deadlines strip: the same computed dates, read as a
sequence). The milestones run in the order the contract is lived — *Signed /
effective* (the `effective_date` key term, the only one with a passage link,
because the rest are arithmetic rather than quotes) → *Give notice by* →
*Initial term ends* → *First renewal runs to*.

A milestone that could not be established keeps its place in the line and
carries its reason, and the three reasons are kept apart: "not stated in the
reviewed text" (the pass completed and found nothing), "not checked" (it did
not complete, so absence proves nothing) and "stated, but not as a date the
text confirms" (quoted, but the verifier could not read a date out of the
quote). `buildTimeline` never invents a date, and when no date at all could
be established the card says so instead of drawing an empty line.

`standings()` compares at local midnight and marks what has passed, the first
milestone still ahead (`next`), and how many days away each one is; a notice
deadline within 90 days keeps MAS-100's amber "in n days". When every date is
in the past the card says that too. The formula (`how`) is the marker's
tooltip, worded as arithmetic over the key terms, not a quote.

Horizontal on laptop widths (markers on a rule), a left-hand rule with the
markers down it under 720 px — one component, one media query.

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
