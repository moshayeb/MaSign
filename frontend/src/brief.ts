import type { KeyTermValue, ReviewFinding, RiskReview, Severity } from './api'
import type { SourceRef } from './components/PassageReader'

// The "Before you sign" card (MAS-105/106/111) is derived here, by rule, from
// the stored review: no model call, so nothing can be invented. Every fact
// and every checklist item names the term, finding, deadline or coverage
// figure it came from, and an absent term is "not stated in the reviewed
// text" only when the key-terms pass completed — otherwise "not checked".

export interface BriefFact {
  id: 'term' | 'cost' | 'renewal' | 'leaving' | 'risks'
  label: string
  text: string
  source?: SourceRef
  // A quieter second line: what is missing or how the value was reached (MAS-218 calm pass).
  note?: string
  // True when the fact is a gap ("Not checked" / "Not stated"), never a value.
  missing?: boolean
  // 'warn' when the fact is a deviation or a Medium risk, 'high' for a High risk.
  tone?: 'warn' | 'high' | 'ok'
}

export interface CheckItem {
  id: string
  kind: 'finding' | 'deviation' | 'missing' | 'missing_document' | 'deadline' | 'coverage'
  severity?: Severity
  text: string
  detail?: string
  source?: SourceRef
}

// The terms whose absence is worth a checklist item on its own.
export const IMPORTANT_TERMS = ['effective_date', 'recurring_fee', 'initial_term', 'notice_period', 'termination_cost'] as const

const SEVERITY_ORDER: Record<Severity, number> = { High: 0, Medium: 1, Low: 2 }

function term(review: RiskReview, id: string): KeyTermValue | undefined {
  return review.key_terms.find((t) => t.id === id)
}

function stated(t: KeyTermValue | undefined): t is KeyTermValue & { source: NonNullable<KeyTermValue['source']> } {
  return !!t && (t.status === 'found' || t.status === 'conflicting') && t.source !== null
}

// How an absent term is described: absence is a fact only after a complete pass.
function absent(review: RiskReview, t: KeyTermValue | undefined): string {
  if (!t || t.status === 'unchecked' || !review.key_terms_complete) return 'not checked'
  return 'not stated in the reviewed text'
}

// "not checked" -> "Not checked": a gap shown as the tile's main line.
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function value(t: KeyTermValue): string {
  return t.status === 'conflicting' ? `${t.value} (stated differently elsewhere)` : t.value
}

function source(t: KeyTermValue): SourceRef {
  return { chunk_index: t.source!.chunk_index, quote: t.source!.quote }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "30 Nov 2028" — the same form the deadline formulas use, whatever the browser locale.
function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso
}

function severityCounts(findings: ReviewFinding[]): string {
  return (['High', 'Medium', 'Low'] as Severity[])
    .map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(' · ')
}

// The 3–5 facts of "In brief" (MAS-105). Only meaningful for a finished review.
export function buildBrief(review: RiskReview): BriefFact[] {
  const effective = term(review, 'effective_date')
  const initial = term(review, 'initial_term')
  const recurring = term(review, 'recurring_fee')
  const oneOff = term(review, 'one_off_fee')
  const renewal = term(review, 'renewal')
  const notice = term(review, 'notice_period')
  const leaving = term(review, 'termination_cost')
  const termEnd = review.deadlines?.find((d) => d.id === 'term_end')
  const noticeBy = review.deadlines?.find((d) => d.id === 'notice_deadline')

  const facts: BriefFact[] = []

  // Term
  if (stated(initial) && stated(effective)) {
    facts.push({
      id: 'term',
      label: 'Term',
      text: `${value(initial)} from ${value(effective)}${termEnd?.date ? `, ending ${formatDate(termEnd.date)}` : ''}`,
      source: source(initial),
    })
  } else if (stated(initial)) {
    facts.push({ id: 'term', label: 'Term', text: value(initial), note: `Start date ${absent(review, effective)}`, source: source(initial) })
  } else if (stated(effective)) {
    facts.push({ id: 'term', label: 'Term', text: `From ${value(effective)}`, note: `Initial term ${absent(review, initial)}`, source: source(effective) })
  } else {
    facts.push({ id: 'term', label: 'Term', text: sentence(absent(review, initial)), note: 'Initial term', missing: true })
  }

  // Cost
  if (stated(recurring)) {
    facts.push({
      id: 'cost',
      label: 'Cost',
      text: `${value(recurring)}${stated(oneOff) ? ` · one-off ${value(oneOff)}` : ''}`,
      source: source(recurring),
    })
  } else if (stated(oneOff)) {
    facts.push({ id: 'cost', label: 'Cost', text: `One-off ${value(oneOff)}`, note: `Recurring fee ${absent(review, recurring)}`, source: source(oneOff) })
  } else {
    facts.push({ id: 'cost', label: 'Cost', text: sentence(absent(review, recurring)), note: 'Recurring fee', missing: true })
  }

  // Renewal
  if (stated(renewal)) {
    const note = noticeBy?.date
      ? `Notice by ${formatDate(noticeBy.date)}${stated(notice) ? ` (${value(notice)})` : ''}`
      : stated(notice)
        ? `${value(notice)} notice`
        : undefined
    facts.push({ id: 'renewal', label: 'Renewal', text: value(renewal), note, source: source(renewal) })
  } else {
    facts.push({
      id: 'renewal',
      label: 'Renewal',
      text: sentence(absent(review, renewal)),
      note: stated(notice) ? `Notice period ${value(notice)}` : undefined,
      missing: true,
      source: stated(notice) ? source(notice) : undefined,
    })
  }

  // Ending early
  if (stated(leaving)) {
    facts.push({
      id: 'leaving',
      label: 'Ending early',
      text: value(leaving),
      source: source(leaving),
      tone: leaving.standard?.status === 'deviates' ? 'warn' : undefined,
    })
  } else {
    facts.push({ id: 'leaving', label: 'Ending early', text: sentence(absent(review, leaving)), note: 'Termination cost', missing: true })
  }

  // Risks
  if (review.findings.length > 0) {
    const names = [...new Set([...review.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).map((f) => f.category_name))]
    const worst = review.findings.some((f) => f.severity === 'High') ? 'high' : review.findings.some((f) => f.severity === 'Medium') ? 'warn' : undefined
    facts.push({ id: 'risks', label: 'Risks', text: `${severityCounts(review.findings)}: ${names.join(', ')}`, tone: worst })
  } else if (review.complete) {
    facts.push({ id: 'risks', label: 'Risks', text: `nothing flagged in ${review.categories.length} categories`, tone: 'ok' })
  } else {
    facts.push({ id: 'risks', label: 'Risks', text: `nothing flagged in the ${review.chunks_checked} of ${review.chunks_total} passages graded` })
  }

  return facts
}

