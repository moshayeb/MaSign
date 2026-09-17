import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Contract, QueryResponse } from './api'

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

const chunk = (index: number, text: string, score = 0.5) => ({ chunk_id: `c${index}`, contract_id: 'nw', chunk_index: index, text, score })

const answered: QueryResponse = {
  answer: 'The monthly fee is EUR 18,500 per month [1]. Late payment bears interest at 1.5% per month [2][1].',
  grounded: true,
  citations: [
    { label: 1, ...chunk(1, '2. Fees. The Subscription Fee is EUR 18,500 per month.', 0.61) },
    { label: 2, ...chunk(2, '2.3 Late payment shall accrue interest at 1.5% per month.', 0.55) },
  ],
  answer_model: 'claude-sonnet-5',
  retrieved_context: [chunk(1, '2. Fees. The Subscription Fee is EUR 18,500 per month.', 0.61), chunk(2, '2.3 Late payment shall accrue interest at 1.5% per month.', 0.55), chunk(9, '10. Insurance. …', 0.3)],
  risks: ['No scaffolded risk rule matched; human review still required.'],
  recommended_actions: ['Archive analysis result.'],
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let shown: [string, string][]

beforeEach(() => {
  shown = []
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.promise).mockImplementation(((promise: Promise<unknown>, messages: Record<string, unknown>) => ({
    unwrap: () =>
      promise.then(
        (value) => {
          if (typeof messages.success === 'function') shown.push(['success', (messages.success as (v: unknown) => string)(value)])
          else shown.push(['dismissed', String(messages.loading)])
          return value
        },
        (error: Error) => {
          shown.push(['error', (messages.error as (e: Error) => string)(error)])
          throw error
        },
      ),
  })) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function renderWithContractAndAsk(question: string, ...responses: Response[]) {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, [northwind]))
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: /northwind\.txt/ }))
  await userEvent.type(screen.getByLabelText('Ask about the contract'), question)
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
  return fetchMock
}

describe('asking a question', () => {
  it('sends the question scoped to the selected contract and renders the answer with clickable citations', async () => {
    const fetchMock = await renderWithContractAndAsk('What is the monthly fee?', json(200, answered))

    expect(await screen.findByText(/The monthly fee is EUR 18,500 per month/)).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls[1]
    expect(JSON.parse(String(init?.body))).toEqual({ question: 'What is the monthly fee?', contract_id: 'nw', limit: 5 })

    // The [n] markers are buttons that highlight the cited passage.
    const markers = screen.getAllByRole('button', { name: /Show cited passage/ })
    expect(markers.map((m) => m.textContent)).toEqual(['[1]', '[2]', '[1]'])
    await userEvent.click(markers[1])
    const cited = screen.getByText('2.3 Late payment shall accrue interest at 1.5% per month.').closest('li')
    expect(cited).toHaveClass('highlighted')
    expect(within(cited as HTMLElement).getByText(/northwind\.txt, passage 3/)).toBeInTheDocument()

    // No success toast: the answer is on screen (rule 3); the loading toast is just dismissed.
    expect(shown).toEqual([['dismissed', 'Reading the contract…']])
    expect(screen.queryByText(/Unverified/)).not.toBeInTheDocument()
    // Uncited passages are still reachable, and the risk placeholder is shown.
    expect(screen.getByText(/Other passages considered \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/human review still required/)).toBeInTheDocument()
  })

  it('shows an Unverified badge when the API says the answer is not grounded', async () => {
    await renderWithContractAndAsk('fee?', json(200, { ...answered, grounded: false }))

    expect(await screen.findByRole('status')).toHaveTextContent(/Unverified/)
  })

  it('renders "Not found in contract." distinctly, with the passages still listed', async () => {
    await renderWithContractAndAsk('Who is the CEO?', json(200, { ...answered, answer: 'Not found in contract.', grounded: false, citations: [] }))

    expect(await screen.findByText(/Not found in contract\./)).toBeInTheDocument()
    expect(screen.queryByText(/Unverified/)).not.toBeInTheDocument() // not-found is not an unverified answer
    expect(screen.getByText(/Passages considered \(3\)/)).toBeInTheDocument()
  })

  it('shows the API detail verbatim when the question is rejected', async () => {
    await renderWithContractAndAsk(
      'x',
      json(503, { detail: 'Answer generation unavailable: Anthropic API refused the request (HTTP 429): rate limited' }),
    )

    await waitFor(() =>
      expect(shown).toEqual([['error', 'Answer generation unavailable: Anthropic API refused the request (HTTP 429): rate limited']]),
    )
    expect(screen.queryByText(/Cited passages/)).not.toBeInTheDocument()
  })

  it('asks across all contracts when that scope is chosen', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, [northwind])).mockResolvedValueOnce(json(200, answered))
    render(<App />)
    await screen.findByRole('button', { name: /northwind\.txt/ })
    await userEvent.click(screen.getByLabelText('All contracts'))
    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'liability cap?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await screen.findByText(/The monthly fee is EUR 18,500/)
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).contract_id).toBeNull()
    expect(screen.getByText(/all contracts · claude-sonnet-5/)).toBeInTheDocument()
  })

  it('copies a citation with its source and confirms in a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await renderWithContractAndAsk('fee?', json(200, answered))
    await screen.findByText(/The monthly fee is EUR 18,500/)

    await userEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0])

    expect(writeText).toHaveBeenCalledWith('"2. Fees. The Subscription Fee is EUR 18,500 per month." — northwind.txt, passage 2')
    expect(toast.success).toHaveBeenCalledWith('Citation [1] copied')
  })
})
