# MaSign evaluation

- Date: 2026-09-20 00:26 UTC
- Embedding profile: quality
- Chat model: n/a (retrieval only)
- Judge model: n/a

## Retrieval (no model call)

| Questions | Resolved | hit@1 | hit@5 | MRR |
|---|---|---|---|---|
| 16 | 16 | 0.94 | 1.00 | 0.96 |

Not top-1: nw-03

| id | question | reference | retrieved (best first) |
|---|---|---|---|
| nw-01 | What is the monthly subscription fee? | 2 | 2, 3, 5, 9, 4 |
| nw-02 | What is the daily rate for professional services? | 2 | 2, 1, 9, 6, 10 |
| nw-03 | When are invoices due? | 2 | 3, 4, 2, 9, 5 |
| nw-04 | What interest applies to late payments? | 3 | 3, 6, 4, 9, 5 |
| nw-05 | Can the vendor suspend the services for late payment? | 3 | 3, 4, 9, 10, 5 |
| nw-06 | By how much can the subscription fee be increased each year? | 3 | 3, 2, 5, 6, 4 |
| nw-07 | How long does the customer have to dispute an invoice? | 3 | 3, 4, 9, 11, 5 |
| nw-08 | What is the early termination fee? | 5 | 5, 3, 9, 4, 10 |
| nw-09 | What service credits apply if availability drops below 99%? | 9 | 9, 10, 6, 5, 3 |
| nw-10 | Are the fees inclusive of VAT? | 2 | 2, 3, 6, 5, 10 |
| nw-11 | How long is the initial term? | 4 | 4, 5, 9, 10, 8 |
| nw-12 | Does the agreement renew automatically? | 4 | 4, 12, 5, 9, 11 |
| nw-13 | How much notice is needed to prevent renewal? | 4 | 4, 5, 12, 10, 3 |
| nw-14 | Is there a cap on liability? | 6 | 6, 10, 11, 5, 9 |
| nw-15 | Who owns deliverables created under a statement of work? | 7 | 7, 12, 1, 6, 5 |
| nw-16 | How long do confidentiality obligations last after termination? | 8 | 8, 7, 5, 9, 4 |
