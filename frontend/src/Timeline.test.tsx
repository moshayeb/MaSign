import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Deadline, KeyTermValue, RiskReview } from './api'
import { Timeline } from './components/Timeline'
import { buildTimeline, standings } from './timeline'

// The contract as a line of dates (MAS-110), built only from what was extracted.

const TODAY = new Date('2026-09-22T12:00:00')

function effective(date: string | null, status: KeyTermValue['status'] = 'found'): KeyTermValue {
  return {
    id: 'effective_date',
    name: 'Effective date',
    kind: 'date',
    status,
    value: date ?? '',
    source: date ? { value: date, quote: `effective as of ${date}`, chunk_id: 'c0', chunk_index: 0, typed: { date } } : null,
    others: [],
  }
}

const DEADLINES: Deadline[] = [
  { id: 'term_end', name: 'Initial term ends', date: '2029-02-28', computed_from: ['effective_date', 'initial_term'], reason: null, how: '1 Mar 2026 + 36 months − 1 day' },
  { id: 'notice_deadline', name: 'Give notice by', date: '2028-11-30', computed_from: ['effective_date', 'initial_term', 'notice_period'], reason: null, how: '28 Feb 2029 − 90 days' },
  { id: 'next_renewal_end', name: 'First renewal runs to', date: '2030-02-28', computed_from: ['effective_date', 'initial_term', 'renewal'], reason: null, how: '28 Feb 2029 + 12 months' },
]

function review(overrides: Partial<RiskReview> = {}): RiskReview {
  return {
    contract_id: 'nw',
    status: 'done',
    model: 'claude-sonnet-5',
    chunks_total: 12,
    chunks_checked: 12,
    chunks_withheld: 0,
    complete: true,
    key_terms_complete: true,
    error: null,
    updated_at: '2026-09-20T09:00:00Z',
    findings: [],
    categories: [],
    key_terms: [effective('2026-03-01')],
    deadlines: DEADLINES,
    ...overrides,
  }
}

describe('buildTimeline', () => {
  it('orders the milestones as the contract is lived, not as the review produced them', () => {
    expect(buildTimeline(review()).map((m) => [m.id, m.date])).toEqual([
      ['effective_date', '2026-03-01'],
      ['notice_deadline', '2028-11-30'],
      ['term_end', '2029-02-28'],
      ['next_renewal_end', '2030-02-28'],
    ])
  })

  it('separates "not stated", "not checked" and "stated but not as a date"', () => {
    const notStated = buildTimeline(review({ key_terms: [effective(null, 'not_stated')] }))[0]
    expect(notStated).toMatchObject({ date: null, reason: 'not stated in the reviewed text' })

    const unchecked = buildTimeline(review({ key_terms: [effective(null, 'unchecked')], key_terms_complete: false }))[0]
    expect(unchecked).toMatchObject({ date: null, reason: 'not checked' })

    // Stated, quoted, but the quote carried no date the verifier could confirm.
    const textOnly = { ...effective('2026-03-01'), source: { value: 'on signature', quote: 'from the date of signature', chunk_id: 'c0', chunk_index: 0, typed: null } }
    expect(buildTimeline(review({ key_terms: [textOnly] }))[0]).toMatchObject({ date: null, reason: 'stated, but not as a date the text confirms' })
  })

  it('carries the passage only on the effective date — the rest are arithmetic, not quotes', () => {
    const [first, ...computed] = buildTimeline(review())
    expect(first.source).toEqual({ chunk_index: 0, quote: 'effective as of 2026-03-01' })
    expect(computed.every((m) => m.source === undefined)).toBe(true)
    expect(computed.every((m) => m.how !== null)).toBe(true)
  })
})

describe('standings', () => {
  it('marks what has passed and the first milestone still ahead', () => {
    const state = standings(buildTimeline(review()), TODAY)
    expect(state.get('effective_date')).toMatchObject({ past: true, next: false })
    expect(state.get('notice_deadline')).toMatchObject({ past: false, next: true })
    expect(state.get('term_end')).toMatchObject({ past: false, next: false })
    expect(state.get('next_renewal_end')?.daysAway).toBe(1255)
  })

  it('gives an undated milestone no standing at all rather than treating it as today', () => {
    const state = standings(buildTimeline(review({ key_terms: [effective(null, 'not_stated')] })), TODAY)
    expect(state.get('effective_date')).toEqual({ past: false, next: false, daysAway: null })
  })
})

describe('<Timeline>', () => {
  it('shows each milestone with its date, formula and standing', () => {
    render(<Timeline review={review()} today={TODAY} />)

    const items = within(screen.getByRole('list', { name: 'Contract timeline' })).getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent('1 Mar 2026')
    expect(within(items[0]).getByText('passed')).toBeInTheDocument()
    expect(within(items[1]).getByText('next')).toBeInTheDocument()
    expect(items[2]).toHaveTextContent('1 Mar 2026 + 36 months − 1 day')
  })

  it('keeps an unknown milestone in its place with the reason, and never draws an empty line as if there were no dates', () => {
    render(<Timeline review={review({ key_terms: [effective(null, 'not_stated')], deadlines: [{ id: 'term_end', name: 'Initial term ends', date: null, computed_from: [], reason: 'effective date not stated in the reviewed text', how: null }] })} today={TODAY} />)

    const items = within(screen.getByRole('list', { name: 'Contract timeline' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('cannot compute: not stated in the reviewed text')
    expect(items[1]).toHaveTextContent('cannot compute: effective date not stated in the reviewed text')
    expect(screen.getByText(/No dates could be established from the reviewed text/)).toBeInTheDocument()
  })

  it('says so when every date is already in the past', () => {
    const past: Deadline[] = [{ id: 'term_end', name: 'Initial term ends', date: '2024-01-31', computed_from: [], reason: null, how: 'x' }]
    render(<Timeline review={review({ key_terms: [effective('2021-01-01')], deadlines: past })} today={TODAY} />)

    expect(screen.getByText(/Every date above is in the past/)).toBeInTheDocument()
    expect(screen.queryByText('next')).not.toBeInTheDocument()
  })

  it('opens the passage behind the effective date', async () => {
    const onShowSource = vi.fn()
    render(<Timeline review={review()} today={TODAY} onShowSource={onShowSource} />)

    await userEvent.click(screen.getByRole('button', { name: 'Show signed / effective in contract' }))
    expect(onShowSource).toHaveBeenCalledWith({ chunk_index: 0, quote: 'effective as of 2026-03-01' })
  })
})
