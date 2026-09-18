import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Contract, RiskReview } from './api'
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
    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument()
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
    expect(screen.getByText(/set ANTHROPIC_API_KEY/)).toBeInTheDocument()

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
