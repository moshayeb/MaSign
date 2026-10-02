import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Contract, RiskReview } from './api'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

// MAS-195: indexed_profiles already drove the Compare-models button (MAS-62)
// but was never shown to the reader -- "why can't I find choosing the right
// embedding model on the UX." This covers the four states the header pill
// can be in.

const base: Contract = {
  contract_id: 'x',
  filename: 'x.txt',
  file_type: 'txt',
  size_bytes: 1,
  character_count: 1,
  chunk_count: 1,
  status: 'processed',
  created_at: '2026-09-16T10:00:00Z',
  risk_status: 'done',
  risk_worst_severity: null,
}
const contracts: Contract[] = [
  { ...base, contract_id: 'portable', filename: 'portable.txt', indexed_profiles: ['portable'] },
  { ...base, contract_id: 'quality', filename: 'quality.txt', indexed_profiles: ['quality'] },
  { ...base, contract_id: 'both', filename: 'both.txt', indexed_profiles: ['portable', 'quality'] },
  { ...base, contract_id: 'none', filename: 'none.txt', indexed_profiles: [] },
]

const cleanReview = (id: string): RiskReview => ({
  contract_id: id,
  status: 'done',
  model: 'claude-sonnet-5',
  chunks_total: 1,
  chunks_checked: 1,
  chunks_withheld: 0,
  complete: true,
  key_terms_complete: true,
  error: null,
  updated_at: '2026-09-20T09:00:00Z',
  findings: [],
  categories: [],
  key_terms: [],
})

beforeEach(() => {
  window.location.hash = ''
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/contracts') return json(contracts)
    const m = /\/api\/contracts\/([^/]+)\/risks/.exec(url)
    if (m) return json(cleanReview(m[1]))
    if (url.endsWith('/passages')) return json([])
    return new Response(JSON.stringify({ detail: `unexpected ${url}` }), { status: 404 })
  })
})
afterEach(() => vi.restoreAllMocks())

describe('embedding profile badge (MAS-195)', () => {
  it('reads "Portable indexed" in a quiet tone for a portable-only contract', async () => {
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /portable\.txt/ }))[0])
    const head = screen.getByRole('heading', { level: 1 }).closest<HTMLElement>('.contract-head')!
    expect(within(head).getByText('Portable indexed')).toHaveClass('status', 'none')
  })

  it('reads "Quality indexed" in the accent tone for a quality-only contract', async () => {
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /quality\.txt/ }))[0])
    const head = screen.getByRole('heading', { level: 1 }).closest<HTMLElement>('.contract-head')!
    expect(within(head).getByText('Quality indexed')).toHaveClass('status', 'accent')
  })

  it('reads "Portable + Quality indexed" when both profiles cover it', async () => {
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /both\.txt/ }))[0])
    const head = screen.getByRole('heading', { level: 1 }).closest<HTMLElement>('.contract-head')!
    expect(within(head).getByText('Portable + Quality indexed')).toHaveClass('status', 'accent')
  })

  it('shows nothing rather than guessing when indexed_profiles is empty', async () => {
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /none\.txt/ }))[0])
    const head = screen.getByRole('heading', { level: 1 }).closest<HTMLElement>('.contract-head')!
    expect(within(head).queryByText(/indexed/)).not.toBeInTheDocument()
  })
})
