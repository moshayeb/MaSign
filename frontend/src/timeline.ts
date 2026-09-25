import type { Deadline, KeyTermValue, RiskReview } from './api'
import type { SourceRef } from './components/PassageReader'

// The contract as a sequence of dates (MAS-110), built from what is already
// stored: the `effective_date` key term (quoted, with its passage) and the
// deadlines MAS-100 computes from the typed terms. Nothing new is extracted
// here, so nothing new can be invented — a milestone without a date keeps
// its place in the line and carries the reason it could not be computed.

export interface Milestone {
  id: 'effective_date' | 'notice_deadline' | 'term_end' | 'next_renewal_end' | string
  name: string
  // ISO date, or null when it could not be established.
  date: string | null
  // Why there is no date — always set when `date` is null.
  reason: string | null
  // The arithmetic behind a computed date ("28 Feb 2029 − 90 days"); null for
  // the effective date, which is quoted from the contract rather than computed.
  how: string | null
  // Only the effective date has a passage: the rest follow from it by arithmetic.
  source?: SourceRef
}

// The order the contract is lived in, not the order the review produced.
const ORDER = ['effective_date', 'notice_deadline', 'term_end', 'next_renewal_end'] as const

const NAMES: Record<string, string> = {
  effective_date: 'Signed / effective',
  notice_deadline: 'Give notice by',
  term_end: 'Initial term ends',
  next_renewal_end: 'First renewal runs to',
}

export function buildTimeline(review: RiskReview): Milestone[] {
  const effective = review.key_terms.find((t) => t.id === 'effective_date')
  const deadlines = review.deadlines ?? []

  const milestones: Milestone[] = [effectiveMilestone(review, effective)]
  for (const id of ORDER.slice(1)) {
    const deadline = deadlines.find((d) => d.id === id)
    if (deadline) milestones.push(fromDeadline(deadline))
  }
  return milestones
}

function effectiveMilestone(review: RiskReview, term: KeyTermValue | undefined): Milestone {
  const typed = term?.source?.typed as { date?: string } | null | undefined
  const stated = term && (term.status === 'found' || term.status === 'conflicting')
  if (stated && typeof typed?.date === 'string') {
    return {
      id: 'effective_date',
      name: NAMES.effective_date,
      date: typed.date,
      reason: null,
      how: null,
      source: term.source ? { contract_id: term.source.contract_id, chunk_index: term.source.chunk_index, quote: term.source.quote } : undefined,
    }
  }
  // Stated but not as a date the quote confirms, versus not stated at all,
  // versus never checked: three different facts, three different sentences.
  const reason = stated
    ? 'stated, but not as a date the text confirms'
    : !term || term.status === 'unchecked' || !review.key_terms_complete
      ? 'not checked'
      : 'not stated in the reviewed text'
  return { id: 'effective_date', name: NAMES.effective_date, date: null, reason, how: null }
}

function fromDeadline(deadline: Deadline): Milestone {
  return {
    id: deadline.id,
    name: NAMES[deadline.id] ?? deadline.name,
    date: deadline.date,
    reason: deadline.date ? null : (deadline.reason ?? 'could not be computed'),
    how: deadline.how,
  }
}

export interface MilestoneStanding {
  past: boolean
  // The first milestone still ahead: the one worth acting on.
  next: boolean
  daysAway: number | null
}

// Where each milestone stands relative to `today`, compared at local midnight
// so "in 30 days" counts days, not hours.
export function standings(milestones: Milestone[], today = new Date()): Map<string, MilestoneStanding> {
  const midnight = new Date(today)
  midnight.setHours(0, 0, 0, 0)
  const result = new Map<string, MilestoneStanding>()
  let nextFound = false
  for (const milestone of milestones) {
    if (!milestone.date) {
      result.set(milestone.id, { past: false, next: false, daysAway: null })
      continue
    }
    const when = new Date(`${milestone.date}T00:00:00`)
    const daysAway = Math.round((when.getTime() - midnight.getTime()) / 86_400_000)
    const past = daysAway < 0
    const next = !past && !nextFound
    if (next) nextFound = true
    result.set(milestone.id, { past, next, daysAway })
  }
  return result
}

export function hasAnyDate(milestones: Milestone[]): boolean {
  return milestones.some((m) => m.date !== null)
}

export function allPast(milestones: Milestone[], today = new Date()): boolean {
  const standing = standings(milestones, today)
  const dated = milestones.filter((m) => m.date !== null)
  return dated.length > 0 && dated.every((m) => standing.get(m.id)?.past)
}
