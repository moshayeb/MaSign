---
name: ui-preview
description: How to see and verify MaSign's React UI without spending API calls — the canned-API preview harness, headless-Edge screenshots (and the 492 px viewport clamp), the sonner toast rules and the frontend test patterns. Trigger this for any change under frontend/, whenever a screenshot, visual check, "how does it look", mobile/phone width, theme or logo work is involved, and before asking the owner to look at the UI.
---

# UI preview (zero-cost)

## 1. Canned-API preview instead of a live model

Create two **untracked, temporary** files (delete them before committing;
`masign-done` checks):

- `frontend/preview.html` — same as `index.html` but loads `/src/preview.tsx`.
- `frontend/src/preview.tsx` — renders `<App />` after replacing
  `window.fetch` with a router: `/api/contracts` → a list with the states you
  need (`risk_status` pending/running/done/null, `risk_worst_severity`),
  `/api/contracts/<id>/risks` → a review (done with findings / running /
  failed / 404 "not reviewed"), `/api/query` → a `QueryResponse` with
  citations, `retrieved_context`, risks, `blocked_passages`. A `?select=<row>`
  or `?state=answer` query param can click a contract row / type a question
  and press Ask via DOM events so the answer state renders without a user.

Run `npx vite --port 5199 --strictPort` from `frontend/` (kill node afterwards:
`taskkill //F //IM node.exe`).

## 2. Screenshots with headless Edge

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
  --disable-gpu --hide-scrollbars --virtual-time-budget=10000 \
  --window-size=1280,900 --screenshot=<scratchpad>/name.png http://localhost:5199/preview.html
```

- The first invocation after a while sometimes writes nothing; run it twice.
- **Headless Edge clamps the viewport to 492 px** even at `--window-size=420`.
  For phone widths, serve a wrapper page from Vite (`preview-phone.html`)
  with `<iframe src="/preview.html" width="400">` and screenshot that — a
  `data:` URL wrapper is blocked from loading localhost.
- Read the PNGs with the Read tool and actually look: overflow, overlapping
  labels, states that contradict each other (`honest-outcomes`).
- The live stack (`http://localhost:8000`) is fine for the landing page and
  list; anything that needs an answer costs calls (`api-spend-guard`).

## 3. Rules the UI must keep (docs/frontend.md)

- sonner toasts for every user action; error toasts show the API `detail`
  verbatim; loading toasts for uploads/questions; no toast for automatic loads.
- Cards are `.card` (never bare `section`, or the toast container picks up
  styling). Status pills: green ok / amber warn / grey none / cyan running.
- **Light theme only** since MAS-95 (owner decision 2026-09-20; dark was the
  MAS-79 choice) — colours are `:root` tokens in `index.css`, text-on-white
  uses `--accent #0077b3`, never the raw logo cyan. Do not change the palette
  without the owner's explicit decision.
- With a contract selected the main column is tabbed (Overview · Ask ·
  Contract text); in tests, click `getByRole('tab', { name: 'Ask' })` before
  looking for the composer, and pass a hash like `#nw/text` to open a tab.
- The brand: `components/Wordmark.tsx` (outlined, font-free); never reintroduce
  a font-dependent SVG. Header logo height is the owner's call (currently 22).
- Phone width ≈ 400 px must not scroll horizontally: `min-width: 0` on flex
  children, `minmax(0, 1fr)` grids, ellipsis on file names.

## 4. Tests

vitest + jsdom + testing-library. Mock `fetch` by URL (see `mockApi` in
`Answer.test.tsx`), mock sonner's `toast.promise` to record messages, keep
accessible names stable (`Ask`, `Upload`, `Refresh`, `Ask about the contract`,
`All contracts`). Components that poll take a `pollMs` prop so tests run fast.
Reviewer probe files (`review-probe-*.test.tsx`) are theirs — never commit,
and expect them to fail once the bug they reproduce is fixed.
