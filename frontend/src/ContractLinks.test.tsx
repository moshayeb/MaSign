import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Contract } from './api'
import { ContractLinks } from './components/ContractLinks'

vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }))

import { toast } from 'sonner'

afterEach(() => vi.restoreAllMocks())

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

    const disclosure = screen.getByText('Related documents').closest('details')!
    expect(disclosure).not.toHaveAttribute('open')
    expect(screen.getByText(/1 missing document/)).toBeVisible()
    expect(screen.getByRole('combobox')).not.toBeVisible()
    await user.click(screen.getByText('Related documents'))
    expect(disclosure).toHaveAttribute('open')
    expect(screen.getByRole('heading', { name: 'Statement of Work' })).toBeVisible()
    expect(screen.getByText('Choose an uploaded document to add it to this review.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link document' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Upload a document' })).toBeInTheDocument()
    expect(screen.getByText(/Upload starts its normal review/)).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox'), 'sow')
    await user.click(screen.getByRole('button', { name: 'Link document' }))
    expect(screen.getByRole('dialog', { name: 'Confirm document link' })).toBeInTheDocument()
  })
  it('links and unlinks after expanding related documents (MAS-206)', async () => {
    const user = userEvent.setup()
    const link = { id: 'link-1', primary_contract_id: 'msa', linked_contract_id: 'sow', reference_name: 'Statement of Work', created_at: primary.created_at }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(link), { status: 201, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.mocked(toast.promise).mockImplementation(((promise: Promise<unknown>) => ({ unwrap: () => promise })) as never)
    const changed = vi.fn()
    const props = { primary, contracts: [primary, sow], onChanged: changed, onUploaded: vi.fn() }
    const { rerender } = render(<ContractLinks {...props} links={[]} references={[{ name: 'Statement of Work', chunk_indexes: [0] }]} />)

    expect(screen.getByText('1 missing document · link to complete the bundle')).toBeVisible()
    await user.click(screen.getByText('Related documents'))
    await user.selectOptions(screen.getByRole('combobox'), 'sow')
    await user.click(screen.getByRole('button', { name: 'Link document' }))
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm link' }))
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/contracts/msa/links', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ linked_contract_id: 'sow', reference_name: 'Statement of Work' }),
    }))

    rerender(<ContractLinks {...props} links={[link]} references={[]} />)
    expect(screen.getByText(/1 linked/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/contracts/msa/links/link-1', expect.objectContaining({ method: 'DELETE' }))
  })

})
