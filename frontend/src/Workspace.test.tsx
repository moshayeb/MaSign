import { render, screen, waitFor, within } from '@testing-library/react'
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

const review: RiskReview = {
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
  findings: [{ category: 'termination', category_name: 'Termination', severity: 'High', reason: 'Half the fees.', quote: 'fifty percent (50%)', chunk_id: 'c1', chunk_index: 1 }],
  categories: [{ id: 'termination', name: 'Termination', worst_severity: 'High', findings: 1 }],
  key_terms: [],
}
const passages = [
  { chunk_id: 'c0', chunk_index: 0, text: '1. Parties.' },
  { chunk_id: 'c1', chunk_index: 1, text: '9. Termination. Customer shall pay fifty percent (50%) of the Fees.' },
]

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  window.location.hash = ''
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/contracts') return json(200, [northwind])
    if (url.endsWith('/risks')) return json(200, review)
    if (url.endsWith('/passages')) return json(200, passages)
    return json(404, { detail: `unexpected ${url}` })
  })
})
afterEach(() => vi.restoreAllMocks())

describe('contract workspace tabs (MAS-95)', () => {
  it('shows the tabs only once a contract is selected, with Overview first', async () => {
    render(<App />)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Select a contract to get started')

    await userEvent.click(await screen.findByRole('button', { name: /northwind\.txt/ }))

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Ask MaSign', 'Sources'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Risk review')).toBeVisible()
    expect(screen.getByLabelText('Ask about the contract')).not.toBeVisible() // mounted, hidden
    expect(window.location.hash).toBe('#nw/overview')
  })

  it('"Show in contract" switches to the Sources tab at the passage', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /northwind\.txt/ }))
    await screen.findByText('Half the fees.')

    await userEvent.click(screen.getByRole('button', { name: 'Show Termination finding in contract' }))

    expect(screen.getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText('Contract text')).toBeVisible()
    expect(document.getElementById('passage-1')).toHaveClass('highlighted')
    expect(within(panel).getByTestId('quote')).toHaveTextContent('fifty percent (50%)')
    expect(window.location.hash).toBe('#nw/text')
  })

  it('moves between tabs with the keyboard and keeps the draft question', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /northwind\.txt/ }))
    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))
    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'What is the fee?')

    screen.getByRole('tab', { name: 'Ask MaSign' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Sources' }))
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{End}')
    await userEvent.keyboard('{ArrowRight}') // wraps around
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))
    expect(screen.getByLabelText('Ask about the contract')).toHaveValue('What is the fee?')
  })

  it('restores the contract and tab from the URL hash, and writes them back', async () => {
    window.location.hash = '#nw/text'
    render(<App />)

    expect(await screen.findByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: /northwind\.txt/ })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))
    expect(window.location.hash).toBe('#nw/ask')
  })

  it('ignores a hash that names an unknown contract', async () => {
    window.location.hash = '#gone/ask'
    render(<App />)
    await screen.findByRole('button', { name: /northwind\.txt/ })
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('shows labelled, row-based PDF and export controls behind one compact menu (MAS-154)', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /northwind\.txt/ }))

    const menuButton = document.querySelector<HTMLElement>('details.actions-menu > summary')!
    const menu = menuButton.closest('details')!
    expect(menu).not.toHaveAttribute('open')
    await userEvent.click(menuButton)
    expect(menu).toHaveAttribute('open')

    const nav = within(menu).getByRole('navigation', { name: 'Export and print options' })
    expect(within(nav).getByRole('link', { name: 'Export PDF' })).toHaveAttribute('href', '/api/contracts/nw/export.pdf')
    expect(within(nav).getByRole('link', { name: 'Export Markdown' })).toHaveAttribute('href', '/api/contracts/nw/export.md')
    expect(within(nav).getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/contracts/nw/export.csv')
    expect(within(nav).getByRole('link', { name: 'Export PDF' })).toHaveAttribute('download')
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    await userEvent.click(within(nav).getByRole('button', { name: 'Print review' }))
    expect(print).toHaveBeenCalled()
  })

  it('shows the contract header with file facts and review state, and the CTA opens the composer (MAS-104)', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /northwind\.txt/ }))

    const head = screen.getByRole('heading', { level: 1 }).closest<HTMLElement>('.contract-head')!
    expect(within(head).getByRole('heading', { level: 1 })).toHaveTextContent('northwind.txt')
    expect(head).toHaveTextContent('TXT')
    expect(head).toHaveTextContent('1 B · 2 passages · uploaded')
    expect(within(head).getByText('Reviewed · High risk')).toHaveClass('status', 'warn')

    await userEvent.click(within(head).getByRole('button', { name: 'Ask a question about this contract' }))
    expect(screen.getByRole('tab', { name: 'Ask MaSign' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByLabelText('Ask about the contract')).toHaveFocus())
  })

  it('has no API docs link in the header any more', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /northwind\.txt/ })
    expect(screen.queryByRole('link', { name: 'API docs' })).not.toBeInTheDocument()
  })
})
