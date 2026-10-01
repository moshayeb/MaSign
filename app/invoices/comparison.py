"""Compare an invoice's extracted fields against a contract's verified key
terms -- fees, due dates, late-payment rates (MAS-92).

Three outcomes only, never a plain boolean: `match`, `possible_mismatch` (both
sides have comparable evidence and the values differ), and `cannot_verify`
(one side is missing, ambiguous, or not safely comparable -- a different
currency, an unstated billing period, a rate expressed two different ways).
Silence is never read as "clean": a contract term that was never verified, or
an invoice field the model never confirmed, produces `cannot_verify`, not a
silent match (honest-outcomes). A mismatch always carries both an invoice and
a contract quote.
"""

from dataclasses import dataclass
from datetime import date
from uuid import UUID

from app.database.models import KeyTermRow
from app.invoices.extractor import InvoiceFieldFinding

MATCH = "match"
POSSIBLE_MISMATCH = "possible_mismatch"
CANNOT_VERIFY = "cannot_verify"

FEE_LABEL = "Fee amount"
DUE_DATE_LABEL = "Payment deadline"
LATE_PAYMENT_LABEL = "Late-payment rate"


@dataclass(frozen=True)
class InvoiceCheckOutcome:
    label: str
    outcome: str
    reason: str
    contract_term: str | None = None
    contract_value: str | None = None
    contract_quote: str | None = None
    contract_chunk_id: UUID | None = None
    source_contract_id: UUID | None = None
    invoice_field: str | None = None
    invoice_value: str | None = None
    invoice_quote: str | None = None
    invoice_chunk_id: UUID | None = None


def compare_invoice(
    fields: dict[str, InvoiceFieldFinding],
    terms: dict[str, KeyTermRow],
    invoice_chunk_ids: dict[int, UUID],
    *,
    checked: bool,
) -> list[InvoiceCheckOutcome]:
    """One outcome per comparable item: fee amount, payment deadline, late-payment rate."""
    if not checked:
        reason = "The invoice's fields could not be read; nothing on it could be verified."
        return [
            InvoiceCheckOutcome(FEE_LABEL, CANNOT_VERIFY, reason),
            InvoiceCheckOutcome(DUE_DATE_LABEL, CANNOT_VERIFY, reason),
            InvoiceCheckOutcome(LATE_PAYMENT_LABEL, CANNOT_VERIFY, reason),
        ]
    return [
        _compare_fee(fields, terms, invoice_chunk_ids),
        _compare_due_date(fields, terms, invoice_chunk_ids),
        _compare_late_payment(fields, terms, invoice_chunk_ids),
    ]


def _invoice_evidence(field: InvoiceFieldFinding, invoice_chunk_ids: dict[int, UUID]) -> dict:
    return dict(
        invoice_field=field.field,
        invoice_value=field.value,
        invoice_quote=field.quote,
        invoice_chunk_id=invoice_chunk_ids.get(field.page),
    )


def _contract_evidence(term: KeyTermRow) -> dict:
    return dict(
        contract_term=term.term,
        contract_value=term.value,
        contract_quote=term.quote,
        contract_chunk_id=term.chunk_id,
        source_contract_id=term.source_contract_id,
    )


def _compare_fee(fields, terms, invoice_chunk_ids) -> InvoiceCheckOutcome:
    invoice_total = fields.get("total_amount")
    if invoice_total is None:
        return InvoiceCheckOutcome(FEE_LABEL, CANNOT_VERIFY, "The invoice does not state a clear total amount.")

    # A one-off fee is the only contract fee kind directly comparable to a
    # single invoice total; a recurring fee needs the invoice's billing period
    # to rule out pro-rating, which this story does not extract.
    contract_term = terms.get("one_off_fee")
    evidence = _invoice_evidence(invoice_total, invoice_chunk_ids)
    if terms.get("recurring_fee") is not None and contract_term is None:
        recurring = terms["recurring_fee"]
        return InvoiceCheckOutcome(
            FEE_LABEL, CANNOT_VERIFY,
            "The contract fee is recurring; the invoice does not state the billing period it covers, so pro-rating cannot be ruled out.",
            **_contract_evidence(recurring), **evidence,
        )
    if contract_term is None:
        return InvoiceCheckOutcome(FEE_LABEL, CANNOT_VERIFY, "The contract does not state a verified fee to compare against.", **evidence)

    evidence |= _contract_evidence(contract_term)
    invoice_typed, contract_typed = invoice_total.typed, contract_term.typed
    if not invoice_typed or not contract_typed:
        return InvoiceCheckOutcome(FEE_LABEL, CANNOT_VERIFY, "The exact amount or currency could not be confirmed on one side.", **evidence)
    if invoice_typed.get("currency") != contract_typed.get("currency"):
        return InvoiceCheckOutcome(
            FEE_LABEL, CANNOT_VERIFY,
            f"Currencies differ ({invoice_typed.get('currency')} vs {contract_typed.get('currency')}); amounts are not comparable.",
            **evidence,
        )
    if invoice_typed.get("amount") == contract_typed.get("amount"):
        return InvoiceCheckOutcome(FEE_LABEL, MATCH, "The invoiced amount matches the contract's one-off fee.", **evidence)
    return InvoiceCheckOutcome(
        FEE_LABEL, POSSIBLE_MISMATCH,
        f"The invoice charges {invoice_typed.get('amount')} {invoice_typed.get('currency')}; the contract states {contract_typed.get('amount')} {contract_typed.get('currency')}.",
        **evidence,
    )


