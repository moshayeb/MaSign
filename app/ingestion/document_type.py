"""Is this file a commercial contract at all? (MAS-107)

An invoice or a requirements document goes through the same pipeline as a
contract and would come back with a clean risk review — reassurance the
rubric never earned. This module gives every upload a kind, by rule and
without a model call, so the UI can say when the contract analysis may not
be meaningful. It is a hint, not a gate: nothing is blocked on it.

Distinct markers count, not their frequency, so a four-clause agreement
still reads as a contract and a long invoice does not become one by
repeating "amount due". Every verdict carries the markers it was made from,
so the UI never says "looks like an invoice" without saying why.

Limitations, by design: keyword-based and English only; a contract pasted
into an email, or a quotation with contract terms attached, reads as
`uncertain`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

KIND_CONTRACT = "contract"
KIND_UNCERTAIN = "uncertain"
KIND_NOT_CONTRACT = "not_contract"

# Each marker: (label shown to the user, regex). Case-insensitive, whole words.
CONTRACT_MARKERS: list[tuple[str, str]] = [
    ("agreement / contract", r"\b(this\s+)?(agreement|contract)\b"),
    ("parties named", r"\bbetween\b[^.\n]{0,200}\b(and)\b"),
    ("party roles", r"\b(customer|vendor|supplier|licensor|licensee|provider|client|contractor|the\s+company|the\s+parties)\b"),
    ("obligations (shall)", r"\bshall\b"),
    ("term / termination", r"\b(initial\s+term|term\s+of\s+this|terminat(e|ion|ed))\b"),
    ("liability", r"\b(liabilit(y|ies)|indemnif(y|ies|ication))\b"),
    ("confidentiality", r"\bconfidential(ity)?\b"),
    ("governing law", r"\b(governing\s+law|governed\s+by\s+the\s+laws?)\b"),
    ("effective date", r"\b(effective\s+date|commencement\s+date|comes?\s+into\s+(force|effect))\b"),
    ("signature block", r"\b(in\s+witness\s+whereof|signed\s+(by|on\s+behalf)|authori[sz]ed\s+signator(y|ies))\b"),
    ("numbered clauses", r"(?m)^\s*\d{1,2}(\.\d{1,2})?\.?\s+[A-Z][A-Za-z ]{2,40}\s*$"),
    ("fees / payment clause", r"\b(fees?|payment\s+terms|invoic(e|ing)\s+(shall|will|is|are))\b"),
    ("renewal / notice", r"\b(renew(al|s|ed)?|notice\s+period|written\s+notice)\b"),
    ("warranties", r"\b(warrant(y|ies|s)|represent(s|ations)?\s+and\s+warrant)\b"),
]

# Non-contract markers, grouped by the kind of document they point to.
NON_CONTRACT_MARKERS: dict[str, list[tuple[str, str]]] = {
    "invoice": [
        ("Invoice number", r"\binvoice\s*(no\.?|number|#|id)\b"),
        ("Amount due", r"\b(amount\s+due|balance\s+due|total\s+due)\b"),
        ("Bill to", r"\b(bill\s+to|billed\s+to|ship\s+to)\b"),
        ("Subtotal", r"\bsub-?total\b"),
        ("VAT / tax line", r"\b(vat|sales\s+tax|tax\s+rate)\b"),
        ("Remittance", r"\b(remit(tance)?|please\s+pay|pay\s+by|payment\s+reference)\b"),
        ("Invoice date", r"\b(invoice\s+date|date\s+of\s+issue)\b"),
    ],
    "quotation": [
        ("Quotation number", r"\b(quotation|quote)\s*(no\.?|number|#|id)\b"),
        ("Valid until", r"\b(valid\s+(until|for|through)|validity)\b"),
        ("Unit price", r"\bunit\s+price\b"),
        ("Quantity column", r"\b(qty|quantity)\b"),
        ("Line total", r"\b(line\s+total|extended\s+price)\b"),
        ("Prepared for", r"\b(prepared\s+for|quotation\s+for|we\s+are\s+pleased\s+to\s+(quote|offer))\b"),
    ],
    "requirements document": [
        ("Functional requirements", r"\b(functional|non-functional)\s+requirements?\b"),
        ("User story", r"\buser\s+stor(y|ies)\b"),
        ("Acceptance criteria", r"\bacceptance\s+criteria\b"),
        ("The system shall", r"\bthe\s+(system|application|software)\s+(shall|must|should)\b"),
        ("Specification", r"\b(software\s+requirements\s+specification|srs|product\s+requirements\s+document|prd)\b"),
        ("Use case", r"\buse\s+cases?\b"),
    ],
    "correspondence or notes": [
        ("Email header", r"(?mi)^\s*(from|to|subject|sent|cc):\s"),
        ("Salutation", r"(?mi)^\s*(dear|hi|hello)\s+[A-Z][a-z]+,?\s*$"),
        ("Agenda", r"\bagenda\b"),
        ("Minutes", r"\b(meeting\s+)?minutes\b"),
        ("Action items", r"\baction\s+items?\b"),
        ("Sign-off", r"(?mi)^\s*(regards|best\s+regards|kind\s+regards|sincerely),?\s*$"),
    ],
    "CV": [
        ("Curriculum vitae", r"\b(curriculum\s+vitae|r[ée]sum[ée])\b"),
        ("Work experience", r"\b(work|professional)\s+experience\b"),
        ("Education", r"(?mi)^\s*education\s*$"),
        ("Skills", r"(?mi)^\s*(skills|technical\s+skills)\s*$"),
        ("References available", r"\breferences\s+available\b"),
    ],
}

MIN_WORDS = 40
CONTRACT_THRESHOLD = 4
NOT_CONTRACT_THRESHOLD = 3


@dataclass(frozen=True)
class DocumentKind:
    kind: str  # contract | uncertain | not_contract
    # The non-contract type the markers point to ("invoice"), or None.
    looks_like: str | None
    # The markers behind the verdict, as sentences for the user.
    reasons: list[str] = field(default_factory=list)


def _hits(markers: list[tuple[str, str]], text: str) -> list[str]:
    return [label for label, pattern in markers if re.search(pattern, text, re.IGNORECASE)]


def classify_document(text: str) -> DocumentKind:
    words = len(text.split())
    contract_hits = _hits(CONTRACT_MARKERS, text)
    other: dict[str, list[str]] = {name: _hits(markers, text) for name, markers in NON_CONTRACT_MARKERS.items()}
    strongest = max(other, key=lambda name: len(other[name]))
    strongest_hits = other[strongest]

    reasons: list[str] = []
    if contract_hits:
        reasons.append(f"Contract markers: {_quote(contract_hits)}")
    if strongest_hits:
        reasons.append(f"{strongest[0].upper()}{strongest[1:]} markers: {_quote(strongest_hits)}")

    # A short invoice is still an invoice; a short text with nothing much in it is not a contract either.
    if len(strongest_hits) >= NOT_CONTRACT_THRESHOLD and len(contract_hits) <= 2:
        return DocumentKind(KIND_NOT_CONTRACT, strongest, reasons)
    if words < MIN_WORDS:
        reasons.append(f"Only {words} words — too short to classify")
        return DocumentKind(KIND_UNCERTAIN, None, reasons)
    if len(contract_hits) >= CONTRACT_THRESHOLD and len(contract_hits) > len(strongest_hits):
        return DocumentKind(KIND_CONTRACT, None, reasons)
    if not reasons:
        reasons.append("No contract or other document markers found")
    return DocumentKind(KIND_UNCERTAIN, strongest if len(strongest_hits) >= NOT_CONTRACT_THRESHOLD else None, reasons)


def _quote(labels: list[str]) -> str:
    return ", ".join(f"'{label}'" for label in labels[:6]) + (f" and {len(labels) - 6} more" if len(labels) > 6 else "")
