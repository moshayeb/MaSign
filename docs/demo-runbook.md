# MaSign class demo runbook (Sprint 3, 2026-09-30)

Ten minutes, one browser tab, two fictional agreements. The spoken examples
below are facts from the files, **not promises about what the model will say**.
Keep [the evaluation questions](evaluation/questions.jsonl) open as a source of
expected answers and exact source quotes. Check live output against the source
passage before describing it as correct.

## Materials and expected source facts

Both files are fictional and already in `data/sample_contracts/`. Uploading or
reviewing them calls the configured chat provider; estimate about two calls
per eight passages for each review and get the owner's approval before
uploading or retrying. Do not upload a real contract for the class demo.

| File | Ask (evaluation ID) | What the contract says | Passage to inspect |
|---|---|---|---|
| `northwind_master_services_agreement.txt` | What interest applies to late payments? (`nw-04`) | 1.5% per month, capped at the maximum lawful rate if lower. | Section 2.3 |
| Northwind | What is the early termination fee? (`nw-08`) | 50% of subscription fees for the remaining initial term; convenience termination is available only after the first 12 months and 90 days' notice. | Section 4.3 |
| Northwind | Does the agreement renew automatically? (`nw-12`) | Yes, in 12-month periods unless either party gives at least 90 days' written notice. | Section 3.2 |
| Northwind | Who is the vendor's account manager? (`nw-18`) | Not stated in this agreement. | No supporting passage; expect an explicit not-found answer. |
| `harbor_software_subscription.txt` | How many days does the customer have to pay an invoice? (`hb-04`) | 45 days from the invoice date. | Section 2.4 |
| Harbor | What does it cost to terminate early? (`hb-07`) | Three months of the annual fee, pro rata, with no refund of prepaid fees. | Section 3.2 |
| Harbor | Does the agreement renew automatically? (`hb-08`) | No; an extension needs a signed renewal order. | Section 3.1 |
| Harbor | What uptime does the supplier guarantee? (`hb-12`) | No uptime commitment is stated. | No supporting passage; expect an explicit not-found answer. |

Potential review points to discuss **only if the displayed result cites the
right clause**: Northwind's 1.5% monthly late interest (Section 2.3), 90-day
non-renewal notice (Section 3.2), and remaining-fees termination charge
(Section 4.3); Harbor's three-month termination charge (Section 3.2) and
uncapped Customer liability for IP infringement or confidentiality breach
(Section 6.3). Severity is a model-assisted rubric judgment, so read the
actual finding and coverage before naming a High or Medium risk. Do not
substitute this table for a successful review.

## Before the presentation

1. Use the merged `main` build. `docker compose up -d --build` starts the
   standard CPU embedding profile; for a GPU quality profile, use the
   [embedding instructions](../README.md#embedding-profiles) and its required
   `llama-server` Compose file. Check `http://localhost:8000/ready`: database
   and vector store must both be `ok`, and `chat_model` must name the intended
   provider. A ready database alone does not mean review or answers will work.
2. Sign in to the demo account. Select the two sample files if already
   uploaded in that account. Otherwise obtain the owner's approval for the
   provider calls, then upload each file once. Wait for **Reviewed** and
   inspect Overview coverage. A **Review failed** or incomplete result is a
   problem to explain, not a result to present as checked.
3. Check the eight questions against the exact sections above. A question
   sent through **Ask MaSign** is paid even if it was asked before; viewing a
   stored answer is free. Obtain approval for the anticipated questions and
   any review retries before running them. If the result disagrees with the
   file, record the mismatch; do not read the expected answer as if MaSign
   produced it.
4. Rehearse the full browser flow **twice** on the intended build and record
   date, build commit, account, review statuses, answers/citations, failures,
   and provider-call count. This is MAS-21's completion criterion. The two
   rehearsals on 2026-09-30 are recorded in
   [the live verification evidence](demo-evidence/2026-09-30.md).

## Ten-minute route through the UI

| Step | Show | Point to make |
|---|---|---|
| 1 | Public home page, then **Open workspace** and sign in | MaSign is a first-pass review tool, not legal advice. |
| 2 | Select Northwind → **Overview** | The four summary cards show stored terms, deviations, risks, and coverage. Read coverage before interpreting a clean-looking risk count. |
| 3 | Open Northwind's late-interest or termination-cost term, then its source | The value should match the quoted clause. A cited finding is a prompt to inspect the text, not a legal conclusion. |
| 4 | If Northwind's review names an unlinked SOW or schedule, open its coverage detail | A reference warning means the separate document is not covered yet. Do not claim the bundle is complete. |
| 5 | **Ask MaSign**: use `nw-08`, then `nw-18` | Compare the fee answer with Section 4.3 and show the explicit not-found case. These requests call the provider. |
| 6 | Select Harbor → **Overview**, then ask `hb-08` | Compare its no-auto-renewal clause with Northwind's automatic renewal. Inspect the source citation. |
| 7 | Open **Actions** → **Export PDF** | The export reflects the stored review; it does not perform a new review. |
| 8 | Show [measured evaluation results](evaluation/README.md) | On 2026-09-28, quality-profile retrieval hit@1 was 0.80 over 35 questions and hit@5 was 1.00; a separate six-answer judged sample scored 0.88 faithfulness and 0.59 factual correctness. Those are small-sample measurements, not a general accuracy promise. |

## If a step fails

- `/ready` says a dependency is unavailable: inspect `docker compose ps` and
  `docker compose logs api --since 5m`. Do not read `/health` as proof that
  Postgres, Qdrant, or the provider is ready.
- **Review failed**: read the exact error; check that the provider is
  configured. A retry can spend more calls, so get approval before selecting
  **Review again** from Actions and confirming its estimate.
- An answer has no usable citation or conflicts with the source: show its
  unverified state and the source text. Switch to a previously checked result
  only if you label it as such.
- A referenced document is missing: explain that it must be uploaded and
  explicitly linked, followed by a fresh bundle review. Do not imply MaSign
  searched a document that is not linked.

## Limits to state plainly

MaSign does not OCR image-only PDFs, draft contracts, or provide legal advice.
The risk rubric is from the Customer's side; its grades are not a verdict on
legality. A cited answer can still be wrong or incomplete. Retrieval results
measure whether a relevant passage was found; they do not measure the
correctness of every answer. The two sample contracts are fictional, and
missing schedules or SOWs remain outside the review until explicitly linked
and reviewed again. See [README known limitations](../README.md#known-limitations).
