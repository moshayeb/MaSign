import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Contract, KeyTermValue, RiskReview } from './api'
import { MAX_SUGGESTIONS, suggestQuestions } from './suggestions'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

// Suggested questions on the Ask tab (MAS-108): ranked by the stored review, no model call.

function term(id: string, name: string, status: KeyTermValue['status'], standard?: KeyTermValue['standard']): KeyTermValue {
  const stated = status === 'found'
  return { id, name, kind: 'text', status, value: stated ? 'x' : '', source: stated ? { value: 'x', quote: 'x', chunk_id: 'c1', chunk_index: 1, typed: null } : null, others: [], standard }
}

function review(overrides: Partial<RiskReview> = {}): RiskReview {
  return {
    contract_id: 'nw',
    status: 'done',
    model: 'claude-sonnet-5',
    chunks_total: 2,
    chunks_checked: 2,
    chunks_withheld: 0,
    complete: true,
    key_terms_complete: true,
    error: null,
    updated_at: '2026-09-20T09:00:00Z',
    findings: [],
    categories: [],
    key_terms: [],
    ...overrides,
  }
}

const BASE = [
  'When can I terminate this agreement?',
  'What happens if I pay late?',
  'Does this contract renew automatically?',
  'What are my financial obligations?',
  'Is there a cap on liability?',
]

describe('suggestQuestions', () => {
  it('uses the base order, five at most, when there is no finished review', () => {
    expect(suggestQuestions(null).map((s) => s.text)).toEqual(BASE)
    expect(suggestQuestions(review({ status: 'running', complete: false })).map((s) => s.text)).toEqual(BASE)
    expect(suggestQuestions(null).every((s) => s.reason === null)).toBe(true)
    expect(BASE).toHaveLength(MAX_SUGGESTIONS)
  })

  it('puts a term the review could not find first, then deviations and High findings', () => {
    const ranked = suggestQuestions(
      review({
        key_terms: [
          term('price_changes', 'Price changes', 'not_stated'),
          term('late_payment', 'Late-payment interest / penalty', 'found', { status: 'deviates', standard: 'at most 1% per month', detail: null }),
          term('renewal', 'Renewal', 'found'),
        ],
        findings: [{ category: 'liability', category_name: 'Liability cap', severity: 'High', reason: 'r', quote: 'q', chunk_id: 'c1', chunk_index: 1 }],
      }),
    )
    expect(ranked.map((s) => s.text)).toEqual([
      'Can the vendor change the price?',
      'What happens if I pay late?',
      'Is there a cap on liability?',
      'When can I terminate this agreement?',
      'Does this contract renew automatically?',
    ])
    expect(ranked[0].reason).toBe('Price changes was not stated in the reviewed text — the answer should say so')
    expect(ranked[1].reason).toBe('Late-payment interest / penalty deviates from your standard')
    expect(ranked[2].reason).toBe('A High risk was found in this area')
    expect(ranked[3].reason).toBeNull()
  })

  it('does not treat an unchecked term as missing (the pass did not complete)', () => {
    const ranked = suggestQuestions(review({ key_terms_complete: false, key_terms: [term('price_changes', 'Price changes', 'not_stated')] }))
    expect(ranked.map((s) => s.text)).toEqual(BASE)
  })
})

describe('Ask tab suggestions', () => {
  const northwind: Contract = {
    contract_id: 'nw',
    filename: 'northwind.txt',
    file_type: 'txt',
    size_bytes: 1,
    character_count: 1,
    chunk_count: 2,
    status: 'processed',
    created_at: '2026-09-16T10:00:00Z',
    risk_status: 'done',
    risk_worst_severity: 'High',
  }
  const stored = review({
    findings: [{ category: 'termination', category_name: 'Termination', severity: 'High', reason: 'Half the fees.', quote: 'fifty percent (50%)', chunk_id: 'c1', chunk_index: 1 }],
    categories: [{ id: 'termination', name: 'Termination', worst_severity: 'High', findings: 1 }],
    key_terms: [term('renewal', 'Renewal', 'not_stated')],
  })

  beforeEach(() => {
    window.location.hash = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url === '/api/contracts') return json([northwind])
      if (url.endsWith('/risks')) return json(stored)
      if (url.endsWith('/passages')) return json([])
      return new Response(JSON.stringify({ detail: `unexpected ${url}` }), { status: 404 })
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the review-ranked chips on the Ask tab and a click fills the composer without sending', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /northwind\.txt/ }))
    await screen.findByText('Risk review')
    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))

    const chips = within(screen.getByLabelText('Suggested questions')).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual([
      'Does this contract renew automatically?', // renewal not stated → first
      'When can I terminate this agreement?', // High termination finding
      'What happens if I pay late?',
      'What are my financial obligations?',
      'Is there a cap on liability?',
    ])
    expect(chips[0]).toHaveAttribute('title', 'Renewal was not stated in the reviewed text — the answer should say so')
    expect(chips[0]).toHaveClass('ranked')
    expect(chips[2]).not.toHaveClass('ranked')

    await userEvent.click(chips[1])
    expect(screen.getByLabelText('Ask about the contract')).toHaveValue('When can I terminate this agreement?')
    expect(screen.getByLabelText('Ask about the contract')).toHaveFocus()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === '/api/query')).toBe(false) // nothing sent, no call spent
  })
})
