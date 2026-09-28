import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Contract, RiskReview } from './api'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

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

const harbor: Contract = {
  contract_id: 'hb',
  filename: 'harbor.docx',
  file_type: 'docx',
  size_bytes: 1,
  character_count: 1,
  chunk_count: 1,
  status: 'processed',
  created_at: '2026-09-18T10:00:00Z',
  risk_status: 'done',
  risk_worst_severity: 'Medium',
}

const gamma: Contract = {
  contract_id: 'gm',
  filename: 'gamma.txt',
  file_type: 'txt',
  size_bytes: 1,
  character_count: 1,
  chunk_count: 1,
  status: 'processed',
  created_at: '2026-09-19T10:00:00Z',
}

function reviewOf(contractId: string, overrides: Partial<RiskReview> = {}): RiskReview {
  return {
    contract_id: contractId,
    status: 'done',
    model: 'claude-sonnet-5',
    chunks_total: 1,
    chunks_checked: 1,
    chunks_withheld: 0,
    complete: true,
    error: null,
    updated_at: '2026-09-20T09:00:00Z',
    findings: [],
    categories: [],
    key_terms_complete: true,
    key_terms: [],
    ...overrides,
  }
}

const reviewNorthwind = reviewOf('nw', {
  findings: [
    { category: 'termination', category_name: 'Termination', severity: 'High', reason: 'Half the fees.', quote: 'fifty percent (50%)', chunk_id: 'c1', chunk_index: 1, contract_id: 'nw' },
  ],
  categories: [{ id: 'termination', name: 'Termination', worst_severity: 'High', findings: 1 }],
  key_terms: [
    {
      id: 'recurring_fee',
      name: 'Recurring fee',
      kind: 'recurring',
      status: 'found',
      value: 'EUR 18,500/month',
      source: { value: 'EUR 18,500/month', quote: 'The Subscription Fee is EUR 18,500 per month.', chunk_id: 'nw-0', chunk_index: 0, contract_id: 'nw', typed: null },
      others: [],
    },
  ],
})

const reviewHarbor = reviewOf('hb', {
  categories: [{ id: 'termination', name: 'Termination', worst_severity: 'Low', findings: 0 }],
  key_terms: [
    {
      id: 'recurring_fee',
      name: 'Recurring fee',
      kind: 'recurring',
      status: 'found',
      value: 'EUR 9,000/month',
      source: { value: 'EUR 9,000/month', quote: 'The monthly fee is EUR 9,000.', chunk_id: 'hb-0', chunk_index: 0, contract_id: 'hb', typed: null },
      others: [],
    },
  ],
})

const northwindPassages = [
  { chunk_id: 'c0', chunk_index: 0, text: 'The Subscription Fee is EUR 18,500 per month.' },
  { chunk_id: 'c1', chunk_index: 1, text: '9. Termination. Customer shall pay fifty percent (50%) of the Fees.' },
]
const harborPassages = [{ chunk_id: 'h0', chunk_index: 0, text: 'The monthly fee is EUR 9,000.' }]

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  window.location.hash = ''
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/contracts') return json(200, [northwind, harbor, gamma])
    if (url === '/api/contracts/nw/risks') return json(200, reviewNorthwind)
    if (url === '/api/contracts/hb/risks') return json(200, reviewHarbor)
    if (url === '/api/contracts/gm/risks') return json(404, { detail: 'This contract has not been reviewed for risks yet.' })
    if (url === '/api/contracts/nw/passages') return json(200, northwindPassages)
    if (url === '/api/contracts/hb/passages') return json(200, harborPassages)
    if (url.endsWith('/passages')) return json(200, [])
    return json(404, { detail: `unexpected ${url}` })
  })
})
afterEach(() => vi.restoreAllMocks())

