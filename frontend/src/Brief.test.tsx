import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { KeyTermValue, RiskReview } from './api'
import { buildBrief, buildChecklist } from './brief'
import { BriefCard } from './components/BriefCard'

// "Before you sign" (MAS-105/106/111): derived by rule from the stored review.

const CATEGORIES = ['liability', 'termination', 'indemnification', 'auto_renewal', 'confidentiality', 'payment_terms', 'ip_assignment']

function found(id: string, name: string, value: string, chunk_index: number, quote: string, standard?: KeyTermValue['standard']): KeyTermValue {
  return { id, name, kind: 'text', status: 'found', value, source: { value, quote, chunk_id: `c${chunk_index}`, chunk_index, typed: null }, others: [], standard }
}

function absent(id: string, name: string, status: 'not_stated' | 'unchecked' = 'not_stated'): KeyTermValue {
  return { id, name, kind: 'text', status, value: '', source: null, others: [] }
}

const TERMS = [
  found('effective_date', 'Effective date', '1 March 2026', 0, 'effective as of 1 March 2026'),
  found('recurring_fee', 'Recurring fee', 'EUR 18,500 per month', 1, 'EUR 18,500 per month'),
  absent('one_off_fee', 'One-off fees'),
  found('payment_deadline', 'Payment deadline', '30 days', 1, 'thirty (30) days', { status: 'meets', standard: 'net 30 days or longer', detail: null }),
  found('late_payment', 'Late-payment interest / penalty', '1.5% per month', 1, 'interest at 1.5% per month', { status: 'deviates', standard: 'at most 1% per month', detail: '1.5× the standard' }),
  found('termination_cost', 'Termination cost', '50% of the remaining fees', 9, 'fifty percent (50%) of the Fees', { status: 'deviates', standard: 'no fee for termination for convenience', detail: 'a termination charge is stated' }),
  found('initial_term', 'Initial term', '36 months', 3, 'thirty-six (36) months'),
  found('renewal', 'Renewal', 'Renews automatically for 12-month periods', 3, 'renews automatically'),
  found('notice_period', 'Notice period', '90 days', 3, "ninety (90) days' notice"),
  absent('price_changes', 'Price changes'),
]

function review(overrides: Partial<RiskReview> = {}): RiskReview {
  const findings = overrides.findings ?? []
  return {
    contract_id: 'nw',
    status: 'done',
    model: 'claude-sonnet-5',
    chunks_total: 12,
    chunks_checked: 12,
    chunks_withheld: 0,
    complete: true,
    error: null,
    updated_at: '2026-09-20T09:00:00Z',
    findings,
    categories: CATEGORIES.map((id) => ({ id, name: id, worst_severity: findings.find((f) => f.category === id)?.severity ?? null, findings: 0 })),
    key_terms_complete: true,
    key_terms: TERMS,
    deadlines: [
      { id: 'term_end', name: 'Initial term ends', date: '2029-02-28', computed_from: ['effective_date', 'initial_term'], reason: null, how: '1 Mar 2026 + 36 months − 1 day' },
      { id: 'notice_deadline', name: 'Give notice by', date: '2028-11-30', computed_from: ['effective_date', 'initial_term', 'notice_period'], reason: null, how: '28 Feb 2029 − 90 days' },
      { id: 'next_renewal_end', name: 'First renewal runs to', date: '2030-02-28', computed_from: [], reason: null, how: null },
    ],
    ...overrides,
  }
}

const FINDINGS: RiskReview['findings'] = [
  { category: 'payment_terms', category_name: 'Payment terms', severity: 'Medium', reason: 'Late interest above the usual 1%.', quote: 'interest at 1.5% per month', chunk_id: 'c1', chunk_index: 1 },
  { category: 'liability', category_name: 'Liability cap', severity: 'High', reason: 'Uncapped liability for the Customer.', quote: 'liability shall be unlimited', chunk_id: 'c8', chunk_index: 8 },
  { category: 'confidentiality', category_name: 'Confidentiality', severity: 'Low', reason: 'Survival period is short.', quote: 'two (2) years', chunk_id: 'c5', chunk_index: 5 },
]

const TODAY = new Date('2026-09-21T12:00:00')

