import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Contract, RiskReview } from './api'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

// Is it a contract at all (MAS-107)? The UI must say so, and a clean review of an invoice must not read as reassurance.

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
  { ...base, contract_id: 'nw', filename: 'northwind.txt', document_kind: 'contract', document_kind_reasons: ["Contract markers: 'agreement / contract'"] },
  { ...base, contract_id: 'inv', filename: 'august-invoice.txt', document_kind: 'not_contract', document_looks_like: 'invoice', document_kind_reasons: ["Invoice markers: 'Invoice number', 'Amount due', 'Bill to'"] },
  { ...base, contract_id: 'memo', filename: 'memo.txt', document_kind: 'uncertain', document_looks_like: null, document_kind_reasons: ['Only 12 words — too short to classify'] },
  { ...base, contract_id: 'old', filename: 'old.txt', document_kind: null },
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
  categories: [
    { id: 'liability', name: 'Liability cap', worst_severity: null, findings: 0 },
    { id: 'termination', name: 'Termination', worst_severity: null, findings: 0 },
  ],
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

describe('document kind (MAS-107)', () => {
  it('tags the non-contract rows in the sidebar, with the markers as the tooltip', async () => {
    render(<App />)
    const invoice = await screen.findByRole('button', { name: /august-invoice\.txt/ })
    expect(within(invoice).getByText('Not a contract?')).toHaveAttribute('title', "Invoice markers: 'Invoice number', 'Amount due', 'Bill to'")
    expect(within(screen.getByRole('button', { name: /memo\.txt/ })).getByText('Type uncertain')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /northwind\.txt/ })).queryByText(/contract\?|uncertain/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /old\.txt/ })).queryByText(/contract\?|uncertain/)).not.toBeInTheDocument()
  })

  it('shows the kind in the header and, for an invoice, a note that the rubric may not apply — and no reassurance', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /august-invoice\.txt/ }))

    const head = screen.getByRole('heading', { level: 1 }).closest<HTMLElement>('.contract-head')!
    expect(within(head).getByText('Likely not a contract — invoice')).toHaveClass('status', 'warn')

    expect(await screen.findByText(/This file does not look like a commercial contract — it reads like an invoice/)).toHaveTextContent(
      "(Invoice markers: 'Invoice number', 'Amount due', 'Bill to'). The key terms and risk review below are graded with the contract rubric and may not be meaningful here; you can still ask questions about the text.",
    )
    // The clean review is not presented as good news.
    const strip = within(screen.getByRole('list', { name: 'Review summary' })).getAllByRole('listitem')
    expect(strip[2]).toHaveTextContent('RisksNonerubric may not apply')
    expect(strip[2]).toHaveClass('warn')
    expect(screen.getByText('Rubric may not apply')).toHaveClass('status', 'warn')
    expect(screen.getByText(/No contract risks or deviations were flagged — but this file does not read as a commercial contract/)).toBeInTheDocument()
    expect(screen.getByTestId('categories-clean')).toHaveTextContent('The rubric is written for contracts, so this says little about this file.')
    expect(screen.queryByText('Nothing needs attention')).not.toBeInTheDocument()
  })

  it('keeps the quiet wording for a contract, and says nothing for a row not yet classified', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /northwind\.txt/ }))
    const head = screen.getByRole('heading', { level: 1 }).closest<HTMLElement>('.contract-head')!
    expect(within(head).getByText('Commercial contract')).toHaveClass('status', 'none')
    expect(await screen.findByText('Nothing needs attention')).toHaveClass('status', 'ok')
    expect(screen.queryByText(/rubric may not apply/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /old\.txt/ }))
    const oldHead = screen.getByRole('heading', { level: 1 }).closest<HTMLElement>('.contract-head')!
    expect(oldHead).toHaveTextContent('old.txt')
    expect(within(oldHead).queryByText(/Commercial contract|not a contract|uncertain/)).not.toBeInTheDocument()
    expect(screen.queryByText(/rubric may not apply/i)).not.toBeInTheDocument()
  })

  it('words an uncertain file as uncertain, not as "not a contract"', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /memo\.txt/ }))
    expect(screen.getByText('Document type uncertain')).toHaveClass('status', 'warn')
    expect(await screen.findByText(/It is not clear whether this file is a commercial contract \(Only 12 words — too short to classify\)/)).toBeInTheDocument()
  })
})
