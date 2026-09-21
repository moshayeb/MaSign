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
  risks: [
    {
      category: 'payment_terms',
      category_name: 'Payment terms',
      severity: 'Medium',
      reason: 'Late interest is at the top of the usual range.',
      quote: 'Late payment shall accrue interest at 1.5% per month.',
      label: 2,
      chunk_id: 'c2',
      contract_id: 'nw',
      chunk_index: 2,
    },
    {
      category: 'termination',
      category_name: 'Termination',
      severity: 'High',
      reason: 'Termination fee of 50% of the remaining fees.',
      quote: '10. Insurance. …',
      label: 3,
      chunk_id: 'c9',
      contract_id: 'nw',
      chunk_index: 9,
    },
  ],
  answer_status: 'answered',
  risks_checked: true,
  risks_complete: true,
  blocked_passages: [],
  recommended_actions: ['Escalate to legal review before signing: Termination.', 'Raise in negotiation: Payment terms.'],
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

// Routes by URL: the contract list, the selected contract's risk review
// (MAS-81; "never reviewed" here) and the query replies in the order given.
function mockApi(queryReplies: Response[], risks: Response = json(404, { detail: 'This contract has not been reviewed for risks yet.' })) {
  const replies = [...queryReplies]
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith('/risks')) return risks.clone()
    if (url.endsWith('/passages')) return json(200, [])
    if (url === '/api/contracts') return json(200, [northwind])
    if (url === '/api/query') return replies.shift() ?? json(500, { detail: 'no reply scripted' })
    return json(404, { detail: `unexpected ${url}` })
  })
}

const queryCall = (fetchMock: ReturnType<typeof mockApi>) => fetchMock.mock.calls.find(([url]) => String(url) === '/api/query')!

async function renderWithContractAndAsk(question: string, ...responses: Response[]) {
  const fetchMock = mockApi(responses)
  render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: /northwind\.txt/ }))
  await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' })) // the composer lives on the Ask tab (MAS-95)
  await userEvent.type(screen.getByLabelText('Ask about the contract'), question)
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
  return fetchMock
}

