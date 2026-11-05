import type { ReactNode } from 'react'
import type { CurrentUser } from '../api'
import { APP_NAV_LINKS } from './navLinks'
import { Wordmark } from './Wordmark'

interface Props {
  // The upload button and the contract list: each page wires its own
  // behaviour (the workspace selects in place, other app pages navigate to it).
  sidebar: ReactNode
  // The signed-in user, once known; null hides the email (never guessed).
  user: CurrentUser | null
  onLogout: () => void
  // Off-canvas sidebar under 960px. The workspace turns it on once a
  // contract is selected; a settings page has it on always.
  drawer: boolean
  drawerOpen: boolean
  onDrawerOpen: (open: boolean) => void
  // The app link for the page being shown, marked as current.
  current?: string
  // What the account area offers when nobody is signed in (MAS-221: the
  // rules page links to sign-in instead of offering Log out).
  signedOut?: ReactNode
  children: ReactNode
}

// The workspace frame (MAS-218, shared since MAS-221): brand, upload and
// contracts on the left, the app links and the account at the foot, and
// on a phone a bar with a "Contracts" toggle that opens it as a drawer.
export function AppFrame({ sidebar, user, onLogout, drawer, drawerOpen, onDrawerOpen, current, signedOut, children }: Props) {
  return (
    <div className={`layout${drawer ? ' has-selection' : ''}${drawerOpen ? ' drawer-open' : ''}`}>
      {/* Mobile drawer (MAS-126): CSS-inert (display: none) except under
          960px in drawer mode, where it is the way back to the sidebar. */}
      {drawer && (
        <div className="mobile-bar">
          <button type="button" className="drawer-toggle" aria-label="Show contracts" aria-expanded={drawerOpen} onClick={() => onDrawerOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            Contracts
          </button>
          <a className="mobile-brand" href="/" aria-label="MaSign home">
            <Wordmark height={19} />
          </a>
        </div>
      )}
      <div className="drawer-backdrop" aria-hidden="true" onClick={() => onDrawerOpen(false)} />
      <aside className="sidebar">
        <a className="sidebar-brand" href="/" aria-label="MaSign home">
          <Wordmark height={22} />
        </a>
        {drawer && (
          <button type="button" className="drawer-close" aria-label="Close" onClick={() => onDrawerOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
        {sidebar}
        {/* MAS-218: the app has no site header, so the site links and the
            account live at the foot of the sidebar (in the drawer on a phone). */}
        <nav className="sidebar-links" aria-label="Main">
          {APP_NAV_LINKS.map((link) => (
            <a
              key={link.href}
              className={`sidebar-link${link.href === current ? ' current' : ''}`}
              href={link.href}
              aria-current={link.href === current ? 'page' : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-account">
          {signedOut ?? (
            <>
              {user?.email && (
                <>
                  <span className="sidebar-avatar" aria-hidden="true">
                    {user.email.charAt(0).toUpperCase()}
                  </span>
                  <span className="sidebar-email">{user.email}</span>
                </>
              )}
              <button type="button" className="link sidebar-logout" onClick={onLogout}>
                Log out
              </button>
            </>
          )}
        </div>
      </aside>
      {children}
    </div>
  )
}
