import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Contract } from '../api'
import { ContractList } from './ContractList'

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