describe('buildBrief (MAS-105)', () => {
  it('states the five facts from the key terms, deadlines and findings, each with its passage', () => {
    const facts = buildBrief(review({ findings: FINDINGS }))
    expect(facts.map((f) => [f.label, f.text, f.source?.chunk_index])).toEqual([
      ['Term', '36 months from 1 March 2026, ending 28 Feb 2029', 3],
      ['Cost', 'EUR 18,500 per month', 1],
      ['Renewal', 'Renews automatically for 12-month periods — notice by 30 Nov 2028 (90 days)', 3],
      ['Leaving', '50% of the remaining fees', 9],
      ['Risks', '1 High · 1 Medium · 1 Low: Liability cap, Payment terms, Confidentiality', undefined],
    ])
    expect(facts[3].tone).toBe('warn') // the termination cost deviates
    expect(facts[4].tone).toBe('high')
  })

  it('says "not stated" only after a complete key-terms pass, "not checked" otherwise, and never guesses', () => {
    const bare = TERMS.map((t) => (t.id === 'initial_term' ? absent(t.id, t.name) : t))
    const complete = buildBrief(review({ key_terms: bare, deadlines: [] }))
    expect(complete[0].text).toBe('effective 1 March 2026; initial term not stated in the reviewed text')
    expect(complete[2].text).toBe('Renews automatically for 12-month periods — 90 days notice') // no computed deadline without the term end

    const partial = buildBrief(review({ key_terms: bare.map((t) => (t.id === 'initial_term' ? absent(t.id, t.name, 'unchecked') : t)), key_terms_complete: false, deadlines: [] }))
    expect(partial[0].text).toBe('effective 1 March 2026; initial term not checked')

    const nothing = buildBrief(review({ key_terms: TERMS.map((t) => absent(t.id, t.name)), deadlines: [] }))
    expect(nothing.map((f) => f.text)).toEqual([
      'initial term not stated in the reviewed text',
      'recurring fee not stated in the reviewed text',
      'not stated in the reviewed text',
      'termination cost not stated in the reviewed text',
      'nothing flagged in 7 categories',
    ])
  })

  it('claims "nothing flagged in n categories" only for a complete review', () => {
    expect(buildBrief(review({}))[4]).toMatchObject({ text: 'nothing flagged in 7 categories', tone: 'ok' })
    const partial = buildBrief(review({ complete: false, chunks_checked: 9 }))[4]
    expect(partial.text).toBe('nothing flagged in the 9 of 12 passages graded')
    expect(partial.tone).toBeUndefined()
  })
})

describe('buildChecklist (MAS-106/111)', () => {
  it('lists High/Medium findings first, then deviations, missing important terms, the notice deadline — each traceable', () => {
    const items = buildChecklist(review({ findings: FINDINGS, key_terms: TERMS.map((t) => (t.id === 'effective_date' ? absent(t.id, t.name) : t)) }), TODAY)
    expect(items.map((i) => [i.kind, i.text, i.source?.chunk_index])).toEqual([
      ['finding', 'Confirm Liability cap', 8],
      ['finding', 'Confirm Payment terms', 1],
      ['deviation', 'Check late-payment interest / penalty', 1],
      ['deviation', 'Check termination cost', 9],
      ['missing', 'Effective date not stated', undefined],
      ['deadline', 'Diary the notice deadline', undefined],
    ])
    expect(items[0].severity).toBe('High')
    expect(items[2].detail).toBe('1.5% per month — your standard: at most 1% per month')
    expect(items[4].detail).toBe('ask where it is agreed')
    expect(items[5].detail).toBe('30 Nov 2028 (28 Feb 2029 − 90 days)')
    expect(items.some((i) => i.text.includes('Confidentiality'))).toBe(false) // Low stays in the Risk review
  })

  it('does not call an unchecked term missing, skips a past notice deadline, and flags an incomplete review', () => {
    const partial = review({
      complete: false,
      chunks_checked: 10,
      key_terms_complete: false,
      key_terms: TERMS.map((t) => (t.id === 'effective_date' ? absent(t.id, t.name, 'unchecked') : t.id === 'late_payment' || t.id === 'termination_cost' ? found(t.id, t.name, t.value, 1, 'q') : t)),
      deadlines: [{ id: 'notice_deadline', name: 'Give notice by', date: '2026-01-31', computed_from: [], reason: null, how: 'x' }],
    })
    const items = buildChecklist(partial, TODAY)
    expect(items.map((i) => [i.kind, i.text])).toEqual([['coverage', '2 passages were not graded']])
    expect(items[0].detail).toBe('read them yourself, or run the review again')
  })

  it('names the uploaded-elsewhere document next to a missing term (MAS-84)', () => {
    const items = buildChecklist(
      review({
        key_terms: TERMS.map((t) => (t.id === 'recurring_fee' ? absent(t.id, t.name) : t.id === 'late_payment' || t.id === 'termination_cost' ? found(t.id, t.name, t.value, 1, 'q') : t)),
        coverage: { chunks_total: 12, chunks_checked: 12, unreadable_passages: [], withheld_passages: [], ingestion_notes: [], external_references: [{ name: 'Order Form', chunk_indexes: [1] }] },
      }),
      TODAY,
    )
    expect(items.find((i) => i.kind === 'missing')).toMatchObject({ text: 'Recurring fee not stated', detail: 'may be in Order Form (not uploaded) — ask where it is agreed' })
  })

  it('puts a referenced but not uploaded document on the checklist, once per document (MAS-123)', () => {
    const clean = TERMS.map((t) => (t.id === 'late_payment' || t.id === 'termination_cost' ? found(t.id, t.name, t.value, 1, 'q') : t))
    const items = buildChecklist(
      review({
        key_terms: clean,
        deadlines: [],
        coverage: {
          chunks_total: 12,
          chunks_checked: 12,
          unreadable_passages: [],
          withheld_passages: [],
          ingestion_notes: [],
          external_references: [
            { name: 'Service Level Schedule', chunk_indexes: [3, 7] },
            { name: 'Order Form', chunk_indexes: [1] },
          ],
        },
      }),
      TODAY,
    )
    expect(items.map((i) => [i.kind, i.text, i.source?.chunk_index])).toEqual([
      ['missing_document', 'Get Service Level Schedule before signing', 3],
      ['missing_document', 'Get Order Form before signing', 1],
    ])
    expect(items[0].detail).toBe('referred to in passages 4, 8 but not uploaded, so what it says could not be reviewed')
    expect(items[1].detail).toBe('referred to in passage 2 but not uploaded, so what it says could not be reviewed')
  })

  it('is empty for a clean, complete review', () => {
    const clean = TERMS.map((t) => (t.id === 'late_payment' || t.id === 'termination_cost' ? found(t.id, t.name, t.value, 1, 'q') : t))
    expect(buildChecklist(review({ key_terms: clean, deadlines: [] }), TODAY)).toEqual([])
  })
})

