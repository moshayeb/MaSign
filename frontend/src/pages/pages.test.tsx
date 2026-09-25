import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AboutPage } from './About'
import { DocumentationPage } from './Documentation'
import { EducationalDisclaimerPage } from './EducationalDisclaimer'
import { HowItWorksPage } from './HowItWorks'
import { PAGES } from './index'
import { PrivacyPage } from './Privacy'
import { WhatMaSignChecksPage } from './WhatMaSignChecks'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) } }
})

// MAS-132: every footer link needs a real page behind it. Each one renders
// with the shared header/footer chrome and its own heading.
describe.each([
  ['/about', AboutPage, 'About MaSign'],
  ['/privacy', PrivacyPage, 'Privacy'],
  ['/documentation', DocumentationPage, 'Docs that live with the code'],
  ['/how-it-works', HowItWorksPage, 'From upload to a cited answer'],
  ['/what-masign-checks', WhatMaSignChecksPage, 'A fixed rubric, graded from your side of the deal'],
  ['/educational-disclaimer', EducationalDisclaimerPage, 'Educational disclaimer'],
] as const)('the %s page', (path, Page, heading) => {
  it('renders its heading and the shared header/footer chrome', () => {
    render(<Page />)

    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument() // header
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('heading', { name: 'Product' })).toBeInTheDocument()
  })

  it('is reachable from the same path it is registered under', () => {
    expect(PAGES[path]).toBe(Page)
  })
})

it('the pages map has exactly the six pages the footer links to, no more', () => {
  expect(Object.keys(PAGES).sort()).toEqual(
    ['/about', '/documentation', '/educational-disclaimer', '/how-it-works', '/privacy', '/what-masign-checks'].sort(),
  )
})

// MAS-142: the three content-heavy public pages get the shared card-grid
// layout instead of a single prose block; these checks pin the specific
// content the ticket asks for, not just that a heading renders.
describe('MAS-142 public content pages', () => {
  it('How it works names exactly the three named steps', () => {
    render(<HowItWorksPage />)

    for (const step of ['Upload', 'Review', 'Check sources']) {
      expect(screen.getByRole('heading', { level: 2, name: step })).toBeInTheDocument()
    }
    expect(within(screen.getByRole('main')).getByRole('link', { name: /open workspace/i })).toHaveAttribute('href', '/workspace')
  })

  it('What MaSign checks lists all seven risk categories and the outcome legend', () => {
    render(<WhatMaSignChecksPage />)

    for (const category of [
      'Liability cap',
      'Termination',
      'Indemnification',
      'Auto-renewal',
      'Confidentiality',
      'Payment terms',
      'IP assignment',
    ]) {
      expect(screen.getByRole('heading', { level: 3, name: category })).toBeInTheDocument()
    }
    expect(screen.getByText('Recurring fee')).toBeInTheDocument()
    for (const outcome of ['High', 'Medium', 'Low', 'Not checked']) {
      expect(screen.getByText(outcome)).toBeInTheDocument()
    }
  })

  it('Documentation keeps the real GitHub links and links to the other two pages', () => {
    render(<DocumentationPage />)
    const main = screen.getByRole('main')

    expect(within(main).getByRole('link', { name: 'README on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/moshayeb/MaSign#readme',
    )
    expect(within(main).getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/how-it-works')
    expect(within(main).getByRole('link', { name: 'What MaSign checks' })).toHaveAttribute('href', '/what-masign-checks')
  })
})
