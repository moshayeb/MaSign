"""The Customer's positions for the key terms that have a number (MAS-96).

A standard is a rule over a term's typed value -- never over its text -- so a
verdict is only ever given for a value that MAS-82 verified against the
quote. Each standard's numbers live in a `params` dict; MaSign's built-in
defaults below are the fallback whenever no row is stored for a term
(`app/database/repository.py` `get_standard`/`get_standards`). Since MAS-120
those numbers are editable through `PUT /api/standards/{term_id}`; a stored
row overrides the default, and deleting it (`DELETE /api/standards/{term_id}`)
restores the default rather than ever writing default values back as a row --
the default lives in exactly one place, here.
"""

from dataclasses import dataclass
from typing import Any

CURRENCIES = ("USD", "EUR", "SEK")
TERMINATION_MODES = ("no_fee", "percent_cap", "amount_cap")

# The numbers a fresh install ships with, unchanged from MAS-96's rule.
DEFAULT_PARAMS: dict[str, dict[str, Any]] = {
    "payment_deadline": {"net_days_min": 30},
    "late_payment": {"rate_max_per_month_percent": 1.0},
    "notice_period": {"notice_days_max": 60},
    "termination_cost": {"mode": "no_fee", "max_percent": None, "max_amount": None, "currency": None},
}

STANDARD_TERM_IDS = tuple(DEFAULT_PARAMS.keys())


@dataclass(frozen=True)
class Verdict:
    # meets | deviates | unknown (stated, but not comparable to this standard) | none (no standard)
    status: str
    standard: str | None = None
    # For deviations: how far, in the term's own unit.
    detail: str | None = None


def effective_params(term_id: str, stored: dict[str, Any] | None) -> dict[str, Any]:
    """The params to compare against: the stored override, or MaSign's default."""
    if term_id not in DEFAULT_PARAMS:
        return {}
    return stored if stored is not None else DEFAULT_PARAMS[term_id]


def describe(term_id: str, params: dict[str, Any]) -> str:
    """The one line a user sees next to a verdict, computed from `params` so
    it can never drift from the stored numbers."""
    if term_id == "payment_deadline":
        return f"net {params['net_days_min']} days or longer"
    if term_id == "late_payment":
        rate = params["rate_max_per_month_percent"]
        return f"at most {rate:g}% per month ({rate * 12:g}% per year)"
    if term_id == "notice_period":
        return f"at most {params['notice_days_max']} days"
    if term_id == "termination_cost":
        mode = params["mode"]
        if mode == "no_fee":
            return "no early-termination fee"
        if mode == "percent_cap":
            return f"at most {params['max_percent']:g}% of the remaining fees"
        currency = params["currency"]
        return f"at most {currency} {params['max_amount']:,.0f}"
    return ""


