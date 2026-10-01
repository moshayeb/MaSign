import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Contract, RiskReview } from './api'

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
const passages = [
  { chunk_id: 'c0', chunk_index: 0, text: '1. Parties.' },
  { chunk_id: 'c1', chunk_index: 1, text: '9. Termination. Customer shall pay fifty percent (50%) of the Fees.' },
]

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// A fake MediaQueryList whose `matches` the test controls and whose change
// listeners the test can fire by hand -- real jsdom has neither, and the
// default `test-setup.ts` stub always reports "narrow" so every other test
// file keeps exercising the pre-MAS-177 tab-switch path unchanged.
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
    if (url.endsWith('/passages')) return json(200, passages)
    return json(404, { detail: `unexpected ${url}` })
  })
})
afterEach(() => vi.restoreAllMocks())

async function openTerminationFinding() {
  await userEvent.click(screen.getByText('View complete analysis'))
  const finding = screen.getByText('Half the fees.').closest('details')!
  await userEvent.click(within(finding).getByText('Termination'))
  expect(finding).toHaveAttribute('open')
}

describe('source side panel on wide screens (MAS-177)', () => {
  it('opens beside the current tab instead of switching to Sources, and focuses its close button', async () => {
    stubMatchMedia(() => false) // no max-width query matches -> isWide
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await screen.findByText('Half the fees.')
    await openTerminationFinding()

    const trigger = screen.getByRole('button', { name: 'Show Termination finding in contract' })
    await userEvent.click(trigger)

    // Overview stays the active tab -- no switch, no lost place.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(window.location.hash).toBe('#nw/overview')

    const panel = screen.getByRole('complementary', { name: /Source passage/ })
    expect(within(panel).getByText('Contract text')).toBeVisible()
    // Scoped id (MAS-177): the hidden Sources tab keeps its own unprefixed
    // `passage-1` in the DOM at the same time, so an unscoped id would be
    // ambiguous -- confirm the one that's actually highlighted is the panel's.
    expect(document.getElementById('panel-passage-1')).toHaveClass('highlighted')
    expect(document.getElementById('passage-1')).not.toHaveClass('highlighted')
    expect(within(panel).getByTestId('quote')).toHaveTextContent('fifty percent (50%)')

    const closeButton = within(panel).getByRole('button', { name: 'Close source passage' })
    expect(closeButton).toHaveFocus()

    await userEvent.click(closeButton)
    expect(screen.queryByRole('complementary', { name: /Source passage/ })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on Escape and returns focus to the citation that opened it', async () => {
    stubMatchMedia(() => false)
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await screen.findByText('Half the fees.')
    await openTerminationFinding()

    const trigger = screen.getByRole('button', { name: 'Show Termination finding in contract' })
    await userEvent.click(trigger)
    await screen.findByRole('complementary', { name: /Source passage/ })

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: /Source passage/ })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('leaves the Sources tab and its own deep link working exactly as before', async () => {
    stubMatchMedia(() => false)
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await screen.findByText('Half the fees.')
    await openTerminationFinding()
    await userEvent.click(screen.getByRole('button', { name: 'Show Termination finding in contract' }))

    await userEvent.click(screen.getByRole('tab', { name: 'Sources' }))
    expect(screen.getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true')
    expect(window.location.hash).toBe('#nw/text')
    expect(within(screen.getByRole('tabpanel')).getByText('Contract text')).toBeVisible()
  })

  it('drops the panel on a resize below the breakpoint, the same as never having opened it', async () => {
    let wide = true
    const mq = stubMatchMedia(() => !wide)
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: /northwind\.txt/ }))[0])
    await screen.findByText('Half the fees.')
    await openTerminationFinding()
    await userEvent.click(screen.getByRole('button', { name: 'Show Termination finding in contract' }))
    await screen.findByRole('complementary', { name: /Source passage/ })

    wide = false
    mq.fire()
    await waitFor(() => expect(screen.queryByRole('complementary', { name: /Source passage/ })).not.toBeInTheDocument())
    // Still the Overview tab, not bounced to Sources by the resize itself.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  })
})
