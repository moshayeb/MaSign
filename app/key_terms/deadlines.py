"""Dates that follow from the typed key terms (MAS-100): arithmetic, never a model.

term_end          = effective_date + initial_term − 1 day   (the day before the anniversary)
notice_deadline   = term_end − notice_period      (only when a renewal period is typed:
                                                   that is the last day to stop the renewal)
next_renewal_end  = term_end + renewal period               (again to the day before)

Every result names the terms it was computed from, and a result that cannot
be computed says which input is missing or text-only — "cannot compute" is a
value, not a blank (honest-outcomes rule 5).
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True)
class Deadline:
    id: str  # term_end | notice_deadline | next_renewal_end
    name: str
    date: date | None
    computed_from: tuple[str, ...] = ()
    reason: str | None = None  # why `date` is None
    # A short human formula, e.g. "1 Mar 2026 + 36 months"
    how: str | None = None


def add_months(start: date, months: int) -> date:
    """`start` plus `months`, clamped to the last day of the target month (31 Jan + 1 → 28/29 Feb)."""
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def add_duration(start: date, typed: dict) -> date | None:
    if isinstance(typed.get("months"), int):
        return add_months(start, typed["months"])
    if isinstance(typed.get("days"), int):
        return start + timedelta(days=typed["days"])
    return None


def _describe(typed: dict) -> str:
    if isinstance(typed.get("months"), int):
        return f"{typed['months']} months"
    if isinstance(typed.get("days"), int):
        return f"{typed['days']} days"
    return "?"


def compute_deadlines(typed: dict[str, dict | None], stated: set[str]) -> list[Deadline]:
    """`typed` maps term id → verified typed value (or None); `stated` are the terms found at all."""

    def missing(term: str, label: str) -> str:
        if term not in stated:
            return f"{label} not stated in the reviewed text"
        return f"{label} stated, but not as a number the text confirms"

    effective = _iso(typed.get("effective_date"))
    initial = typed.get("initial_term")
    notice = typed.get("notice_period")
    renewal = typed.get("renewal")

    results: list[Deadline] = []

    # 1. term end
    if effective is None:
        results.append(Deadline("term_end", "Initial term ends", None, reason=missing("effective_date", "effective date")))
        term_end = None
    elif not initial or add_duration(effective, initial) is None:
        results.append(Deadline("term_end", "Initial term ends", None, ("effective_date",), reason=missing("initial_term", "initial term")))
        term_end = None
    else:
        # A term "of 36 months from 1 March 2026" ends on 28 Feb 2029, the day before the anniversary.
        term_end = add_duration(effective, initial) - timedelta(days=1)  # type: ignore[operator]
        results.append(
            Deadline(
                "term_end", "Initial term ends", term_end, ("effective_date", "initial_term"), how=f"{_short(effective)} + {_describe(initial)} − 1 day"
            )
        )

    # 2. last day to stop the renewal
    if term_end is None:
        results.append(Deadline("notice_deadline", "Give notice by", None, reason="the term end could not be computed"))
    elif not renewal or add_duration(term_end, renewal) is None:
        reason = (
            "no renewal period is stated, so the notice period applies to termination, not to stopping a renewal"
            if "renewal" not in stated
            else "the renewal is stated, but not as a period the text confirms"
        )
        results.append(Deadline("notice_deadline", "Give notice by", None, ("initial_term",), reason=reason))
    elif not notice or _notice_days(notice) is None:
        results.append(Deadline("notice_deadline", "Give notice by", None, ("effective_date", "initial_term"), reason=missing("notice_period", "notice period")))
    else:
        days = _notice_days(notice)
        assert days is not None
        results.append(
            Deadline(
                "notice_deadline",
                "Give notice by",
                term_end - timedelta(days=days),
                ("effective_date", "initial_term", "notice_period"),
                how=f"{_short(term_end)} − {days} days",
            )
        )

    # 3. the renewal period after the term
    if term_end is None:
        results.append(Deadline("next_renewal_end", "First renewal runs to", None, reason="the term end could not be computed"))
    elif not renewal or add_duration(term_end, renewal) is None:
        reason = "no renewal period is stated" if "renewal" not in stated else "the renewal is stated, but not as a period the text confirms"
        results.append(Deadline("next_renewal_end", "First renewal runs to", None, ("initial_term",), reason=reason))
    else:
        end = add_duration(term_end + timedelta(days=1), renewal) - timedelta(days=1)  # type: ignore[operator]
        results.append(
            Deadline(
                "next_renewal_end",
                "First renewal runs to",
                end,
                ("effective_date", "initial_term", "renewal"),
                how=f"{_short(term_end)} + {_describe(renewal)}",
            )
        )
    return results


def _notice_days(typed: dict) -> int | None:
    if isinstance(typed.get("days"), int):
        return typed["days"]
    if isinstance(typed.get("months"), int):
        return typed["months"] * 30
    return None


def _iso(typed: dict | None) -> date | None:
    if not typed or not isinstance(typed.get("date"), str):
        return None
    try:
        return date.fromisoformat(typed["date"])
    except ValueError:
        return None


def _short(value: date) -> str:
    return f"{value.day} {calendar.month_abbr[value.month]} {value.year}"
