import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import pkg from '../package.json'
import App from './App'
import { APP_VERSION } from './version'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

// The application shell (MAS-125): a footer that says what MaSign is, a header
// that carries the logo alone, and no link that points at something missing.

describe('the shell', () => {
  it('shows the disclaimer, the repository and the version in a footer on every screen', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    render(<App />)

    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText('AI-assisted contract review. Verify important terms before signing.')).toBeInTheDocument()
    expect(within(footer).getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/moshayeb/MaSign')
    expect(within(footer).getByText(`Version ${APP_VERSION}`)).toBeInTheDocument()
  })

  it('carries no link to a page that does not exist', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    render(<App />)

    // Only real destinations: the repository, the brand's own home, and downloads.
    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? ''
      expect(href === '/' || href.startsWith('https://github.com/') || href.startsWith('/api/')).toBe(true)
    }
    expect(screen.queryByRole('link', { name: /How it works|About|Privacy|Documentation/ })).not.toBeInTheDocument()
  })

  it('keeps the tagline off the permanent header', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    render(<App />)

    const header = screen.getByRole('banner')
    expect(within(header).getByLabelText('MaSign home')).toBeInTheDocument()
    expect(within(header).queryByText(/with the clause to prove it/)).not.toBeInTheDocument()
    // The landing page still makes the claim, where it belongs.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Get the clause that proves it/)
  })
})

describe('the version in the footer', () => {
  it('matches package.json, so the two cannot drift', () => {
    expect(APP_VERSION).toBe(pkg.version)
  })
})
