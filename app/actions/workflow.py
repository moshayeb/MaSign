"""Suggested next steps derived from the risk findings (deterministic, no model)."""

from app.risk_analysis.analyzer import RiskFinding


def build_follow_up_actions(findings: list[RiskFinding], *, checked: bool = True, withheld: int = 0) -> list[str]:
    if withheld and not checked:
        # Asking again would change nothing: the text itself is the problem (MAS-93/94).
        return [
            "Read the withheld passage(s) yourself: they contain instructions addressed to the AI, "
            "which a genuine contract has no reason to carry. Ask the counterparty to explain that text."
        ]
    if not checked:
        return ["Risk analysis was unavailable for this answer; ask again or review the passages manually."]
    actions: list[str] = []
    if withheld:
        actions.append(
            f"{withheld} passage(s) were withheld from the model and not graded; read them yourself before relying on this."
        )
    if not findings:
        return actions + ["No risk flagged in the passages the model could read; review the rest of the contract before relying on this."]


    high = [f for f in findings if f.severity == "High"]
    medium = [f for f in findings if f.severity == "Medium"]
    if high:
        actions.append(
            "Escalate to legal review before signing: " + ", ".join(sorted({f.category_name for f in high})) + "."
        )
    if medium:
        actions.append("Raise in negotiation: " + ", ".join(sorted({f.category_name for f in medium})) + ".")
    if not high and not medium:
        actions.append("Low-severity points only; note them for the contract owner.")
    actions.append("Confirm the flagged clauses against the full contract, not only the retrieved passages.")
    return actions
