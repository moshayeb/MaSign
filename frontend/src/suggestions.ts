import type { RiskReview } from './api'

// Suggested questions for the Ask tab (MAS-108): a fixed Customer-side set,
// ranked by what the stored review found — a term the review could not find
// comes first (the honest "Not found" is worth seeing once), then the terms
// that deviate from the standard and the categories with a High finding.
// No model call: the ranking is a few rules over data already on screen.

export interface Suggestion {
  text: string
  // Why it was ranked where it is; shown as the chip's title.
  reason: string | null
}

interface Candidate {
  text: string
  terms: string[]
  categories: string[]
}

const CANDIDATES: Candidate[] = [
  { text: 'When can I terminate this agreement?', terms: ['notice_period', 'termination_cost'], categories: ['termination'] },
  { text: 'What happens if I pay late?', terms: ['late_payment'], categories: ['payment_terms'] },
  { text: 'Does this contract renew automatically?', terms: ['renewal'], categories: ['auto_renewal'] },
  { text: 'What are my financial obligations?', terms: ['recurring_fee', 'one_off_fee'], categories: [] },
  { text: 'Is there a cap on liability?', terms: [], categories: ['liability'] },
  { text: 'When does the agreement start, and how long does it run?', terms: ['effective_date', 'initial_term'], categories: [] },
  { text: 'Can the vendor change the price?', terms: ['price_changes'], categories: [] },
]

export const MAX_SUGGESTIONS = 5

export function suggestQuestions(review: RiskReview | null): Suggestion[] {
  const done = review !== null && review.status === 'done'
  const scored = CANDIDATES.map((candidate, position) => {
    let score = 0
    let reason: string | null = null
    if (done) {
      const terms = review.key_terms.filter((t) => candidate.terms.includes(t.id))
      const missing = terms.find((t) => t.status === 'not_stated')
      const deviating = terms.find((t) => t.standard?.status === 'deviates')
      const worst = review.findings.filter((f) => candidate.categories.includes(f.category)).map((f) => f.severity)
      if (missing && review.key_terms_complete) {
        score = 3
        reason = `${missing.name} was not stated in the reviewed text — the answer should say so`
      } else if (deviating) {
        score = 2
        reason = `${deviating.name} deviates from your standard`
      } else if (worst.includes('High')) {
        score = 2
        reason = 'A High risk was found in this area'
      } else if (worst.includes('Medium')) {
        score = 1
        reason = 'A Medium risk was found in this area'
      }
    }
    return { candidate, score, reason, position }
  })
  return scored
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ candidate, reason }) => ({ text: candidate.text, reason }))
}
