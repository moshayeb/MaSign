def retrieve_contract_context(question: str, contract_id: str | None = None) -> list[str]:
    scope = f"contract {contract_id}" if contract_id else "sample contract corpus"
    return [
        f"Retrieved placeholder context for '{question}' from {scope}.",
        "Example clause: Vendor liability is capped at fees paid in the previous 12 months.",
    ]
