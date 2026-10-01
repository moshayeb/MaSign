"""The expected-clause checklist MaSign checks for, per standard profile (MAS-188).

Like the key terms and risk rubric, the catalog is data: the checking prompt
and the API are built from the same definitions. Each clause is a yes/no
presence check, verified against the text the same way a key term or risk
finding is: a clause counts as present only with a verbatim quote naming it;
"absent" is only claimed once the whole-contract review completed for every
passage (honest-outcomes) -- an incomplete review reports "cannot tell",
never "absent". Which clauses apply is a property of a standard profile
(MAS-185), the same way the four numeric comparison rules are: the catalog
below is fixed, and a profile can disable entries it does not want checked.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Clause:
    id: str
    name: str
    looks_for: str


CLAUSES: tuple[Clause, ...] = (
    Clause(
        id="liability_cap",
        name="Liability cap",
        looks_for="A clause limiting or excluding a party's liability — a maximum amount, a multiple of fees, or types of loss excluded.",
    ),
    Clause(
        id="data_protection",
        name="Data protection",
        looks_for="A clause on handling personal data: GDPR/privacy compliance, or a data processing agreement/addendum.",
    ),
    Clause(
        id="insurance",
        name="Insurance",
        looks_for="A requirement that a party hold insurance of a stated type, amount, or for the contract's duration.",
    ),
    Clause(
        id="indemnification",
        name="Indemnification",
        looks_for="A clause where one party indemnifies, holds harmless, or compensates the other for third-party claims or losses.",
    ),
)

CLAUSE_IDS: tuple[str, ...] = tuple(c.id for c in CLAUSES)
CLAUSE_BY_ID: dict[str, Clause] = {c.id: c for c in CLAUSES}


def clauses_text(clause_ids: tuple[str, ...] = CLAUSE_IDS) -> str:
    """The clause checklist as the model sees it, limited to `clause_ids` -- a
    profile may have disabled some of the full catalog."""
    lines = ["Clauses to check for (report only these; a clause not in this list is never reported):"]
    for clause_id in clause_ids:
        clause = CLAUSE_BY_ID[clause_id]
        lines.append(f"- {clause.id} ({clause.name}): {clause.looks_for}")
    return "\n".join(lines)
