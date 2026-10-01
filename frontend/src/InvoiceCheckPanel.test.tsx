import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Contract, InvoiceCheck } from './api'
import { InvoiceCheckPanel } from './components/InvoiceCheckPanel'

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
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function makeCheck(overrides: Partial<InvoiceCheck> = {}): InvoiceCheck {
  return {
    id: 'check-1',
    invoice: { id: 'inv-1', contract_id: 'nw', filename: 'invoice.pdf', size_bytes: 1234, character_count: 200, page_count: 1, ingestion_notes: [], created_at: '2026-10-01T10:00:00Z' },
    contract_id: 'nw',
    model: 'fake-chat',
    checked: true,
    created_at: '2026-10-01T10:00:00Z',
    matches: 1,
    possible_mismatches: 1,
    cannot_verify: 1,
    items: [
      {
        label: 'Fee amount',
        outcome: 'match',
        reason: "The invoiced amount matches the contract's one-off fee.",
        contract_term: 'one_off_fee',
        contract_value: 'EUR 500 one-time setup fee',
        contract_quote: 'a one-time setup fee of EUR 500',
        contract_chunk_id: 'chunk-1',
        contract_chunk_index: 0,
        source_contract_id: 'nw',
        invoice_field: 'total_amount',
        invoice_value: 'EUR 500.00',
        invoice_quote: 'Total amount due: EUR 500.00',
        invoice_chunk_id: 'inv-chunk-1',
        invoice_page: 1,
      },
      {
        label: 'Payment deadline',
        outcome: 'possible_mismatch',
        reason: 'The invoice gives a 45-day payment window; the contract states 30 net days.',
        contract_term: 'payment_deadline',
        contract_value: '30 days',
        contract_quote: 'payable within 30 days of the invoice date',
        contract_chunk_id: 'chunk-2',
        contract_chunk_index: 1,
        source_contract_id: 'nw',
        invoice_field: 'due_date',
        invoice_value: '15 February 2026',
        invoice_quote: 'Due date: 2026-02-15',
        invoice_chunk_id: 'inv-chunk-1',
        invoice_page: 1,
      },
      {
        label: 'Late-payment rate',
        outcome: 'cannot_verify',
        reason: 'The invoice does not state a late-payment rate (expected on a routine, not-yet-overdue invoice).',
        contract_term: null,
        contract_value: null,
        contract_quote: null,
        contract_chunk_id: null,
        contract_chunk_index: null,
        source_contract_id: null,
        invoice_field: null,
        invoice_value: null,
        invoice_quote: null,
        invoice_chunk_id: null,
        invoice_page: null,
      },
    ],
    ...overrides,
  }
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
          shown.push(['error', typeof messages.error === 'function' ? (messages.error as (e: Error) => string)(error) : String(messages.error)])
          throw error
        },
      ),
  })) as typeof toast.promise)
})

describe('invoice verification (MAS-92)', () => {
  it('shows that no invoice has been checked yet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, []))
    render(<InvoiceCheckPanel contract={northwind} />)

    expect(await screen.findByText('No invoice has been checked against this contract yet.')).toBeInTheDocument()
  })

  it('shows match, possible-mismatch and cannot-verify outcomes distinctly, each with its own evidence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, [makeCheck()]))
    render(<InvoiceCheckPanel contract={northwind} />)

    const feeItem = (await screen.findByText('Fee amount')).closest('li')!
    expect(within(feeItem).getByText('Match')).toBeInTheDocument()
    expect(within(feeItem).getByText(/Total amount due: EUR 500.00/)).toBeInTheDocument()
    expect(within(feeItem).getByText(/a one-time setup fee of EUR 500/)).toBeInTheDocument()

    const deadlineItem = (await screen.findByText('Payment deadline')).closest('li')!
    expect(within(deadlineItem).getByText('Possible mismatch')).toBeInTheDocument()

    const lateItem = (await screen.findByText('Late-payment rate')).closest('li')!
    expect(within(lateItem).getByText('Cannot verify')).toBeInTheDocument()
    expect(within(lateItem).queryByText('“”')).not.toBeInTheDocument() // no quote shown when there is none
  })

  it('shows a warning instead of a clean result when the invoice could not be read at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, [makeCheck({ checked: false })]))
    render(<InvoiceCheckPanel contract={northwind} />)

    expect(await screen.findByText(/fields could not be read, so nothing on it could be verified/)).toBeInTheDocument()
  })

  it("opens the contract's cited passage through onShowSource", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, [makeCheck()]))
    const onShowSource = vi.fn()
    render(<InvoiceCheckPanel contract={northwind} onShowSource={onShowSource} />)

    const feeItem = (await screen.findByText('Fee amount')).closest('li')!
    await userEvent.click(within(feeItem).getByRole('button', { name: /passage 1/ }))

    expect(onShowSource).toHaveBeenCalledWith({ contract_id: 'nw', chunk_index: 0, quote: 'a one-time setup fee of EUR 500' })
  })

  it('uploads an invoice and reports the outcome counts through a toast', async () => {
    const file = new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (init?.method === 'POST') return json(201, makeCheck())
      if (url.includes('/invoice-checks')) return json(200, [])
      return json(404, { detail: 'not found' })
    })
    render(<InvoiceCheckPanel contract={northwind} />)
    await screen.findByText('No invoice has been checked against this contract yet.')

    const input = screen.getByLabelText(/Invoice file/) as HTMLInputElement
    await userEvent.upload(input, file)

    await waitFor(() => expect(shown).toContainEqual(['success', '1 match, 1 possible mismatch, 1 not verifiable']))
  })

  it('reports an upload failure with the API detail, not a generic error', async () => {
    // A real rejection (e.g. a scanned PDF) still has a .pdf name, so the
    // input's `accept` filter lets it through to the server, which is the
    // one that actually decides -- the server's `detail` is what must show.
    const file = new File(['not a readable pdf'], 'invoice.pdf', { type: 'application/pdf' })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') return json(415, { detail: 'Unsupported file content. Upload a digital PDF invoice.' })
      return json(200, [])
    })
    render(<InvoiceCheckPanel contract={northwind} />)
    await screen.findByText('No invoice has been checked against this contract yet.')

    const input = screen.getByLabelText(/Invoice file/) as HTMLInputElement
    await userEvent.upload(input, file)

    await waitFor(() => expect(shown).toContainEqual(['error', 'Unsupported file content. Upload a digital PDF invoice.']))
  })
})
