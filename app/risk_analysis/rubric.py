"""The risk rubric (MAS-15): what MaSign looks for and how it grades it.

The rubric is data, so the prompt (analyzer.py) and docs/risk-rubric.md are
built from the same definitions. Findings are graded from the perspective of
the Customer — the party paying for and receiving the services — because
that is who uploads a contract to check it.
"""

from dataclasses import dataclass

SEVERITIES = ("Low", "Medium", "High")

PERSPECTIVE = (
    "Assess risk from the perspective of the Customer (the party paying for and receiving the "
    "services, goods or licence), unless a passage makes clear the uploader is the other party."
)


@dataclass(frozen=True)
class RiskCategory:
    id: str
    name: str
    looks_for: str
    high: str
    medium: str
    low: str


RISK_CATEGORIES: tuple[RiskCategory, ...] = (
    RiskCategory(
        id="liability",
        name="Liability cap",
        looks_for="Limits and exclusions of liability: caps, carve-outs, uncapped exposure, one-sidedness.",
        high="Customer's liability is unlimited or uncapped, or the cap is one-sided against Customer; "
        "Vendor excludes liability for its own gross negligence, wilful misconduct or data breaches.",
        medium="A cap below twelve months of fees, broad exclusions of indirect loss without carve-outs, "
        "or a cap that applies only to Vendor.",
        low="A mutual cap of at least twelve months of fees with the customary carve-outs (death or "
        "personal injury, fraud, confidentiality, IP infringement).",
    ),
    RiskCategory(
        id="termination",
        name="Termination",
        looks_for="Termination rights, notice periods, lock-in, early-termination fees and what survives.",
        high="Customer cannot terminate for convenience at all, or termination triggers a fee of 50% or "
        "more of the remaining contract value; Vendor may terminate at will without notice.",
        medium="Termination for convenience only after a minimum period or with notice over 60 days, "
        "or any early-termination fee; termination for cause with a cure period over 30 days.",
        low="Mutual termination for convenience on 30–60 days' notice with no fee.",
    ),
    RiskCategory(
        id="indemnification",
        name="Indemnification",
        looks_for="Who indemnifies whom, for what, and whether the indemnity is capped.",
        high="Customer must indemnify Vendor broadly (e.g. for any claim arising from the agreement) or "
        "without a cap; Vendor gives no IP-infringement indemnity.",
        medium="Indemnities are mutual but uncapped, or Vendor's indemnity has wide exclusions.",
        low="Vendor indemnifies for IP infringement and Customer's indemnity is limited to its own "
        "misuse or breach.",
    ),
    RiskCategory(
        id="auto_renewal",
        name="Auto-renewal",
        looks_for="Automatic renewal terms, renewal length and the window to give notice of non-renewal.",
        high="Renews automatically for twelve months or more with a non-renewal notice window of 90 days "
        "or longer, or renewal at increased fees set by Vendor alone.",
        medium="Automatic renewal with a notice window between 30 and 89 days, or renewal terms longer "
        "than the notice makes practical.",
        low="No automatic renewal, or renewal with 30 days' notice or less and unchanged fees.",
    ),
    RiskCategory(
        id="confidentiality",
        name="Confidentiality",
        looks_for="Scope and duration of confidentiality, one-sidedness, standard exceptions, data handling.",
        high="Only Customer is bound, obligations are perpetual with no exceptions, or Vendor may use "
        "Customer data for its own purposes.",
        medium="Obligations lack the usual exceptions (public knowledge, independently developed, legally "
        "required disclosure) or a defined duration.",
        low="Mutual obligations with standard exceptions and a defined survival period.",
    ),
    RiskCategory(
        id="payment_terms",
        name="Payment terms",
        looks_for="Fees, invoicing, payment windows, late interest, price increases, refunds and penalties.",
        high="Late interest above 1.5% per month, unilateral price increases without a cap, penalties "
        "beyond the fees, or all payments non-refundable regardless of Vendor's breach.",
        medium="Payment due in under 30 days, interest between 1% and 1.5% per month, annual increases "
        "without a cap, or suspension of service on any late payment without notice.",
        low="Net 30 or longer, interest at 1% per month or less, increases capped, disputes handled "
        "before suspension.",
    ),
    RiskCategory(
        id="ip_assignment",
        name="IP assignment",
        looks_for="Ownership of deliverables, data and improvements; licence scope and restrictions.",
        high="Customer assigns its own IP or data to Vendor, or Vendor owns deliverables Customer paid "
        "for with no licence back.",
        medium="Customer gets only a narrow, non-transferable licence to deliverables, or feedback and "
        "improvements become Vendor's without limit.",
        low="Customer owns its data and deliverables (or has a perpetual licence) and Vendor keeps its "
        "pre-existing platform IP.",
    ),
)

CATEGORY_IDS = tuple(category.id for category in RISK_CATEGORIES)
CATEGORY_BY_ID = {category.id: category for category in RISK_CATEGORIES}


def rubric_text() -> str:
    """The rubric as the model sees it."""
    lines = [PERSPECTIVE, "", "Categories and severity:"]
    for category in RISK_CATEGORIES:
        lines += [
            f"- {category.id} ({category.name}): {category.looks_for}",
            f"    High: {category.high}",
            f"    Medium: {category.medium}",
            f"    Low: {category.low}",
        ]
    return "\n".join(lines)
