# MaSign evaluation

- Date: 2026-09-28 19:40 UTC
- Embedding profile: portable
- Chat model: claude-sonnet-5
- Judge model: anthropic/claude-haiku-4-5-20251001

## Retrieval (no model call)

| Questions | Resolved | hit@1 | hit@5 | MRR |
|---|---|---|---|---|
| 6 | 6 | 0.50 | 1.00 | 0.72 |

Not top-1: bnl-01, bnl-04, bnl-05

| id | question | reference | retrieved (best first) |
|---|---|---|---|
| bnl-01 | What is the minimum monthly fee BNL owes VIP? | 11 | 10, 11, 14, 23, 44 |
| bnl-02 | How long does BNL have to pay a VIP invoice? | 14 | 14, 10, 23, 29, 22 |
| bnl-03 | What late charge applies if BNL pays an invoice late? | 14 | 14, 32, 23, 10, 52 |
| bnl-04 | Is VIP's liability to BNL capped? | 28 | 29, 22, 28, 36, 31 |
| bnl-05 | What does BNL owe VIP if it ends the agreement early, during an Extended Term, with less than six months' notice? | 43 | 22, 43, 10, 29, 44 |
| bnl-06 | Can VIP share BNL's data with third parties? | 18 | 18, 23, 22, 39, 56 |

## Answers (judged)

| Judged | Faithfulness | Factual correctness | Not-found questions right | Answer calls | Judge calls |
|---|---|---|---|---|---|
| 6 | 0.88 | 0.59 | 2/2 | 16 | 36 |

| id | faithfulness | correctness | outcome |
|---|---|---|---|
| bnl-01 | 1.00 | 1.00 | grounded |
| bnl-02 | 0.80 | 0.00 | grounded |
| bnl-03 | 0.60 | 0.50 | grounded |
| bnl-04 | 1.00 | 0.57 | grounded |
| bnl-05 | 1.00 | 0.50 | unverified |
| bnl-06 | 0.86 | 1.00 | grounded |
| bnl-07 | – | – | said not found ✔ |
| bnl-08 | – | – | said not found ✔ |
