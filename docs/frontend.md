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

## Look and feel (MAS-73, MAS-79)

Deep navy theme (Inter, `#070c16` ground with a cyan glow and a faint grid
that fades out, translucent "glass" panels) with the logo's cyan `#009fe3` as
the single accent — inspired by a Gemini-generated landing page the owner
liked. The logo icon is inlined (`components/Logo.tsx`) so its ink paths
follow the theme; the wordmark SVGs depend on the Azonix font and are not
used in the browser — the header types "MASIGN" in Michroma next to the icon
(to be replaced by the outlined wordmark once the owner exports it).
Two-column layout: a sticky sidebar (upload drop zone, compact contract rows
with a file-type tag) and the main column, stacking under 960 px. Before the
first answer the main column is a landing: headline, the question composer
(scope pills and Ask inside one bordered box), example questions as chips
and three feature tiles; after it, the composer and the answer card.
Cards are `.card` (never bare `section`, so the toast container stays
invisible); section titles are small uppercase labels. The answer card
carries a status pill — green "Grounded · n passages", amber "Unverified",
grey "Not in the text" — and citation cards with a numbered bubble.
Verified with headless-Edge screenshots at 1280 px and inside a 400 px
iframe (headless Edge clamps its own viewport to 492 px, so narrow widths
must be checked through an iframe).

## Query results

`POST /api/query` returns (MAS-12/13):

- `answer` — one to four sentences written only from the passages, with `[n]`
  markers, or exactly `Not found in contract.`
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
  some findings were dropped: show the verified ones with an "incomplete
  analysis" warning.
- `recommended_actions` — next steps derived from the findings.
- `retrieved_context` — every passage considered, best first, same shape
  minus `label`; `chunk_index` gives its position in the contract and `score`
  (cosine, 0–1) can drive a relevance hint.

`contract_id` is optional in the request — default the UI to the selected
contract, and offer "all contracts" explicitly. A 503 here carries the reason
(no API key, provider down, rate limit) in `detail` — show it verbatim.
