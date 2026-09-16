import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Contract } from './api'

// sonner renders real DOM, but its enter animation and timers make text
// assertions brittle under jsdom; the toast calls themselves are the contract.
vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return {
    ...actual,
    Toaster: () => null,
    toast: Object.assign(vi.fn(), {
      error: vi.fn(),
      success: vi.fn(),
      promise: vi.fn(),
    }),
  }
})

import { toast } from 'sonner'

const contract = (overrides: Partial<Contract> = {}): Contract => ({
  contract_id: 'c1',
  filename: 'msa.txt',
  file_type: 'txt',
  size_bytes: 2048,
  character_count: 1900,
  chunk_count: 2,
  status: 'processed',
  created_at: '2026-09-16T10:00:00Z',
  ...overrides,
})

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// toast.promise is mocked: run the promise and call the matching message
// builder, the way sonner would, and return the { unwrap } handle.
function promiseToastBehaviour() {
  vi.mocked(toast.promise).mockImplementation(((promise: Promise<unknown>, messages: Record<string, unknown>) => ({
    unwrap: () =>
      promise.then(
        (value) => {
          const success = messages.success as (v: unknown) => string
          shown.push(['success', success(value)])
          return value
        },
        (error: Error) => {
          const failure = messages.error as (e: Error) => string
          shown.push(['error', failure(error)])
          throw error
        },
      ),
  })) as never)
}

let shown: [string, string][]

beforeEach(() => {
  shown = []
  vi.mocked(toast.error).mockClear()
  promiseToastBehaviour()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('contract list', () => {
  it('lists contracts and marks the chosen one as selected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, [contract(), contract({ contract_id: 'c2', filename: 'nda.pdf' })]))

    render(<App />)

    expect(await screen.findByText('msa.txt')).toBeInTheDocument()
    expect(screen.getByText('nda.pdf')).toBeInTheDocument()
    await userEvent.click(screen.getByText('nda.pdf'))
    expect(screen.getByRole('button', { name: /nda\.pdf/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /msa\.txt/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the API detail in an error toast when loading fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(503, { detail: 'Database unavailable. Check that Postgres is running and DATABASE_URL is correct.' }),
    )

    render(<App />)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Database unavailable. Check that Postgres is running and DATABASE_URL is correct.',
      ),
    )
    expect(screen.getByText(/No contracts yet/)).toBeInTheDocument()
  })
})

describe('upload', () => {
  it('reports success with the filename and chunk count, then refreshes and selects it', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(200, contract({ contract_id: 'new', filename: 'northwind.txt', chunk_count: 12 })))
      .mockResolvedValueOnce(json(200, [contract({ contract_id: 'new', filename: 'northwind.txt', chunk_count: 12 })]))

    render(<App />)
    await screen.findByText(/No contracts yet/)
    const input = screen.getByLabelText(/Contract file/) as HTMLInputElement
    await userEvent.upload(input, new File(['1. Fees'], 'northwind.txt', { type: 'text/plain' }))
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(shown).toEqual([['success', 'northwind.txt uploaded — 12 chunks']]))
    expect(await screen.findByRole('button', { name: /northwind\.txt/ })).toHaveAttribute('aria-pressed', 'true')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/contracts', '/api/contracts/upload', '/api/contracts'])
  })

  it('shows the API detail verbatim when the upload is rejected', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(422, { detail: 'No readable text found in scan.pdf. Scanned documents need OCR first.' }))

    render(<App />)
    await screen.findByText(/No contracts yet/)
    await userEvent.upload(screen.getByLabelText(/Contract file/), new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() =>
      expect(shown).toEqual([['error', 'No readable text found in scan.pdf. Scanned documents need OCR first.']]),
    )
    expect(screen.getByText(/No contracts yet/)).toBeInTheDocument() // list untouched, nothing selected
    // Ready for another attempt: no longer "Uploading…", waiting for a new file.
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
    expect((screen.getByLabelText(/Contract file/) as HTMLInputElement).value).toBe('')
  })
})
