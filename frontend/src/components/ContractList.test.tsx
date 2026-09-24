import { render, screen } from '@testing-library/react'
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
