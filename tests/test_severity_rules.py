"""MAS-152: deterministic correction of a verified quote's severity against
the rubric's own numeric boundary -- narrow by design, never a guess."""

from uuid import uuid4

from app.retrieval.vector_store import ChunkHit
from app.risk_analysis.analyzer import RiskFinding
from app.risk_analysis.severity_rules import correct_termination_notice_severity

CONTRACT = uuid4()


def _finding(*, category: str = "termination", severity: str = "Medium", quote: str) -> RiskFinding:
    hit = ChunkHit(chunk_id=uuid4(), contract_id=CONTRACT, chunk_index=0, text=quote, score=0.8)
    return RiskFinding(
        category=category,
        category_name="Termination",
        severity=severity,
        reason="exceeding the low-risk threshold",
        quote=quote,
        label=1,
        hit=hit,
    )


def test_a_60_day_mutual_fee_free_notice_is_corrected_from_medium_to_low() -> None:
    finding = _finding(quote="Either party may terminate this Agreement for convenience upon 60 days' written notice, without payment of any fee.")

    corrected = correct_termination_notice_severity(finding)

    assert corrected.severity == "Low"
    assert "60 days" in corrected.reason and "Low" in corrected.reason
    assert corrected.quote == finding.quote  # the verified quote itself is never touched


def test_a_30_day_mutual_fee_free_notice_is_also_corrected_the_low_band_is_inclusive() -> None:
    finding = _finding(quote="Either party may terminate this Agreement for convenience upon 30 days' written notice, without payment of any fee.")

    assert correct_termination_notice_severity(finding).severity == "Low"


def test_a_notice_period_over_60_days_remains_eligible_for_medium() -> None:
    finding = _finding(quote="Either party may terminate this Agreement for convenience upon 90 days' written notice, without payment of any fee.")

    corrected = correct_termination_notice_severity(finding)

    assert corrected.severity == "Medium"
    assert corrected.reason == finding.reason  # untouched, not just the same severity


def test_a_stated_termination_fee_is_left_alone_even_within_the_low_day_range() -> None:
    finding = _finding(
        quote="Either party may terminate this Agreement for convenience upon 45 days' written notice, "
        "subject to an early termination fee of $10,000."
    )

    assert correct_termination_notice_severity(finding).severity == "Medium"


def test_a_one_sided_notice_clause_is_not_this_rules_concern() -> None:
    finding = _finding(quote="Vendor may terminate this Agreement for convenience upon 45 days' written notice with no fee.")

    assert correct_termination_notice_severity(finding).severity == "Medium"


def test_a_quote_with_no_day_count_is_left_alone() -> None:
    finding = _finding(quote="Either party may terminate this Agreement for cause with no fee.")

    assert correct_termination_notice_severity(finding).severity == "Medium"


def test_only_the_termination_category_is_corrected() -> None:
    finding = _finding(
        category="payment_terms",
        quote="Either party may terminate this Agreement for convenience upon 60 days' written notice, without payment of any fee.",
    )

    assert correct_termination_notice_severity(finding).severity == "Medium"


def test_an_already_low_finding_is_returned_unchanged() -> None:
    finding = _finding(severity="Low", quote="Either party may terminate this Agreement for convenience upon 60 days' written notice, without payment of any fee.")

    assert correct_termination_notice_severity(finding) is finding
