import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import pkg from '../package.json'
import App from './App'
import { HomePage } from './HomePage'
import { PAGES } from './pages'
import { APP_VERSION } from './version'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

// The application shell (MAS-125, redesigned MAS-132): a four-column public
// footer, a header that carries the logo alone, and no link that points at
// something missing — every href is either a real in-app page (src/pages/),
// the workspace itself, or a working GitHub URL.

describe('the shell', () => {
  it('shows a four-column footer with real links on every screen', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    render(<App />)

    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText('Understand contracts before you sign.')).toBeInTheDocument()
    expect(within(footer).getByText('© 2026 MaSign')).toBeInTheDocument()
    expect(within(footer).getByRole('heading', { name: 'Product' })).toBeInTheDocument()
    expect(within(footer).getByRole('heading', { name: 'Resources' })).toBeInTheDocument()
    expect(within(footer).getByRole('heading', { name: 'Project' })).toBeInTheDocument()
    // Exactly one GitHub link now (Resources column) — MAS-160 dropped the
    // brand-column and bottom-row duplicates.
    expect(within(footer).getAllByRole('link', { name: 'GitHub' })).toHaveLength(1)
    expect(within(footer).getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/moshayeb/MaSign')
    expect(within(footer).getByRole('link', { name: 'Report an issue' })).toHaveAttribute('href', 'https://github.com/moshayeb/MaSign/issues')
  })

  it('carries no link to a page that does not exist', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    render(<App />)

    // Every href is either a known static page, the home page, the
    // workspace itself, a GitHub URL, or a download — never a placeholder.
    const knownPaths = new Set(['/', '/workspace', ...Object.keys(PAGES)])
    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? ''
      expect(knownPaths.has(href) || href.startsWith('https://github.com/') || href.startsWith('/api/')).toBe(true)
    }
  })

  it('keeps the tagline off the permanent header', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    render(<App />)

    const header = screen.getByRole('banner')
    expect(within(header).getByLabelText('MaSign home')).toBeInTheDocument()
    expect(within(header).queryByText(/with the clause to prove it/)).not.toBeInTheDocument()
    // The workspace's empty state is a functional prompt now, not the pitch.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Select a contract to get started')
  })

  it('makes the marketing claim on the home page, where it belongs (MAS-133)', () => {
    render(<HomePage />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Understand your contract before you sign/)
    // The CTA appears both in the header nav and the hero.
    const workspaceLinks = screen.getAllByRole('link', { name: /Open workspace/ })
    expect(workspaceLinks.length).toBeGreaterThan(0)
    for (const link of workspaceLinks) expect(link).toHaveAttribute('href', '/workspace')
  })

  it('shows the not-legal-advice notice first, on every screen, not only in the footer (MAS-155/MAS-160)', () => {
    render(<HomePage />)

    expect(screen.getByText(/Not legal advice/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Full disclaimer' })).toHaveAttribute('href', '/educational-disclaimer')

    // The workspace carries the same notice — it is in the shared chrome,
    // not a home-page-only marketing line.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    render(<App />)
    expect(screen.getAllByText(/Not legal advice/).length).toBeGreaterThan(0)
  })

  it('explains four real MaSign behaviours without unsupported claims (MAS-134)', () => {
    render(<HomePage />)

    expect(screen.getByRole('heading', { name: 'Why MaSign' })).toBeInTheDocument()
    for (const title of ['Cited answers', 'Risk review', 'Key terms', 'Honest unknowns']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
    expect(screen.getByText('Open the cited passage behind a grounded answer.')).toBeInTheDocument()
    expect(screen.getByText('A clear first read of your contract, with sources you can open.')).toBeInTheDocument()
    expect(screen.getByText('See when information is missing or could not be checked.')).toBeInTheDocument()
  })

  it('keeps one linked proof section and a final workspace action (MAS-171)', () => {
    render(<HomePage />)

    for (const title of ['Cited answers', 'Risk review', 'Key terms', 'Honest unknowns']) {
      const card = screen.getByRole('link', { name: new RegExp(title) })
      expect(card).toHaveClass('home-proof-card')
    }
    expect(screen.queryByRole('heading', { name: 'Source-linked answers' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ready to review a contract?' })).toBeInTheDocument()
    expect(screen.getByText('Upload a contract to see important terms, possible risks, and their source passages together.')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Open workspace' }).at(-1)).toHaveAttribute('href', '/workspace')
  })
})

describe('the version in the footer', () => {
  it('matches package.json, so the two cannot drift', () => {
    expect(APP_VERSION).toBe(pkg.version)
  })
})
