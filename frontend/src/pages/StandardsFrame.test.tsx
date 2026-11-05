import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Contract } from '../api'
import { StandardsPage } from './Standards'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

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

const PROFILE = { id: 'profile-default', name: 'Default', is_default: true }

let assign: Mock<(url: string) => void>

beforeEach(() => {
  assign = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { ...window.location, set href(v: string) { assign(v) } },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mockApi(signedIn: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (!signedIn) return json(401, { detail: 'Sign in to continue.' })
    if (url === '/api/auth/me') return json(200, { email: 'mo@example.com' })
    if (url === '/api/contracts') return json(200, [contract(), contract({ contract_id: 'c2', filename: 'nda.pdf' })])
    if (url === '/api/standard-profiles') return json(200, [PROFILE])
    if (/\/(standards|clauses|policy-rules)$/.test(url)) return json(200, [])
    return json(404, { detail: `unexpected ${url}` })
  })
}

// MAS-221: Comparison rules lives in the same frame as the workspace.
describe('comparison rules in the workspace frame (MAS-221)', () => {
  it('shows the sidebar with this page marked current, and a contract opens in the workspace', async () => {
    mockApi(true)
    render(<StandardsPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Contract comparison rules' })).toBeInTheDocument()
    const sidebar = screen.getByRole('complementary')
    expect(within(sidebar).getByRole('link', { name: 'Comparison rules' })).toHaveAttribute('aria-current', 'page')
    expect(within(sidebar).getByRole('link', { name: 'How it works' })).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('banner')).not.toBeInTheDocument() // no site header any more

    await userEvent.click((await within(sidebar).findAllByRole('button', { name: /nda\.pdf/ }))[0])
    expect(assign).toHaveBeenCalledWith('/workspace#c2')
    expect(await within(sidebar).findByText('mo@example.com')).toBeInTheDocument()
    expect(await screen.findByRole('tablist', { name: 'Standard profiles' })).toBeInTheDocument()
  })

  it('signed out: shows no contracts, offers sign-in, and keeps the page’s own signed-out message', async () => {
    const fetchMock = mockApi(false)
    render(<StandardsPage />)

    expect(await screen.findByRole('link', { name: 'Sign in to manage rules' })).toHaveAttribute('href', '/login')
    const sidebar = screen.getByRole('complementary')
    await waitFor(() => expect(within(sidebar).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login'))
    expect(within(sidebar).queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
    expect(within(sidebar).queryByRole('button', { name: /Upload contract/ })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/contracts')
    expect(assign).not.toHaveBeenCalled() // no redirect: same outcome as before the frame
  })
})


describe('sidebar authorization and recovery (MAS-222)', () => {
  it('does not load contracts or offer upload while identity is pending', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/auth/me') return new Promise<Response>(() => {})
      return json(200, [])
    })
    render(<StandardsPage />)
    const sidebar = screen.getByRole('complementary')
    expect(within(sidebar).getByText('Loading account...')).toBeInTheDocument()
    expect(sidebar.querySelector('.upload')).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/contracts')
  })

  it('does not request contracts after a forbidden identity response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(403, { detail: 'Access denied.' }))
    render(<StandardsPage />)
    const sidebar = screen.getByRole('complementary')
    await within(sidebar).findByRole('link', { name: 'Sign in' })
    expect(sidebar.querySelector('.upload')).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/contracts')
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied.')
  })

  it('retries identity failures without attempting contracts until confirmed', async () => {
    let attempts = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/auth/me') return ++attempts === 1 ? json(503, { detail: 'Identity temporarily unavailable.' }) : json(200, { email: 'mo@example.com' })
      if (url === '/api/contracts') return json(200, [contract()])
      if (url === '/api/standard-profiles') return json(200, [PROFILE])
      return json(200, [])
    })
    render(<StandardsPage />)
    const sidebar = screen.getByRole('complementary')
    await within(sidebar).findByText(/Identity temporarily unavailable/)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/contracts')
    await userEvent.click(within(sidebar).getByRole('button', { name: 'Retry account' }))
    expect((await within(sidebar).findAllByRole('button', { name: /msa.txt/ })).length).toBeGreaterThan(0)
  })

  it('keeps list failure separate from an empty workspace and retries it', async () => {
    let lists = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/auth/me') return json(200, { email: 'mo@example.com' })
      if (url === '/api/contracts') return ++lists === 1 ? json(503, { detail: 'Database unavailable.' }) : json(200, [contract()])
      if (url === '/api/standard-profiles') return json(200, [PROFILE])
      return json(200, [])
    })
    render(<StandardsPage />)
    const sidebar = screen.getByRole('complementary')
    await within(sidebar).findByText(/Could not load your contracts/)
    expect(sidebar).toHaveTextContent('Database unavailable.')
    expect(within(sidebar).queryByText(/No contracts yet/)).not.toBeInTheDocument()
    await userEvent.click(within(sidebar).getByRole('button', { name: 'Refresh contracts' }))
    expect((await within(sidebar).findAllByRole('button', { name: /msa.txt/ })).length).toBeGreaterThan(0)
  })
})


it('opens a newly uploaded contract in the workspace from rules (MAS-221)', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/auth/me') return json(200, { email: 'mo@example.com' })
    if (url === '/api/contracts/upload') return json(201, contract({ contract_id: 'new-contract', filename: 'new.txt' }))
    if (url === '/api/contracts') return json(200, [contract()])
    if (url === '/api/standard-profiles') return json(200, [PROFILE])
    return json(200, [])
  })
  render(<StandardsPage />)
  const sidebar = screen.getByRole('complementary')
  const input = await within(sidebar).findByLabelText('Contract file (TXT, PDF or DOCX, up to 10 MB)')
  await userEvent.upload(input, new File(['Fictional mock contract'], 'new.txt', { type: 'text/plain' }))
  await userEvent.click(within(sidebar).getByRole('button', { name: 'Upload' }))
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/workspace#new-contract'))
})
