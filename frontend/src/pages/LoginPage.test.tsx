import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { LoginPage } from './LoginPage'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, Toaster: () => null, toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }
})

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let originalHref: string
beforeEach(() => {
  originalHref = window.location.href
  vi.mocked(toast.error).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', originalHref)
})

describe('LoginPage', () => {
  it('signs in and sends the browser to the workspace', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { id: 'u1', email: 'reviewer@example.com' }))
    // jsdom does not implement real navigation; assigning href just updates
    // the location object, which is enough to assert the redirect happened.
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, set href(v: string) { assign(v) } }, writable: true })

    render(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Email'), 'reviewer@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'reviewer@example.com', password: 'correct horse battery staple' }) }),
    )
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/workspace'))
  })

  it('shows the API detail in a toast when sign-in fails, and does not navigate', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { detail: 'Invalid email or password.' }))

    render(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Email'), 'reviewer@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid email or password.'))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument() // still on the form
  })

  it('toggles to account creation and posts to register instead', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(201, { id: 'u2', email: 'new@example.com' }))

    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(screen.getByText('Create your account')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough password')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({ method: 'POST' }))
  })

  it('has a disabled forgot-password control, no placeholder link (MAS-143 scope)', () => {
    render(<LoginPage />)
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeDisabled()
  })
})