describe('asking a question', () => {
  it('sends the question scoped to the selected contract and renders the answer with clickable citations', async () => {
    const fetchMock = await renderWithContractAndAsk('What is the monthly fee?', json(200, answered))

    expect(await screen.findByText(/The monthly fee is EUR 18,500 per month/)).toBeInTheDocument()
    const [, init] = queryCall(fetchMock)
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
    // Uncited passages are still reachable.
    expect(screen.getByText(/Other passages considered \(1\)/)).toBeInTheDocument()
  })

  it('renders each risk flag with severity, reason and the quoted clause, linked to its passage (MAS-16)', async () => {
    await renderWithContractAndAsk('fee?', json(200, answered))
    await screen.findByText(/The monthly fee is EUR 18,500/)

    const flags = screen.getAllByRole('listitem').filter((li) => li.classList.contains('risk'))
    expect(flags).toHaveLength(2)
    expect(flags[0]).toHaveClass('severity-medium')
    expect(within(flags[0]).getByText('Payment terms')).toBeInTheDocument()
    expect(within(flags[0]).getByText(/Late interest is at the top/)).toBeInTheDocument()
    expect(within(flags[0]).getByText(/“Late payment shall accrue interest at 1.5% per month.”/)).toBeInTheDocument()
    expect(flags[1]).toHaveClass('severity-high')
    expect(screen.getByText('Escalate to legal review before signing: Termination.')).toBeInTheDocument()

    // The High flag points at an uncited passage: the collapsed list opens and the passage is highlighted.
    await userEvent.click(within(flags[1]).getByRole('button', { name: 'Show passage 3' }))
    const details = screen.getByText(/Other passages considered/).closest('details') as HTMLDetailsElement
    expect(details.open).toBe(true)
    await waitFor(() => expect(screen.getByText('10. Insurance. …').closest('li')).toHaveClass('highlighted'))
  })

  it('says so when the risk analysis was unavailable, and when nothing was flagged', async () => {
    await renderWithContractAndAsk('fee?', json(200, { ...answered, risks: [], risks_checked: false }))
    expect(await screen.findByText(/Risk analysis was unavailable/)).toBeInTheDocument()
  })

  it('warns that the analysis is incomplete without hiding the verified flags (MAS-74)', async () => {
    await renderWithContractAndAsk('fee?', json(200, { ...answered, risks_complete: false }))
    await screen.findByText(/The monthly fee is EUR 18,500/)

    expect(screen.getByText(/Incomplete analysis/)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('risk'))).toHaveLength(2)
  })

  it('shows a calm message when no risk was flagged', async () => {
    await renderWithContractAndAsk('fee?', json(200, { ...answered, risks: [], risks_checked: true }))
    expect(await screen.findByText(/No risk flagged in the retrieved passages/)).toBeInTheDocument()
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
    const fetchMock = mockApi([json(200, answered)])
    render(<App />)
    await screen.findByRole('button', { name: /northwind\.txt/ })
    await userEvent.click(screen.getByLabelText('All contracts'))
    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'liability cap?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await screen.findByText(/The monthly fee is EUR 18,500/)
    expect(JSON.parse(String(queryCall(fetchMock)[1]?.body)).contract_id).toBeNull()
    expect(screen.getByText(/all contracts · claude-sonnet-5/)).toBeInTheDocument()
  })

  it('clears the answer when a different contract is selected, keeping the draft (MAS-86)', async () => {
    const other: Contract = { ...northwind, contract_id: 'nda', filename: 'nda.pdf', file_type: 'pdf' }
    const replies = [json(200, answered)]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/risks')) return json(404, { detail: 'not reviewed' })
      if (url === '/api/contracts') return json(200, [northwind, other])
      if (url === '/api/query') return replies.shift() ?? json(500, { detail: 'no reply scripted' })
      return json(404, { detail: `unexpected ${url}` })
    })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /northwind\.txt/ }))
    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))
    await userEvent.type(screen.getByLabelText('Ask about the contract'), 'fee?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByText(/The monthly fee is EUR 18,500/)

    await userEvent.click(screen.getByRole('button', { name: /northwind\.txt/ })) // same contract: answer stays
    expect(screen.getByText(/The monthly fee is EUR 18,500/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Ask/ })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('button', { name: /nda\.pdf/ }))
    expect(screen.queryByText(/The monthly fee is EUR 18,500/)).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true') // back to the overview (MAS-95)
    expect(screen.getByLabelText('Ask about the contract')).toHaveValue('fee?')
  })

  it('says which passages the prompt-injection guardrail withheld (MAS-90)', async () => {
    await renderWithContractAndAsk('fee?', json(200, { ...answered, blocked_passages: [3] }))
    await screen.findByText(/The monthly fee is EUR 18,500/)

    expect(screen.getByText(/One passage was withheld from the model/)).toBeInTheDocument()
    expect(screen.getByText(/passage 3 below/)).toBeInTheDocument()
    await userEvent.click(screen.getByText(/Other passages considered/))
    expect(screen.getByText('Withheld from the model')).toBeInTheDocument()
  })

  it('shows a distinct "withheld" outcome when every passage was withheld, never "not found" or "no risk" (MAS-93/94)', async () => {
    const only = answered.retrieved_context.slice(0, 1)
    await renderWithContractAndAsk(
      'what is the monthly invoice?',
      json(200, {
        ...answered,
        answer: 'Could not answer: the passages matching this question were withheld from the model.',
        answer_status: 'withheld',
        grounded: false,
        citations: [],
        retrieved_context: only,
        risks: [],
        risks_checked: false,
        risks_complete: false,
        recommended_actions: [],
        blocked_passages: [1],
      }),
    )
    await screen.findByText(/Could not answer/)

    expect(screen.getByText('Withheld')).toBeInTheDocument()
    expect(screen.queryByText('Not in the text')).not.toBeInTheDocument()
    expect(screen.queryByText(/Not found in contract/)).not.toBeInTheDocument()
    expect(screen.getByText(/The only passage matching this question was withheld from the model/)).toBeInTheDocument()
    expect(screen.getByText(/Risk check not run/)).toBeInTheDocument()
    expect(screen.queryByText(/No risk flagged/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Risk analysis was unavailable/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByText(/Passages considered/))
    expect(screen.getByText('Withheld from the model')).toBeInTheDocument()
  })

  it('counts withheld passages as unchecked when some were withheld (MAS-94)', async () => {
    await renderWithContractAndAsk(
      'fee?',
      json(200, { ...answered, answer: 'NOT_FOUND', answer_status: 'not_found', grounded: false, citations: [], risks: [], recommended_actions: [], risks_complete: false, blocked_passages: [3] }),
    )
    await screen.findByText(/Not found in contract/)

    expect(screen.getByText(/Not in the 2 passages the model was allowed to read \(1 of 3 withheld\)/)).toBeInTheDocument()
    expect(screen.getByText(/No risk flagged in the 2 of 3 passages the model could read; 1 withheld and not graded/)).toBeInTheDocument()
    expect(screen.getByText(/One passage was withheld from the model/)).toBeInTheDocument()
  })

  it('says when a passage was read minus its injected sentences, not withheld (MAS-99)', async () => {
    await renderWithContractAndAsk('fee?', json(200, { ...answered, redacted_passages: [1] }))
    await screen.findByText(/The monthly fee is EUR 18,500/)

    expect(screen.getByText(/Passage 1 contained instructions addressed to the AI: only those sentences were withheld from the model, the rest was read/)).toBeInTheDocument()
    expect(screen.queryByText(/One passage was withheld from the model/)).not.toBeInTheDocument()
    expect(screen.getByText('Sentences withheld')).toBeInTheDocument() // on the cited passage
    expect(screen.getByText(/Grounded · 2 passages/)).toBeInTheDocument() // still a normal, grounded answer
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
