def build_follow_up_actions(risks: list[str]) -> list[str]:
    if not risks:
        return ["Archive analysis result."]

    return [
        "Create a legal review task.",
        "Ask the contract owner to confirm risk tolerance.",
    ]