def _compare_due_date(fields, terms, invoice_chunk_ids) -> InvoiceCheckOutcome:
    invoice_date_f = fields.get("invoice_date")
    due_date_f = fields.get("due_date")
    if invoice_date_f is None or due_date_f is None:
        return InvoiceCheckOutcome(DUE_DATE_LABEL, CANNOT_VERIFY, "The invoice does not clearly state both an invoice date and a due date.")

    evidence = _invoice_evidence(due_date_f, invoice_chunk_ids)
    contract_term = terms.get("payment_deadline")
    if contract_term is None:
        return InvoiceCheckOutcome(DUE_DATE_LABEL, CANNOT_VERIFY, "The contract does not state a verified payment deadline (net days) to compare against.", **evidence)

    evidence |= _contract_evidence(contract_term)
    invoice_typed, due_typed, contract_typed = invoice_date_f.typed, due_date_f.typed, contract_term.typed
    if not invoice_typed or not due_typed or not contract_typed:
        return InvoiceCheckOutcome(DUE_DATE_LABEL, CANNOT_VERIFY, "The invoice date or due date could not be confirmed precisely enough to count days.", **evidence)
    try:
        invoiced = date.fromisoformat(invoice_typed["date"])
        due = date.fromisoformat(due_typed["date"])
    except (KeyError, ValueError):
        return InvoiceCheckOutcome(DUE_DATE_LABEL, CANNOT_VERIFY, "The invoice date or due date could not be parsed.", **evidence)

    actual_days = (due - invoiced).days
    net_days = contract_typed.get("net_days")
    if net_days is None:
        return InvoiceCheckOutcome(DUE_DATE_LABEL, CANNOT_VERIFY, "The contract's payment deadline could not be confirmed as a number of days.", **evidence)
    if actual_days == net_days:
        return InvoiceCheckOutcome(DUE_DATE_LABEL, MATCH, f"The invoice's {actual_days}-day payment window matches the contract's {net_days} net days.", **evidence)
    return InvoiceCheckOutcome(
        DUE_DATE_LABEL, POSSIBLE_MISMATCH,
        f"The invoice gives a {actual_days}-day payment window; the contract states {net_days} net days.",
        **evidence,
    )


def _compare_late_payment(fields, terms, invoice_chunk_ids) -> InvoiceCheckOutcome:
    invoice_rate = fields.get("late_fee_rate")
    if invoice_rate is None:
        return InvoiceCheckOutcome(
            LATE_PAYMENT_LABEL, CANNOT_VERIFY,
            "The invoice does not state a late-payment rate (expected on a routine, not-yet-overdue invoice).",
        )

    evidence = _invoice_evidence(invoice_rate, invoice_chunk_ids)
    contract_term = terms.get("late_payment")
    if contract_term is None:
        return InvoiceCheckOutcome(LATE_PAYMENT_LABEL, CANNOT_VERIFY, "The contract does not state a verified late-payment rate to compare against.", **evidence)

    evidence |= _contract_evidence(contract_term)
    invoice_typed, contract_typed = invoice_rate.typed, contract_term.typed
    if not invoice_typed or not contract_typed:
        return InvoiceCheckOutcome(LATE_PAYMENT_LABEL, CANNOT_VERIFY, "The exact rate could not be confirmed on one side.", **evidence)

    if "rate_percent" in invoice_typed and "rate_percent" in contract_typed:
        if invoice_typed.get("per") != contract_typed.get("per"):
            return InvoiceCheckOutcome(
                LATE_PAYMENT_LABEL, CANNOT_VERIFY,
                f"Rate periods differ ({invoice_typed.get('per')} vs {contract_typed.get('per')}); rates are not directly comparable.",
                **evidence,
            )
        if invoice_typed["rate_percent"] == contract_typed["rate_percent"]:
            return InvoiceCheckOutcome(LATE_PAYMENT_LABEL, MATCH, "The invoice's late-payment rate matches the contract.", **evidence)
        return InvoiceCheckOutcome(
            LATE_PAYMENT_LABEL, POSSIBLE_MISMATCH,
            f"The invoice charges {invoice_typed['rate_percent']}% per {invoice_typed.get('per')}; the contract states {contract_typed['rate_percent']}% per {contract_typed.get('per')}.",
            **evidence,
        )
    if "amount" in invoice_typed and "amount" in contract_typed:
        if invoice_typed.get("currency") != contract_typed.get("currency"):
            return InvoiceCheckOutcome(LATE_PAYMENT_LABEL, CANNOT_VERIFY, "Currencies differ; the fixed penalty amounts are not comparable.", **evidence)
        if invoice_typed["amount"] == contract_typed["amount"]:
            return InvoiceCheckOutcome(LATE_PAYMENT_LABEL, MATCH, "The invoice's fixed late fee matches the contract.", **evidence)
        return InvoiceCheckOutcome(
            LATE_PAYMENT_LABEL, POSSIBLE_MISMATCH,
            f"The invoice charges a {invoice_typed['amount']} {invoice_typed.get('currency')} late fee; the contract states {contract_typed['amount']} {contract_typed.get('currency')}.",
            **evidence,
        )
    return InvoiceCheckOutcome(
        LATE_PAYMENT_LABEL, CANNOT_VERIFY,
        "The late-payment rate is expressed differently on each side (percentage vs. fixed fee) and cannot be compared directly.",
        **evidence,
    )
