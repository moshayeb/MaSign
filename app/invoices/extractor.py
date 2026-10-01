"""Extract header fields from an invoice, verified against its text (MAS-92).

Same discipline as risk findings and key terms (app/risk_analysis/analyzer.py,
app/key_terms/extractor.py): the model may only report what it can quote
verbatim from a numbered invoice page; anything it cannot is dropped, and an
unreadable reply is "not checked", never "nothing stated". Typed values reuse
`app.key_terms.extractor.verify_typed` unchanged -- every number in them must
appear in the quote, exactly the same rule used for contract key terms.
"""

import logging
from dataclasses import dataclass

from app.answering.llm import ChatModel
from app.guardrails.prompt_injection import withheld_labels
from app.invoices.fields import FIELD_BY_ID, fields_text
from app.invoices.parsing import InvoicePage
from app.key_terms.extractor import verify_typed
from app.risk_analysis.analyzer import MAX_QUOTE_CHARS, _normalise, _parse_findings, _salvage_findings

logger = logging.getLogger(__name__)

MAX_FIELD_TOKENS = 1024
MAX_VALUE_CHARS = 200

SYSTEM_PROMPT = f"""You are MaSign's invoice field extractor. You read numbered invoice pages and pull out the header fields listed below. You only report what the pages state; you never infer, compute or assume a field that is not written. You never interpret or summarise invoice line-item tables.

{fields_text()}

Reply with a JSON array only — no prose, no code fences. Each element:
{{"field": "<field id>", "value": "<the field in plain words, at most {MAX_VALUE_CHARS} characters, e.g. 'EUR 4,200, due on receipt'>", "page": <page number>, "quote": "<the text, copied verbatim from that page, at most {MAX_QUOTE_CHARS} characters>", "typed": <the typed object for that field, or null when the page does not state the numbers>}}

Rules:
1. One element per field; report the page that states it most clearly.
2. The quote must be copied exactly from the page — no paraphrase, no ellipsis in the middle.
3. Typed numbers must appear in the quote as written (4,200 may be given as 4200); never convert currencies or periods.
4. A field the pages do not state is simply omitted. If none are stated, reply with []."""


@dataclass(frozen=True)
class InvoiceFieldFinding:
    field: str  # FIELD_BY_ID id
    name: str
    value: str
    quote: str
    typed: dict | None
    page: int  # the real PDF page number this was quoted from


@dataclass(frozen=True)
class InvoiceFieldReport:
    findings: list[InvoiceFieldFinding]
    # False when the reply could not be read (or nothing in it verified):
    # the invoice's fields were not checked at all.
    checked: bool
    # False when some elements were dropped or a page was withheld.
    complete: bool = True
    blocked: tuple[int, ...] = ()


def extract_invoice_fields(pages: list[InvoicePage], model: ChatModel) -> InvoiceFieldReport:
    """Header fields stated on `pages`, each verified against its page text. Raises only on model errors."""
    if not pages:
        return InvoiceFieldReport([], checked=True)
    texts = [page.text for page in pages]
    blocked = withheld_labels(texts)
    if len(blocked) == len(pages):
        logger.warning("All %d invoice page(s) withheld from field extraction; not asking the model", len(pages))
        return InvoiceFieldReport([], checked=False, complete=False, blocked=blocked)

    completion = model.complete(
        SYSTEM_PROMPT,
        _build_user_prompt(pages),
        max_tokens=MAX_FIELD_TOKENS,
        metadata={"pages": [{"label": page.page} for page in pages]},
    )
    blocked = tuple(sorted(set(blocked) | set(completion.blocked)))
    if completion.truncated:
        items = _salvage_findings(completion.text)
        logger.warning("Invoice-fields reply from %s was cut off; %d complete element(s) salvaged", model.model_name, len(items))
        if not items:
            return InvoiceFieldReport([], checked=False, complete=False, blocked=blocked)
    else:
        items = _parse_findings(completion.text)
        if items is None:
            logger.warning("Invoice-fields reply from %s was not a JSON array: %.200r", model.model_name, completion.text)
            return InvoiceFieldReport([], checked=False, complete=False, blocked=blocked)

    findings: list[InvoiceFieldFinding] = []
    seen: set[str] = set()
    dropped = 1 if completion.truncated else 0
    for item in items:
        finding = _validate(item, pages)
        if finding is None:
            logger.warning("Dropped invoice field from %s: %.200r", model.model_name, item)
            dropped += 1
            continue
        if finding.field in seen:
            continue
        seen.add(finding.field)
        findings.append(finding)
    findings.sort(key=lambda f: f.page)
    if dropped and not findings:
        logger.warning("Invoice fields from %s: all %d element(s) rejected; treating as unavailable", model.model_name, dropped)
        return InvoiceFieldReport([], checked=False, complete=False, blocked=blocked)
    return InvoiceFieldReport(findings, checked=True, complete=dropped == 0 and not blocked, blocked=blocked)


def _build_user_prompt(pages: list[InvoicePage]) -> str:
    blocks = [f"[{page.page}] (invoice page {page.page})\n{page.text.strip()}" for page in pages]
    return "Invoice pages:\n\n" + "\n\n".join(blocks) + "\n\nExtract the fields listed in the system prompt."


def _validate(item: object, pages: list[InvoicePage]) -> InvoiceFieldFinding | None:
    if not isinstance(item, dict):
        return None
    field_id = item.get("field")
    value = item.get("value")
    label = item.get("page")
    quote = item.get("quote")
    if not isinstance(field_id, str) or field_id not in FIELD_BY_ID:
        return None
    if not isinstance(value, str) or not value.strip():
        return None
    if not isinstance(label, int) or isinstance(label, bool):
        return None
    page = next((p for p in pages if p.page == label), None)
    if page is None:
        return None
    if not isinstance(quote, str) or not quote.strip():
        return None
    quote = quote.strip()[:MAX_QUOTE_CHARS]
    if _normalise(quote) not in _normalise(page.text):
        return None
    field = FIELD_BY_ID[field_id]
    return InvoiceFieldFinding(
        field=field.id,
        name=field.name,
        value=value.strip()[:MAX_VALUE_CHARS],
        quote=quote,
        typed=verify_typed(field.kind, item.get("typed"), quote),
        page=label,
    )