describe('BriefCard', () => {
  it('renders the facts and the checklist, opens a passage on click, and lets the reader tick items', async () => {
    const onShowSource = vi.fn()
    render(<BriefCard review={review({ findings: FINDINGS })} onShowSource={onShowSource} />)

    const card = screen.getByText('Before you sign').closest('section')!
    expect(within(card).getByText('5 to check')).toBeInTheDocument()
    expect(within(card).getByText('36 months from 1 March 2026, ending 28 Feb 2029')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Show leaving in contract' }))
    expect(onShowSource).toHaveBeenCalledWith({ chunk_index: 9, quote: 'fifty percent (50%) of the Fees' })

    const list = within(card).getByRole('list', { name: 'Before you sign checklist' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(5) // 2 findings, 2 deviations, the notice deadline (2028 is in the future)
    expect(items[0]).toHaveTextContent('HighConfirm Liability cap — Uncapped liability for the Customer.passage 9')
    await userEvent.click(within(items[0]).getByRole('button', { name: 'Show "Confirm Liability cap" in contract' }))
    expect(onShowSource).toHaveBeenLastCalledWith({ chunk_index: 8, quote: 'liability shall be unlimited' })

    await userEvent.click(within(items[0]).getByRole('checkbox', { name: 'Done: Confirm Liability cap' }))
    expect(items[0]).toHaveClass('done')
    expect(within(card).getByText('4 to check')).toBeInTheDocument() // 5 items, one ticked
    expect(within(card).getByText(/not legal advice/)).toBeInTheDocument()
  })

  it('reads calmly when nothing needs attention, and waits for a running review', () => {
    const clean = TERMS.map((t) => (t.id === 'late_payment' || t.id === 'termination_cost' ? found(t.id, t.name, t.value, 1, 'q') : t))
    const { unmount } = render(<BriefCard review={review({ key_terms: clean, deadlines: [] })} />)
    expect(screen.getByText('Nothing needs attention')).toHaveClass('status', 'ok')
    expect(screen.getByText(/no risks flagged, no deviations from your standard, the important terms are stated, and nothing is missing from the upload/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Before you sign checklist' })).not.toBeInTheDocument()
    unmount()

    render(<BriefCard review={review({ status: 'running', complete: false, chunks_checked: 3 })} />)
    expect(screen.getByText('Waiting for the review')).toBeInTheDocument()
    expect(screen.getByText('The summary appears when the review finishes.')).toBeInTheDocument()
    expect(screen.queryByText('In brief')).not.toBeInTheDocument()
  })
})
