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
    expect(within(footer).getByText('© 2026 MaSign · Educational project')).toBeInTheDocument()
    expect(within(footer).getByRole('heading', { name: 'Product' })).toBeInTheDocument()
    expect(within(footer).getByRole('heading', { name: 'Resources' })).toBeInTheDocument()
    expect(within(footer).getByRole('heading', { name: 'Project' })).toBeInTheDocument()
    // At least one GitHub link (column 1, Resources, and the bottom row all carry one).
    expect(within(footer).getAllByRole('link', { name: 'GitHub' })[0]).toHaveAttribute('href', 'https://github.com/moshayeb/MaSign')
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

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Get the clause that proves it/)
    // The CTA appears both in the header nav and the hero.
    const workspaceLinks = screen.getAllByRole('link', { name: /Open workspace/ })
    expect(workspaceLinks.length).toBeGreaterThan(0)
    for (const link of workspaceLinks) expect(link).toHaveAttribute('href', '/workspace')
  })

  it('explains four real MaSign behaviours without unsupported claims (MAS-134)', () => {
    render(<HomePage />)

    expect(screen.getByRole('heading', { name: 'Clear answers. Evidence you can check.' })).toBeInTheDocument()
    for (const title of ['Cited answers', 'Risk review', 'Key terms', 'Honest unknowns']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
    expect(screen.getByText('Open the exact clause behind every answer.')).toBeInTheDocument()
    expect(screen.getByText('MaSign keeps “Not found” and “Not checked” clearly separate.')).toBeInTheDocument()
  })
})

describe('the version in the footer', () => {
  it('matches package.json, so the two cannot drift', () => {
    expect(APP_VERSION).toBe(pkg.version)
  })
})