def validate_params(term_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    """Clean and validate a save request; raises ValueError with a user-facing message."""
    if term_id == "payment_deadline":
        days = _positive_int(raw.get("net_days_min"), "Payment deadline")
        return {"net_days_min": days}
    if term_id == "late_payment":
        rate = _non_negative_number(raw.get("rate_max_per_month_percent"), "Maximum late interest")
        if rate > 100:
            raise ValueError("Maximum late interest must be 100% or less.")
        return {"rate_max_per_month_percent": rate}
    if term_id == "notice_period":
        days = _positive_int(raw.get("notice_days_max"), "Notice period")
        return {"notice_days_max": days}
    if term_id == "termination_cost":
        mode = raw.get("mode")
        if mode not in TERMINATION_MODES:
            raise ValueError(f"Termination-cost preference must be one of {', '.join(TERMINATION_MODES)}.")
        if mode == "no_fee":
            return {"mode": "no_fee", "max_percent": None, "max_amount": None, "currency": None}
        if mode == "percent_cap":
            percent = _non_negative_number(raw.get("max_percent"), "Maximum termination fee")
            if percent > 100:
                raise ValueError("Maximum termination fee must be 100% or less.")
            return {"mode": "percent_cap", "max_percent": percent, "max_amount": None, "currency": None}
        amount = _non_negative_number(raw.get("max_amount"), "Maximum termination fee")
        currency = raw.get("currency")
        if currency not in CURRENCIES:
            raise ValueError(f"Currency must be one of {', '.join(CURRENCIES)}.")
        return {"mode": "amount_cap", "max_percent": None, "max_amount": amount, "currency": currency}
    raise ValueError(f"Unknown standard: {term_id}")


def _positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be a whole number of days.")
    if not (0 <= value <= 3650):
        raise ValueError(f"{label} must be between 0 and 3650 days.")
    return value


def _non_negative_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a number.")
    if value < 0:
        raise ValueError(f"{label} cannot be negative.")
    return float(value)


def compare(term_id: str, typed: dict | None, params: dict[str, Any] | None = None) -> Verdict:
    """The verdict for one stored key term; `typed` is the verified typed
    value or None. `params` defaults to MaSign's built-in standard."""
    if term_id not in DEFAULT_PARAMS:
        return Verdict("none")
    params = params if params is not None else DEFAULT_PARAMS[term_id]
    standard_text = describe(term_id, params)
    if not typed:
        return Verdict("unknown", standard_text)

    if term_id == "payment_deadline":
        days = typed.get("net_days")
        if not isinstance(days, int):
            return Verdict("unknown", standard_text)
        min_days = params["net_days_min"]
        if days >= min_days:
            return Verdict("meets", standard_text)
        return Verdict("deviates", standard_text, f"net {days} is {min_days - days} days shorter")

    if term_id == "late_payment":
        rate = typed.get("rate_percent")
        per = typed.get("per")
        if not isinstance(rate, (int, float)) or per not in ("month", "year"):
            # A fixed penalty has no rate to compare.
            return Verdict("unknown", standard_text)
        monthly = float(rate) if per == "month" else float(rate) / 12
        cap = params["rate_max_per_month_percent"]
        if monthly <= cap + 1e-9:
            return Verdict("meets", standard_text)
        shown = f"{rate:g}% per {per}"
        if cap == 0:
            return Verdict("deviates", standard_text, f"{shown} exceeds the 0% standard")
        return Verdict("deviates", standard_text, f"{shown} is {monthly / cap:.1f}× the standard")

    if term_id == "notice_period":
        days = typed.get("days")
        months = typed.get("months")
        if isinstance(months, int) and not isinstance(days, int):
            days = months * 30
        if not isinstance(days, int):
            return Verdict("unknown", standard_text)
        max_days = params["notice_days_max"]
        if days <= max_days:
            return Verdict("meets", standard_text)
        return Verdict("deviates", standard_text, f"{days} days is {days - max_days} days longer")

    if term_id == "termination_cost":
        return _compare_termination_cost(typed, params, standard_text)

    return Verdict("none")


def _compare_termination_cost(typed: dict, params: dict[str, Any], standard_text: str) -> Verdict:
    mode = params["mode"]
    percent = typed.get("percent")
    amount = typed.get("amount")

    if isinstance(percent, (int, float)):
        if mode == "amount_cap":
            # A percent-of-fees term can't be checked against an absolute cap
            # without knowing the contract's total value -- say so, don't guess.
            return Verdict("unknown", standard_text)
        cap = 0.0 if mode == "no_fee" else params["max_percent"]
        if percent <= cap:
            return Verdict("meets", standard_text)
        return Verdict("deviates", standard_text, f"{percent:g}% of the remaining fees is payable")

    if isinstance(amount, (int, float)):
        if mode == "no_fee":
            if amount <= 0:
                return Verdict("meets", standard_text)
            currency = typed.get("currency", "")
            return Verdict("deviates", standard_text, f"a fee of {currency} {amount:,.0f} applies".strip())
        if mode == "percent_cap":
            # Same gap in the other direction: an absolute fee can't be
            # checked against a percent-of-fees cap without the contract value.
            return Verdict("unknown", standard_text)
        # amount_cap: only comparable when the contract's currency matches the
        # configured one -- MaSign does not convert currencies.
        typed_currency = typed.get("currency")
        if typed_currency != params["currency"]:
            return Verdict("unknown", standard_text)
        if amount <= params["max_amount"]:
            return Verdict("meets", standard_text)
        return Verdict("deviates", standard_text, f"a fee of {typed_currency} {amount:,.0f} exceeds the standard")

    return Verdict("unknown", standard_text)
