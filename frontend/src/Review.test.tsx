import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Contract, KeyTermValue, RiskReview } from './api'
import { RiskReviewPanel } from './components/RiskReviewPanel'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return {
    ...actual,
    Toaster: () => null,
    toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), promise: vi.fn() }),
  }
})

import { toast } from 'sonner'

const northwind: Contract = {
  contract_id: 'nw',
  filename: 'northwind.txt',
  file_type: 'txt',
  size_bytes: 11263,
  character_count: 11263,
  chunk_count: 12,
  status: 'processed',
  created_at: '2026-09-16T10:00:00Z',
  risk_status: 'pending',
}

const CATEGORIES = ['liability', 'termination', 'indemnification', 'auto_renewal', 'confidentiality', 'payment_terms', 'ip_assignment']
const NAMES: Record<string, string> = {
  liability: 'Liability cap',
  termination: 'Termination',
  indemnification: 'Indemnification',
  auto_renewal: 'Auto-renewal',
  confidentiality: 'Confidentiality',
  payment_terms: 'Payment terms',
  ip_assignment: 'IP assignment',
}

const TERMS: [string, string][] = [
  ['recurring_fee', 'Recurring fee'],
  ['one_off_fee', 'One-off fees'],
  ['payment_deadline', 'Payment deadline'],
  ['late_payment', 'Late-payment interest / penalty'],
  ['termination_cost', 'Termination cost'],
  ['initial_term', 'Initial term'],
  ['renewal', 'Renewal'],
  ['notice_period', 'Notice period'],
  ['price_changes', 'Price changes'],
]

function notStated([id, name]: [string, string], status: KeyTermValue['status'] = 'not_stated'): KeyTermValue {
  return { id, name, kind: 'text', status, value: status === 'unchecked' ? 'Not checked' : 'Not stated in the reviewed text', source: null, others: [] }
}

function stated([id, name]: [string, string], value: string, chunk_index: number, quote: string, others: KeyTermValue['others'] = []): KeyTermValue {
  return {
    id,
    name,
    kind: 'money',
    status: others.length ? 'conflicting' : 'found',
    value,
    source: { value, quote, chunk_id: `c${chunk_index}`, chunk_index, typed: null },
    others,
  }
}

function review(overrides: Partial<RiskReview>): RiskReview {
  const findings = overrides.findings ?? []
  return {
    contract_id: 'nw',
    status: 'done',
    model: 'claude-sonnet-5',
    chunks_total: 12,
    chunks_checked: 12,
    chunks_withheld: 0,
    complete: true,
    key_terms_complete: overrides.key_terms_complete ?? overrides.status !== 'done' ? false : true,
    key_terms: overrides.key_terms ?? TERMS.map((t) => notStated(t)),
    error: null,
    updated_at: '2026-09-17T09:00:00Z',
    findings,
    categories: CATEGORIES.map((id) => {
      const mine = findings.filter((f) => f.category === id)
      const worst = mine.some((f) => f.severity === 'High') ? 'High' : mine.some((f) => f.severity === 'Medium') ? 'Medium' : mine.length ? 'Low' : null
      return { id, name: NAMES[id], worst_severity: worst, findings: mine.length }
    }),
    ...overrides,
  }
}

const done = review({
  findings: [
    { category: 'liability', category_name: 'Liability cap', severity: 'High', reason: 'Uncapped liability for the Customer.', quote: 'liability shall be unlimited', chunk_id: 'c8', chunk_index: 8 },
    { category: 'payment_terms', category_name: 'Payment terms', severity: 'Medium', reason: 'Late interest at 1.5% per month.', quote: 'interest at 1.5% per month', chunk_id: 'c1', chunk_index: 1 },
  ],
})

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let shown: [string, string][]

