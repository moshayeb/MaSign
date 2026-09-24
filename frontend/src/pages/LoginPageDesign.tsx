import { Wordmark } from '../components/Wordmark'

// Visual design only (MAS-132) for a login page MaSign does not have yet:
// no real accounts, no registration, no password reset, no session handling.
// Deliberately NOT in `./index.ts`'s PAGES map and not imported by App.tsx or
// main.tsx — there is no route that renders this in the shipped app. It
// exists to be reviewed via a temporary ui-preview screenshot (see
// docs/frontend.md) and to give a future login ticket a starting point, not
// to be reached by a visitor. The form has no onSubmit handler: submitting
// it does nothing, on purpose.
export function LoginPageDesign() {
  return (
    <div className="login-design">
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
          <h1 className="login-heading">Welcome back</h1>
          <form
            className="login-form"
            onSubmit={(event) => {
              // Design only: no account system exists to submit to.
              event.preventDefault()
            }}
          >
            <label className="login-label" htmlFor="login-email">
              Email
            </label>
            <input id="login-email" name="email" type="email" autoComplete="email" className="login-input" />

            <label className="login-label" htmlFor="login-password">
              Password
            </label>
            <input id="login-password" name="password" type="password" autoComplete="current-password" className="login-input" />

            <button type="submit" className="primary login-submit">
              Sign in
            </button>
          </form>
          <div className="login-links">
            {/* Disabled, not a link: there is nowhere real for these to go
                yet (no accounts, no password reset) -- a `#` href would be
                a placeholder link, which this design deliberately avoids. */}
            <button type="button" className="link" disabled>
              Forgot password?
            </button>
            <button type="button" className="link" disabled>
              Create an account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
