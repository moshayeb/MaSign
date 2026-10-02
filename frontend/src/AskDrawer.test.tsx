import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Contract, QueryResponse, RiskReview } from './api'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

const northwind: Contract = {
  contract_id: 'nw',
  filename: 'northwind.txt',
  file_type: 'txt',
  size_bytes: 1,
  character_count: 1,
  chunk_count: 2,
  status: 'processed',
  created_at: '2026-09-16T10:00:00Z',
  risk_status: 'done',
  risk_worst_severity: 'High',
}

const review: RiskReview = {
  contract_id: 'nw',
  status: 'done',
  model: 'claude-sonnet-5',
  chunks_total: 2,
  chunks_checked: 2,
  chunks_withheld: 0,
  complete: true,
  key_terms_complete: true,
  error: null,
  updated_at: '2026-09-20T09:00:00Z',
  findings: [{ category: 'termination', category_name: 'Termination', severity: 'High', reason: 'Half the fees.', quote: 'fifty percent (50%)', chunk_id: 'c1', chunk_index: 1 }],
  categories: [{ id: 'termination', name: 'Termination', worst_severity: 'High', findings: 1 }],
  key_terms: [],
}

const answered: QueryResponse = {
  answer: 'Payment is due within 30 days [1].',
  grounded: true,
  citations: [{ label: 1, chunk_id: 'c0', contract_id: 'nw', chunk_index: 0, text: 'Payment is due within thirty (30) days.', score: 0.6 }],
  answer_model: 'claude-sonnet-5',
  retrieved_context: [],
  risks: [],
  answer_status: 'answered',
  risks_checked: true,
  risks_complete: true,
  blocked_passages: [],
  recommended_actions: [],
  profile: 'portable',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// Same fake MediaQueryList SourcePanel.test.tsx uses (MAS-177) -- real jsdom
// has neither `matches` nor change listeners, and the default test-setup.ts
// stub always reports "narrow".
function stubMatchMedia(getMatches: () => boolean) {
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return getMatches()
    },
    media: query,
    addEventListener: (_event: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_event: string, cb: () => void) => listeners.delete(cb),
  }))
  return { fire: () => listeners.forEach((cb) => cb()) }
}

beforeEach(() => {
  window.location.hash = ''
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/contracts') return json(200, [northwind])
    if (url.endsWith('/risks')) return json(200, review)
    if (url.endsWith('/passages')) return json(200, [])
    if (url === '/api/query') return json(200, answered)
    return json(404, { detail: `unexpected ${url}` })
  })
})
afterEach(() => vi.restoreAllMocks())

describe('Ask MaSign slide-in drawer on wide screens (MAS-194)', () => {
  it('opens beside the Overview tab instead of switching to it, and focuses its close button', async () => {
    stubMatchMedia(() => false) // no max-width query matches -> isWide
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await screen.findByText('Half the fees.')

    const cta = screen.getByRole('button', { name: 'Ask a question about this contract' })
    await userEvent.click(cta)

    // Overview stays the active tab -- no switch, no lost place.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(window.location.hash).toBe('#nw/overview')

    const panel = screen.getByRole('complementary', { name: 'Ask MaSign' })
    expect(within(panel).getByLabelText('Ask about the contract')).toBeVisible()

    const closeButton = within(panel).getByRole('button', { name: 'Close Ask MaSign' })
    expect(closeButton).toHaveFocus()

    await userEvent.click(closeButton)
    expect(screen.queryByRole('complementary', { name: 'Ask MaSign' })).not.toBeInTheDocument()
    expect(cta).toHaveFocus()
  })

  it('also opens from the Tabs bar\'s own Ask MaSign entry, not just the header CTA', async () => {
    stubMatchMedia(() => false)
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await screen.findByText('Half the fees.')

    await userEvent.click(screen.getByRole('tab', { name: 'Ask MaSign' }))

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('complementary', { name: 'Ask MaSign' })).toBeVisible()
  })

  it('answers a question asked from inside the drawer, same as the plain tab would', async () => {
    stubMatchMedia(() => false)
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await screen.findByText('Half the fees.')
    await userEvent.click(screen.getByRole('button', { name: 'Ask a question about this contract' }))

    const panel = screen.getByRole('complementary', { name: 'Ask MaSign' })
    await userEvent.type(within(panel).getByLabelText('Ask about the contract'), 'When is payment due?')
    await userEvent.click(within(panel).getByRole('button', { name: 'Ask' }))

    expect(await within(panel).findByText(/Payment is due within 30 days/)).toBeVisible()
  })

  it('closes on Escape and returns focus to the citation that opened it', async () => {
    stubMatchMedia(() => false)
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await screen.findByText('Half the fees.')

    const cta = screen.getByRole('button', { name: 'Ask a question about this contract' })
    await userEvent.click(cta)
    await screen.findByRole('complementary', { name: 'Ask MaSign' })

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: 'Ask MaSign' })).not.toBeInTheDocument()
    expect(cta).toHaveFocus()
  })

  it('a source citation inside the drawer takes over from it, same edge as two source panels', async () => {
    stubMatchMedia(() => false)
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await screen.findByText('Half the fees.')
    await userEvent.click(screen.getByRole('button', { name: 'Ask a question about this contract' }))

    const panel = screen.getByRole('complementary', { name: 'Ask MaSign' })
    await userEvent.type(within(panel).getByLabelText('Ask about the contract'), 'When is payment due?')
    await userEvent.click(within(panel).getByRole('button', { name: 'Ask' }))
    await within(panel).findByText(/Payment is due within 30 days/)

    await userEvent.click(within(panel).getByRole('button', { name: 'Show citation 1 in contract' }))

    expect(screen.queryByRole('complementary', { name: 'Ask MaSign' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: /Source passage/ })).toBeVisible()
  })

  it('falls back to the plain tab-switch below the 960px breakpoint, unchanged', async () => {
    // Default test-setup.ts stub: narrow.
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await screen.findByText('Half the fees.')

    await userEvent.click(screen.getByRole('button', { name: 'Ask a question about this contract' }))

    expect(screen.queryByRole('complementary', { name: 'Ask MaSign' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Ask MaSign' })).toHaveAttribute('aria-selected', 'true')
    expect(window.location.hash).toBe('#nw/ask')
  })

  it('closes if a deep link lands directly on the Ask tab while it was open', async () => {
    let wide = true
    const mq = stubMatchMedia(() => !wide)
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await screen.findByText('Half the fees.')
    await userEvent.click(screen.getByRole('button', { name: 'Ask a question about this contract' }))
    await screen.findByRole('complementary', { name: 'Ask MaSign' })

    wide = false
    mq.fire()
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Ask MaSign' })).not.toBeInTheDocument())
  })
})
