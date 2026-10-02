import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Contract, QueryResponse } from './api'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

// MAS-196: closes the actual gap behind "can the user choose what model to
// work with" -- MAS-195 only showed which profile(s) a contract had: this
// lets a single "Ask" (not Compare, which always fires both) pick one.

const northwindNoQuality: Contract = {
  contract_id: 'nw',
  filename: 'northwind.txt',
  file_type: 'txt',
  size_bytes: 1,
  character_count: 1,
  chunk_count: 1,
  status: 'processed',
  created_at: '2026-09-16T10:00:00Z',
  indexed_profiles: ['portable'],
}
const northwindBoth: Contract = { ...northwindNoQuality, indexed_profiles: ['portable', 'quality'] }
const acmeBoth: Contract = { ...northwindNoQuality, contract_id: 'acme', filename: 'acme.txt', indexed_profiles: ['portable', 'quality'] }

function response(overrides: Partial<QueryResponse>): QueryResponse {
  return {
    answer: 'The notice period is 30 days.',
    answer_status: 'answered',
    grounded: true,
    citations: [],
    answer_model: 'claude-sonnet-5',
    retrieved_context: [],
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

function mockApi(contracts: Contract[], queryHandler: (body: { profile?: string; contract_id?: string | null }) => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/risks')) return json(404, { detail: 'not reviewed' })
    if (url.endsWith('/passages')) return json(200, [])
    if (url === '/api/contracts') return json(200, contracts)
    if (url === '/api/query') return queryHandler(JSON.parse(String(init?.body ?? '{}')))
    return json(404, { detail: `unexpected ${url}` })
  })
}

async function openAskTab(filename: RegExp) {
  await userEvent.click((await screen.findAllByRole('button', { name: filename }))[0])
  await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))
}

afterEach(() => vi.restoreAllMocks())

describe('choosing the embedding profile for a single question (MAS-196)', () => {
  it('has no picker for a contract with no quality index', async () => {
    mockApi([northwindNoQuality], () => json(200, response({})))
    render(<App />)
    await openAskTab(/northwind\.txt/)

    expect(screen.queryByRole('group', { name: 'Answer with' })).not.toBeInTheDocument()
  })

  it('shows the picker, defaults to Portable, and asking with the default never sends a profile override behavior change', async () => {
    const fetchMock = mockApi([northwindBoth], (body) => json(200, response({ profile: body.profile === 'quality' ? 'quality' : 'portable' })))
    render(<App />)
    await openAskTab(/northwind\.txt/)

    const picker = screen.getByRole('group', { name: 'Answer with' })
    expect(within(picker).getByRole('radio', { name: 'Portable' })).toBeChecked()
    expect(within(picker).getByRole('radio', { name: 'Quality' })).not.toBeChecked()

    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'What is the notice period?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByText(/notice period is 30 days/)

    const queryCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/query')!
    expect((JSON.parse(String(queryCall[1]?.body)) as { profile: string }).profile).toBe('portable')
  })

  it('picking Quality drives the actual request and the answer says which profile ran', async () => {
    const fetchMock = mockApi([northwindBoth], (body) =>
      json(200, response({ profile: body.profile === 'quality' ? 'quality' : 'portable', answer: body.profile === 'quality' ? 'Quality: 30 days.' : 'Portable: 30 days.' })),
    )
    render(<App />)
    await openAskTab(/northwind\.txt/)

    const picker = screen.getByRole('group', { name: 'Answer with' })
    await userEvent.click(within(picker).getByRole('radio', { name: 'Quality' }))
    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'What is the notice period?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText('Quality: 30 days.')).toBeInTheDocument()
    expect(screen.getByText(/Quality embeddings/)).toBeInTheDocument()

    const queryCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/query')!
    expect((JSON.parse(String(queryCall[1]?.body)) as { profile: string }).profile).toBe('quality')
  })

  it('does not say "Quality embeddings" when portable answered', async () => {
    mockApi([northwindBoth], () => json(200, response({ profile: 'portable', answer: 'Portable: 30 days.' })))
    render(<App />)
    await openAskTab(/northwind\.txt/)
    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'What is the notice period?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText('Portable: 30 days.')).toBeInTheDocument()
    expect(screen.queryByText(/Quality embeddings/)).not.toBeInTheDocument()
  })

  it('falls back to Portable, hiding the picker, for the "All contracts" scope', async () => {
    mockApi([northwindBoth], () => json(200, response({})))
    render(<App />)
    await openAskTab(/northwind\.txt/)
    await userEvent.click(within(screen.getByRole('group', { name: 'Answer with' })).getByRole('radio', { name: 'Quality' }))

    await userEvent.click(screen.getByRole('radio', { name: 'All contracts' }))
    expect(screen.queryByRole('group', { name: 'Answer with' })).not.toBeInTheDocument()
  })

  it('a quality pick does not carry over to a different, non-quality contract', async () => {
    const plain: Contract = { ...northwindNoQuality, contract_id: 'plain', filename: 'plain.txt' }
    const fetchMock = mockApi([northwindBoth, plain], (body) => json(200, response({ profile: body.profile === 'quality' ? 'quality' : 'portable' })))
    render(<App />)
    await openAskTab(/northwind\.txt/)
    await userEvent.click(within(screen.getByRole('group', { name: 'Answer with' })).getByRole('radio', { name: 'Quality' }))

    // Selecting a different contract returns to the Overview tab (MAS-104).
    await userEvent.click((await screen.findAllByRole('button', { name: /plain\.txt/ }))[0])
    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))
    expect(screen.queryByRole('group', { name: 'Answer with' })).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'What is the notice period?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/query')).toBe(true))

    const queryCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/query')!
    expect((JSON.parse(String(queryCall[1]?.body)) as { profile: string }).profile).toBe('portable')
  })

  it('remembers Quality when switching back to the same quality-indexed contract', async () => {
    const fetchMock = mockApi([northwindBoth, acmeBoth], (body) => json(200, response({ profile: body.profile === 'quality' ? 'quality' : 'portable' })))
    render(<App />)
    await openAskTab(/northwind\.txt/)
    await userEvent.click(within(screen.getByRole('group', { name: 'Answer with' })).getByRole('radio', { name: 'Quality' }))

    // Each selection returns to the Overview tab (MAS-104).
    await userEvent.click((await screen.findAllByRole('button', { name: /acme\.txt/ }))[0])
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))

    expect(within(screen.getByRole('group', { name: 'Answer with' })).getByRole('radio', { name: 'Quality' })).toBeChecked()

    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'What is the notice period?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/query')).toBe(true))

    const queryCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/query')!
    expect((JSON.parse(String(queryCall[1]?.body)) as { profile: string }).profile).toBe('quality')
  })
})
