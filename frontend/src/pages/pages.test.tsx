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
  ['/documentation', DocumentationPage, 'Documentation'],
  ['/how-it-works', HowItWorksPage, 'How it works'],
  ['/what-masign-checks', WhatMaSignChecksPage, 'What MaSign checks'],
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