describe('comparing two contracts (MAS-113)', () => {
  it('picks exactly two contracts and renders their key terms and risk categories side by side', async () => {
    render(<App />)
    await screen.findAllByRole('button', { name: /northwind\.txt/ })

    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))
    expect(screen.getByText('Select two contracts to compare · 0 of 2')).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: /northwind\.txt/ })[0])
    await userEvent.click(screen.getAllByRole('button', { name: /harbor\.docx/ })[0])

    const compare = await screen.findByRole('region', { name: 'Contract comparison' })
    expect(within(compare).getByText('Comparing two contracts')).toBeInTheDocument()
    const heads = compare.querySelector('.compare-heads') as HTMLElement
    expect(within(heads).getByText('northwind.txt')).toBeInTheDocument()
    expect(within(heads).getByText('harbor.docx')).toBeInTheDocument()

    // Both sides' fee is shown, verbatim from their own source — a real difference.
    const feeRow = screen.getByText('Recurring fee').closest('.compare-row') as HTMLElement
    expect(within(feeRow).getByText('EUR 18,500/month')).toBeInTheDocument()
    expect(within(feeRow).getByText('EUR 9,000/month')).toBeInTheDocument()
    expect(feeRow).toHaveClass('differs')

    // Termination category: High on one side, Low on the other.
    const terminationRow = screen.getByRole('rowheader', { name: 'Termination' }).closest('.compare-row') as HTMLElement
    expect(within(terminationRow).getByText(/High · 1 finding/)).toBeInTheDocument()
    expect(within(terminationRow).getByText(/Low · 0 findings/)).toBeInTheDocument()

    // Findings are listed per contract, with a source link each.
    expect(screen.getByRole('heading', { name: 'northwind.txt', level: 4 })).toBeInTheDocument()
    expect(screen.getByText('Half the fees.')).toBeInTheDocument()

    // Never claims a winner.
    expect(screen.getByText(/does not say which contract is legally better/)).toBeInTheDocument()
  })

  it('shows missing values as missing, never inferred, for an unreviewed contract', async () => {
    render(<App />)
    await screen.findAllByRole('button', { name: /northwind\.txt/ })

    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))
    await userEvent.click(screen.getAllByRole('button', { name: /northwind\.txt/ })[0])
    await userEvent.click(screen.getAllByRole('button', { name: /gamma\.txt/ })[0])

    expect(await screen.findByText('Comparing two contracts')).toBeInTheDocument()
    expect(screen.getByText(/gamma\.txt has not been reviewed yet/)).toBeInTheDocument()

    const feeRow = screen.getByText('Recurring fee').closest('.compare-row') as HTMLElement
    expect(within(feeRow).getByText('EUR 18,500/month')).toBeInTheDocument()
    expect(within(feeRow).getByText('Not reviewed')).toBeInTheDocument()
    expect(feeRow).not.toHaveClass('differs') // not comparable, not a difference
  })

  it('Cancel during picking exits without comparing, and Exit comparison returns to normal browsing', async () => {
    render(<App />)
    await screen.findAllByRole('button', { name: /northwind\.txt/ })

    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))
    await userEvent.click(screen.getAllByRole('button', { name: /northwind\.txt/ })[0])
    expect(screen.getByText('Select two contracts to compare · 1 of 2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Select two contracts to compare/)).not.toBeInTheDocument()
    expect(screen.getByText('Select a contract to get started')).toBeInTheDocument()

    // A full pick still reaches the comparison, and Exit comparison returns cleanly.
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))
    await userEvent.click(screen.getAllByRole('button', { name: /northwind\.txt/ })[0])
    await userEvent.click(screen.getAllByRole('button', { name: /harbor\.docx/ })[0])
    expect(await screen.findByText('Comparing two contracts')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Exit comparison' }))
    expect(screen.queryByText('Comparing two contracts')).not.toBeInTheDocument()
    expect(screen.getByText('Select a contract to get started')).toBeInTheDocument()
  })

  it('deselecting a pick during picking allows a different third contract to be chosen', async () => {
    render(<App />)
    await screen.findAllByRole('button', { name: /northwind\.txt/ })

    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))
    await userEvent.click(screen.getAllByRole('button', { name: /northwind\.txt/ })[0])
    await userEvent.click(screen.getAllByRole('button', { name: /harbor\.docx/ })[0])
    // Auto-closed picking once two were chosen (no third click possible here);
    // exit and re-pick with a swap instead to prove a dropped pick frees a slot.
    await screen.findByText('Comparing two contracts')
    await userEvent.click(screen.getByRole('button', { name: 'Exit comparison' }))

    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))
    await userEvent.click(screen.getAllByRole('button', { name: /northwind\.txt/ })[0])
    await userEvent.click(screen.getAllByRole('button', { name: /northwind\.txt/ })[0]) // deselect
    expect(screen.getByText('Select two contracts to compare · 0 of 2')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: /gamma\.txt/ })[0])
    await userEvent.click(screen.getAllByRole('button', { name: /harbor\.docx/ })[0])

    const compare = await screen.findByRole('region', { name: 'Contract comparison' })
    expect(within(compare).getByText('gamma.txt')).toBeInTheDocument()
    expect(within(compare).getByText('harbor.docx')).toBeInTheDocument()
  })

  it('opening a source from the comparison selects that contract and shows the passage', async () => {
    render(<App />)
    await screen.findAllByRole('button', { name: /northwind\.txt/ })

    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))
    await userEvent.click(screen.getAllByRole('button', { name: /northwind\.txt/ })[0])
    await userEvent.click(screen.getAllByRole('button', { name: /harbor\.docx/ })[0])
    await screen.findByText('Comparing two contracts')

    await userEvent.click(screen.getByRole('button', { name: 'Show Termination finding in northwind.txt' }))

    expect(screen.queryByText('Comparing two contracts')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('passage-1')).toHaveClass('highlighted')
  })
})
