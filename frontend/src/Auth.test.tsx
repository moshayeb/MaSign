import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import App from './App'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, Toaster: () => null, toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), promise: vi.fn() }) }
})

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

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

// The workspace shell renders immediately regardless of the auth check
// (App.test.tsx's synchronous shell assertions rely on this); a confirmed
// 401 from /api/auth/me redirects as a side effect rather than blocking
// the initial paint (MAS-143).
describe('workspace auth', () => {
  it('redirects to /login when the session is not valid', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) return json(401, { detail: 'Sign in to continue.' })
      return json(200, [])
    })

    render(<App />)

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))
  })

  it('shows the signed-in email and a working Log out control', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) return json(200, { id: 'u1', email: 'reviewer@example.com' })
      if (url === '/api/auth/logout') return new Response(null, { status: 204 })
      return json(200, [])
    })

    render(<App />)

    // Desktop and mobile nav both render the account control (like every
    // other nav link in PageChrome), so there are two matches.
    expect((await screen.findAllByText('reviewer@example.com'))[0]).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Log out' })[0])

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))
  })

  it('does not redirect on a non-401 failure (e.g. the API is unreachable)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) return json(503, { detail: 'Database unavailable.' })
      return json(503, { detail: 'Database unavailable.' })
    })

    render(<App />)

    // The shell still renders (proving no blind redirect happened) even
    // though the account could not be confirmed.
    expect(await screen.findByText(/No contracts yet/)).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })
})
