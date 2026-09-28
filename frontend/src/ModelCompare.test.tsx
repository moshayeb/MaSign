import { render, screen } from '@testing-library/react'
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

const northwindNoQuality: Contract = {
  contract_id: 'nw',
  filename: 'northwind.txt',
  file_type: 'txt',
  size_bytes: 11263,
  character_count: 11263,
  chunk_count: 12,
  status: 'processed',
  created_at: '2026-09-16T10:00:00Z',
  indexed_profiles: ['portable'],
}

const northwindCompareReady: Contract = { ...northwindNoQuality, indexed_profiles: ['portable', 'quality'] }

const chunk = (index: number, text: string, score = 0.5) => ({ chunk_id: `c${index}`, contract_id: 'nw', chunk_index: index, text, score })

function response(overrides: Partial<QueryResponse>): QueryResponse {
  return {
    answer: 'answer',
    answer_status: 'answered',
    grounded: true,
    citations: [],
    answer_model: 'claude-sonnet-5',
    retrieved_context: [chunk(0, 'passage text')],
    risks: [],
    risks_checked: true,
    risks_complete: true,
    recommended_actions: [],
    blocked_passages: [],
    redacted_passages: [],
    profile: 'portable',
    ...overrides,
  }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear()
  // Mirrors what real sonner does on a toast.promise rejection: calls
  // toast.error with the message builder's result.
  vi.mocked(toast.promise).mockImplementation(((promise: Promise<unknown>, messages: Record<string, unknown>) => ({
    unwrap: () =>
      promise.then(
        (value) => value,
        (error: Error) => {
          if (typeof messages.error === 'function') toast.error((messages.error as (e: Error) => string)(error))
          throw error
        },
      ),
  })) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mockApi(contract: Contract, queryHandler: (body: { profile?: string }) => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/risks')) return json(404, { detail: 'not reviewed' })
    if (url.endsWith('/passages')) return json(200, [])
    if (url === '/api/contracts') return json(200, [contract])
    if (url === '/api/query') return queryHandler(JSON.parse(String(init?.body ?? '{}')))
    return json(404, { detail: `unexpected ${url}` })
  })
}

async function openAskTab(filename: RegExp) {
  // getAllByRole(...)[0]: the row's own select button always renders before
  // its "Actions for <filename>" menu trigger (MAS-126), and both match a
  // loose filename regex against role=button.
  await userEvent.click((await screen.findAllByRole('button', { name: filename }))[0])
  await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))
}

describe('compare embedding models (MAS-62)', () => {
  it('has no compare button for a contract with no quality index', async () => {
    mockApi(northwindNoQuality, () => json(200, response({})))
    render(<App />)
    await openAskTab(/northwind\.txt/)

    expect(screen.queryByRole('button', { name: /Compare models/ })).not.toBeInTheDocument()
  })

  it('states the doubled cost before comparing, fires both profiles, and shows both answers labelled', async () => {
    const fetchMock = mockApi(northwindCompareReady, (body) =>
      json(
        200,
        response({
          profile: body.profile === 'quality' ? 'quality' : 'portable',
          answer: body.profile === 'quality' ? 'Quality says: 30 days.' : 'Portable says: 30 days.',
        }),
      ),
    )
    render(<App />)
    await openAskTab(/northwind\.txt/)

    const compareButton = screen.getByRole('button', { name: /Compare models/ })
    expect(compareButton).toHaveTextContent('≈ 4 model calls')

    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'What is the notice period?')
    await userEvent.click(compareButton)

    expect(await screen.findByText('Portable says: 30 days.')).toBeInTheDocument()
    expect(screen.getByText('Quality says: 30 days.')).toBeInTheDocument()
    expect(screen.getByText('Portable · ModernBERT')).toBeInTheDocument()
    expect(screen.getByText('Quality · Qwen3-Embedding-4B')).toBeInTheDocument()

    const queryCalls = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/query')
    expect(queryCalls).toHaveLength(2)
    const profiles = queryCalls.map(([, init]) => (JSON.parse(String(init?.body)) as { profile: string }).profile).sort()
    expect(profiles).toEqual(['portable', 'quality'])
  })

  it('exiting the comparison returns to the normal composer view', async () => {
    mockApi(northwindCompareReady, (body) => json(200, response({ profile: body.profile === 'quality' ? 'quality' : 'portable' })))
    render(<App />)
    await openAskTab(/northwind\.txt/)
    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'What is the notice period?')
    await userEvent.click(screen.getByRole('button', { name: /Compare models/ }))
    await screen.findByRole('heading', { name: 'Comparing embedding models' })

    await userEvent.click(screen.getByRole('button', { name: 'Exit comparison' }))

    expect(screen.queryByRole('heading', { name: 'Comparing embedding models' })).not.toBeInTheDocument()
  })

  it('a 409 for an unindexed quality profile is reported and does not crash the view', async () => {
    mockApi(northwindCompareReady, (body) =>
      body.profile === 'quality'
        ? json(409, { detail: "This contract has not been indexed for the 'quality' profile yet." })
        : json(200, response({ profile: 'portable' })),
    )
    render(<App />)
    await openAskTab(/northwind\.txt/)
    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'What is the notice period?')
    await userEvent.click(screen.getByRole('button', { name: /Compare models/ }))

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("This contract has not been indexed for the 'quality' profile yet."))
    // Neither side renders -- Promise.all rejects as a whole, matching one
    // combined outcome for one compare action rather than a half-drawn view.
    expect(screen.queryByRole('heading', { name: 'Comparing embedding models' })).not.toBeInTheDocument()
  })
})
