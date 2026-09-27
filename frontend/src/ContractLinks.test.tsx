import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Contract } from './api'
import { ContractLinks } from './components/ContractLinks'

vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }))

const primary: Contract = {
  contract_id: 'msa', filename: 'master-services-agreement.pdf', file_type: 'pdf',
  size_bytes: 100, character_count: 100, chunk_count: 2, status: 'processed',
  created_at: '2026-09-25T10:00:00Z', risk_status: 'done',
}

const sow: Contract = {
  ...primary, contract_id: 'sow', filename: 'statement-of-work.pdf',
}

describe('related-document panel (MAS-153)', () => {
  it('keeps choosing an uploaded document as the clear primary action', async () => {
    const user = userEvent.setup()
    render(
      <ContractLinks
        primary={primary}
        links={[]}
        references={[{ name: 'Statement of Work', chunk_indexes: [0] }]}
        contracts={[primary, sow]}
        onChanged={vi.fn()}
        onUploaded={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Statement of Work' })).toBeInTheDocument()
    expect(screen.getByText('Choose an uploaded document to add it to this review.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link document' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Upload a document' })).toBeInTheDocument()
    expect(screen.getByText(/Upload starts its normal review/)).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox'), 'sow')
    await user.click(screen.getByRole('button', { name: 'Link document' }))
    expect(screen.getByRole('dialog', { name: 'Confirm document link' })).toBeInTheDocument()
  })
})