beforeEach(() => {
  shown = []
  vi.mocked(toast.promise).mockImplementation(((promise: Promise<unknown>, messages: Record<string, unknown>) => ({
    unwrap: () =>
      promise.then(
        (value) => {
          shown.push(['success', typeof messages.success === 'function' ? (messages.success as (v: unknown) => string)(value) : String(messages.success)])
          return value
        },
        (error: Error) => {
          shown.push(['error', (messages.error as (e: Error) => string)(error)])
          throw error
        },
      ),
  })) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('whole-contract risk review (MAS-81)', () => {
  it('polls while the review runs, then shows every category and the verified findings', async () => {
    const replies = [json(200, review({ status: 'running', chunks_checked: 8, complete: false })), json(200, done)]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => replies.shift() ?? json(200, done))
    const onSettled = vi.fn()

    render(<RiskReviewPanel contract={northwind} pollMs={10} onSettled={onSettled} />)

    expect(await screen.findByText(/Reviewing… 8\/12 passages/)).toBeInTheDocument()
    expect(await screen.findByText(/Reviewed · 12 passages/)).toBeInTheDocument()
    expect(onSettled).toHaveBeenCalledTimes(1)

    const cells = screen.getAllByRole('listitem').filter((li) => li.classList.contains('review-cat'))
    expect(cells).toHaveLength(7)
    expect(within(cells[0]).getByText('Liability cap')).toBeInTheDocument()
    expect(within(cells[0]).getByText('High')).toBeInTheDocument()
    expect(within(cells[1]).getByText('Nothing found')).toBeInTheDocument()

    const findings = screen.getAllByRole('listitem').filter((li) => li.classList.contains('risk'))
    expect(findings).toHaveLength(2)
    expect(within(findings[0]).getByText(/Uncapped liability/)).toBeInTheDocument()
    expect(within(findings[0]).getByText('passage 9')).toBeInTheDocument()
    expect(within(findings[0]).getByText(/“liability shall be unlimited”/)).toBeInTheDocument()
    expect(screen.getAllByText('claude-sonnet-5').length).toBeGreaterThan(0) // on the review and the key-terms card
  })

  it('shows the failure reason verbatim and lets the user run the review again', async () => {
    const failed = review({ status: 'failed', chunks_checked: 0, complete: false, error: 'Chat model is not configured: set ANTHROPIC_API_KEY' })
    let started = false
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        started = true
        return json(202, review({ status: 'pending', chunks_checked: 0, complete: false, model: null }))
      }
      return json(200, started ? review({ status: 'running', chunks_checked: 4, complete: false }) : failed)
    })

    render(<RiskReviewPanel contract={northwind} pollMs={10} />)

    expect(await screen.findByText('Review failed')).toBeInTheDocument()
    expect(screen.getAllByText(/set ANTHROPIC_API_KEY/).length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: 'Review again' }))

    await waitFor(() => expect(shown).toEqual([['success', 'Risk review started — 12 passages to grade']]))
    expect(fetchMock).toHaveBeenCalledWith('/api/contracts/nw/review', expect.objectContaining({ method: 'POST' }))
    expect(await screen.findByText(/Reviewing…/)).toBeInTheDocument()
  })

  it('offers a review for a contract uploaded before reviews existed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(404, { detail: 'This contract has not been reviewed for risks yet. Start a review to grade it.' }))

    render(<RiskReviewPanel contract={{ ...northwind, risk_status: null }} />)

    expect(await screen.findByText('Not reviewed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review risks' })).toBeInTheDocument()
    expect(screen.getByText(/uploaded before whole-contract reviews existed/)).toBeInTheDocument()
  })

  it('does not call empty categories clean when the review failed or was partial (MAS-87)', async () => {
    const partial = review({ status: 'done', complete: false, chunks_checked: 9, findings: done.findings })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, partial))

    render(<RiskReviewPanel contract={northwind} />)

    expect(await screen.findByText(/Partly reviewed · 9\/12 passages/)).toBeInTheDocument()
    expect(screen.queryByText('Nothing found')).not.toBeInTheDocument()
    expect(screen.getAllByText('Unable to determine')).toHaveLength(5)
    expect(screen.getAllByText('High').length).toBeGreaterThan(0) // verified findings still graded
    const cells = screen.getAllByRole('listitem').filter((li) => li.classList.contains('review-cat'))
    expect(cells.filter((li) => li.classList.contains('clean'))).toHaveLength(0)
  })

  it('reports withheld passages as not graded, not clean (MAS-94)', async () => {
    const withheld = review({ status: 'done', complete: false, chunks_checked: 11, chunks_withheld: 1, findings: done.findings })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, withheld))

    render(<RiskReviewPanel contract={northwind} />)

    expect(await screen.findByText(/Partly reviewed · 11\/12 passages · 1 withheld/)).toBeInTheDocument()
    expect(screen.getByText(/1 passage was withheld from the model because it contains instructions addressed to the AI/)).toBeInTheDocument()
    expect(screen.queryByText(/reply for them was unreadable/)).not.toBeInTheDocument()
    expect(screen.queryByText('Nothing found')).not.toBeInTheDocument()
  })

  it('shows every key term with its source, and "Not stated" only for a complete pass (MAS-82)', async () => {
    const terms = TERMS.map((t) =>
      t[0] === 'recurring_fee'
        ? stated(t, 'EUR 18,500 per month', 1, 'Customer shall pay EUR 18,500 per month')
        : t[0] === 'notice_period'
          ? stated(t, '90 days', 4, "ninety (90) days' notice", [{ value: '60 days', quote: 'sixty (60) days', chunk_id: 'c9', chunk_index: 9, typed: null }])
          : notStated(t),
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, review({ status: 'done', key_terms_complete: true, key_terms: terms })))

    render(<RiskReviewPanel contract={northwind} />)

    const card = (await screen.findByText('Key terms')).closest('section')!
    expect(within(card).getByText(/2 of 9 stated · 12 of 12 passages read/)).toBeInTheDocument()
    expect(within(card).getByText('EUR 18,500 per month')).toBeInTheDocument()
    expect(within(card).getByText(/· passage 2/)).toBeInTheDocument()
    expect(within(card).getByText(/“Customer shall pay EUR 18,500 per month”/)).toBeInTheDocument()
    expect(within(card).getAllByText('Not stated in the reviewed text')).toHaveLength(7)
    expect(within(card).getByText('Conflicting')).toBeInTheDocument()
    expect(within(card).getByText(/Also stated in passage 10: “60 days”/)).toBeInTheDocument()
    expect(within(card).getByText(/One term is stated differently/)).toBeInTheDocument()
  })

  it('says "Not checked", never "Not stated", when the key-terms pass did not complete (MAS-82)', async () => {
    const terms = TERMS.map((t) => (t[0] === 'recurring_fee' ? stated(t, 'EUR 18,500 per month', 1, 'EUR 18,500 per month') : notStated(t, 'unchecked')))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, review({ status: 'done', key_terms_complete: false, key_terms: terms })))

    render(<RiskReviewPanel contract={northwind} />)

    const card = (await screen.findByText('Key terms')).closest('section')!
    expect(within(card).getByText(/Partly checked/)).toBeInTheDocument()
    expect(within(card).getByText(/could not be checked for key terms/)).toBeInTheDocument()
    expect(within(card).getAllByText('Not checked')).toHaveLength(8)
    expect(within(card).queryByText('Not stated in the reviewed text')).not.toBeInTheDocument()
    expect(within(card).getByText('EUR 18,500 per month')).toBeInTheDocument()
  })

  it('lists what was not read, by passage, and links each one to the contract text (MAS-84)', async () => {
    const onShowSource = vi.fn()
    const coverage = {
      chunks_total: 12,
      chunks_checked: 9,
      unreadable_passages: [4, 5],
      withheld_passages: [11],
      ingestion_notes: ['Page 3 of 14 has no text layer (scanned or image-only) and could not be read.'],
      external_references: [{ name: 'Order Form', chunk_indexes: [1] }],
    }
    const partial = review({ status: 'done', complete: false, chunks_checked: 9, chunks_withheld: 1, findings: done.findings, coverage })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, partial))

    render(<RiskReviewPanel contract={northwind} onShowSource={onShowSource} />)

    expect(await screen.findByText(/Reviewed .* by claude-sonnet-5 · 9 of 12 passages graded, 1 withheld/)).toBeInTheDocument()
    const notes = screen.getAllByRole('list', { name: 'Coverage' })
    expect(notes).toHaveLength(2) // once on the review, once on the key terms
    const note = notes.find((n) => n.textContent?.includes('for risks'))! // the key-terms card renders first
    const lines = within(note).getAllByRole('listitem').map((li) => li.textContent)
    expect(lines).toEqual([
      'Not reviewed: Page 3 of 14 has no text layer (scanned or image-only) and could not be read.',
      "Not graded for risks — the model's reply was unreadable for passages 5, 6. Read them yourself, or run the review again.",
      'Withheld from the model — passage 12 contains instructions addressed to the AI and was not graded.',
      'Depends on a document not uploaded: Order Form (referred to in passage 2). What it says could not be determined.',
    ])
    expect(notes.find((n) => n.textContent?.includes('for key terms'))).toBeDefined()

    await userEvent.click(within(note).getByRole('button', { name: 'Show passage 5 in contract' }))
    expect(onShowSource).toHaveBeenCalledWith({ chunk_index: 4 })
    expect(screen.queryByText(/reply for them was unreadable/)).not.toBeInTheDocument() // replaced by the list
  })

  it('says next to a "not stated" key term which uploaded-elsewhere document it may be in (MAS-84)', async () => {
    const coverage = { chunks_total: 12, chunks_checked: 12, unreadable_passages: [], withheld_passages: [], ingestion_notes: [], external_references: [{ name: 'Schedule 2', chunk_indexes: [3] }] }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, review({ status: 'done', key_terms_complete: true, coverage })))

    render(<RiskReviewPanel contract={northwind} />)

    const card = (await screen.findByText('Key terms')).closest('section')!
    expect(within(card).getAllByText(/Not stated in the reviewed text — may be in Schedule 2 \(not uploaded\)/)).toHaveLength(9)
  })

  it('shows "Unable to determine" for every category of a failed review', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, review({ status: 'failed', complete: false, chunks_checked: 0, error: 'rate limited' })))

    render(<RiskReviewPanel contract={northwind} />)

    expect(await screen.findByText('Review failed')).toBeInTheDocument()
    expect(screen.getAllByText('Unable to determine')).toHaveLength(7)
    expect(screen.queryByText('Nothing found')).not.toBeInTheDocument()
  })

  it('says plainly when everything was read and nothing was flagged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, review({})))

    render(<RiskReviewPanel contract={northwind} />)

    expect(await screen.findByText(/nothing was flagged/)).toBeInTheDocument()
    expect(screen.getAllByText('Nothing found')).toHaveLength(7)
  })
})
