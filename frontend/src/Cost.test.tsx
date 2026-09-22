import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Contract, RiskReview } from './api'
import { RiskReviewPanel } from './components/RiskReviewPanel'
import { reviewCalls, reviewCostLabel } from './cost'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return {
    ...actual,
    Toaster: () => null,
    toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) }),
  }
})

// The UI must not spend the owner's budget by accident (MAS-122).

const northwind: Contract = {
  contract_id: 'nw',
  filename: 'northwind.txt',
  file_type: 'txt',
  size_bytes: 11263,
  character_count: 11263,
  chunk_count: 12,
  status: 'processed',
  created_at: '2026-09-16T10:00:00Z',
  risk_status: 'done',
  risk_worst_severity: null,
}

const review: RiskReview = {
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
  categories: [{ id: 'liability', name: 'Liability cap', worst_severity: null, findings: 0 }],
  key_terms: [],
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let posts: string[]

beforeEach(() => {
  posts = []
})
afterEach(() => vi.restoreAllMocks())

function mockApi(risks: () => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (init?.method === 'POST') {
      posts.push(url)
      return json(202, { ...review, status: 'pending', chunks_checked: 0, complete: false })
    }
    return risks()
  })
}

describe('cost estimates', () => {
  it('counts two calls per batch of eight passages', () => {
    expect(reviewCalls(0)).toBe(0)
    expect(reviewCalls(1)).toBe(2)
    expect(reviewCalls(8)).toBe(2)
    expect(reviewCalls(9)).toBe(4)
    expect(reviewCalls(12)).toBe(4) // Northwind, as CLAUDE.md records it
    expect(reviewCalls(22)).toBe(6)
    expect(reviewCostLabel(12)).toBe('≈ 4 model calls')
    expect(reviewCostLabel(1)).toBe('≈ 2 model calls')
  })
})

describe('recovering from a failed review read (MAS-122)', () => {
  it('offers a free re-read, never a paid review, and recovers when the API returns', async () => {
    let fail = true
    mockApi(() => (fail ? json(503, { detail: 'Service Unavailable' }) : json(200, review)))

    render(<RiskReviewPanel contract={northwind} />)

    expect(await screen.findByText('Unavailable', { selector: '.status' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Review risks/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Review again/ })).not.toBeInTheDocument()
    expect(screen.getByText(/it does not start a new review, so it costs nothing/)).toBeInTheDocument()

    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(/Reviewed · 12 passages/)).toBeInTheDocument()
    expect(posts).toEqual([]) // nothing paid for, at any point
  })

  it('still offers the first review for a contract that was never reviewed (404), with its cost', async () => {
    mockApi(() => json(404, { detail: 'This contract has not been reviewed for risks yet.' }))

    render(<RiskReviewPanel contract={{ ...northwind, risk_status: null }} />)

    const button = await screen.findByRole('button', { name: 'Review risks — ≈ 4 model calls' })
    expect(screen.getByText('≈ 4 model calls')).toBeInTheDocument()

    await userEvent.click(button) // a first review needs no confirmation
    await waitFor(() => expect(posts).toEqual(['/api/contracts/nw/review']))
  })
})

describe('asking twice for a paid re-review (MAS-122)', () => {
  it('shows the cost, asks before spending it, and does nothing at all on Cancel', async () => {
    mockApi(() => json(200, review))

    render(<RiskReviewPanel contract={northwind} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review again — ≈ 4 model calls' }))
    expect(posts).toEqual([]) // the first click only asks

    const confirm = screen.getByRole('status')
    expect(confirm).toHaveTextContent('Run the review again? It grades all 12 passages from scratch and costs ≈ 4 model calls.')

    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(posts).toEqual([])
    expect(screen.getByRole('button', { name: 'Review again — ≈ 4 model calls' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Review again — ≈ 4 model calls' }))
    await userEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Yes, run it' }))
    await waitFor(() => expect(posts).toEqual(['/api/contracts/nw/review']))
    expect(screen.queryByText(/Run the review again\?/)).not.toBeInTheDocument()
  })
})
