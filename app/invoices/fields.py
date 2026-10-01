"""The header fields MaSign extracts from an uploaded invoice (MAS-92).

Line items and their interpretation are explicitly out of scope for this
story (model-based line-item interpretation is listed as out of scope on the
ticket); this module only defines the invoice-level fields that are
comparable against a contract's verified key terms (app/key_terms/terms.py)
-- fees, due dates, late-payment rates -- using the same typed-field kinds, so
`app.key_terms.extractor.verify_typed` can be reused as-is.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class InvoiceField:
    id: str
    name: str
    looks_for: str
    kind: str  # text | date | money | rate


INVOICE_FIELDS: tuple[InvoiceField, ...] = (
    InvoiceField(
        id="invoice_number",
        name="Invoice number",
        looks_for="The invoice's own identifying number or reference.",
        kind="text",
    ),
    InvoiceField(
        id="invoice_date",
        name="Invoice date",
        looks_for="The date the invoice was issued.",
        kind="date",
    ),
    InvoiceField(
        id="due_date",
        name="Due date",
        looks_for="The date payment is due.",
        kind="date",
    ),
    InvoiceField(
        id="total_amount",
        name="Total amount due",
        looks_for="The total amount due on this invoice, with its currency.",
        kind="money",
    ),
    InvoiceField(
        id="late_fee_rate",
        name="Stated late-payment rate",
        looks_for="A late-payment interest rate or penalty the invoice itself prints, only if the invoice states one (most invoices do not, until overdue).",
        kind="rate",
    ),
)

FIELD_IDS = tuple(f.id for f in INVOICE_FIELDS)
FIELD_BY_ID = {f.id: f for f in INVOICE_FIELDS}


def fields_text() -> str:
    """The field list as the model sees it."""
    lines = ["Invoice fields to extract:"]
    for f in INVOICE_FIELDS:
        lines.append(f"- {f.id} ({f.name}): {f.looks_for}{_typed_hint(f.kind)}")
    return "\n".join(lines)


def _typed_hint(kind: str) -> str:
    return {
        "text": "",
        "date": ' Typed: {"date": "YYYY-MM-DD"} -- the date exactly as printed on the invoice, in ISO form.',
        "money": ' Typed: {"amount": <number>, "currency": "<ISO 4217>"}.',
        "rate": ' Typed: {"rate_percent": <number>, "per": "month" | "year"} or, for a fixed penalty, {"amount": <number>, "currency": "<ISO 4217>"}.',
    }[kind]
