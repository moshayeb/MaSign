# Redesign feature inventory (MAS-209)

The preservation checklist for the three redesign phases (MAS-209 design
system, then public pages, then workspace). Taken from `main` at `b146c35`
by reading the routes, components, `aria-label`s and action labels in
`frontend/src`. A redesign PR is not done until every line here is still
present and reachable, on desktop **and** at 390 px.

Legend: **[W]** workspace (`/workspace`), **[P]** public page, **(c)**
conditional — only shown in some state.

## Routes (`main.tsx`, `pages/index.ts`)

- [ ] `/` home · `/workspace` · `/login`
- [ ] `/about` · `/privacy` · `/documentation` · `/how-it-works` ·
      `/what-masign-checks` · `/educational-disclaimer` · `/standards`
- [ ] Old bookmark `/#<contract>/<tab>` redirects to `/workspace#…`
- [ ] Unknown path falls back to the home page

## Shell — every page

- [ ] Legal banner "Not legal advice …" with **Full disclaimer** link (first thing on every screen, MAS-155)
- [ ] Header: wordmark → home; nav How it works · What MaSign checks · Documentation
- [ ] Header CTA **Open workspace**, replaced by account (email + **Log out**) when signed in
- [ ] Phone: nav collapses into the **Menu** disclosure, same links + CTA/account
- [ ] Footer: brand, tagline, Product / Resources / Project columns, GitHub, Report an issue, © line
- [ ] sonner toasts for every user action; error toasts show the API `detail` verbatim

## Public pages [P]

- [ ] Home: hero + product preview, trust strip, three steps, Why MaSign, Clear expectations, final CTA
- [ ] How it works, What MaSign checks (seven risk categories), Documentation (resources), About, Privacy, Educational disclaimer
- [ ] Login: sign in ↔ create account switch, email + password, submit, disabled "forgot password" placeholder, error toasts

## Workspace — sidebar [W]

- [ ] **Upload a contract**: dropzone (click or drag), TXT/PDF/DOCX ≤ 10 MB, **Upload** button, upload progress toast
- [ ] **Contracts** card: count, **Compare** (start compare picking), **Refresh**
- [ ] (c) Compare picking: checkboxes on rows, status line, **Cancel**
- [ ] **Search contracts** box, **Sort by** (Newest · Highest risk · Most deviations)
- [ ] Row: file-type badge, name (ellipsis), review status + worst severity, fee · term summary, (c) "Not a contract?" badge
- [ ] Row **Actions for …** menu: Export PDF · DOCX · Markdown · CSV · XLSX, **Delete** → **Confirm delete** dialog
- [ ] Empty / loading / no-match states of the list
- [ ] **Comparison rules** link (→ `/standards`)
- [ ] Phone: **Show contracts** drawer toggle, **Close**, backdrop

## Workspace — contract header [W]

- [ ] File mark, "Contract workspace" eyebrow, contract name (full, not truncated — MAS-124)
- [ ] Meta line: type, size, passages, upload date; review status pill; document kind pill; indexed-profile badge(s)
- [ ] **Ask a question about this contract** (opens Ask)
- [ ] **Actions** menu: (c) Review risks / Review again (with cost, confirm before re-spend — MAS-122), Export PDF · DOCX · Markdown · CSV · XLSX, Print review
- [ ] Tabs: **Overview** · **Ask MaSign** (with "· answered" hint) · **Invoices** · **Sources**; hash routing `#<id>/<tab>`

## Overview tab [W]

- [ ] Review summary strip: Key terms · Deviations · Risks · Coverage tiles; each jumps to its section
- [ ] (c) Running: "…" / "Reviewing" tiles, coverage so far; never a "0 findings" claim (MAS-207)
- [ ] Coverage notice: withheld / redacted passages ("AI instructions detected"), unreadable passages, ingestion notes
- [ ] (c) Document-kind warning ("does not look like a commercial contract")
- [ ] **Before you sign** checklist: In brief (term, cost, renewal, leaving, risks) with passage links; Needs attention items with checkboxes and passage links
- [ ] Related documents / contract bundle: link a document to a reference (**Link**, **Confirm link**, **Cancel**), **Unlink**
- [ ] Contract timeline (deadlines)
- [ ] Clause checklist (expected clauses), RFI suggestions (Ask MaSign to draft a clarifying question)
- [ ] **View complete analysis** fold: findings with **Filter findings by severity** (All · High · Medium · Low), seven-category list, key terms with standard verdicts, show-in-contract links
- [ ] Risk review status line + review metadata; (c) failed review with free **Try again** read, (c) not reviewed yet

## Ask MaSign tab / drawer [W]

- [ ] Question box with draft, **Suggested questions**, search scope (this contract · all contracts), embedding profile choice when indexed (compare mode)
- [ ] Cost shown before **Ask**
- [ ] Answer: grounded / not found / withheld states, `[n]` citations with **Show citation n in contract**, copy citation, flagged risks, recommended actions
- [ ] **Previous questions**: open a stored answer, **Forget**
- [ ] Model comparison view (compare mode), contract comparison view (compare picking)
- [ ] Ask drawer on narrow screens with **Close Ask MaSign**

## Invoices tab [W]

- [ ] **Invoice verification**: upload a digital PDF invoice (≤ 10 MB), check result rows against the contract, show-source links, reload

## Sources tab [W]

- [ ] Contract text by passage, **Search text in document**, withheld sentences marked, jump target from any "Show … in contract" link
- [ ] Source side panel (**Close source passage**) and back-to-context link

## Comparison rules — `/standards` [P]

- [ ] Standard profiles: select, **New profile name** + create, **Rename profile**, make default, delete with confirm
- [ ] Standards cards: days / percent / termination-cost forms (no fee · percent cap · amount cap, **Currency**), save, reset to default
- [ ] Expected clauses toggles; clause content rules (**Save … rule**, **Clear … rule**); sign-in gate "Sign in to manage rules"
- [ ] Load error with **Try again**

## Cross-cutting

- [ ] Keyboard: tabs, menus, drawers and dialogs reachable and closable by keyboard; visible focus
- [ ] Reduced motion respected
- [ ] Light theme only (MAS-95/136 tokens)
- [ ] Print styles for the Overview (MAS-97)
