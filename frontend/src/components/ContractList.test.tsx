import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Contract } from '../api'
import { ContractList } from './ContractList'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  const errorMock = vi.fn()
  const toastMock = Object.assign(vi.fn(), {
    error: errorMock,
    success: vi.fn(),
    // Mirrors what real sonner does on a toast.promise rejection: calls
    // toast.error with the message builder's result.
    promise: vi.fn((p: Promise<unknown>, messages: Record<string, unknown>) => ({
      unwrap: () =>
        p.then(
          (value) => value,
          (error: Error) => {
            if (typeof messages.error === 'function') errorMock((messages.error as (e: Error) => string)(error))
            throw error
          },
        ),
    })),
  })
  return { ...actual, toast: toastMock }
})

function contract(overrides: Partial<Contract> & { contract_id: string; filename: string; created_at: string }): Contract {
  return {
    file_type: 'txt',
    size_bytes: 100,
    character_count: 100,
    chunk_count: 1,
    status: 'processed',
    risk_status: null,
    ...overrides,
  }
}

const DATE_QUALIFIER = /· \d{1,2} \w{3}/

// MAS-133: several uploads can share a filename in real data; a duplicate
// must be distinguishable in the list without opening it.
describe('ContractList duplicate names', () => {
  it('adds a short date qualifier only to names that repeat', () => {
    const contracts = [
      contract({ contract_id: 'a', filename: 'E-Contract.txt', created_at: '2026-09-22T10:00:00Z' }),
      contract({ contract_id: 'b', filename: 'E-Contract.txt', created_at: '2026-09-23T10:00:00Z' }),
      contract({ contract_id: 'c', filename: 'northwind.txt', created_at: '2026-09-20T10:00:00Z' }),
    ]
    render(<ContractList contracts={contracts} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} />)

    const duplicateButtons = screen.getAllByText('E-Contract.txt').map((name) => name.closest('button')!)
    expect(duplicateButtons).toHaveLength(2)
    for (const button of duplicateButtons) expect(button.textContent).toMatch(DATE_QUALIFIER)

    const uniqueButton = screen.getByText('northwind.txt').closest('button')!
    expect(uniqueButton.textContent).not.toMatch(DATE_QUALIFIER)
  })

  it('does not add a date qualifier when every name is unique', () => {
    const contracts = [
      contract({ contract_id: 'a', filename: 'acme.txt', created_at: '2026-09-22T10:00:00Z' }),
      contract({ contract_id: 'b', filename: 'northwind.txt', created_at: '2026-09-23T10:00:00Z' }),
    ]
    render(<ContractList contracts={contracts} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} />)

    expect(screen.getByText('acme.txt').closest('button')!.textContent).not.toMatch(DATE_QUALIFIER)
    expect(screen.getByText('northwind.txt').closest('button')!.textContent).not.toMatch(DATE_QUALIFIER)
  })
})

// MAS-101: fee, term, worst risk and deviations under each contract, without opening it.
describe('ContractList summary strip', () => {
  it('adds no second line for a contract with no risk review at all — the badge already says so', () => {
    const contracts = [contract({ contract_id: 'a', filename: 'unreviewed.txt', created_at: '2026-09-22T10:00:00Z', risk_status: null })]
    const { container } = render(<ContractList contracts={contracts} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} />)

    expect(screen.getByText('Not reviewed')).toBeInTheDocument() // the status badge
    expect(container.querySelector('.contract-summary')).toBeNull()
  })

  it('shows fee, term, High findings and deviations for a reviewed contract', () => {
    const contracts = [
      contract({
        contract_id: 'a',
        filename: 'reviewed.txt',
        created_at: '2026-09-22T10:00:00Z',
        risk_status: 'done',
        recurring_fee: 'EUR 18,500 per month',
        initial_term: '36 months',
        high_findings: 2,
        deviations: 3,
      }),
    ]
    render(<ContractList contracts={contracts} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} />)

    expect(screen.getByText('EUR 18,500 per month · 36 months · 2 High · 3 deviations')).toBeInTheDocument()
  })

  it('adds no second line when the review found nothing beyond what the badge says', () => {
    const contracts = [contract({ contract_id: 'a', filename: 'clean.txt', created_at: '2026-09-22T10:00:00Z', risk_status: 'done' })]
    const { container } = render(<ContractList contracts={contracts} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} />)

    expect(screen.getByText('Reviewed')).toBeInTheDocument() // the status badge
    expect(container.querySelector('.contract-summary')).toBeNull()
  })

  it('sorts by highest risk, then by most deviations, on demand', async () => {
    const contracts = [
      contract({ contract_id: 'low', filename: 'low.txt', created_at: '2026-09-20T10:00:00Z', risk_status: 'done', risk_worst_severity: 'Low', deviations: 3 }),
      contract({ contract_id: 'high', filename: 'high.txt', created_at: '2026-09-19T10:00:00Z', risk_status: 'done', risk_worst_severity: 'High', deviations: 0 }),
      contract({ contract_id: 'medium', filename: 'medium.txt', created_at: '2026-09-21T10:00:00Z', risk_status: 'done', risk_worst_severity: 'Medium', deviations: 1 }),
    ]
    const { container } = render(<ContractList contracts={contracts} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} />)

    const names = () => Array.from(container.querySelectorAll('.contract-name')).map((el) => el.textContent)
    expect(names()[0]).toBe('low.txt') // default: newest first, as the API returns it

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'Highest risk')
    expect(names()[0]).toBe('high.txt')

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'Most deviations')
    expect(names()[0]).toBe('low.txt') // 3 deviations, ahead of medium's 1 and high's 0
  })
})

