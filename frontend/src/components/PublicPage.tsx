import type { ReactNode } from 'react'
import { PageChrome } from './PageChrome'

// Shared layout for the three content-heavy public pages (MAS-142): How it
// works, What MaSign checks, Documentation. Same header/footer chrome as
// every other page (PageChrome), but a hero + card-grid body instead of
// StaticPage's single narrow prose column — for pages that need to show
// several distinct pieces of information, not one continuous read. About,
// Privacy and the educational disclaimer stay on StaticPage: they are a
// single legal/informational statement, not a feature explainer.
export function PublicPage({
  eyebrow,
  title,
  subtitle,
  cta,
  children,
}: {
  eyebrow?: string
  title: string
  subtitle?: ReactNode
  cta?: ReactNode
  children: ReactNode
}) {
  return (
    <PageChrome>
      <main className="content pubpage">
        <section className="pubpage-hero">
          {eyebrow && <p className="pubpage-eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {subtitle && <p className="pubpage-subtitle">{subtitle}</p>}
          {cta}
        </section>
        {children}
      </main>
    </PageChrome>
  )
}

export function PublicPageIcon({ children }: { children: ReactNode }) {
  return (
    <span className="pubpage-icon" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  )
}

export function OpenWorkspaceCta() {
  return (
    <a className="primary pubpage-cta" href="/workspace">
      Open workspace
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </a>
  )
}
