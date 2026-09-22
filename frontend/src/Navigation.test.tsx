import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Contract, RiskReview } from './api'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

// Getting around the workspace (MAS-124): the selection reaches the reader on a
// phone and the keyboard everywhere, and the summary numbers lead to their section.

const long = 'northwind_master_services_agreement_2026_final_signed_copy.txt'

const contracts: Contract[] = [
  {
    contract_id: 'nw',
    filename: long,
    file_type: 'txt',
    size_bytes: 11263,
    character_count: 11263,
    chunk_count: 12,
    status: 'processed',
    created_at: '2026-09-16T10:00:00Z',
    risk_status: 'done',
    risk_worst_severity: 'High',
    document_kind: 'contract',
    document_kind_reasons: [],
  },
  { contract_id: 'hb', filename: 'harbor.txt', file_type: 'txt', size_bytes: 1, character_count: 1, chunk_count: 2, status: 'processed', created_at: '2026-09-18T10:00:00Z', risk_status: null },
]

const review: RiskReview = {
  contract_id: 'nw',
  status: 'done',
  model: 'claude-sonnet-5',
  chunks_total: 12,
  chunks_checked: 12,
  chunks_withheld: 0,
  complete: true,
  key_terms_complete: true,
  error: null,
  updated_at: '2026-09-20T09:00:00Z',
  findings: [{ category: 'liability', category_name: 'Liability cap', severity: 'High', reason: 'Uncapped.', quote: 'unlimited', chunk_id: 'c8', chunk_index: 8 }],
  categories: [{ id: 'liability', name: 'Liability cap', worst_severity: 'High', findings: 1 }],
  key_terms: [],
  coverage: { chunks_total: 12, chunks_checked: 12, unreadable_passages: [], withheld_passages: [], redacted_passages: [], ingestion_notes: [], external_references: [{ name: 'Order Form', chunk_indexes: [1] }] },
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// jsdom has neither scrollIntoView nor matchMedia.
let narrow = false
let scrolled: string[]

beforeEach(() => {
  window.location.hash = ''
  scrolled = []
  narrow = false
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: narrow && query.includes('max-width'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.tagName.toLowerCase() + (this.className ? `.${String(this.className).split(' ')[0]}` : ''))
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/contracts') return json(200, contracts)
    if (url === '/api/contracts/nw/risks') return json(200, review)
    if (url.endsWith('/risks')) return json(404, { detail: 'not reviewed' })
    if (url.endsWith('/passages')) return json(200, [])
    return json(404, { detail: `unexpected ${url}` })
  })
})
afterEach(() => vi.restoreAllMocks())

describe('reaching the selected contract (MAS-124)', () => {
  it('moves focus to the contract heading so the keyboard follows the selection', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(long.replace(/[.]/g, '\\.')) }))

    const heading = await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(scrolled).toEqual([]) // wide screen: the workspace is already visible, so the page stays put
  })

  it('scrolls the workspace into view when the layout is one column', async () => {
    narrow = true
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(long.replace(/[.]/g, '\\.')) }))

    await waitFor(() => expect(scrolled).toContain('h1.workspace-title'))
  })

  it('carries the whole filename in the heading, not a shortened one', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(long.replace(/[.]/g, '\\.')) }))

    // Whether it wraps is a stylesheet question jsdom cannot answer (it loads no
    // CSS); that it is wrapped rather than cut short was checked in the browser
    // at 400 px. Here: the heading holds the name in full.
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(long)
    expect(heading).not.toHaveTextContent('…')
  })
})

describe('the summary tiles lead to their section (MAS-124)', () => {
  it('makes each tile a button that scrolls to the card the number came from', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(long.replace(/[.]/g, '\\.')) }))
    await screen.findByText(/Reviewed · 12 passages/)

    const strip = screen.getByRole('list', { name: 'Review summary' })
    const tiles = within(strip).getAllByRole('button')
    expect(tiles).toHaveLength(4)
    expect(tiles[2]).toHaveAccessibleName('Risks: 1 High graded from your side — go to the section')

    await userEvent.click(tiles[0]) // Key terms
    expect(scrolled.at(-1)).toBe('section.card')
    await waitFor(() => expect(document.querySelector('.card.key-terms')).toHaveFocus())

    await userEvent.click(tiles[2]) // Risks → the review card
    await waitFor(() => expect(document.querySelector('.card.review')).toHaveFocus())

    await userEvent.click(tiles[3]) // Coverage → opens the details
    expect(document.querySelector('.coverage-notice')).toHaveAttribute('open')
  })

  it('leaves the tiles as plain text when there is no review to jump into', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /harbor\.txt/ }))
    await screen.findByText(/uploaded before whole-contract reviews existed/)

    const strip = screen.getByRole('list', { name: 'Review summary' })
    expect(within(strip).queryAllByRole('button')).toEqual([]) // no dead controls
  })
})