// The "Needs attention" checklist (MAS-106/111): one item per High/Medium
// finding, per deviation, per important term not stated, the notice
// deadline, and an incomplete review. Empty means nothing needs attention.
export function buildChecklist(review: RiskReview, today = new Date()): CheckItem[] {
  const items: CheckItem[] = []

  const findings = [...review.findings]
    .filter((f) => f.severity !== 'Low')
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.chunk_index - b.chunk_index)
  for (const f of findings) {
    items.push({
      id: `finding-${f.category}-${f.chunk_id}`,
      kind: 'finding',
      severity: f.severity,
      text: f.category_name,
      detail: f.reason,
      source: { chunk_index: f.chunk_index, quote: f.quote },
    })
  }

  for (const t of review.key_terms) {
    if (stated(t) && t.standard?.status === 'deviates') {
      items.push({
        id: `deviation-${t.id}`,
        kind: 'deviation',
        text: t.name,
        detail: `${t.value} — your rule: ${t.standard.standard ?? ''}`,
        source: source(t),
      })
    }
  }

  const external = (review.coverage?.external_references ?? []).map((r) => r.name)
  if (review.key_terms_complete) {
    for (const id of IMPORTANT_TERMS) {
      const t = term(review, id)
      if (t && t.status === 'not_stated') {
        items.push({
          id: `missing-${id}`,
          kind: 'missing',
          text: `${t.name} not stated`,
          detail: external.length > 0 ? `may be in ${external.join(' or ')} (not uploaded) — ask where it is agreed` : 'ask where it is agreed',
        })
      }
    }
  }

  // A document the text depends on that nobody uploaded: something to fetch
  // before signing, not only a note above the card (MAS-123). One item per
  // document, however many passages refer to it.
  for (const reference of review.coverage?.external_references ?? []) {
    const passages = reference.passages ?? reference.chunk_indexes ?? []
    const [first] = passages
    const passageNames = passages.map((passage) => {
      if (typeof passage === 'number') return passage + 1
      return `${passage.filename}, passage ${passage.chunk_index + 1}`
    })
    items.push({
      id: `document-${reference.name}`,
      kind: 'missing_document',
      text: `Get ${reference.name} before signing`,
      detail: `referred to in ${passages.length === 1 ? 'passage' : 'passages'} ${passageNames.join(', ')} but not uploaded, so what it says could not be reviewed`,
      // Cross-document passage navigation belongs to the bundle reader in
      // MAS-140. A legacy, primary-document number remains clickable here.
      source: typeof first === 'number' ? { chunk_index: first } : undefined,
    })
  }

  const noticeBy = review.deadlines?.find((d) => d.id === 'notice_deadline')
  if (noticeBy?.date) {
    const when = new Date(`${noticeBy.date}T00:00:00`)
    const midnight = new Date(today)
    midnight.setHours(0, 0, 0, 0)
    if (when.getTime() >= midnight.getTime()) {
      items.push({ id: 'deadline-notice', kind: 'deadline', text: 'Diary the notice deadline', detail: `${formatDate(noticeBy.date)} (${noticeBy.how ?? 'computed from the key terms'})` })
    }
  }

  if (review.status === 'done' && !review.complete) {
    const ungraded = review.chunks_total - review.chunks_checked
    items.push({
      id: 'coverage',
      kind: 'coverage',
      text: `${ungraded} passage${ungraded === 1 ? ' was' : 's were'} not graded`,
      detail: `read ${ungraded === 1 ? 'it' : 'them'} yourself, or run the review again`,
    })
  }

  return items
}
