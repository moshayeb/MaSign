"""Deterministic severity correction for unambiguous numeric rubric boundaries (MAS-152).

A live review graded a verified 60-day mutual termination notice clause as
Medium ("exceeding the low-risk threshold"), when the rubric's Low band for
termination is explicitly "30-60 days' notice with no fee" -- 60 is the
inclusive upper bound, not an excess of it. The model's quote and passage
were correct; only its arithmetic on the rubric's own numeric boundary was
wrong.

This is deliberately narrow (MAS-152's option 2, not option 1): it corrects
one well-defined rule -- termination notice days against the rubric's 30-60
Low band -- and only when the quote itself makes mutuality and the absence
of a fee unambiguous. Anything the quote does not clearly state (a one-sided
clause, an unclear fee, no day count at all) is left exactly as the model
graded it: an unverifiable correction would be worse than the bug it fixes.
"""

import re
from dataclasses import replace
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.risk_analysis.analyzer import RiskFinding

TERMINATION_LOW_DAYS = range(30, 61)  # rubric: "30-60 days' notice with no fee" is Low

_NOTICE_DAYS = re.compile(r"(\d{1,3})\s*(?:calendar\s+)?days?(?:['’]|\s+of)?\s*(?:prior\s+)?(?:written\s+)?notice", re.IGNORECASE)
_MUTUAL = re.compile(r"\b(mutual(?:ly)?|either party|both parties)\b", re.IGNORECASE)
_FEE_AMOUNT = re.compile(r"[$€£]\s*\d|\d+(?:\.\d+)?\s*%|\bfee of\b", re.IGNORECASE)
_NO_FEE = re.compile(r"\bno\b[^.]{0,20}\bfee\b|\bwithout\b[^.]{0,30}\bfee\b", re.IGNORECASE)


def correct_termination_notice_severity(finding: "RiskFinding") -> "RiskFinding":
    """Downgrade a termination finding to Low when the quote unambiguously
    describes a 30-60 day mutual, fee-free notice period -- the rubric's own
    Low band. Anything less than fully unambiguous is left untouched.
    """
    if finding.category != "termination" or finding.severity == "Low":
        return finding
    quote = finding.quote
    days_match = _NOTICE_DAYS.search(quote)
    if days_match is None:
        return finding
    days = int(days_match.group(1))
    if days not in TERMINATION_LOW_DAYS:
        return finding  # over 60 days remains eligible for Medium, per the rubric
    if _MUTUAL.search(quote) is None:
        return finding  # a one-sided clause is not this rule's concern
    if _FEE_AMOUNT.search(quote) is not None or _NO_FEE.search(quote) is None:
        return finding  # a stated fee, or no clear "no fee" language, is ambiguous
    corrected_reason = (
        f"{finding.reason} Severity corrected: the rubric's termination category grades "
        f"{days} days' mutual, fee-free notice as Low (30-60 day band), not "
        f"{finding.severity}."
    )
    return replace(finding, severity="Low", reason=corrected_reason)
