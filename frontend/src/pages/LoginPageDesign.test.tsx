import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PAGES } from './index'
import { LoginPageDesign } from './LoginPageDesign'

// MAS-132: a visual design for a future login page, explicitly not wired to
// any route or to auth. These tests prove both halves of that: the
// component itself renders correctly (so it is a real, reviewable design,
// not dead code), and it is nowhere in the table main.tsx uses to decide
// what to render for a path.
describe('LoginPageDesign', () => {
  it('renders the two-panel layout with no working submit', () => {
    render(<LoginPageDesign />)

    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByText('Understand your contract before you sign.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()

    // Not links: there is nowhere real for these to go yet, so a `#` href
    // would itself be a placeholder link — disabled buttons instead.
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create an account' })).toBeDisabled()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    // No account system exists to submit to — clicking through must not throw.
    expect(() => screen.getByRole('button', { name: 'Sign in' }).click()).not.toThrow()
  })

  it('is not registered in the pages map main.tsx routes on', () => {
    expect(Object.values(PAGES)).not.toContain(LoginPageDesign)
  })
})
