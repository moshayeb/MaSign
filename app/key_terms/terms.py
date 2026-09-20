"""The key terms MaSign extracts from every contract (MAS-82).

Like the risk rubric, the list is data: the extraction prompt, the API and
the docs are built from the same definitions. Every term is a financial
consequence of signing — what is paid, when, what late payment costs, what
leaving costs, and how long the contract binds — from the Customer's side.

Each term has a `kind` that says which typed fields may accompany its text
value (owner decision 2026-09-18, prep for invoice verification, MAS-92):

- money:       {"amount": 18500, "currency": "EUR"} or, for a fee expressed as a
               share of remaining fees, {"percent": 50}
- recurring:   {"amount": 18500, "currency": "EUR", "period": "month"}
- net_days:    {"net_days": 30}
- rate:        {"rate_percent": 1.5, "per": "month"} or a fixed {"amount", "currency"}
- duration:    {"months": 36} or {"days": 90}
- date:        {"date": "2026-03-01"} (ISO), verified against the date as written in the quote
- renewal:     text, optionally {"months": 12} or {"days": 365} for the renewal period
- text:        no typed fields
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class KeyTerm:
    id: str
    name: str
    looks_for: str
    kind: str  # money | recurring | net_days | rate | duration | date | renewal | text


KEY_TERMS: tuple[KeyTerm, ...] = (
    KeyTerm(
        id="effective_date",
        name="Effective date",
        looks_for="The date the agreement starts (the effective date, commencement date or date it is made).",
        kind="date",
    ),
    KeyTerm(
        id="recurring_fee",
        name="Recurring fee",
        looks_for="The subscription, licence or service fee Customer pays per period (per month, quarter or year).",
        kind="recurring",
    ),
    KeyTerm(
        id="one_off_fee",
        name="One-off fees",
        looks_for="Setup, onboarding, implementation or other one-time charges.",
        kind="money",
    ),
    KeyTerm(
        id="payment_deadline",
        name="Payment deadline",
        looks_for="How many days after the invoice date payment is due (net days).",
        kind="net_days",
    ),
    KeyTerm(
        id="late_payment",
        name="Late-payment interest / penalty",
        looks_for="Interest rate or fixed penalty on overdue amounts, and per what period.",
        kind="rate",
    ),
    KeyTerm(
        id="termination_cost",
        name="Termination cost",
        looks_for="Any fee or remaining-fees obligation triggered by ending the agreement early.",
        kind="money",
    ),
    KeyTerm(
        id="initial_term",
        name="Initial term",
        looks_for="How long the agreement runs before it can end or renew.",
        kind="duration",
    ),
    KeyTerm(
        id="renewal",
        name="Renewal",
        looks_for="Whether and how the agreement renews (automatically, for how long, at what fees).",
        kind="renewal",
    ),
    KeyTerm(
        id="notice_period",
        name="Notice period",
        looks_for="How much notice is needed to terminate or to stop a renewal.",
        kind="duration",
    ),
    KeyTerm(
        id="price_changes",
        name="Price changes",
        looks_for="Whether and how fees may increase (index, fixed percentage, at Vendor's discretion).",
        kind="text",
    ),
)

TERM_IDS = tuple(term.id for term in KEY_TERMS)
TERM_BY_ID = {term.id: term for term in KEY_TERMS}

# The typed fields the model may return per kind, and which of them must be
# numbers found in the quote for the typed value to be kept.
TYPED_FIELDS: dict[str, dict[str, type]] = {
    "money": {"amount": float, "currency": str, "percent": float},
    "recurring": {"amount": float, "currency": str, "period": str},
    "net_days": {"net_days": int},
    "rate": {"rate_percent": float, "per": str, "amount": float, "currency": str},
    "duration": {"days": int, "months": int},
    "date": {"date": str},
    "renewal": {"days": int, "months": int},
    "text": {},
}
PERIODS = ("month", "quarter", "year")
NOT_STATED = "Not stated in the reviewed text"


def terms_text() -> str:
    """The term list as the model sees it."""
    lines = ["Terms to extract (Customer = the party paying):"]
    for term in KEY_TERMS:
        typed = _typed_hint(term.kind)
        lines.append(f"- {term.id} ({term.name}): {term.looks_for}{typed}")
    return "\n".join(lines)


def _typed_hint(kind: str) -> str:
    return {
        "money": ' Typed: {"amount": <number>, "currency": "<ISO 4217>"} or, for a share of remaining fees, {"percent": <number>}.',
        "recurring": ' Typed: {"amount": <number>, "currency": "<ISO 4217>", "period": "month" | "quarter" | "year"}.',
        "net_days": ' Typed: {"net_days": <integer>}.',
        "rate": ' Typed: {"rate_percent": <number>, "per": "month" | "year"} or, for a fixed penalty, {"amount": <number>, "currency": "<ISO 4217>"}.',
        "duration": ' Typed: {"months": <integer>} or {"days": <integer>}.',
        "date": ' Typed: {"date": "YYYY-MM-DD"} — the date exactly as written in the quote, in ISO form.',
        "renewal": ' Typed, only when the passage states the renewal period: {"months": <integer>} or {"days": <integer>}.',
        "text": "",
    }[kind]
