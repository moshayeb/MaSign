"""The Customer's default positions for the key terms that have a number (MAS-96).

A standard is a rule over a term's typed value — never over its text — so a
verdict is only ever given for a value that MAS-82 verified against the
quote. The thresholds are the rubric's *Low* lines (`app/risk_analysis/
rubric.py`, payment terms / termination / auto-renewal), so the card and the
risk grading cannot disagree. To change a standard, change it here; a UI for
that is post-course (MAS-98).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Standard:
    term: str
    # One line the user sees next to a verdict, e.g. "net 30 days or longer".
    text: str


@dataclass(frozen=True)
class Verdict:
    # meets | deviates | unknown (stated, but no comparable typed value) | none (no standard)
    status: str
    standard: str | None = None
    # For deviations: how far, in the term's own unit.
    detail: str | None = None


STANDARDS: dict[str, Standard] = {
    "payment_deadline": Standard("payment_deadline", "net 30 days or longer"),
    "late_payment": Standard("late_payment", "at most 1% per month (12% per year)"),
    "notice_period": Standard("notice_period", "at most 60 days (2 months)"),
    "termination_cost": Standard("termination_cost", "no early-termination fee"),
}

NET_DAYS_MIN = 30
LATE_RATE_MAX_PER_MONTH = 1.0
NOTICE_DAYS_MAX = 60


def compare(term_id: str, typed: dict | None) -> Verdict:
    """The verdict for one stored key term; `typed` is the verified typed value or None."""
    standard = STANDARDS.get(term_id)
    if standard is None:
        return Verdict("none")
    if not typed:
        return Verdict("unknown", standard.text)
    if term_id == "payment_deadline":
        days = typed.get("net_days")
        if not isinstance(days, int):
            return Verdict("unknown", standard.text)
        if days >= NET_DAYS_MIN:
            return Verdict("meets", standard.text)
        return Verdict("deviates", standard.text, f"net {days} is {NET_DAYS_MIN - days} days shorter")
    if term_id == "late_payment":
        rate = typed.get("rate_percent")
        per = typed.get("per")
        if not isinstance(rate, (int, float)) or per not in ("month", "year"):
            # A fixed penalty has no rate to compare.
            return Verdict("unknown", standard.text)
        monthly = float(rate) if per == "month" else float(rate) / 12
        if monthly <= LATE_RATE_MAX_PER_MONTH + 1e-9:
            return Verdict("meets", standard.text)
        shown = f"{rate:g}% per {per}"
        return Verdict("deviates", standard.text, f"{shown} is {monthly / LATE_RATE_MAX_PER_MONTH:.1f}× the standard")
    if term_id == "notice_period":
        days = typed.get("days")
        months = typed.get("months")
        if isinstance(months, int) and not isinstance(days, int):
            days = months * 30
        if not isinstance(days, int):
            return Verdict("unknown", standard.text)
        if days <= NOTICE_DAYS_MAX:
            return Verdict("meets", standard.text)
        return Verdict("deviates", standard.text, f"{days} days is {days - NOTICE_DAYS_MAX} days longer")
    if term_id == "termination_cost":
        percent = typed.get("percent")
        amount = typed.get("amount")
        if isinstance(percent, (int, float)):
            if percent <= 0:
                return Verdict("meets", standard.text)
            return Verdict("deviates", standard.text, f"{percent:g}% of the remaining fees is payable")
        if not isinstance(amount, (int, float)):
            return Verdict("unknown", standard.text)
        if amount <= 0:
            return Verdict("meets", standard.text)
        currency = typed.get("currency", "")
        return Verdict("deviates", standard.text, f"a fee of {currency} {amount:,.0f} applies".strip())
    return Verdict("none")
