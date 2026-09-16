"""Suggested next steps derived from the risk findings (deterministic, no model)."""

from app.risk_analysis.analyzer import RiskFinding


def build_follow_up_actions(findings: list[RiskFinding], *, checked: bool = True) -> list[str]:
    if not checked:
        return ["Risk analysis was unavailable for this answer; ask again or review the passages manually."]
    if not findings:
        return ["No risk flagged in these passages; review the rest of the contract before relying on this."]

    actions: list[str] = []
    high = [f for f in findings if f.severity == "High"]
    medium = [f for f in findings if f.severity == "Medium"]
    if high:
        actions.append(
            "Escalate to legal review before signing: " + ", ".join(sorted({f.category_name for f in high})) + "."
        )
    if medium:
        actions.append("Raise in negotiation: " + ", ".join(sorted({f.category_name for f in medium})) + ".")
    if not actions:
        actions.append("Low-severity points only; note them for the contract owner.")
    actions.append("Confirm the flagged clauses against the full contract, not only the retrieved passages.")
    return actions
