import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Coverage } from './api'
import { CoverageNotice } from './components/CoverageNotice'

// A document the contract leans on but nobody uploaded is a hole in the review (MAS-123).

const base: Coverage = {
  chunks_total: 12,
  chunks_checked: 12,
  unreadable_passages: [],
  withheld_passages: [],
  redacted_passages: [],
  ingestion_notes: [],
  external_references: [],
}

describe('coverage notice (MAS-123)', () => {
  it('warns in amber and leads with the consequence when a referenced document is missing', () => {
    render(<CoverageNotice coverage={{ ...base, external_references: [{ name: 'Service Level Schedule', chunk_indexes: [3] }] }} />)

    const notice = screen.getByText(/Review may be incomplete/).closest('details')!
    expect(notice).toHaveClass('security') // the amber style, not the quiet grey one
    expect(notice).toHaveTextContent('Review may be incomplete — Service Level Schedule was referenced but not uploaded')
    expect(screen.getByText('View details')).toBeInTheDocument()
  })

  it('names several documents in one line', () => {
    render(
      <CoverageNotice
        coverage={{ ...base, external_references: [{ name: 'Order Form', chunk_indexes: [1] }, { name: 'Schedule 2', chunk_indexes: [4] }] }}
      />,
    )
    expect(screen.getByText(/Review may be incomplete/)).toHaveTextContent('Order Form and Schedule 2 were referenced but not uploaded')
  })

  it('shows an explicit linked document as resolved rather than as a missing-document warning', () => {
    render(
      <CoverageNotice
        coverage={{
          ...base,
          resolved_references: [{ reference_name: 'Statement of Work', linked_contract_id: 'sow-id', linked_contract_filename: 'sow-final.docx' }],
        }}
      />,
    )
    const notice = screen.getByText('Statement of Work linked').closest('details')!
    expect(notice).not.toHaveClass('security')
    expect(screen.getByRole('link', { name: 'sow-final.docx' })).toHaveAttribute('href', '/workspace#sow-id/overview')
  })

  it('says nothing at all when everything was read and nothing is missing', () => {
    const { container } = render(<CoverageNotice coverage={base} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the quiet grey style when the only note is an unreadable page', () => {
    render(<CoverageNotice coverage={{ ...base, ingestion_notes: ['Page 3 of 14 has no text layer (scanned or image-only) and could not be read.'] }} />)
    const notice = screen.getByText(/part of the file not readable/).closest('details')!
    expect(notice).not.toHaveClass('security')
  })
})
