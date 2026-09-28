import { useState, type FormEvent } from 'react'
import { toast, Toaster } from 'sonner'
import { ApiError, login, registerAccount } from '../api'
import { Wordmark } from '../components/Wordmark'

type Mode = 'sign-in' | 'create-account'

// Real accounts (MAS-143): wired to POST /api/auth/login and
// /api/auth/register, replacing the visual-only LoginPageDesign it grew
// from. A successful sign-in or registration sets the session cookie
// server-side and sends the browser straight to the workspace.
export function LoginPage() {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    try {
      if (mode === 'sign-in') {
        await login(email, password)
      } else {
        await registerAccount(email, password)
      }
      window.location.href = '/workspace'
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="login-design">
      <Toaster position="top-right" theme="light" richColors closeButton />
      <div className="login-illustration" aria-hidden="true">
        <div className="login-illustration-dots" />
        <div className="login-illustration-content">
          <p className="login-illustration-line">Understand your contract before you sign.</p>
          <p className="login-illustration-sub">Upload a contract, ask clear questions, and review important clauses with cited sources.</p>
          <div className="login-doc-card">
            <div className="login-doc-card-head">
              <span className="login-doc-card-dot" />
              <span className="login-doc-card-dot" />
              <span className="login-doc-card-dot" />
            </div>
            <div className="login-doc-line long" />
            <div className="login-doc-line" />
            <div className="login-doc-clause">
              <div className="login-doc-line short" />
              <div className="login-doc-line" />
              <span className="login-doc-badge">High risk</span>
            </div>
            <div className="login-doc-line" />
            <div className="login-doc-source">[3] Termination — Section 8.2</div>
          </div>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="login-form-inner">
          <Wordmark height={28} />
          <h1 className="login-heading">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h1>
          <form className="login-form" onSubmit={(event) => void onSubmit(event)}>
            <label className="login-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              className="login-input"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <label className="login-label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              className="login-input"
              required
              minLength={mode === 'create-account' ? 8 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <button type="submit" className="primary login-submit" disabled={submitting}>
              {submitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <div className="login-links">
            {/* No password-reset flow exists yet (MAS-143's course-quality
                scope explicitly excludes it) -- a disabled button, not a `#`
                placeholder link. */}
            <button type="button" className="link" disabled>
              Forgot password?
            </button>
            <button type="button" className="link" onClick={() => setMode(mode === 'sign-in' ? 'create-account' : 'sign-in')}>
              {mode === 'sign-in' ? 'Create an account' : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
