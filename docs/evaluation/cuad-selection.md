# CUAD contract selection (MAS-32)

## What and why

**Outsourcing Agreement between Virtual Item Processing Systems, Inc. ("VIP")
and Brokers National Life Assurance Company ("BNL")**, executed 1 May 2006.
From the Contract Understanding Atticus Dataset (CUAD) v1, contract title
`BNLFINANCIALCORP_03_30_2007-EX-10.8-OUTSOURCING AGREEMENT`, filed as SEC
exhibit EX-10.8. Stored at `data/eval_contracts/bnl_vip_outsourcing_agreement.txt`.

BNL, an insurance company, outsources electronic data processing ("EDP
Services") for its policy administration to VIP — a services/outsourcing
agreement with BNL as the buyer, the closest fit CUAD offers to MaSign's
Customer perspective (rubric default in `app/risk_analysis/rubric.py`).
Confirmed from the text itself, not just the title: "VIP desires to provide
EDP Services to BNL; ... BNL desires to obtain EDP services from VIP for the
processing and administration of its insurance policies."

## Selection process

CUAD's `data.zip` (18.3 MB, from `github.com/TheAtticusProject/cuad`,
`data/CUADv1.json`) has all 510 contracts as SQuAD-style QA pairs — one
`context` (the full contract text) per contract, 41 clause-category
questions each, answered where that clause is present. Filtered
programmatically (script not committed; one-off) for:

- Title matching a services/outsourcing/licence/SaaS agreement, and not an
  amendment, exhibit fragment, or schedule-only filing.
- 36,000–100,000 characters (~15–30 pages at the ~2,400 chars/page the
  ticket's own cost estimate used).
- A liability label present (`Cap On Liability` or `Uncapped Liability`).
- A term label present (`Termination For Convenience`, or both `Renewal
  Term` and `Notice Period To Terminate Renewal`).
- A financial label present (`Liquidated Damages`, `Minimum Commitment`,
  `Revenue/Profit Sharing`, or `Price Restrictions`).
- An IP label present (`Ip Ownership Assignment`, `License Grant`, or any of
  CUAD's other seven IP-adjacent categories).

10 contracts passed. This one was picked over the other 9 (mostly hosting/
licence agreements where the filer is the vendor, not the buyer) because its
own recitals make the buyer/vendor relationship explicit and unambiguous,
its length (39,863 characters, ~16 pages) sits mid-range rather than at
either edge, and it clears every required category with room to spare:
`Cap On Liability`, `Uncapped Liability`, `Renewal Term`, `Notice Period To
Terminate Renewal`, `Minimum Commitment`, `Price Restrictions`, `License
Grant`.

## Licence

CUAD is released by The Atticus Project under **CC BY 4.0**
(https://www.atticusprojectai.org/cuad, dataset source
`github.com/TheAtticusProject/cuad`). This file is one contract's plain text
from that corpus, used unmodified — including its original page-break
artifacts (`E-4`, `E-5`, … `E-19`, inline from the source PDF's exhibit
stamps) rather than cleaned up, since a real contract's OCR/export noise is
exactly what the fictional contracts can't exercise. Attribution: Contract
Understanding Atticus Dataset (CUAD), The Atticus Project, CC BY 4.0.

## Questions

8 questions appended to `questions.jsonl` with the `bnl-` id prefix: 3
financial (minimum fee, payment deadline, late-payment interest), 2
liability/termination (liability cap, early-termination cancellation fee), 1
confidentiality (not a CUAD label — hand-written from the "Proprietary and
Related Rights" / "Client Data" clause, paragraph 6(A)), 2 unanswerable
(warranty duration, early/bulk-payment discount — genuinely absent from the
text, not merely un-labelled by CUAD).