// MAS-126: at most one small warning tag beside a name, not up to two.
describe('ContractList badge trimming', () => {
  it('shows only the document-kind warning when both it and a readability note apply', () => {
    const contracts = [
      contract({
        contract_id: 'a',
        filename: 'maybe.txt',
        created_at: '2026-09-22T10:00:00Z',
        document_kind: 'uncertain',
        document_kind_reasons: ['no defined-term "Agreement"'],
        ingestion_notes: ['Page 2 of 5 has no text layer.'],
      }),
    ]
    render(<ContractList contracts={contracts} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} />)

    expect(screen.getByText('Type uncertain')).toBeInTheDocument()
    expect(screen.queryByText('Partly readable')).not.toBeInTheDocument()
  })

  it('falls back to the readability note when there is no document-kind mismatch', () => {
    const contracts = [
      contract({ contract_id: 'a', filename: 'scanned.txt', created_at: '2026-09-22T10:00:00Z', ingestion_notes: ['Page 2 of 5 has no text layer.'] }),
    ]
    render(<ContractList contracts={contracts} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} />)

    expect(screen.getByText('Partly readable')).toBeInTheDocument()
  })
})

// MAS-126: export and delete without opening the contract first.
describe('ContractList row actions menu', () => {
  function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }

  // The trigger is a real <button aria-label="Actions for …"> (portal-based
  // RowActionsMenu, MAS-126) -- unlike the workspace header's <summary>-based
  // menu, it needs no querySelector escape hatch.
  function menuTrigger(): HTMLElement {
    return screen.getByRole('button', { name: 'Actions for northwind.txt' })
  }

  const northwind = contract({ contract_id: 'nw', filename: 'northwind.txt', created_at: '2026-09-22T10:00:00Z' })

  afterEach(() => vi.restoreAllMocks())

  it('offers export links and a delete action, hidden while picking a compare pair', () => {
    const { rerender } = render(<ContractList contracts={[northwind]} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} />)

    expect(menuTrigger()).toBeInTheDocument()

    rerender(<ContractList contracts={[northwind]} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} comparing />)
    expect(screen.queryByRole('button', { name: 'Actions for northwind.txt' })).not.toBeInTheDocument()
  })

  it('shows Export PDF/Markdown/CSV as downloads and Delete as a button', async () => {
    render(<ContractList contracts={[northwind]} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} />)

    await userEvent.click(menuTrigger())
    const nav = screen.getByRole('navigation', { name: 'Actions for northwind.txt' })

    expect(within(nav).getByRole('link', { name: 'Export PDF' })).toHaveAttribute('href', '/api/contracts/nw/export.pdf')
    expect(within(nav).getByRole('link', { name: 'Export Markdown' })).toHaveAttribute('href', '/api/contracts/nw/export.md')
    expect(within(nav).getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/contracts/nw/export.csv')
    expect(within(nav).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('confirms before deleting, and Cancel makes no request at all', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<ContractList contracts={[northwind]} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} />)

    await userEvent.click(menuTrigger())
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog', { name: 'Confirm delete' })
    expect(dialog).toHaveTextContent('Delete northwind.txt? This removes its review, key terms and stored answers, and cannot be undone.')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog', { name: 'Confirm delete' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deletes on confirm, reloads the list, and tells the caller which contract is gone', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const onReload = vi.fn()
    const onDeleted = vi.fn()
    render(<ContractList contracts={[northwind]} selectedId={null} onSelect={vi.fn()} onReload={onReload} onDeleted={onDeleted} />)

    await userEvent.click(menuTrigger())
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Confirm delete' })).getByRole('button', { name: 'Yes, delete it' }))

    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith('nw'))
    expect(fetchMock).toHaveBeenCalledWith('/api/contracts/nw', expect.objectContaining({ method: 'DELETE' }))
    expect(onReload).toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Confirm delete' })).not.toBeInTheDocument()
  })

  it('keeps the dialog open and reports the API detail when the delete fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(409, { detail: 'Contract not found.' }))
    const onDeleted = vi.fn()
    render(<ContractList contracts={[northwind]} selectedId={null} onSelect={vi.fn()} onReload={vi.fn()} onDeleted={onDeleted} />)

    await userEvent.click(menuTrigger())
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Confirm delete' })).getByRole('button', { name: 'Yes, delete it' }))

    const { toast } = await import('sonner')
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Contract not found.'))
    expect(onDeleted).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Confirm delete' })).toBeInTheDocument()
  })
})
