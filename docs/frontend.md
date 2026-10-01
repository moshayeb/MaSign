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

A successful answer is stored server-side (MAS-102), never a refused
(`withheld`) one. Under the composer, `PreviousQuestions` lists this
contract's stored questions, newest first — each with when it was asked and
a status pill (Grounded / Unverified / Not found / Withheld) — plus any
no-scope ("all contracts") question whose answer actually cited this
contract. Clicking one renders it through the same `AnswerView` a live
answer uses, including citations and "Show in contract"; it never calls
`/api/query` again, since the whole response was stored. A "Forget" link per
entry deletes it. Asking a new question from the composer still calls the
API as normal and refreshes this list once answered, so the just-asked
question appears without a reload.
Build output (`frontend/dist`) is served by FastAPI from `/` when present
(`FRONTEND_DIST` overrides the path); without it `/` redirects to `/docs`.

## Look and feel (MAS-73, MAS-79, MAS-95, MAS-136)

**Light theme only** remains the rule from MAS-95 (owner decision 2026-09-20;
the MAS-79 navy palette is in git history). Its specific palette was
superseded by the owner-approved MassQL alignment in MAS-136 on 2026-09-24:
Inter uses a 16px base size; shared surfaces are white, `#f5f5f5`, and
`#f8f9fb`; borders are `#e8e8e8`; headings, body, secondary, and muted text
are `#111`, `#333`, `#555`, and `#777`. `#0caded` is used for cyan fills and
decorative emphasis, while `#087eac` is the readable cyan for interactive
text on white. Primary buttons hover to `#0a9fd8`; outlined controls use a
pale-cyan hover surface and cyan border; header links use a simple cyan text
hover. Status colours are the 700-weight shades (`--ok #047857`, `--warn
#b45309`) on 12 % tints; severity tags are white on solid red/amber/green.
Every shared colour is a `:root` token, and `color-scheme: light` is set. The
selected-contract workspace adds a scoped slate canvas (`#f5f8fb`) and white
dashboard surfaces in MAS-178. This does not alter the shared brand tokens,
Inter, the public pages, or the empty workspace. It adopts the owner-provided
workspace mockup's spacing, section hierarchy, subtle card lift and cyan
interaction cues while leaving out its simulated IDE chrome and unsupported
confidence/completion claims.
The header shows the full logo inlined (`components/Wordmark.tsx`,
generated from `logo/MaSign_logo_BB.svg`) so the ink paths follow the theme
and no font is needed: every letter is an outline — the owner exported the
wordmark from Illustrator in Anurati, and the one letter Illustrator left as
live text (the S) was outlined with fontTools. `frontend/public/brand/` holds
the font-free colour and white versions for documents.
Two-column layout: a sticky sidebar and the main column, becoming a mobile
drawer (MAS-126, see below) once a contract is selected and the layout is
one column. Since MAS-104 the sidebar is the upload card (the dashed drop
zone — the owner kept it over a "+ New contract" button, 2026-09-21), a
search box and a **Sort by** select (newest / highest risk / most
deviations, client-side — the list is small) once there is more than one
contract, and one line per contract: file-type tag, name, and the review
state in words (Reviewed · High risk / Not reviewed / Reviewing… / Review
failed, `reviewStatus.ts`) — size, passage count and date moved to the
contract header. Since MAS-101 a reviewed contract with something to add
gets a second, muted line under its name — recurring fee, initial term, High
findings and deviations from `GET /api/contracts` (`recurring_fee`,
`initial_term`, `high_findings`, `deviations`, all read from stored rows,
no model call), e.g. "EUR 18,500 per month · 36 months · 2 High ·
3 deviations", ellipsis at narrow widths. The line is omitted — not a
duplicate "Reviewed" — when the review found nothing beyond what the status
badge already says, or when there is no review yet (`ContractList.tsx`,
`summaryLine`).

