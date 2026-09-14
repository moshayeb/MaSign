def analyze_contract_risks(context: list[str]) -> list[str]:
    combined_context = " ".join(context).lower()
    risks: list[str] = []

    if "liability" in combined_context and "capped" in combined_context:
        risks.append("Review whether the liability cap is commercially acceptable.")

    if not risks:
        risks.append("No scaffolded risk rule matched; human review still required.")

    return risks
