# Risk rubric (MAS-15)

What MaSign flags and how it grades it. The rubric lives in
`app/risk_analysis/rubric.py`; this page is generated from the same
definitions, so the model, the tests and the reader see one rubric.

**Perspective.** Assess risk from the perspective of the Customer (the party paying for and receiving the services, goods or licence), unless a passage makes clear the uploader is the other party.

**Output.** Each finding is one category, one severity, a one-sentence reason
and the clause quoted verbatim from a retrieved passage — a finding whose quote
does not appear in the passage is discarded (MAS-16), the same discipline as
answer citations. Findings are graded per query over the passages retrieved
for that question; other parts of the contract are not checked, and the UI
says so.

## Categories

- **Liability cap** (`liability`): Limits and exclusions of liability: caps, carve-outs, uncapped exposure, one-sidedness.
- **Termination** (`termination`): Termination rights, notice periods, lock-in, early-termination fees and what survives.
- **Indemnification** (`indemnification`): Who indemnifies whom, for what, and whether the indemnity is capped.
- **Auto-renewal** (`auto_renewal`): Automatic renewal terms, renewal length and the window to give notice of non-renewal.
- **Confidentiality** (`confidentiality`): Scope and duration of confidentiality, one-sidedness, standard exceptions, data handling.
- **Payment terms** (`payment_terms`): Fees, invoicing, payment windows, late interest, price increases, refunds and penalties.
- **IP assignment** (`ip_assignment`): Ownership of deliverables, data and improvements; licence scope and restrictions.

## Severity

| Category | High | Medium | Low |
|---|---|---|---|
| `liability` — Liability cap | Customer's liability is unlimited or uncapped, or the cap is one-sided against Customer; Vendor excludes liability for its own gross negligence, wilful misconduct or data breaches. | A cap below twelve months of fees, broad exclusions of indirect loss without carve-outs, or a cap that applies only to Vendor. | A mutual cap of at least twelve months of fees with the customary carve-outs (death or personal injury, fraud, confidentiality, IP infringement). |
| `termination` — Termination | Customer cannot terminate for convenience at all, or termination triggers a fee of 50% or more of the remaining contract value; Vendor may terminate at will without notice. | Termination for convenience only after a minimum period or with notice over 60 days, or any early-termination fee; termination for cause with a cure period over 30 days. | Mutual termination for convenience on 30–60 days' notice with no fee. |
| `indemnification` — Indemnification | Customer must indemnify Vendor broadly (e.g. for any claim arising from the agreement) or without a cap; Vendor gives no IP-infringement indemnity. | Indemnities are mutual but uncapped, or Vendor's indemnity has wide exclusions. | Vendor indemnifies for IP infringement and Customer's indemnity is limited to its own misuse or breach. |
| `auto_renewal` — Auto-renewal | Renews automatically for twelve months or more with a non-renewal notice window of 90 days or longer, or renewal at increased fees set by Vendor alone. | Automatic renewal with a notice window between 30 and 89 days, or renewal terms longer than the notice makes practical. | No automatic renewal, or renewal with 30 days' notice or less and unchanged fees. |
| `confidentiality` — Confidentiality | Only Customer is bound, obligations are perpetual with no exceptions, or Vendor may use Customer data for its own purposes. | Obligations lack the usual exceptions (public knowledge, independently developed, legally required disclosure) or a defined duration. | Mutual obligations with standard exceptions and a defined survival period. |
| `payment_terms` — Payment terms | Late interest above 1.5% per month, unilateral price increases without a cap, penalties beyond the fees, or all payments non-refundable regardless of Vendor's breach. | Payment due in under 30 days, interest between 1% and 1.5% per month, annual increases without a cap, or suspension of service on any late payment without notice. | Net 30 or longer, interest at 1% per month or less, increases capped, disputes handled before suspension. |
| `ip_assignment` — IP assignment | Customer assigns its own IP or data to Vendor, or Vendor owns deliverables Customer paid for with no licence back. | Customer gets only a narrow, non-transferable licence to deliverables, or feedback and improvements become Vendor's without limit. | Customer owns its data and deliverables (or has a perpetual licence) and Vendor keeps its pre-existing platform IP. |

## Suggested next steps

Derived deterministically from the findings (`app/actions/workflow.py`): any
High → "Escalate to legal review before signing: <categories>"; any Medium →
"Raise in negotiation: <categories>"; Low only → note for the contract owner;
always a reminder to confirm against the full contract. When the analysis
could not be run or read — or every finding it returned failed validation —
the response says so (`risks_checked: false`) instead of showing an empty
list; when only some findings failed, the verified ones are returned with
`risks_complete: false`. A failed risk call never discards a good answer.

## Known limits

- Two scopes (MAS-81): the **whole-contract review** runs after every upload
  over all passages, in batches of 8 per model call, and is stored per
  contract (`GET /api/contracts/{id}/risks`, `POST .../review` to re-run);
  the per-query flags grade only the passages a question retrieved. A
  passage whose reply was unreadable makes the review *incomplete*, a model
  failure makes it *failed* — never silently empty.
- Thresholds (12 months of fees, 1.5 %/month, 90 days' notice, 50 % fee) are
  common SaaS/services norms, not legal advice; they are easy to change here.
- MAS-32 measures precision on a labelled set; until then treat flags as a
  first read.