**Fewer badges beside a name (MAS-126).** At most one small warning tag now,
not up to two: a document-kind mismatch (*Not a contract?* / *Type
uncertain*) wins over a readability note (*Partly readable*) when both would
otherwise apply, since the rubric possibly not applying at all is the more
consequential thing to flag (`ContractList.tsx`, `warningBadge`). Each row
also gets its own compact kebab menu (`.row-actions-menu`, hidden while
picking a compare pair) with **Export PDF/Markdown/CSV** and **Delete** —
export or remove a contract without opening it first. Delete is irreversible
(the contract's chunks, review, key terms, stored questions and links
cascade, and its vectors are removed from Qdrant, `DELETE
/api/contracts/{id}`), so it always confirms first (`.confirm-box`, the same
dialog pattern `ContractLinks.tsx` uses for linking); a delete that fails
leaves the dialog open with the API's `detail` in an error toast rather than
silently closing. Deleting the currently-selected, asked-about or
being-compared contract clears whichever of those pointed at it
(`App.tsx`'s `deleted` handler) before the list itself reloads.

### Contract workspace tabs (MAS-95)

Selecting a contract replaces the landing with the contract header
(MAS-104: file name, type tag, size · passages · upload date, the
Reviewed / Not reviewed pill read from the contract list, the **Ask a
question** button (its accessible name and tooltip still say "about this
contract") that opens the Ask tab with the cursor in the composer, and the
Download links) and a tab bar (`components/Tabs.tsx`,
WAI-ARIA `tablist`/`tab`/`tabpanel`; arrow keys, Home and End move, only
the active tab is in the tab order):

- **Overview** — the summary strip, the coverage notice, the off-rubric
  banner and "Before you sign" (default, all always visible), then "View
  complete analysis" (MAS-126) folding the full Key terms card and Risk
  review behind one click.
- **Ask MaSign** — the composer, five suggested questions, and the answer
  with citations and per-question flags. Asking a question switches here.
  The suggestions (`src/suggestions.ts`, MAS-108) are a fixed Customer-side
  set ranked by the stored review — a term the review could not find first
  (the chip's title says the answer should say "not found"), then terms that
  deviate from the standard and categories with a High finding; without a
  finished review the base order shows. A click fills the composer and
  focuses it; Ask sends it — a chip never spends a call by itself. The chips
  go once an answer is shown and return when another contract is selected.
- **Invoices** (MAS-92) — `components/InvoiceCheckPanel.tsx`: a dropzone that
  accepts a digital PDF invoice only (`accept=".pdf"`), and the contract's
  past invoice checks, newest first. Each check lists its compared items —
  fee amount, payment deadline, late-payment rate — with a status pill
  (`match` green, `possible_mismatch` amber, `cannot_verify` grey, the same
  `.status .ok/.warn/.none` vocabulary as key terms) and both sides' verbatim
  quote as a `.term-quote` blockquote: the invoice's (with its page number)
  and the contract's (a "passage N" button that opens Sources through the
  same `onShowSource`/`SourceRef` mechanism as risk findings and key terms,
  naming the linked document when the passage comes from one). A check whose
  invoice could not be read at all (`checked: false`) shows a warning banner
  instead of any item looking clean. Uploading shows a loading toast, then a
  success toast with the match/possible-mismatch/cannot-verify counts, or the
  API's `detail` verbatim on failure (415 non-PDF, 422 unreadable/scanned).
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

## Overview (MAS-104, progressive disclosure MAS-126)

`RiskReviewPanel` is the Overview: it loads and polls the stored review and
renders `SummaryStrip`, the off-rubric banner, `CoverageNotice`, `ContractLinks`
and `BriefCard` ("Before you sign") always visible, then a `<details
className="overview-detail">` — **"View complete analysis"**, closed by
default — holding the full `KeyTermsCard` and the complete Risk review
(every finding, every category, however clean). The strip is four tiles —
Key terms `n of 10`, Deviations `n`, Risks `2 High · 1 Medium` (or `None`
only when the review is complete), Coverage `n of m` passages read (+
withheld) — with "…" while the review runs and "—" / "Not reviewed" before
one exists, so the strip never shows a zero that could read as "nothing
wrong".

**The hard constraint (stated in the MAS-126 ticket itself): progressive
disclosure hides detail, never a reason to doubt the review.** Nothing that
was already always-visible moved behind the fold — `BriefCard`'s checklist
(`brief.ts`, MAS-105/106/111) already covered exactly this ground (High/Medium
findings, standard deviations, missing important terms, the notice deadline,
an incomplete review) before this ticket existed, so the fold only ever hides
what BriefCard already doesn't need to repeat: Low-severity findings, the
clean-categories line, and every extracted key term's full quote. Missing
documents (MAS-123), incomplete coverage (MAS-84/87/94), withheld/redacted
passages (MAS-90/99) and rubric limitations (MAS-107) all still render
outside the fold exactly as before — `Review.test.tsx`'s "progressive
disclosure never hides a reason to doubt the review" test asserts this
directly (`toBeVisible()`/`not.toBeVisible()`, not just presence in the DOM,
since jsdom does not hide a closed `<details>`'s content on its own the way a
browser does — `@testing-library/jest-dom`'s `toBeVisible()` has its own
`<details>`-awareness for exactly this reason).

Inside the fold: findings come first, worst first, and the categories
without a finding are one muted line: "No issues found in the 5 other
categories: …" when the review is complete, "5 other categories: unable to
determine — the review did not cover every passage" when it is not, "…
still being graded…" while it runs. There are no green "Nothing found"
cards. A `SummaryStrip` tile whose target lives behind the fold (`key-terms`,
`review`) opens it before scrolling and focusing the target
(`RiskReviewPanel.tsx`'s `jumpTo`); `coverage` still opens `CoverageNotice`'s
own `<details>` directly, unaffected, since that was never behind the fold
to begin with.

MAS-176 refines the Overview's spacing and evidence hierarchy using the
existing Inter font and MassQL-aligned light tokens. Each finding is an
individual `<details>` card: the closed row shows its severity, category and
reason; opening it reveals the stored verbatim quote, source document/passage
and an **Open source passage** action. The source still opens the existing
Sources tab and retains the return path. The complete-analysis fold continues
to contain all findings and key terms, while High/Medium risks and every
reason to doubt the review remain visible above it. The mockup's confidence
percentages, PDF-page labels and "Complete Review" action are deliberately
absent because MaSign does not produce those results.

MAS-178 makes the mockup adaptation visible on the initial Overview: a
document-context header with the real file status and existing actions, a
"Review overview" introduction, four metric cards with meaning-specific
icons, and a two-column "Before you sign" card. Source passage actions use
compact cyan chips. Facts and items needing attention stack at narrower widths.
The cards still show only stored review
counts; no decorative progress bar suggests a success percentage. Coverage
warnings, linked-document actions, failed/partial/off-rubric states and the
review-again cost confirmation retain their established behavior and
prominence. The existing Ask and Sources tabs remain the navigation model;
the side-by-side source view is a separate backlog item (MAS-177).

MAS-177 adds that side-by-side view, but only on wide screens: `useIsWide.ts`
tracks a `(max-width: 960px)` media query (the same breakpoint the MAS-126
mobile drawer uses) and `App.tsx`'s `showSource` branches on it. At >= 960px,
a citation (an answer's `[n]`, a risk finding, a key term, an invoice check,
coverage, timeline — every existing `onShowSource` call site) opens
`SourcePanel.tsx`, a slide-in panel fixed to the right edge of the viewport
containing the same `PassageReader` the Sources tab uses, scrolled and
focused to the target passage. It is deliberately not a modal: there is no
backdrop and no focus trap, so the tab underneath stays mounted, visible and
scrollable the whole time — only Escape or the panel's own close button
dismiss it, and closing returns focus to whichever citation opened it.
Below 960px the panel never renders at all; `showSource` falls back to the
pre-MAS-177 tab-switch (Sources tab + "← Back" link, MAS-109) unchanged, so
narrow screens and the Sources tab's own deep links (`#id/text`) keep working
exactly as before. Because the Sources tab's own `PassageReader` stays
mounted (just hidden) while the panel is open, both instances would render
identical `passage-N` ids for the same contract; `PassageReader` takes an
`idPrefix` prop (`"panel-"` for `SourcePanel`, unprefixed for the Sources
tab) so the one target-scrolling effect that uses `document.getElementById`
resolves the instance actually on screen, not whichever is first in the DOM.

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
The active page gets a `.active`/`aria-current="page"` highlight in both the
desktop nav and the phone menu (MAS-142).

### Public content pages (MAS-142)

How it works has its own walkthrough layout. What MaSign checks and
Documentation use the shared `PublicPage.tsx` layout (`.pubpage`): a hero
(eyebrow, `<h1>`, subtitle, optional CTA) over card-grid sections
(`.pubpage-grid-3`, `.pubpage-card`, `.pubpage-icon`). These pages share the
home page's cyan palette and line icons while keeping their own CSS classes.
`About`, `Privacy`
and the educational disclaimer stay on `StaticPage`: each is a single
statement to read top to bottom, not a set of distinct facts to scan.

- **How it works** collapses to the three steps the ticket names — Upload,
  Review, Check sources — folding "ask a question" into "check sources"
  rather than keeping it a fourth step, plus a callout repeating the
  honest-unknowns behaviour ("Not found in contract.").
- **What MaSign checks** renders all seven `RISK_CATEGORIES`
  (`app/risk_analysis/rubric.py`) as cards, the ten `KEY_TERMS`
  (`app/key_terms/terms.py`) as a plain list, and a four-item legend for
  High / Medium / Low / Not checked (`.pubpage-legend`). MAS-180 gives those
  four public legend labels soft tinted backgrounds, dark text and a clear
  pill shape, without changing workspace finding badges. Category and term
  names and wording are read
  straight from those two modules' definitions, not restated from memory,
  so the page cannot drift from what the model is actually asked to find.
- **Documentation** keeps the real README/`docs/` GitHub links and adds two
  in-app cross-links (How it works, What MaSign checks) as the third
  "resource" alongside the technical docs.

MAS-179 gives What MaSign checks and Documentation a full-width pale cyan
hero, the same Inter heading scale and section rhythm as How it works, and
more spacious responsive cards. The homepage eyebrow is deliberately smaller
than its headline; the headline keeps the same Inter family as the rest of
MaSign, with tighter spacing and a cyan emphasis on “before you sign.” The
copy now describes ten key terms and avoids implying that every term or
finding is always found. The footer and legal pages remain unchanged.

### Public home and workspace (MAS-133)

`/` is a small public home page: its purpose is to explain MaSign and lead a
visitor to `/workspace`, without loading contract data or inviting a paid
question immediately. It has one **Open workspace** CTA, a three-step
Upload → Review → Check sources explanation, and the cited answers / honest
unknowns / risk grading trust points.

MAS-135 made the home page calmer and easier to read with a pale-cyan hero
surface, dark navy headings and readable dark-grey body text. The hero says **Understand your
contract before you sign** and explains the three concrete things MaSign does:
find terms, review possible risks, and open the source text. The Why MaSign
section uses four white cards: Cited answers, Risk review, Key terms and
Honest unknowns, led by **A clear first read of your contract, with sources
you can open.** Its copy names only behaviour MaSign has today; it does not
make accuracy, speed, certification, customer-logo, pricing or
cross-document-review claims. The secondary **Open workspace** CTA links to
`/workspace`. The grid is four columns on desktop and one column at phone
width.

### Home page hero mockup and expanded sections (MAS-147)

The hero became two columns (`.home-hero-row`, single column again under
860px): an eyebrow badge, the headline, a primary **Open workspace** CTA
plus a new secondary **See how it works** CTA (→ `/how-it-works`), a
static product-screenshot
mockup (`HeroMockup` in `HomePage.tsx`). The mockup is `aria-hidden` and
built from the app's own classes (`.filetype`, `.risks`/`li.risk`,
`.severity`, `.status`) with content grounded in real behaviour rather than
invented: the coverage notice repeats `CoverageNotice.tsx`'s exact copy
("AI instructions detected · 1 passage withheld"), the findings use real
rubric categories and severity thresholds, and "Deviates" is
`KeyTermsCard.tsx`'s real standard-comparison status. MAS-172 removes the
file-format line and illustration caption at the owner's request; the mockup
remains a static illustration. `.home-cta` got real button styling to match the new
secondary CTA sitting next to it (previously `.primary` only styled
`<button>`, so the link-only "Open workspace" CTA looked unstyled next to a
real button once the two sat side by side).

"How MaSign works" replaced the old top-left number badge with a numbered
circle icon per step and arrow connectors between cards (`.home-steps-row`,
rotates 90° and stacks under 720px). The "Why MaSign" cards are now real
links to `/how-it-works` or `/what-masign-checks` with a chevron affordance,
instead of static `<article>`s. A new "Clear expectations" section
(`.home-expectations`) states three things plainly: MaSign assists rather
than replaces a lawyer (already stated on `/about`), AI findings need
verifying against their source passage, and contract text relevant to a
question or review is sent to the configured AI provider — the last one is
the CLAUDE.md LLM-decision architecture, not a new promise; it does not
claim anything about a provider's training/retention policy the codebase
cannot verify.

### Home page hierarchy (MAS-171)

The home page has one proof section: the four linked **Why MaSign** cards.
The earlier three-item cyan trust strip repeated those same claims and was
removed. The resulting sequence is hero and product illustration, three
steps, Why MaSign, Clear expectations, then the final CTA. The linked proof
cards have the restrained cyan border, shadow and lift treatment on pointer
hover and keyboard focus; static informational cards remain still so they do
not look clickable.

The page ends, before the existing footer, with `.home-final-cta`: **Ready to
review a contract?** and an **Open workspace** link. It contains no speed,
accuracy, legal-advice, or security claim. The layout stacks without horizontal
scrolling under 720px and makes no request to the API or a model.

### Homepage visual refinement (MAS-174)

The supplied Gemini HTML is a visual reference, not an application template.
The React homepage keeps MaSign's Inter font, original logo, uppercase hero
headline, working routes and shared legal notice. The hero has more breathing
room and a quiet cyan glow behind the static workspace preview. A pale section
separates the three steps, followed by a white Why MaSign section with linked
cards. Copy describes cited results and incomplete analysis without promising
that every answer is grounded or every review completes. The layout retains
visible keyboard focus and stacks at 400px; reduced-motion users do not get
the link lift effect.

### Homepage motion and spacing (MAS-175)

The owner's light premium reference informs homepage-only spacing, soft cyan
decoration and motion. The hero and illustrative workspace preview rise in
briefly on load. Workspace calls to action and linked Why MaSign cards respond
to hover with a small lift. The three How MaSign works cards use numbered
cyan gradient squares, uppercase headings, and a stronger hover lift; the
expectation cards remain still.
At `prefers-reduced-motion: reduce`, these entrance and hover animations are
disabled. The homepage uses the existing Inter font and MassQL-aligned cyan
tokens; the footer and shared workspace styles are unchanged.

The owner-provided hero element is the visual reference for the three-line,
sentence-case headline and cyan underline, pill label, paired calls to action,
and floating workspace card. The card shows a file header, key-term rows and
two risk findings as a static illustration; it does not display real contract
data or offer working source links. The two columns stack at phone widths.
The Why MaSign reference also sets four pale feature cards with white icon
tiles and a small cyan hover lift (two columns at tablet width), followed by
the pale Clear expectations panel with three text columns. Existing feature
links, the secondary workspace CTA, and cautious product wording remain.

### Shared visual system (MAS-136)

MaSign now shares MassQL's light brand direction: `#0caded` is the cyan used
for fills and decorative emphasis; `#087eac` is the darker companion used for
interactive text on white. Shared surfaces are white, `#f5f5f5`, and
`#f8f9fb`, with `#e8e8e8` borders. Inter is the shared `16px` base typeface;
headings use `#111`, body text `#333`, secondary text `#555`, and muted text
`#777`. Hover states follow the same system: cyan buttons use `#0a9fd8`,
outlined controls use a pale-cyan surface and cyan border, and public proof
cards lift slightly with a cyan border and soft cyan shadow. Risk and status
colours retain their existing meanings.

`/workspace` is the existing working area. Before a contract is selected it
leads with **Select a contract to get started**; the all-contract question
composer is an explicitly chosen secondary action. This keeps upload or
selection as the main first task. Old `/#<contract>/<tab>` bookmarks redirect
to `/workspace` while preserving their hash. If duplicate filenames appear
in the contract library, each duplicate gets its UTC upload date in the
stable `22 Sep` form; unique names stay compact.

**`/login`** (`src/pages/LoginPage.tsx`, wired to real accounts MAS-143) is the
MAS-132 design made real: two-column, a decorative illustration panel and a
form panel, mobile shows the form first (`order` in the `@media (max-width:
760px)` block; each panel resets to `flex: none` there, not the desktop
`flex: 1 1 50%`, or stacking leaves large empty gaps — caught in a real
mobile screenshot before this shipped). A link at the bottom toggles between
sign-in and account creation in place, rather than a second page — there is
no separate `/register` route. `/workspace` (`App.tsx`) checks `GET
/api/auth/me` on mount and redirects here when it 401s; a signed-in visitor's
email and a **Log out** control replace the header's "Open workspace" CTA
(`PageChrome`'s `authControl` prop).

The engineering-grid background is gone and the blue tint behind the page is
softer: the app should read as a legal workspace, not a developer tool.

A selected contract has **one** primary button, *Ask a question*. Its
accessible name and tooltip say that it is about the selected contract.
Its compact icon **Actions** trigger opens a vertical, labelled menu:
**Review risks**/**Review again** (MAS-126, when it applies — see below),
**Export PDF**, **Export Markdown**, **Export CSV**, and **Print review**.
Each row has a matching icon and separator, so the action remains clear
without a large permanent control (a `<details>`, so it opens by keyboard
and closes on Escape without any focus-trap code). Review again finally
moved here in MAS-126, once the review state it needs was already lifted
into `App` (MAS-108, for the Ask-tab suggestions) — the remaining work was
an imperative handle (`RiskReviewPanelHandle.reviewAgain`) so the menu can
trigger it while `RiskReviewPanel` keeps owning the confirm-before-re-spend
banner and the actual start/poll logic; the menu item itself is computed by
the panel (`onReviewAction`) and hidden under exactly the same conditions
the old inline button was (loading, unavailable, running, or already
mid-confirm). The third tab is **Sources** (the hash keeps the id `text`, so
older links still open it); the card inside it is still "Contract text".

The upload card keeps its rectangle (owner decision, twice) with less
padding and a smaller icon, so it sits quietly above the contract list.

### Getting around the workspace (MAS-124)

Selecting a contract moves focus to the contract heading (`tabIndex={-1}`,
no ring for mouse users, a ring under `:focus-visible`), so the keyboard
follows the selection; when `matchMedia('(max-width: 960px)')` matches — the
one-column layout, where the sidebar is now a drawer once a contract is
selected (MAS-126, below) rather than stacking above the workspace — the
heading is also scrolled into view. On a wide screen the page deliberately
does not move: the workspace is already visible and a page that jumps under
the mouse is worse than one that stays still.

The heading spells the filename out over as many lines as it needs
(`overflow-wrap: anywhere`); truncation belongs in the sidebar row, where the
name is a label rather than the subject of the page.

The four summary tiles are buttons once there is a review to jump into: Key
terms and Deviations scroll to the key-terms card (opening "View complete
analysis", MAS-126), Risks to the risk review (same fold), Coverage to the
coverage notice (opening its own, separate `<details>`) or to the review
when there is no notice. Each target card takes focus as well as the scroll.
A tile with nothing behind it yet stays plain text — a dead button is worse
than no button.

### Mobile drawer (MAS-126)

Under 960px, once a contract is selected, `.layout` carries `has-selection`
and the sidebar (upload card + contract list) leaves the document flow
entirely — `position: fixed`, translated off-canvas — instead of stacking
above the workspace and pushing a full screen's height of contract-list
scrolling between the reader and what they came here for. A **Contracts**
toggle (`.drawer-toggle`, itself `display: none` outside this breakpoint)
opens it; a close button inside the sidebar and a full-screen backdrop
(`.drawer-backdrop`, click-to-close, `aria-hidden` — the dedicated close
button is the keyboard path) both close it, and so does picking a different
contract from inside it (`App.tsx`'s `select`). All of this is CSS-inert at
desktop widths and before any contract is selected: `.layout` only ever
carries `has-selection`/`drawer-open` once `App` has something to hand off
to it, so nothing about the desktop two-column layout changed. Verified with
a headless-Edge screenshot inside a 400px iframe: closed state shows the
toggle above the workspace, open state shows the sidebar overlay with a
backdrop and the workspace still visible (dimmed) behind it, no horizontal
scrollbar either way. The MAS-104 heading-focus effect used to also
`scrollIntoView` on a phone, from when the sidebar stacked above the
workspace and was worth scrolling past; the drawer redesign left only the
compact toggle there, so that scroll was removed — it was hiding the toggle
off the top of the screen for nothing (`App.tsx`, the `focused` effect).

### What costs money (MAS-122)

`src/cost.ts` holds the estimates — `2 * ceil(chunks / 8)` for a review (one
call per batch of 8 for the risks, one for the key terms), 2 for a question —
so no number is written twice. Every paid control names its cost before it is
pressed: the Actions menu's **Review risks**/**Review again** item (MAS-126)
reads "≈ 4 model calls" beside it and in its accessible name, and the
composer says "Each question uses about 2 model calls". **Review again**
takes two clicks: the first opens an amber confirm ("Run the review again? It grades all
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
caps, the value prominent, a `passage n` link and the standard pill inline.
The selected contract is already named in the workspace header, so its tiles
show only the passage. A linked-document source keeps its filename (clipped
visually if needed, with the full name in its tooltip and accessible name),
then its passage number. This preserves bundle provenance without overflowing
the tile. The verbatim quote sits beneath it; `conflicting` terms add an amber
tag plus "Also stated in passage m" lines. The terms that are `not_stated` share one line
("Not stated in the reviewed text: One-off fees, Price changes") — only sent
when the pass completed — and `unchecked` terms another ("Not checked: …")
with an amber notice that some passages could not be checked — never
present absence as a fact the contract states. Pill: `n of 10 stated`
(green, `· k deviate(s)` amber), `n of 10 stated · partly checked` (amber)
or `Extracting…`.

### Download and print (MAS-97, MAS-191)

The contract header has plain `<a download>` links to
`/api/contracts/{id}/export.pdf`, `.docx`, `.md`, `.csv` and `.xlsx` (the
browser shows the download; no toast), in that order in the Actions menu
(PDF/DOCX as the two document formats, Markdown between them for the plain-text
reader, CSV/XLSX as the two tabular formats), and a Print button
(`window.print()`). `@media print` in `index.css` hides the sidebar, tabs,
composer, download links and action buttons, forces the Overview panels
visible in black on white, keeps passage numbers as plain text, and breaks
the page between cards. The Markdown (and so also the PDF and DOCX, which
both render from it, MAS-191) export includes a "Questions asked" section
listing this contract's stored question history (MAS-102), each with its
answer; the CSV and XLSX exports (which share one row-building function,
MAS-191) do not — same split as before, just two more formats on each side.

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

### Editable standards (MAS-120)

"Comparison rules" in the sidebar footer (`App.tsx`, below the contract
list) opens `/standards` (`pages/Standards.tsx`, registered in `pages/index.ts`
like the public static pages, but reached from the workspace rather than the
footer). The page is titled "Contract comparison rules" to reflect its four
fixed numeric comparisons, scoped to the signed-in workspace (MAS-181). It
states that edits immediately update existing Overview verdicts, checklists
and exports without re-reading the contract or calling AI; unverifiable values
remain "Can't compare". A two-column desktop grid becomes one column on
phones. Each card shows the saved rule separately from editable values, an
example verdict calculated from the draft, and an unsaved-change indicator.
One `.card` per standard (`GET /api/standards`): the current text,
a "MaSign default" / "Customised" pill, a small form matched to that term's
shape (a days number for payment deadline/notice period, a percent for late
payment, a mode selector plus the matching field for termination cost —
no-fee / percent-of-remaining-fees / a fixed amount in USD, EUR or SEK), and
a "Restore MaSign's default" link, disabled once the standard already is the
default. Saving (`PUT`) or resetting (`DELETE`) replaces just that card's row
in local state from the response — no full reload — and remounts that card's
form so its inputs match the saved value. Save is disabled for unchanged
values. A failed initial load shows the API reason and a Try again button
rather than an indefinite loading message; a missing session links to Sign in
instead. A save the API
rejects (422) is never applied: the card keeps showing its last-saved value
and the toast carries the API's `detail` verbatim, same as every other error
toast. Saving takes effect immediately everywhere a standard verdict is
shown (Overview, key terms, export) with no re-review, since the comparison
is rule-based, not a model call.

### Named standard profiles (MAS-185)

Above the standards grid, a `role="tablist"` bar lists every named profile
in the workspace as a pill (`listStandardProfiles`), the selected one
highlighted, plus a "+ New profile" link. Selecting a profile reloads the
grid below from `GET /standard-profiles/{id}/standards` instead of the plain
`/api/standards`; saving/resetting a card now calls the profile-scoped
`PUT`/`DELETE /standard-profiles/{id}/standards/{term_id}`. Below the tabs,
a "Rename" link always shows for the selected profile; "Make this the
workspace default" and "Delete profile" show only for a non-default one —
the one `is_default` profile can't be deleted (the API 400s; the button is
simply absent rather than present-and-failing). Create, rename and delete
are all inline styled forms, not a native browser dialog (MAS-186, fixed the
same day it shipped: MaSign has no `window.prompt`/`window.confirm` anywhere
else, and one briefly slipped in here) — the same `.standard-input` field
the four standard cards already use, a Create/Save/Yes-delete button, and a
Cancel link. Deleting is a two-step inline confirm, swapping the action row
for the warning text (*"Contracts using it fall back to the workspace
default"*) plus Yes/Cancel, since it is the one action here that affects
contracts the user isn't currently looking at.

A contract's own assignment lives on its Overview tab: `KeyTermsCard`'s
`StandardProfilePicker` is a `<select>` next to the "Key terms" heading
(`"Workspace default"` plus every named profile) that only renders once a
workspace has created a second profile — a workspace that never used this
feature sees no new control at all. Changing it (`PUT /contracts/{id}/
standard-profile`) re-reads that contract's review and tells the parent
panel to refresh the contract list, so the Overview's deviation count and
the sidebar row's badge update together, same as a direct standards edit —
still no re-review, no model call.

## Coverage (MAS-84)

`CoverageNotice` (MAS-104) renders `review.coverage` once for the whole
Overview as one line. Since MAS-139 this is bundle-aware: every coverage
location names its source document as well as its passage number, because each
linked document starts again at passage 1. A named reference only counts as
resolved after the user created an explicit contract link; it then appears as
"Statement of Work — linked: sow-final.docx". Since MAS-123 a document the contract refers to but
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
(referred to in passage 2)". A passage in the primary contract remains a link
into the reader (`onShowSource`, accessible name `Show passage n in contract`).
A source location from a linked document includes its document id, so selecting
it opens that document in the multi-document reader.
The review
shows "Reviewed <date> by <model> · n of m passages graded"; the
"Not stated" line of the key terms adds "— may be in <document> (not
uploaded)"; the contract list shows a *Partly readable* badge whose title
is the ingestion notes.

## Contract text reader (MAS-83)

For a contract bundle (MAS-140), the reader offers a document tab for the
primary agreement and each explicitly linked document. Linking is always a
confirmed action: a reviewer can choose an uploaded file or upload one from
the unresolved-reference warning, then confirm the exact reference name.
Choosing a file does not link it by itself; the confirmation names both the
reference and selected document. Either document can unlink the relationship.
A new upload states that its normal review will run and uses the usual upload
toast/error behaviour. Unlinking changes the primary contract's review to an
honest "review again" state, because any earlier result may have used the
removed document.

`PassageReader` (a collapsible `.card.reader` below the review) loads
`GET /api/contracts/{id}/passages` once per contract and renders every
passage. App holds a `SourceRef {chunk_index, quote?}`; `RiskReviewPanel`,
`KeyTermsCard`, `CoverageNote`, `Timeline` and `AnswerView` all receive
`onShowSource` and call it from a "Show in contract" button (accessible
names `Show <category> finding in contract`, `Show <term> in contract`,
`Show citation <n> in contract`, and so on). A new target opens the reader,
scrolls the passage into view, focuses it (`tabIndex=-1`, `aria-current`)
and wraps the quote in `<mark>` via `findQuote` in `src/quote.tsx` (exact
match, then whitespace/quote-style tolerant) — so two different citations
onto different passages/quotes stay visually distinguishable, one at a
time. Selecting another contract clears the target. The answer view's own
`[n]` markers still jump within the Ask tab to the citation card first
(MAS-83's original in-card highlighting); the citation card's own "Show in
contract" button is what opens the actual contract text (MAS-109).

Since MAS-109, App also remembers which tab (Overview or Ask MaSign) a
source click came from (`returnTab`) and the Sources tab shows a "← Back
to Overview"/"← Back to Ask MaSign" link above the reader so the click is
not a one-way trip. Any tab change made directly — clicking a tab, the
header's "Ask a question" CTA, selecting a different contract — retires
that link; only a `showSource` call sets it, and only when the click did
not originate from the Sources tab itself.

## Compare two contracts (MAS-113)

The sidebar's "Compare" button (shown once 2+ contracts exist) puts
`ContractList` into a picking mode: a status bar reads "Select two contracts
to compare · n of 2", each row becomes a checkbox-style toggle instead of a
select action, and a second click on an already-picked row drops it and frees
the slot. Picking a second contract closes picking mode automatically and
replaces the main column with `CompareView`; "Cancel" (while picking) or
"Exit comparison" (once shown) both return to normal browsing. Selecting a
different contract elsewhere resets any in-progress or completed comparison.

`CompareView` fetches each side's `GET /api/contracts/{id}/risks`
independently (`useReview`, a small hook wrapping the same review states
`RiskReviewPanel` uses) and renders two tables as CSS grid rows shared across
a fixed 3-column layout (label, side A, side B): key terms (union of both
sides' terms, side A's order first) and the seven rubric categories in rubric
order. Every cell states what that side actually has and nothing else:
**Not reviewed** (no review has ever run), **Not checked** (reviewed, this
key term's extraction pass did not cover it), **Not stated** (reviewed, the
term does not appear), or the quoted value with a "Show in contract" link —
the same three-way distinction `KeyTermsCard` uses, never collapsed into a
single blank state. A row is highlighted (amber) only when both sides have a
found value and the values differ — never for a side that is merely missing
data, since that is not a difference, it's an unknown. Findings from both
reviews are listed underneath in two columns, reusing `AnswerView`'s risk-flag
styling. A closing disclaimer states plainly that nothing here is scored,
ranked, or inferred, and that the view does not say which contract is legally
better.

A "Show in contract" click here calls `onShowSource(contract, ref)`, which
selects that contract (exiting the comparison) and then calls the normal
`showSource` — landing on that contract's own Sources tab via the MAS-83/
MAS-109 machinery unchanged, rather than a parallel in-place viewer.

## Compare embedding models (MAS-62)

A different comparison from MAS-113's above: one contract, one question,
answered independently by both embedding profiles. `QuestionPanel` shows a
second button, "Compare models (≈ 4 model calls)", next to "Ask" — but only
when a single contract is the search scope *and* that contract's
`indexed_profiles` already includes `"quality"` (`GET /api/contracts`'s own
field, MAS-62); there is no button that would just 409. The cost is stated on
the button itself before it is pressed (CLAUDE.md's UI budget rule, MAS-122):
comparing is two full `/api/query` round trips, each with its own paid answer
+ risk call, so it costs twice a normal question, not the same.

Clicking it fires `Promise.all([askQuestion(..., 'portable'), askQuestion(...,
'quality')])` under one `toast.promise` (one loading/error message for the
pair; a rejection from either side reports the API's `detail` and renders
neither side, rather than showing a half comparison) and hands both responses
to `ModelCompareView`, which replaces the normal `AnswerView` in the Ask tab
until "Exit comparison". Each side is `AnswerView` itself, unmodified, in a
two-column grid (one column under 640px) headed "Portable · ModernBERT" /
"Quality · Qwen3-Embedding-4B" — citations, risk pills, click-to-source and
the withheld/not-found states all render exactly as a single answer would,
since nothing about rendering one side needed to change to show two.
Both sides are still stored as ordinary questions (MAS-102): comparing
appears twice in "Previous questions", once per profile.

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

### Related-document panel (MAS-153)

When a review names a document that has not been uploaded, the related-document
panel makes the next step clear without claiming a match. It shows the named
document, then one primary row: choose an already uploaded document and select
**Link document**. The alternate upload path is visually secondary and keeps
its cost disclosure: uploading starts the document review (about two
model calls for up to eight passages). The explicit confirmation dialog and
unlink behaviour are unchanged. The panel uses Inter and the normal body/text
scale, and stacks the selector and button at narrow widths.

### How it works walkthrough (MAS-173)

`/how-it-works` uses a scoped `.how-*` layout: pale cyan hero, a three-step
Upload / Review / Check sources walkthrough, and two outcome explanations.
It inherits Inter and the existing brand tokens without changing workspace
styles or the shared header/footer. Numbered rows and the outcome cards stack
on mobile. All navigation links have visible keyboard focus. Copy distinguishes
missing information from incomplete analysis and makes no accuracy promises.
The other public information pages retain their existing layouts pending review.
