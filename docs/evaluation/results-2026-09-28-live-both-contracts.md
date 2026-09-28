# MaSign evaluation

- Date: 2026-09-28 18:57 UTC
- Embedding profile: quality (deployed as default; see docs/evaluation/README.md note)
- Chat model: n/a (retrieval only)
- Judge model: n/a

## Retrieval (no model call)

| Questions | Resolved | hit@1 | hit@5 | MRR |
|---|---|---|---|---|
| 29 | 29 | 0.86 | 1.00 | 0.91 |

Not top-1: nw-03, nw-19, hb-11, hb-13

| id | question | reference | retrieved (best first) |
|---|---|---|---|
| nw-01 | What is the monthly subscription fee? | 2 | 2, 3, 5, 9, 4 |
| nw-02 | What is the daily rate for professional services? | 2 | 2, 1, 9, 6, 10 |
| nw-03 | When are invoices due? | 2 | 3, 4, 2, 9, 5 |
| nw-04 | What interest applies to late payments? | 3 | 3, 6, 4, 9, 5 |
| nw-05 | Can the vendor suspend the services for late payment? | 3 | 3, 4, 9, 10, 5 |
| nw-06 | By how much can the subscription fee be increased each year? | 3 | 3, 2, 5, 6, 4 |
| nw-07 | How long does the customer have to dispute an invoice? | 3 | 3, 4, 9, 11, 5 |
| nw-08 | What is the early termination fee? | 5 | 5, 3, 4, 9, 10 |
| nw-09 | What service credits apply if availability drops below 99%? | 9 | 9, 10, 6, 5, 3 |
| nw-10 | Are the fees inclusive of VAT? | 2 | 2, 3, 6, 5, 10 |
| nw-11 | How long is the initial term? | 4 | 4, 5, 9, 10, 8 |
| nw-12 | Does the agreement renew automatically? | 4 | 4, 12, 5, 9, 11 |
| nw-13 | How much notice is needed to prevent renewal? | 4 | 4, 5, 12, 10, 3 |
| nw-14 | Is there a cap on liability? | 6 | 6, 10, 11, 5, 9 |
| nw-15 | Who owns deliverables created under a statement of work? | 7 | 7, 12, 1, 5, 6 |
| nw-16 | How long do confidentiality obligations last after termination? | 8 | 8, 7, 5, 9, 4 |
| nw-19 | When does the agreement start? | 1 | 4, 12, 1, 5, 11 |
| hb-01 | What is the annual subscription fee? | 2 | 2, 3, 1, 5, 4 |
| hb-02 | Is there a one-time onboarding fee? | 2 | 2, 3, 1, 5, 4 |
| hb-03 | What does an additional named user cost? | 2 | 2, 1, 3, 5, 4 |
| hb-04 | How many days does the customer have to pay an invoice? | 2 | 2, 3, 5, 4, 1 |
| hb-05 | What interest is charged on overdue amounts? | 2 | 2, 3, 5, 6, 4 |
| hb-06 | Can the supplier raise the price, and by how much? | 2 | 2, 3, 4, 5, 1 |
| hb-07 | What does it cost to terminate early? | 3 | 3, 2, 5, 6, 1 |
| hb-08 | Does the agreement renew automatically? | 3 | 3, 2, 6, 5, 4 |
| hb-09 | How long is the term? | 3 | 3, 2, 6, 5, 1 |
| hb-10 | Is the customer's liability capped? | 5 | 5, 4, 3, 2, 6 |
| hb-11 | Which country's courts have jurisdiction? | 5 | 6, 5, 3, 2, 1 |
| hb-13 | What is the effective date of the agreement? | 1 | 3, 6, 5, 1, 2 |
