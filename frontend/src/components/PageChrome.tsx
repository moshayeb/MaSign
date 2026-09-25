import type { ReactNode } from 'react'
import { Toaster } from 'sonner'
import { Footer } from './Footer'
import { Wordmark } from './Wordmark'

const NAV_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/what-masign-checks', label: 'What MaSign checks' },
  { href: '/documentation', label: 'Documentation' },
]

// The header + toaster + footer every screen shares — the home page, the
// workspace and the public static pages alike, so the site reads as one
// product (MAS-132, nav added MAS-133 now that the pages it points to
// exist). Desktop shows the links inline with "Open workspace" as the
// primary CTA; a phone collapses them into a <details> disclosure, the same
// keyboard-accessible pattern the workspace's own Actions menu already uses,
// so this needed no new interaction code.
export function PageChrome({ children }: { children: ReactNode }) {
  const path = typeof window !== 'undefined' ? window.location.pathname : ''

  return (
    <>
      <Toaster position="top-right" theme="light" richColors closeButton />
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="MaSign home">
            <Wordmark height={26} />
          </a>
          <nav className="topnav" aria-label="Main">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                className={`topnav-link${path === link.href ? ' active' : ''}`}
                href={link.href}
                aria-current={path === link.href ? 'page' : undefined}
              >
                {link.label}
              </a>
            ))}
            <a className="topnav-cta" href="/workspace">
              Open workspace
            </a>
          </nav>
          <details className="topnav-mobile">
            <summary aria-label="Menu">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </summary>
            <nav className="topnav-mobile-list" aria-label="Main">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  className={`link${path === link.href ? ' active' : ''}`}
                  href={link.href}
                  aria-current={path === link.href ? 'page' : undefined}
                >
                  {link.label}
                </a>
              ))}
              <a className="topnav-cta" href="/workspace">
                Open workspace
              </a>
            </nav>
          </details>
        </div>
      </header>
      {children}
      <Footer />
    </>
  )
}
