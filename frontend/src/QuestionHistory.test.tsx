import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Contract, QueryResponse, StoredQuestion } from './api'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

const northwind: Contract = {
  contract_id: 'nw',
  filename: 'northwind.txt',
  file_type: 'txt',
  size_bytes: 1200,
  character_count: 1200,
  chunk_count: 2,
  status: 'processed',
  created_at: '2026-09-16T10:00:00Z',
}

const chunk = (index: number, text: string) => ({ chunk_id: `c${index}`, contract_id: 'nw', chunk_index: index, text, score: 0.6 })

const liveAnswer: QueryResponse = {
  answer: 'The notice period is 30 days [1].',
  answer_status: 'answered',
  grounded: true,
  citations: [{ label: 1, ...chunk(0, '9. Termination. Either party may terminate on 30 days notice.') }],
  answer_model: 'claude-sonnet-5',
  retrieved_context: [chunk(0, '9. Termination. Either party may terminate on 30 days notice.')],
  risks: [],
  risks_checked: true,
  risks_complete: true,
  recommended_actions: [],
  blocked_passages: [],
  redacted_passages: [],
}

const storedResponse: QueryResponse = {
  answer: 'The monthly fee is EUR 18,500 [1].',
  answer_status: 'answered',
  grounded: true,
  citations: [{ label: 1, ...chunk(1, '2. Fees. The Subscription Fee is EUR 18,500 per month.') }],
  answer_model: 'claude-sonnet-5',
  retrieved_context: [chunk(1, '2. Fees. The Subscription Fee is EUR 18,500 per month.')],
  risks: [],
  risks_checked: true,
  risks_complete: true,
  recommended_actions: [],
  blocked_passages: [],
  redacted_passages: [],
}

const storedQuestions: StoredQuestion[] = [
  {
    id: 'q1',
    contract_id: 'nw',
    question: 'What is the monthly fee?',
    answer: storedResponse.answer,
    answer_status: 'answered',
    grounded: true,
    model: 'claude-sonnet-5',
    response: storedResponse,
    created_at: '2026-09-20T09:00:00Z',
  },
]

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mockApi() {
  const questions = [...storedQuestions]
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/api/contracts') return json(200, [northwind])
    if (url === '/api/contracts/nw/risks') return json(404, { detail: 'This contract has not been reviewed for risks yet.' })
    if (url === '/api/contracts/nw/passages') return json(200, [])
    if (url === '/api/contracts/nw/questions') return json(200, [...questions])
    if (url.startsWith('/api/questions/') && init?.method === 'DELETE') {
      const id = url.split('/').pop()
      const index = questions.findIndex((q) => q.id === id)
      if (index === -1) return json(404, { detail: 'Question not found.' })
      questions.splice(index, 1)
      return new Response(null, { status: 204 })
    }
    if (url === '/api/query') {
      questions.unshift({
        id: 'q2',
        contract_id: 'nw',
        question: 'What is the notice period?',
        answer: liveAnswer.answer,
        answer_status: 'answered',
        grounded: true,
        model: 'claude-sonnet-5',
        response: liveAnswer,
        created_at: '2026-09-27T10:00:00Z',
      })
      return json(200, liveAnswer)
    }
    return json(404, { detail: `unexpected ${url}` })
  })
}

beforeEach(() => window.location.hash = '')
afterEach(() => vi.restoreAllMocks())

describe('question history (MAS-102)', () => {
  it('lists previously answered questions under the contract, newest handling and status pills', async () => {
    mockApi()
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))

    const list = await screen.findByRole('list', { name: 'Previous questions' })
    const item = within(list).getByText('What is the monthly fee?')
    expect(item).toBeInTheDocument()
    const row = item.closest('.previous-question') as HTMLElement
    expect(within(row).getByText('Grounded')).toBeInTheDocument()
  })

  it('opening a stored question shows the full answer without a new /api/query call', async () => {
    const fetchMock = mockApi()
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))
    await screen.findByText('What is the monthly fee?')
    const callsBefore = fetchMock.mock.calls.filter(([u]) => String(u) === '/api/query').length

    await userEvent.click(screen.getByText('What is the monthly fee?'))

    expect(await screen.findByText('The monthly fee is EUR 18,500', { exact: false })).toBeInTheDocument()
    const callsAfter = fetchMock.mock.calls.filter(([u]) => String(u) === '/api/query').length
    expect(callsAfter).toBe(callsBefore) // no new model call
    // The tab's own hint now reads "answered" once a response is shown, whether live or stored.
    expect(screen.getByRole('tab', { name: /Ask MaSign/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('asking a live question still calls the API and the new answer appears in the history', async () => {
    mockApi()
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))
    await screen.findByText('What is the monthly fee?')

    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'What is the notice period?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText('The notice period is 30 days', { exact: false })).toBeInTheDocument()
    // The composer's own answer view is the live one; the history list refetches
    // and now includes the just-asked question too.
    await waitFor(() => expect(screen.getByRole('list', { name: 'Previous questions' })).toHaveTextContent('What is the notice period?'))
  })

  it('Forget removes a stored question from the list', async () => {
    mockApi()
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))
    await screen.findByText('What is the monthly fee?')

    await userEvent.click(screen.getByRole('button', { name: /Forget/ }))

    await waitFor(() => expect(screen.queryByText('What is the monthly fee?')).not.toBeInTheDocument())
  })

  it('shows no Previous questions section for a contract with no stored history', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/contracts') return json(200, [northwind])
      if (url === '/api/contracts/nw/risks') return json(404, { detail: 'This contract has not been reviewed for risks yet.' })
      if (url === '/api/contracts/nw/passages') return json(200, [])
      if (url === '/api/contracts/nw/questions') return json(200, [])
      return json(404, { detail: `unexpected ${url}` })
    })
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))

    await screen.findByLabelText('Ask about the contract')
    expect(screen.queryByText('Previous questions')).not.toBeInTheDocument()
  })
})
